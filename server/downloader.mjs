import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseVideoURL, qualityOptions, safeFilename } from './downloader-core.mjs'

const PORT = Number(process.env.DOWNLOADER_PORT || 8787)
const HOST = process.env.DOWNLOADER_HOST || '127.0.0.1'
const allowedOrigin = process.env.DOWNLOADER_ORIGIN || ''
const sessions = new Map()
const jobs = new Map()
const SESSION_TTL = 10 * 60_000
const FILE_TTL = 20 * 60_000
let active = 0

function headers(request) {
  const origin = request.headers.origin
  return {
    'Cache-Control': 'no-store',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    ...(allowedOrigin && origin === allowedOrigin
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      : {}),
  }
}

function json(request, response, status, data) {
  response.writeHead(status, {
    ...headers(request),
    'Content-Type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(data))
}

function runYtDlp(args, { timeout = 60_000, signal, onOutput } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.env.YT_DLP_PATH || 'yt-dlp',
      [
        '--ignore-config',
        '--no-playlist',
        '--no-warnings',
        '--socket-timeout',
        '15',
        '--retries',
        '2',
        '--extractor-retries',
        '2',
        ...args,
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    let stdout = ''
    let settled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(error)
    }
    const abort = () => child.kill()
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error('La plataforma tardó demasiado en responder.'))
    }, timeout)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.on('error', () => fail(new Error('No se encontró yt-dlp en el servidor.')))
    child.stdout.on('data', (chunk) => {
      if (onOutput) onOutput(String(chunk))
      else if (stdout.length < 8_000_000) stdout += chunk
      else child.kill()
    })
    child.stderr.resume()
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      if (signal?.aborted) reject(new Error('Descarga cancelada.'))
      else if (code !== 0)
        reject(
          new Error(
            'No se pudo obtener este video. Puede ser privado, estar bloqueado o haber cambiado la plataforma.',
          ),
        )
      else resolve(stdout)
    })
  })
}

function runFfmpeg(input, output, option) {
  return new Promise((resolve, reject) => {
    const scale = option.portrait ? `${option.height}:-2` : `-2:${option.height}`
    const child = spawn(
      process.env.FFMPEG_PATH || 'ffmpeg',
      [
        '-nostdin',
        '-y',
        '-i',
        input,
        '-vf',
        `scale=${scale}`,
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        output,
      ],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    )
    child.stderr.resume()
    const timer = setTimeout(() => child.kill(), 10 * 60_000)
    child.on('error', () => {
      clearTimeout(timer)
      reject(new Error('No se encontró FFmpeg en el servidor.'))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('No se pudo crear la calidad seleccionada.'))
    })
  })
}

async function body(request) {
  let text = ''
  for await (const chunk of request) {
    text += chunk
    if (text.length > 4096) throw new Error('Solicitud demasiado grande.')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('Solicitud inválida.')
  }
}

