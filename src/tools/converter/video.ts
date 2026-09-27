import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import type { Quality } from './image'

export type VideoFormat = 'mp4' | 'mov' | 'mkv' | 'avi' | 'webm' | 'gif'
export interface VideoOptions {
  format: VideoFormat
  quality: Quality
  gifStart: number
  gifEnd: number
  gifWidth: number
  gifFps: number
}
export interface VideoUpdate {
  message: string
  progress: number | null
}

export const MAX_VIDEO_BYTES = 500_000_000
const FORMATS = ['mp4', 'mov', 'webm', 'mkv', 'avi'] as const
let idleEngine: FFmpeg | undefined

export function videoFormat(file: File): string | null {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase()
  return extension && FORMATS.some((format) => format === extension) ? extension : null
}

export function disposeIdleVideoEngine() {
  const idle = idleEngine
  idleEngine = undefined
  idle?.terminate()
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Conversión cancelada.', 'AbortError')
}

function outputArgs(options: VideoOptions, hasAudio: boolean, webmKbps: number): string[] {
  if (options.format === 'gif') {
    return [
      '-ss',
      String(options.gifStart),
      '-t',
      String(options.gifEnd - options.gifStart),
      '-i',
      'input',
      '-an',
      '-sn',
      '-dn',
      '-filter_complex',
      `[0:v]fps=${options.gifFps},scale=${options.gifWidth}:-2:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse`,
      '-loop',
      '0',
      'output.gif',
    ]
  }
  const quality = options.quality === 'alta' ? 0 : options.quality === 'equilibrada' ? 1 : 2
  const common = [
    '-i',
    'input',
    '-map',
    '0:v:0',
    ...(hasAudio ? ['-map', '0:a:0'] : []),
    '-sn',
    '-dn',
  ]
  if (options.format === 'mp4' || options.format === 'mov' || options.format === 'mkv') {
    return [
      ...common,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'libx264',
      '-preset',
      'superfast',
      '-crf',
      String([18, 23, 29][quality]),
      '-pix_fmt',
      'yuv420p',
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', ['192k', '128k', '96k'][quality]] : ['-an']),
      ...(options.format === 'mp4' || options.format === 'mov' ? ['-movflags', '+faststart'] : []),
      `output.${options.format}`,
    ]
  }
  if (options.format === 'avi') {
    return [
      ...common,
      '-vf',
      'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v',
      'mpeg4',
      '-q:v',
      String([2, 5, 9][quality]),
      '-pix_fmt',
      'yuv420p',
      ...(hasAudio ? ['-c:a', 'libmp3lame', '-b:a', ['192k', '128k', '96k'][quality]] : ['-an']),
      'output.avi',
    ]
  }
  return [
    ...common,
    '-vf',
    'scale=trunc(iw/2)*2:trunc(ih/2)*2',
    '-c:v',
    'libvpx',
    '-deadline',
    'realtime',
    '-cpu-used',
    '5',
    '-b:v',
    `${webmKbps}k`,
    '-pix_fmt',
    'yuv420p',
    ...(hasAudio ? ['-c:a', 'libopus', '-b:a', ['160k', '112k', '80k'][quality]] : ['-an']),
    'output.webm',
  ]
}

function webmBitrate(
  stream: { width?: number; height?: number; avg_frame_rate?: string },
  quality: Quality,
) {
  const [numerator, denominator] = (stream.avg_frame_rate ?? '').split('/').map(Number)
  const frameRate =
    denominator > 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : 30
  const pixels = (stream.width ?? 1280) * (stream.height ?? 720)
  const factor = quality === 'alta' ? 0.18 : quality === 'equilibrada' ? 0.1 : 0.06
  return Math.round(Math.min(20_000, Math.max(150, (pixels * frameRate * factor) / 1000)))
}

