import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync(new URL('./src/trimmer.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const defaultProbe = JSON.stringify({ format: { duration: '8' }, streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] })

function harness({ outputSize = 1000, probe = defaultProbe, probeCode = 0, hooks = {} } = {}) {
  let instances = 0
  let executions = 0
  let probes = 0
  const engines = []
  const exports = {}
  class FFmpeg {
    loaded = false
    terminations = 0
    deleted = []
    commands = []
    listeners = new Map()
    constructor() { instances++; engines.push(this) }
    on(event, callback) { this.listeners.set(event, callback) }
    off(event) { this.listeners.delete(event) }
    async load() { this.loaded = true; await hooks.load?.() }
    async writeFile() {}
    async deleteFile(path) { this.deleted.push(path); await hooks.deleteFile?.(path) }
    async ffprobe() { probes++; return probeCode }
    terminate() { this.loaded = false; this.terminations++ }
    async exec(args) {
      executions++
      this.commands.push(args)
      const progress = this.listeners.get('progress')
      for (const value of [NaN, Infinity, -1, 1.1, 0, 0.2, 0.6, 0.4, 1]) progress({ progress: value })
      return hooks.execCode ?? 0
    }
    async readFile(path) {
      if (path === 'probe.json') return probe
      return new Uint8Array(outputSize)
    }
  }
  vm.runInNewContext(compiled, {
    exports, Blob, Uint8Array, DOMException,
    require(name) {
      if (name === '@ffmpeg/ffmpeg') return { FFmpeg }
      if (name === '@ffmpeg/util') return { fetchFile: async () => new Uint8Array(1) }
      if (name.startsWith('@ffmpeg/core')) return { default: name }
      throw new Error(`Unexpected module: ${name}`)
    },
  })
  const run = async (settings = { startSec: 1, endSec: 3 }, signal = new AbortController().signal) => {
    const updates = []
    const result = await exports.trimVideo({ size: 2_000_000 }, settings, (update) => updates.push(update), signal)
    return { updates, result }
  }
  return { run, dispose: exports.disposeIdleEngine, instances: () => instances, executions: () => executions, probes: () => probes, engines, api: exports }
}

function pair(args, flag) {
  const index = args.indexOf(flag)
  return index === -1 ? undefined : args[index + 1]
}

test('invalid range does not execute ffmpeg', async () => {
  const engine = harness()
  const cases = [
    [{ startSec: Number.NaN, endSec: 2 }, /números finitos/],
    [{ startSec: Number.POSITIVE_INFINITY, endSec: 2 }, /números finitos/],
    [{ startSec: -0.01, endSec: 2 }, /negativo/],
    [{ startSec: 2, endSec: 2 }, /posterior al inicio/],
    [{ startSec: 2, endSec: 1 }, /posterior al inicio/],
    [{ startSec: 0, endSec: 0.09 }, /0,1 segundos/],
  ]
  for (const [settings, pattern] of cases) await assert.rejects(engine.run(settings), pattern)
  assert.equal(engine.instances(), 0)
  assert.equal(engine.executions(), 0)
  assert.equal(engine.probes(), 0)
  await assert.rejects(engine.run({ startSec: 0, endSec: 8.06 }), /supera la duración/)
  assert.equal(engine.executions(), 0)
  assert.equal(engine.probes(), 1)
})

test('invalid ffmpeg progress never moves backward', async () => {
  const engine = harness()
  const first = await engine.run()
  const second = await engine.run()
  assert.equal(engine.instances(), 1)
  const trimming = second.updates.filter((update) => update.phase === 'trimming').map((update) => update.progress)
  assert.deepEqual(trimming, [0, 0, 0.2, 0.6, 0.6, 1])
  for (let index = 1; index < trimming.length; index++) assert.ok(trimming[index] >= trimming[index - 1])
  for (const update of second.updates) assert.ok(Number.isFinite(update.progress) && update.progress >= 0 && update.progress <= 1)
  assert.deepEqual(trimming, first.updates.filter((update) => update.phase === 'trimming').map((update) => update.progress))
  assert.equal(second.updates.at(-1).progress, 1)
})

test('cancel during load aborts and does not reuse the engine', async () => {
  const engine = harness()
  const controller = new AbortController()
  const pending = engine.run({ startSec: 1, endSec: 3 }, controller.signal)
  controller.abort()
  engine.dispose()
  await assert.rejects(pending, { name: 'AbortError', message: 'Recorte cancelado.' })
  assert.equal(engine.instances(), 1)
  assert.ok(engine.engines[0].terminations > 0)
  assert.equal(engine.engines[0].listeners.size, 0)
  await engine.run()
  assert.equal(engine.instances(), 2)
})

test('dispose and a new trim load another instance', async () => {
  const engine = harness()
  engine.dispose()
  engine.dispose()
  assert.equal(engine.instances(), 0)
  await engine.run()
  engine.dispose()
  const { updates } = await engine.run()
  assert.equal(engine.instances(), 2)
  assert.equal(updates[0].phase, 'loading')
  assert.equal(engine.engines[0].terminations, 1)
  assert.equal(engine.engines[1].terminations, 0)
  assert.equal(engine.engines[1].loaded, true)
})

test('successful trim returns a blob, deletes temporaries and reuses the engine', async () => {
  const engine = harness()
  const { updates, result } = await engine.run({ startSec: 1, endSec: 3 })
  assert.equal(updates[0].phase, 'loading')
  assert.ok(result.blob instanceof Blob)
  assert.equal(result.blob.type, 'video/mp4')
  assert.equal(result.blob.size, 1000)
  assert.equal(result.startSec, 1)
  assert.equal(result.endSec, 3)
  assert.equal(result.durationSec, 2)
  assert.deepEqual(engine.engines[0].deleted, ['input', 'probe.json', 'output.mp4'])
  assert.equal(engine.engines[0].terminations, 0)
  assert.equal(engine.engines[0].listeners.size, 0)
  const args = engine.engines[0].commands[0]
  const inputAt = args.indexOf('-i')
  assert.ok(inputAt !== -1)
  assert.ok(args.indexOf('-ss') > inputAt)
  assert.ok(args.indexOf('-to') > inputAt)
  assert.equal(args.filter((arg) => arg === '-ss').length, 1)
  assert.equal(pair(args, '-ss'), '1')
  assert.equal(pair(args, '-to'), '3')
  assert.equal(pair(args, '-c:v'), 'libx264')
  assert.equal(pair(args, '-preset'), 'superfast')
  assert.equal(pair(args, '-crf'), '23')
  assert.equal(pair(args, '-pix_fmt'), 'yuv420p')
  assert.equal(pair(args, '-c:a'), 'aac')
  assert.equal(pair(args, '-b:a'), '128k')
  assert.equal(pair(args, '-movflags'), '+faststart')
  assert.equal(args.includes('-an'), false)
  assert.ok(args.includes('-map') && args.includes('0:v:0') && args.includes('0:a:0'))
  assert.ok(args.includes('-sn') && args.includes('-dn'))
  assert.equal(args.some((arg) => arg.includes('scale')), false)
  const second = await engine.run({ startSec: 1, endSec: 3 })
  assert.equal(engine.instances(), 1)
  assert.equal(second.updates[0].phase, 'analyzing')
  assert.equal(engine.engines[0].terminations, 0)
  assert.deepEqual(engine.engines[0].deleted, ['input', 'probe.json', 'output.mp4', 'input', 'probe.json', 'output.mp4'])
})

test('video without audio passes -an', async () => {
  const engine = harness({ probe: JSON.stringify({ format: { duration: '8' }, streams: [{ codec_type: 'video' }] }) })
  await engine.run({ startSec: 0, endSec: 2 })
  const args = engine.engines[0].commands[0]
  assert.ok(args.includes('-an'))
  assert.equal(args.includes('0:a:0'), false)
  assert.equal(args.includes('-c:a'), false)
  assert.equal(args.includes('128k'), false)
  assert.ok(args.includes('0:v:0'))
  assert.ok(args.includes('-sn') && args.includes('-dn'))
})

test('broken probe fails with a spanish error', async () => {
  const broken = harness({ probe: '{' })
  await assert.rejects(broken.run(), { message: 'No se puede leer este video. Comprueba que no esté dañado.' })
  assert.equal(broken.executions(), 0)
  assert.equal(broken.engines[0].terminations, 1)
  assert.equal(broken.engines[0].listeners.size, 0)

  const unreadable = harness({ probeCode: 2 })
  await assert.rejects(unreadable.run(), { message: 'No se puede leer este video. Comprueba que no esté dañado.' })
  assert.equal(unreadable.executions(), 0)

  const silent = harness({ probe: JSON.stringify({ format: { duration: '8' }, streams: [{ codec_type: 'audio' }] }) })
  await assert.rejects(silent.run(), { message: 'El archivo no contiene una pista de video compatible.' })
  assert.equal(silent.executions(), 0)

  const timeless = harness({ probe: JSON.stringify({ format: { duration: 'no' }, streams: [{ codec_type: 'video' }] }) })
  await assert.rejects(timeless.run(), { message: 'No se pudo leer una duración válida del video.' })
  assert.equal(timeless.executions(), 0)
})

test('clampTrimEdge keeps at least 0.1s inside the duration', () => {
  const { clampTrimEdge } = harness().api
  const cases = [
    ['start', -4, 1, 4, 10, 0, 4],
    ['start', 9, 1, 4, 10, 3.9, 4],
    ['end', 40, 1, 4, 10, 1, 10],
    ['end', 1.02, 1, 4, 10, 1, 1.1],
    ['start', 0, 0, 8, 8, 0, 8],
    ['end', 8, 0, 8, 8, 0, 8],
  ]
  for (const [edge, seconds, start, end, duration, expectedStart, expectedEnd] of cases) {
    const next = clampTrimEdge(edge, seconds, start, end, duration)
    assert.deepEqual(next, { start: expectedStart, end: expectedEnd })
    assert.ok(next.start >= 0)
    assert.ok(next.end <= duration)
    assert.ok(next.end - next.start >= 0.1 - 1e-9)
    if (edge === 'start') assert.equal(next.end, expectedEnd)
    else assert.equal(next.start, expectedStart)
  }
})

test('previewPlayback stays inside the selected trim', () => {
  const { previewPlayback } = harness().api
  const before = previewPlayback(0.4, 1, 4)
  assert.equal(before.jumpToStart, true, 'antes del inicio salta al inicio')
  assert.equal(before.pause, false)
  const inside = previewPlayback(2.5, 1, 4)
  assert.equal(inside.jumpToStart, false, 'dentro del tramo no salta')
  assert.equal(inside.pause, false, 'dentro del tramo no pausa')
  const atStart = previewPlayback(1, 1, 4)
  assert.deepEqual(atStart, { jumpToStart: false, pause: false })
  const atEnd = previewPlayback(4, 1, 4)
  assert.equal(atEnd.pause, true, 'al llegar al fin pausa')
  const replay = previewPlayback(4, 1, 4)
  assert.equal(replay.jumpToStart, true, 'otro play con el tiempo en el fin vuelve al inicio')
  const past = previewPlayback(4.25, 1, 4)
  assert.equal(past.pause, true)
  assert.equal(past.jumpToStart, true)
})

test('formatTrimClock formats 0, 65 and 65.4', () => {
  const { formatTrimClock } = harness().api
  assert.equal(formatTrimClock(0), '0:00')
  assert.equal(formatTrimClock(65), '1:05')
  assert.equal(formatTrimClock(65.4), '1:05,4')
})

test('failed temporary cleanup terminates and does not reuse the engine', async () => {
  const engine = harness({ hooks: { deleteFile() { throw new Error('delete failed') } } })
  const { result } = await engine.run()
  assert.equal(result.blob.size, 1000)
  assert.ok(engine.engines[0].terminations > 0)
  assert.equal(engine.engines[0].listeners.size, 0)
  await engine.run()
  assert.equal(engine.instances(), 2)
})
