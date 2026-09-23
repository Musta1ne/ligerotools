import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'

export interface TrimSettings {
  startSec: number
  endSec: number
}
export interface TrimUpdate {
  phase: 'loading' | 'analyzing' | 'trimming' | 'finalizing'
  progress: number
  message: string
}
export interface TrimResult {
  blob: Blob
  durationSec: number
  startSec: number
  endSec: number
}
export const MAX_INPUT_BYTES = 500_000_000
const MIN_TRIM_SECONDS = 0.1

export type TrimEdge = 'start' | 'end'

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function roundMillis(value: number) {
  return Math.round(value * 1000) / 1000
}

export function formatTrimClock(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const tenths = Math.round(safe * 10)
  const whole = Math.floor(tenths / 10)
  const fraction = tenths % 10
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  const body = `${minutes}:${String(secs).padStart(2, '0')}`
  return fraction === 0 ? body : `${body},${fraction}`
}

export function clampTrimEdge(edge: TrimEdge, seconds: number, start: number, end: number, duration: number) {
  const length = Number.isFinite(duration) && duration > 0 ? duration : 0
  const minSpan = Math.min(MIN_TRIM_SECONDS, length)
  let nextStart = clamp(finiteOr(start, 0), 0, length)
  let nextEnd = clamp(finiteOr(end, length), 0, length)
  if (nextEnd < nextStart) nextEnd = nextStart
  if (edge === 'start') {
    const proposed = clamp(finiteOr(seconds, nextStart), 0, length)
    nextStart = Math.min(proposed, Math.max(0, nextEnd - minSpan))
    if (nextEnd - nextStart < minSpan - 1e-6) nextEnd = Math.min(length, nextStart + minSpan)
  } else {
    const proposed = clamp(finiteOr(seconds, nextEnd), 0, length)
    nextEnd = Math.max(proposed, Math.min(length, nextStart + minSpan))
    if (nextEnd - nextStart < minSpan - 1e-6) nextStart = Math.max(0, nextEnd - minSpan)
  }
  return { start: roundMillis(nextStart), end: roundMillis(nextEnd) }
}

let idleEngine: FFmpeg | undefined

function throwTrimAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Recorte cancelado.', 'AbortError')
}

export function disposeIdleEngine() {
  const idle = idleEngine
  idleEngine = undefined
  idle?.terminate()
}

export function trimRangeError(startSec: number, endSec: number, durationSec?: number) {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec)) return 'El inicio y el fin del recorte deben ser números finitos.'
  if (startSec < 0) return 'El inicio del recorte no puede ser negativo.'
  if (endSec <= startSec) return 'El fin del recorte debe ser posterior al inicio.'
  if (endSec - startSec < MIN_TRIM_SECONDS) return 'El recorte debe durar al menos 0,1 segundos.'
  if (durationSec !== undefined && endSec > durationSec + 0.05) return 'El fin del recorte supera la duración del video.'
  return ''
}