export async function convertVideo(
  file: File,
  options: VideoOptions,
  onUpdate: (update: VideoUpdate) => void,
  signal: AbortSignal,
): Promise<Blob> {
  abortIfNeeded(signal)
  const source = videoFormat(file)
  if (!source || !file.size || file.size > MAX_VIDEO_BYTES)
    throw new Error('Selecciona un MP4, MOV, WebM, MKV o AVI de hasta 500 MB.')
  if (source === options.format)
    throw new Error('Elige un formato diferente al del archivo original.')
  if (
    options.format === 'gif' &&
    (!Number.isFinite(options.gifStart) ||
      !Number.isFinite(options.gifEnd) ||
      options.gifStart < 0 ||
      options.gifEnd <= options.gifStart ||
      options.gifEnd - options.gifStart > 15.01)
  ) {
    throw new Error('Selecciona un fragmento de hasta 15 segundos para el GIF.')
  }
  if (
    options.format === 'gif' &&
    (!Number.isInteger(options.gifWidth) ||
      options.gifWidth < 160 ||
      options.gifWidth > 800 ||
      !Number.isInteger(options.gifFps) ||
      options.gifFps < 5 ||
      options.gifFps > 20)
  ) {
    throw new Error(
      'El ancho del GIF debe estar entre 160 y 800 px y los fotogramas entre 5 y 20 FPS.',
    )
  }

  const ffmpeg = idleEngine ?? new FFmpeg()
  idleEngine = undefined
  const abort = () => ffmpeg.terminate()
  signal.addEventListener('abort', abort, { once: true })
  let reusable = false
  let encoding = false
  let lastProgress = 0
  const report = (progress: number) => {
    if (!encoding || signal.aborted || !Number.isFinite(progress)) return
    lastProgress = Math.max(lastProgress, Math.min(1, Math.max(0, progress)))
    onUpdate({ message: 'Convirtiendo en tu dispositivo…', progress: lastProgress })
  }
  const onProgress = ({ progress }: { progress: number }) => report(progress)
  ffmpeg.on('progress', onProgress)
  try {
    if (!ffmpeg.loaded) {
      onUpdate({ message: 'Cargando el motor de vídeo local…', progress: null })
      await ffmpeg.load({ coreURL, wasmURL })
    }
    abortIfNeeded(signal)
    onUpdate({ message: 'Analizando el vídeo…', progress: null })
    await ffmpeg.writeFile('input', await fetchFile(file))
    abortIfNeeded(signal)
    const probeCode = await ffmpeg.ffprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,width,height,avg_frame_rate',
      '-of',
      'json',
      'input',
      '-o',
      'probe.json',
    ])
    if (probeCode !== 0 && probeCode !== -1) throw new Error('No se pudo leer este vídeo.')
    const text = await ffmpeg.readFile('probe.json', 'utf8')
    if (typeof text !== 'string') throw new Error('No se pudo analizar el vídeo.')
    let probe: {
      format?: { duration?: string }
      streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string }[]
    }
    try {
      probe = JSON.parse(text)
    } catch {
      throw new Error('El vídeo está dañado o usa un formato no compatible.')
    }
    if (!probe.streams?.some((stream) => stream.codec_type === 'video'))
      throw new Error('El archivo no contiene una pista de vídeo compatible.')
    const duration = Number(probe.format?.duration)
    const effectiveOptions =
      options.format === 'gif' && Number.isFinite(duration)
        ? { ...options, gifEnd: Math.min(options.gifEnd, duration) }
        : options
    if (options.format === 'gif' && effectiveOptions.gifEnd <= options.gifStart)
      throw new Error('El fragmento GIF empieza después del final del vídeo.')
    abortIfNeeded(signal)
    const output = `output.${options.format}`
    const hasAudio = probe.streams.some((stream) => stream.codec_type === 'audio')
    const videoStream = probe.streams.find((stream) => stream.codec_type === 'video')!
    encoding = true
    onUpdate({ message: 'Convirtiendo en tu dispositivo…', progress: 0 })
    const code = await ffmpeg.exec([
      '-y',
      ...outputArgs(effectiveOptions, hasAudio, webmBitrate(videoStream, options.quality)),
    ])
    encoding = false
    abortIfNeeded(signal)
    if (code !== 0)
      throw new Error(
        'No se pudo convertir el vídeo. Es posible que su códec no sea compatible o falte memoria.',
      )
    const data = await ffmpeg.readFile(output)
    if (typeof data === 'string' || !data.length)
      throw new Error('El archivo convertido está vacío.')
    const mime = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      mkv: 'video/x-matroska',
      avi: 'video/x-msvideo',
      webm: 'video/webm',
      gif: 'image/gif',
    }[options.format]
    const blob = new Blob([new Uint8Array(data)], { type: mime })
    abortIfNeeded(signal)
    onUpdate({ message: 'Archivo listo para descargar.', progress: 1 })
    reusable = true
    return blob
  } catch (error) {
    abortIfNeeded(signal)
    throw error instanceof Error
      ? error
      : new Error(
          'No se pudo convertir el vídeo. Prueba con un archivo más pequeño o con otro formato.',
        )
  } finally {
    encoding = false
    ffmpeg.off('progress', onProgress)
    if (reusable && !signal.aborted) {
      try {
        for (const path of ['input', 'probe.json', `output.${options.format}`])
          await ffmpeg.deleteFile(path)
      } catch {
        reusable = false
      }
    }
    signal.removeEventListener('abort', abort)
    if (reusable && !signal.aborted && !idleEngine) idleEngine = ffmpeg
    else ffmpeg.terminate()
  }
}
