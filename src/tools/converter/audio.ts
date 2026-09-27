import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile } from '@ffmpeg/util'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import type { Quality } from './image'
import type { VideoUpdate } from './video'
import { MAX_VIDEO_BYTES, videoFormat } from './video'

export type AudioFormat = 'mp3' | 'wav' | 'm4a' | 'aac' | 'flac' | 'ogg' | 'opus'
export interface AudioOptions {
  format: AudioFormat
  quality: Quality
  sourceKind: 'audio' | 'video'
}

export const MAX_AUDIO_BYTES = 100_000_000
const MAX_WAV_OUTPUT_BYTES = 200_000_000
const FORMATS: readonly AudioFormat[] = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']
const MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
}
let idleEngine: FFmpeg | undefined

export function audioFormat(file: File): AudioFormat | null {
  const extension = /\.([^.]+)$/.exec(file.name)?.[1].toLowerCase()
  return extension && FORMATS.includes(extension as AudioFormat) ? (extension as AudioFormat) : null
}

export function disposeIdleAudioEngine() {
  const idle = idleEngine
  idleEngine = undefined
  idle?.terminate()
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Conversión cancelada.', 'AbortError')
}

function outputArgs(format: AudioFormat, quality: Quality): string[] {
  const index = quality === 'alta' ? 0 : quality === 'equilibrada' ? 1 : 2
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', ['256k', '192k', '128k'][index], 'output.mp3']
    case 'wav':
      return ['-c:a', 'pcm_s16le', 'output.wav']
    case 'm4a':
      return [
        '-c:a',
        'aac',
        '-b:a',
        ['256k', '192k', '128k'][index],
        '-movflags',
        '+faststart',
        'output.m4a',
      ]
    case 'aac':
      return ['-c:a', 'aac', '-b:a', ['256k', '192k', '128k'][index], '-f', 'adts', 'output.aac']
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '5', 'output.flac']
    case 'ogg':
      return ['-c:a', 'libvorbis', '-q:a', ['6', '4', '2'][index], 'output.ogg']
    case 'opus':
      return ['-c:a', 'libopus', '-b:a', ['160k', '112k', '64k'][index], 'output.opus']
  }
}

export async function convertAudio(
  file: File,
  options: AudioOptions,
  onUpdate: (update: VideoUpdate) => void,
  signal: AbortSignal,
): Promise<Blob> {
  abortIfNeeded(signal)
  const source = options.sourceKind === 'video' ? videoFormat(file) : audioFormat(file)
  const max = options.sourceKind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES
  if (!source || !file.size || file.size > max) {
    throw new Error(
      options.sourceKind === 'video'
        ? 'Selecciona un vídeo admitido de hasta 500 MB.'
        : 'Selecciona un MP3, WAV, M4A, AAC, FLAC, OGG u Opus de hasta 100 MB.',
    )
  }
  if (options.sourceKind === 'video' && options.format !== 'mp3') {
    throw new Error('La salida de audio para vídeos es MP3.')
  }
  if (source === options.format) throw new Error('Elige un formato distinto al original.')

  const ffmpeg = idleEngine ?? new FFmpeg()
  idleEngine = undefined
  const abort = () => ffmpeg.terminate()
  signal.addEventListener('abort', abort, { once: true })
  let reusable = false
  let encoding = false
  let lastProgress = 0
  const onProgress = ({ progress }: { progress: number }) => {
    if (!encoding || signal.aborted || !Number.isFinite(progress)) return
    lastProgress = Math.max(lastProgress, Math.min(1, Math.max(0, progress)))
    onUpdate({ message: 'Convirtiendo el audio en tu dispositivo…', progress: lastProgress })
  }
  ffmpeg.on('progress', onProgress)
  try {
    if (!ffmpeg.loaded) {
      onUpdate({ message: 'Cargando el motor de audio local…', progress: null })
      await ffmpeg.load({ coreURL, wasmURL })
    }
    abortIfNeeded(signal)
    onUpdate({ message: 'Analizando el audio…', progress: null })
    await ffmpeg.writeFile('input', await fetchFile(file))
    abortIfNeeded(signal)
    const probeCode = await ffmpeg.ffprobe([
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type,sample_rate,channels',
      '-of',
      'json',
      'input',
      '-o',
      'probe.json',
    ])
    if (probeCode !== 0 && probeCode !== -1)
      throw new Error('No se pudo leer el archivo de origen.')
    const probeText = await ffmpeg.readFile('probe.json', 'utf8')
    if (typeof probeText !== 'string') throw new Error('No se pudo analizar el archivo de origen.')
    let probe: {
      format?: { duration?: string }
      streams?: { codec_type?: string; sample_rate?: string; channels?: number }[]
    }
    try {
      probe = JSON.parse(probeText)
    } catch {
      throw new Error('El archivo está dañado o usa un códec no compatible.')
    }
    const audioStream = probe.streams?.find((stream) => stream.codec_type === 'audio')
    if (!audioStream) {
      throw new Error(
        options.sourceKind === 'video'
          ? 'Este vídeo no contiene una pista de audio para extraer.'
          : 'El archivo no contiene una pista de audio compatible.',
      )
    }
    if (options.format === 'wav') {
      const duration = Number(probe.format?.duration)
      const sampleRate = Number(audioStream.sample_rate)
      const channels = audioStream.channels ?? 2
      if (
        Number.isFinite(duration) &&
        Number.isFinite(sampleRate) &&
        duration * sampleRate * channels * 2 > MAX_WAV_OUTPUT_BYTES
      ) {
        throw new Error('El WAV superaría 200 MB. Elige FLAC u otro formato de salida.')
      }
    }
    abortIfNeeded(signal)
    encoding = true
    onUpdate({ message: 'Convirtiendo el audio en tu dispositivo…', progress: 0 })
    const output = `output.${options.format}`
    const code = await ffmpeg.exec([
      '-y',
      '-i',
      'input',
      '-map',
      '0:a:0',
      '-vn',
      '-sn',
      '-dn',
      ...outputArgs(options.format, options.quality),
    ])
    encoding = false
    abortIfNeeded(signal)
    if (code !== 0)
      throw new Error(
        'No se pudo convertir el audio. Es posible que su códec no sea compatible o falte memoria.',
      )
    const data = await ffmpeg.readFile(output)
    if (typeof data === 'string' || !data.length) throw new Error('El audio convertido está vacío.')
    const blob = new Blob([new Uint8Array(data)], { type: MIME[options.format] })
    abortIfNeeded(signal)
    onUpdate({ message: 'Audio listo para descargar.', progress: 1 })
    reusable = true
    return blob
  } catch (error) {
    abortIfNeeded(signal)
    throw error instanceof Error
      ? error
      : new Error('No se pudo convertir el audio. Prueba con otro archivo.')
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