export async function trimVideo(
  file: File,
  settings: TrimSettings,
  onUpdate: (update: TrimUpdate) => void,
  signal: AbortSignal,
): Promise<TrimResult> {
  throwTrimAborted(signal)
  if (!file.size || file.size > MAX_INPUT_BYTES) throw new Error('Selecciona un video de hasta 500 MB que no esté vacío.')
  const { startSec, endSec } = settings
  const earlyError = trimRangeError(startSec, endSec)
  if (earlyError) throw new Error(earlyError)

  const ffmpeg = idleEngine ?? new FFmpeg()
  idleEngine = undefined
  const abort = () => ffmpeg.terminate()
  signal.addEventListener('abort', abort, { once: true })
  let encoding = false
  let reusable = false
  let lastProgress = 0
  const reportProgress = (progress: number) => {
    if (!encoding || signal.aborted || !Number.isFinite(progress) || progress < 0 || progress > 1) return
    lastProgress = Math.max(lastProgress, progress)
    onUpdate({ phase: 'trimming', progress: lastProgress, message: 'Recortando en tu dispositivo…' })
  }
  const onProgress = ({ progress }: { progress: number }) => reportProgress(progress)
  const onLog = ({ message }: { message: string }) => {
    const match = /time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message)
    if (!match) return
    const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
    reportProgress(seconds / (endSec - startSec))
  }
  ffmpeg.on('progress', onProgress)
  ffmpeg.on('log', onLog)
  try {
    signal.throwIfAborted()
    if (!ffmpeg.loaded) {
      onUpdate({ phase: 'loading', progress: 0, message: 'Cargando el motor WASM local (aprox. 32 MB)…' })
      signal.throwIfAborted()
      await ffmpeg.load({ coreURL, wasmURL })
    }
    signal.throwIfAborted()
    onUpdate({ phase: 'analyzing', progress: 0, message: 'Leyendo el video…' })
    const bytes = await fetchFile(file)
    signal.throwIfAborted()
    await ffmpeg.writeFile('input', bytes)
    const probeCode = await ffmpeg.ffprobe(['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', 'input', '-o', 'probe.json'])
    if (probeCode !== 0 && probeCode !== -1) throw new Error('No se puede leer este video. Comprueba que no esté dañado.')
    const probeText = await ffmpeg.readFile('probe.json', 'utf8')
    if (typeof probeText !== 'string') throw new Error('No se pudo analizar el video.')
    let probe: { format?: { duration?: string }; streams?: { codec_type?: string }[] }
    try {
      probe = JSON.parse(probeText)
      if (!probe || !Array.isArray(probe.streams)) throw new Error()
    } catch {
      throw new Error('No se puede leer este video. Comprueba que no esté dañado.')
    }
    if (!probe.streams?.some((stream) => stream.codec_type === 'video')) throw new Error('El archivo no contiene una pista de video compatible.')
    const durationSec = Number(probe.format?.duration)
    if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('No se pudo leer una duración válida del video.')
    const rangeError = trimRangeError(startSec, endSec, durationSec)
    if (rangeError) throw new Error(rangeError)
    const hasAudio = probe.streams.some((stream) => stream.codec_type === 'audio')
    signal.throwIfAborted()
    encoding = true
    reportProgress(0)
    const code = await ffmpeg.exec([
      '-y', '-i', 'input', '-ss', String(startSec), '-to', String(endSec),
      '-map', '0:v:0', ...(hasAudio ? ['-map', '0:a:0'] : []), '-sn', '-dn',
      '-c:v', 'libx264', '-preset', 'superfast', '-crf', '23', '-pix_fmt', 'yuv420p',
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-movflags', '+faststart', 'output.mp4',
    ])
    encoding = false
    signal.throwIfAborted()
    if (code !== 0) throw new Error('No se pudo recortar el video. El formato puede no ser compatible o puede faltar memoria.')
    const data = await ffmpeg.readFile('output.mp4')
    if (typeof data === 'string' || !data.length) throw new Error('El resultado está vacío.')
    onUpdate({ phase: 'finalizing', progress: lastProgress, message: 'Preparando tu MP4…' })
    const blob = new Blob([new Uint8Array(data)], { type: 'video/mp4' })
    signal.throwIfAborted()
    reusable = true
    onUpdate({ phase: 'finalizing', progress: 1, message: 'Video listo para descargar.' })
    return { blob, durationSec: endSec - startSec, startSec, endSec }
  } catch (error) {
    throwTrimAborted(signal)
    throw error
  } finally {
    encoding = false
    ffmpeg.off('progress', onProgress)
    ffmpeg.off('log', onLog)
    if (reusable && !signal.aborted) {
      try {
        for (const path of ['input', 'probe.json', 'output.mp4']) await ffmpeg.deleteFile(path)
      } catch {
        reusable = false
      }
    }
    signal.removeEventListener('abort', abort)
    if (reusable && !signal.aborted && idleEngine === undefined) idleEngine = ffmpeg
    else ffmpeg.terminate()
    throwTrimAborted(signal)
  }
}