async function startJob(job, session, option) {
  const kind = job.kind
  active++
  try {
    job.dir = await mkdtemp(join(tmpdir(), 'ligero-downloader-'))
    const output = join(job.dir, 'download.%(ext)s')
    const args = ['--no-part', '--max-filesize', '1G', '-o', output]
    if (kind === 'audio') args.push('-f', 'bestaudio/best', '-x', '--audio-format', 'mp3')
    else {
      args.push(
        '-f',
        option.hasAudio ? option.formatId : `${option.formatId}+bestaudio`,
        '--merge-output-format',
        'mp4',
        '--recode-video',
        'mp4',
      )
    }
    args.push('--', session.url)
    await runYtDlp(args, { timeout: 10 * 60_000 })
    const files = await readdir(job.dir)
    const extension = kind === 'audio' ? '.mp3' : '.mp4'
    const file = files.find((name) => name.endsWith(extension))
    if (!file) throw new Error('No se generó el archivo solicitado.')
    job.file = join(job.dir, file)
    if (kind === 'video' && option.transcode) {
      const scaled = join(job.dir, 'scaled.mp4')
      await runFfmpeg(job.file, scaled, option)
      await rm(job.file)
      job.file = scaled
    }
    job.size = (await stat(job.file)).size
    if (!job.size) throw new Error('El archivo descargado está vacío.')
    job.status = 'ready'
  } catch (error) {
    job.status = 'error'
    job.error = error instanceof Error ? error.message : 'No se pudo preparar el archivo.'
    if (job.dir) await rm(job.dir, { recursive: true, force: true }).catch(() => {})
    job.dir = null
  } finally {
    job.completed = Date.now()
    active--
  }
  return job
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url || '/', 'http://localhost').pathname
  const origin = request.headers.origin
  if (
    origin &&
    origin !== `http://${request.headers.host}` &&
    origin !== `https://${request.headers.host}` &&
    origin !== allowedOrigin
  ) {
    return json(request, response, 403, { error: 'Origen no permitido.' })
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...headers(request),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return response.end()
  }
  try {
    if (request.method === 'GET' && pathname === '/api/downloader/health') {
      return json(request, response, 200, { ok: true })
    }
    if (request.method === 'POST' && pathname === '/api/downloader/inspect') {
      if (active >= 2)
        return json(request, response, 429, {
          error: 'El servicio está ocupado. Intenta de nuevo en un momento.',
        })
      const url = parseVideoURL((await body(request)).url)
      active++
      let info
      try {
        info = JSON.parse(await runYtDlp(['--dump-single-json', '--skip-download', '--', url]))
      } finally {
        active--
      }
      const options = qualityOptions(info)
      if (!options.length) throw new Error('No se encontraron calidades de video disponibles.')
      const id = randomUUID()
      const title = String(info.title || 'Video').slice(0, 180)
      sessions.set(id, { url, title, options, created: Date.now() })
      return json(request, response, 200, {
        id,
        title,
        platform: String(info.extractor_key || '').slice(0, 60),
        duration: Number(info.duration) || null,
        qualities: options.map(({ height }) => height),
      })
    }
    if (request.method === 'POST' && pathname === '/api/downloader/jobs') {
      if (active >= 2)
        return json(request, response, 429, {
          error: 'El servicio está ocupado. Intenta de nuevo en un momento.',
        })
      const { id: sessionId, kind, height } = await body(request)
      const session = sessions.get(sessionId)
      if (!session || Date.now() - session.created > SESSION_TTL)
        throw new Error('El enlace caducó. Vuelve a consultarlo.')
      if (kind !== 'audio' && kind !== 'video') throw new Error('Elige MP4 o MP3.')
      const option = session.options.find((entry) => entry.height === height)
      if (kind === 'video' && !option) throw new Error('Elige una calidad disponible.')
      const id = randomUUID()
      const job = {
        id,
        status: 'working',
        title: session.title,
        kind,
        created: Date.now(),
        dir: null,
      }
      jobs.set(id, job)
      void startJob(job, session, option)
      return json(request, response, 202, { id: job.id })
    }
    const match = pathname.match(/^\/api\/downloader\/jobs\/([0-9a-f-]+)(?:\/(file))?$/)
    if (request.method === 'GET' && match) {
      const job = jobs.get(match[1])
      if (!job) return json(request, response, 404, { error: 'Descarga no encontrada o caducada.' })
      if (!match[2])
        return json(request, response, 200, {
          status: job.status,
          error: job.error,
          fileUrl: job.status === 'ready' ? `/api/downloader/jobs/${job.id}/file` : undefined,
        })
      if (job.status !== 'ready')
        return json(request, response, 409, { error: 'El archivo todavía no está listo.' })
      response.writeHead(200, {
        ...headers(request),
        'Content-Type': job.kind === 'audio' ? 'audio/mpeg' : 'video/mp4',
        'Content-Length': job.size,
        'Content-Disposition': `attachment; filename="${safeFilename(job.title, job.kind === 'audio' ? 'mp3' : 'mp4')}"`,
      })
      return createReadStream(job.file).pipe(response)
    }
    return json(request, response, 404, { error: 'Ruta no encontrada.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Error inesperado.'
    return json(request, response, 400, { error: message })
  }
})

setInterval(() => {
  const now = Date.now()
  for (const [id, session] of sessions) if (now - session.created > SESSION_TTL) sessions.delete(id)
  for (const [id, job] of jobs) {
    if (job.status === 'working' || now - job.completed < FILE_TTL) continue
    jobs.delete(id)
    if (job.dir) void rm(job.dir, { recursive: true, force: true })
  }
}, 60_000).unref()

server.listen(PORT, HOST, () => console.log(`Ligero.Downloader API: http://${HOST}:${PORT}`))
