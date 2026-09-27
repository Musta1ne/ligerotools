import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ArrowRight,
  Check,
  FileAudio,
  FileImage,
  FileVideo,
  Info,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Upload,
  X,
} from 'lucide-react'
import { convertImage, imageFormat, MAX_IMAGE_BYTES } from './image'
import type { ImageFormat, Quality } from './image'
import { audioFormat, convertAudio, disposeIdleAudioEngine, MAX_AUDIO_BYTES } from './audio'
import type { AudioFormat } from './audio'
import { convertVideo, disposeIdleVideoEngine, MAX_VIDEO_BYTES, videoFormat } from './video'
import type { VideoFormat, VideoUpdate } from './video'
import './converter.css'

type Selected = { file: File; kind: 'image' | 'video' | 'audio'; source: string }
type OutputFormat = ImageFormat | VideoFormat | AudioFormat
const IMAGE_OUTPUTS: { value: ImageFormat; label: string }[] = [
  { value: 'png', label: 'PNG' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'svg', label: 'SVG vectorial' },
]
const VIDEO_OUTPUTS: { value: VideoFormat | 'mp3'; label: string }[] = [
  { value: 'mp4', label: 'MP4' },
  { value: 'mov', label: 'MOV' },
  { value: 'mkv', label: 'MKV' },
  { value: 'avi', label: 'AVI' },
  { value: 'webm', label: 'WebM' },
  { value: 'gif', label: 'GIF animado' },
  { value: 'mp3', label: 'MP3 (solo audio)' },
]
const AUDIO_OUTPUTS: { value: AudioFormat; label: string }[] = [
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'm4a', label: 'M4A (AAC)' },
  { value: 'aac', label: 'AAC' },
  { value: 'flac', label: 'FLAC' },
  { value: 'ogg', label: 'OGG (Vorbis)' },
  { value: 'opus', label: 'Opus' },
]
const formatSize = (bytes: number) =>
  `${(bytes / 1_000_000).toLocaleString('es', { maximumFractionDigits: 2 })} MB`

function identify(file: File): Selected | null {
  const image = imageFormat(file)
  if (image) return { file, kind: 'image', source: image }
  const video = videoFormat(file)
  if (video) return { file, kind: 'video', source: video }
  const audio = audioFormat(file)
  if (audio) return { file, kind: 'audio', source: audio }
  return null
}

function ConverterPage() {
  const [selected, setSelected] = useState<Selected | null>(null)
  const [output, setOutput] = useState<OutputFormat>('png')
  const [quality, setQuality] = useState<Quality>('equilibrada')
  const [background, setBackground] = useState('#ffffff')
  const [svgWidth, setSvgWidth] = useState('')
  const [colors, setColors] = useState(12)
  const [detail, setDetail] = useState(2)
  const [gifStart, setGifStart] = useState('0')
  const [gifEnd, setGifEnd] = useState('15')
  const [gifWidth, setGifWidth] = useState(480)
  const [gifFps, setGifFps] = useState(10)
  const [videoDuration, setVideoDuration] = useState<number | null>(null)
  const [videoHeight, setVideoHeight] = useState<number | null>(null)
  const [videoWidth, setVideoWidth] = useState<number | null>(null)
  const [sourceURL, setSourceURL] = useState('')
  const [resultURL, setResultURL] = useState('')
  const [result, setResult] = useState<Blob | null>(null)
  const [error, setError] = useState('')
  const [update, setUpdate] = useState<VideoUpdate | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const urls = useRef({ source: '', result: '' })

  useEffect(() => {
    mounted.current = true
    const owned = urls.current
    return () => {
      mounted.current = false
      controller.current?.abort()
      disposeIdleVideoEngine()
      disposeIdleAudioEngine()
      if (owned.source) URL.revokeObjectURL(owned.source)
      if (owned.result) URL.revokeObjectURL(owned.result)
    }
  }, [])

  function replaceURL(kind: 'source' | 'result', blob?: Blob) {
    const previous = urls.current[kind]
    const next = blob ? URL.createObjectURL(blob) : ''
    urls.current[kind] = next
    if (previous) URL.revokeObjectURL(previous)
    if (kind === 'source') setSourceURL(next)
    else setResultURL(next)
  }

  function clearResult() {
    setResult(null)
    replaceURL('result')
    setUpdate(null)
    setError('')
  }

  function selectFiles(files: FileList | null) {
    if (!files?.length || controller.current) return
    if (files.length !== 1) {
      setError('Selecciona un solo archivo a la vez.')
      return
    }
    const next = identify(files[0])
    if (!next) {
      setError('Elige una imagen, vídeo o audio de los formatos indicados.')
      return
    }
    const max =
      next.kind === 'image'
        ? MAX_IMAGE_BYTES
        : next.kind === 'video'
          ? MAX_VIDEO_BYTES
          : MAX_AUDIO_BYTES
    if (!next.file.size || next.file.size > max) {
      setError(
        `El archivo debe pesar hasta ${next.kind === 'image' ? '30' : next.kind === 'video' ? '500' : '100'} MB.`,
      )
      return
    }
    if (next.kind !== 'video') disposeIdleVideoEngine()
    if (next.kind !== 'audio') disposeIdleAudioEngine()
    setSelected(next)
    setOutput(
      next.kind === 'image'
        ? next.source === 'png'
          ? 'jpeg'
          : 'png'
        : next.kind === 'audio'
          ? next.source === 'mp3'
            ? 'wav'
            : 'mp3'
          : next.source === 'mp4'
            ? 'webm'
            : 'mp4',
    )
    setSvgWidth('')
    setVideoDuration(null)
    setVideoWidth(null)
    setVideoHeight(null)
    setGifStart('0')
    setGifEnd('15')
    replaceURL('source', next.file)
    clearResult()
  }

  function removeFile() {
    if (controller.current) return
    setSelected(null)
    replaceURL('source')
    clearResult()
  }

  async function start() {
    if (!selected || controller.current) return
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    clearResult()
    try {
      let blob: Blob
      if (selected.kind === 'image') {
        const width = svgWidth.trim() ? Number(svgWidth) : undefined
        blob = await convertImage(
          selected.file,
          {
            format: output as ImageFormat,
            quality,
            background,
            width,
            colors,
            detail,
          },
          current.signal,
          (message) => {
            if (controller.current === current) setUpdate({ message, progress: null })
          },
        )
      } else if (selected.kind === 'audio' || output === 'mp3') {
        blob = await convertAudio(
          selected.file,
          {
            format: output as AudioFormat,
            quality,
            sourceKind: selected.kind === 'video' ? 'video' : 'audio',
          },
          (value) => {
            if (controller.current === current) setUpdate(value)
          },
          current.signal,
        )
      } else {
        blob = await convertVideo(
          selected.file,
          {
            format: output as VideoFormat,
            quality,
            gifStart: Number(gifStart),
            gifEnd: Number(gifEnd),
            gifWidth,
            gifFps,
          },
          (value) => {
            if (controller.current === current) setUpdate(value)
          },
          current.signal,
        )
      }
      if (controller.current === current && mounted.current) {
        setResult(blob)
        replaceURL('result', blob)
      }
    } catch (cause) {
      if (controller.current === current && !current.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'No se pudo convertir el archivo.')
      }
    } finally {
      if (controller.current === current) {
        controller.current = null
        setBusy(false)
      }
    }
  }

  function cancel() {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setUpdate(null)
  }

  const outputs =
    selected?.kind === 'video'
      ? VIDEO_OUTPUTS
      : selected?.kind === 'audio'
        ? AUDIO_OUTPUTS
        : IMAGE_OUTPUTS
  const isGif = selected?.kind === 'video' && output === 'gif'
  const isVector = selected?.kind === 'image' && output === 'svg'
  const isRaster = selected?.kind === 'image' && output !== 'svg'
  const isAudioResult =
    selected?.kind === 'audio' || (selected?.kind === 'video' && output === 'mp3')
  const lossyAudio = ['mp3', 'm4a', 'aac', 'ogg', 'opus'].includes(output)
  const seconds = Number(gifEnd) - Number(gifStart)
  const gifRangeError =
    isGif &&
    (!Number.isFinite(seconds) ||
      Number(gifStart) < 0 ||
      seconds <= 0 ||
      seconds > 15 ||
      (videoDuration !== null && Number(gifEnd) > videoDuration + 0.05))
  const invalidSvgWidth =
    selected?.source === 'svg' &&
    isRaster &&
    svgWidth.trim() !== '' &&
    (!Number.isInteger(Number(svgWidth)) || Number(svgWidth) < 1 || Number(svgWidth) > 10000)
  const approxHeight =
    videoWidth && videoHeight
      ? Math.round((gifWidth * videoHeight) / videoWidth)
      : Math.round((gifWidth * 9) / 16)
  const frameCount = Math.max(0, seconds) * gifFps
  const estimateLow = Math.max(0.01, (gifWidth * approxHeight * frameCount * 0.04) / 1_000_000)
  const estimateHigh = Math.max(0.02, (gifWidth * approxHeight * frameCount * 0.25) / 1_000_000)
  const filename = selected
    ? `${selected.file.name.replace(/\.[^.]+$/, '')}-convertido.${output === 'jpeg' ? 'jpg' : output}`
    : ''

  return (
    <div className="converter-tool">
      <section className="intro converter-intro">
        <div className="eyebrow">
          <span className="tiny-line" /> TU ARCHIVO. TU FORMATO.
        </div>
        <h1>
          Convierte sin <span>salir de aquí.</span>
        </h1>
        <p>
          Cambia el formato de una imagen, un vídeo o un audio; vectoriza un logo, crea un GIF o
          extrae MP3 de un vídeo. Todo se procesa en tu dispositivo.
        </p>
      </section>

      <section className="converter-workspace" aria-label="Convertidor de formatos">
        <div className="converter-panel">
          <div className="converter-heading">
            <span className="step">01</span>
            <h2>Elige un archivo</h2>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            accept=".png,.jpg,.jpeg,.webp,.svg,.mp4,.mov,.webm,.mkv,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus"
            disabled={busy}
            onChange={(event) => {
              selectFiles(event.target.files)
              event.target.value = ''
            }}
          />
          {!selected ? (
            <button
              type="button"
              className={`converter-drop ${dragging ? 'dragging' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                selectFiles(event.dataTransfer.files)
              }}
            >
              <Upload size={30} />
              <strong>Arrastra una imagen, vídeo o audio</strong>
              <span>o haz clic para elegirlo</span>
              <small>
                Imagen: PNG, JPEG, WebP, SVG · Vídeo: MP4, MOV, WebM, MKV, AVI · Audio: MP3, WAV,
                M4A, AAC, FLAC, OGG, Opus
              </small>
            </button>
          ) : (
            <div className="converter-selected">
              <div className="converter-file">
                <span>
                  {selected.kind === 'image' ? (
                    <FileImage size={24} />
                  ) : selected.kind === 'video' ? (
                    <FileVideo size={24} />
                  ) : (
                    <FileAudio size={24} />
                  )}
                </span>
                <div>
                  <strong title={selected.file.name}>{selected.file.name}</strong>
                  <small>
                    {formatSize(selected.file.size)} · {selected.source.toUpperCase()}
                  </small>
                </div>
                <button
                  type="button"
                  aria-label="Quitar archivo"
                  disabled={busy}
                  onClick={removeFile}
                >
                  <X size={18} />
                </button>
              </div>
              <div
                className={`converter-preview${selected.kind === 'audio' ? ' audio-preview' : ''}`}
              >
                {selected.kind === 'image' ? (
                  <img
                    src={sourceURL}
                    alt="Vista previa del archivo original"
                    onLoad={(event) => {
                      if (selected.source === 'svg' && !svgWidth)
                        setSvgWidth(String(event.currentTarget.naturalWidth))
                    }}
                  />
                ) : selected.kind === 'audio' ? (
                  <audio src={sourceURL} controls preload="metadata" />
                ) : (
                  <video
                    ref={videoRef}
                    src={sourceURL}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const node = event.currentTarget
                      if (Number.isFinite(node.duration)) {
                        setVideoDuration(node.duration)
                        setGifEnd(String(Math.min(15, Math.round(node.duration * 10) / 10)))
                      }
                      setVideoWidth(node.videoWidth)
                      setVideoHeight(node.videoHeight)
                    }}
                  />
                )}
              </div>
              <small>Vista previa original · puede depender del navegador</small>
              <button
                type="button"
                className="converter-change"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                Elegir otro archivo
              </button>
            </div>
          )}
          <p className="converter-privacy">
            <LockKeyhole size={16} /> Tu archivo no se sube a un servidor.
          </p>
        </div>

        <div className="converter-panel">
          <div className="converter-heading">
            <span className="step">02</span>
            <h2>Prepara la conversión</h2>
          </div>
          <fieldset disabled={busy || !selected}>
            <label className="converter-label" htmlFor="converter-output">
              Formato de salida
            </label>
            <select
              id="converter-output"
              value={output}
              onChange={(event) => {
                setOutput(event.target.value as OutputFormat)
                clearResult()
              }}
            >
              {outputs
                .filter((item) => item.value !== selected?.source)
                .map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
            </select>

            {((isRaster && output !== 'png') ||
              (selected?.kind === 'video' && !isGif) ||
              (selected?.kind === 'audio' && lossyAudio)) && (
              <>
                <label className="converter-label" htmlFor="converter-quality">
                  Calidad
                </label>
                <select
                  id="converter-quality"
                  value={quality}
                  onChange={(event) => {
                    setQuality(event.target.value as Quality)
                    clearResult()
                  }}
                >
                  <option value="alta">Alta</option>
                  <option value="equilibrada">Equilibrada</option>
                  <option value="pequena">Archivo más pequeño</option>
                </select>
                <small>El tamaño final depende del contenido.</small>
              </>
            )}

            {selected?.kind === 'video' && output === 'mp3' && (
              <small>
                Se extrae el audio del vídeo completo. Si el vídeo no contiene sonido, la conversión
                mostrará un error.
              </small>
            )}
            {selected?.kind === 'audio' && (output === 'wav' || output === 'flac') && (
              <small>
                WAV y FLAC no añaden pérdidas nuevas, pero no recuperan calidad de un audio
                comprimido.
              </small>
            )}

            {isRaster && output === 'jpeg' && (
              <>
                <label className="converter-label" htmlFor="converter-background">
                  Fondo para zonas transparentes
                </label>
                <div className="converter-color">
                  <input
                    id="converter-background"
                    type="color"
                    value={background}
                    onChange={(event) => {
                      setBackground(event.target.value)
                      clearResult()
                    }}
                  />
                  <span>{background}</span>
                </div>
              </>
            )}

            {selected?.source === 'svg' && isRaster && (
              <>
                <label className="converter-label" htmlFor="converter-width">
                  Ancho de salida (px)
                </label>
                <input
                  id="converter-width"
                  type="number"
                  min="1"
                  max="10000"
                  step="1"
                  value={svgWidth}
                  onChange={(event) => {
                    setSvgWidth(event.target.value)
                    clearResult()
                  }}
                />
                <small>El alto se ajusta para mantener la proporción.</small>
                {invalidSvgWidth && (
                  <p className="converter-error-inline">Indica un ancho entre 1 y 10 000 px.</p>
                )}
              </>
            )}

            {isVector && (
              <>
                <label className="converter-label" htmlFor="converter-colors">
                  Colores: {colors}
                </label>
                <input
                  id="converter-colors"
                  type="range"
                  min="2"
                  max="32"
                  value={colors}
                  onChange={(event) => {
                    setColors(Number(event.target.value))
                    clearResult()
                  }}
                />
                <label className="converter-label" htmlFor="converter-detail">
                  Detalle
                </label>
                <select
                  id="converter-detail"
                  value={detail}
                  onChange={(event) => {
                    setDetail(Number(event.target.value))
                    clearResult()
                  }}
                >
                  <option value="1">Simple</option>
                  <option value="2">Equilibrado</option>
                  <option value="3">Alto</option>
                </select>
                <small>
                  Ideal para logos, iconos e ilustraciones. El SVG tendrá formas vectoriales reales.
                </small>
              </>
            )}

            {isGif && (
              <>
                <div className="converter-pair">
                  <div>
                    <label className="converter-label" htmlFor="gif-start">
                      Inicio (s)
                    </label>
                    <input
                      id="gif-start"
                      type="number"
                      min="0"
                      step="0.1"
                      value={gifStart}
                      onChange={(event) => {
                        setGifStart(event.target.value)
                        clearResult()
                      }}
                    />
                  </div>
                  <div>
                    <label className="converter-label" htmlFor="gif-end">
                      Fin (s)
                    </label>
                    <input
                      id="gif-end"
                      type="number"
                      min="0.1"
                      step="0.1"
                      value={gifEnd}
                      onChange={(event) => {
                        setGifEnd(event.target.value)
                        clearResult()
                      }}
                    />
                  </div>
                </div>
                <div className="converter-markers">
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        setGifStart((Math.round(videoRef.current.currentTime * 10) / 10).toString())
                        clearResult()
                      }
                    }}
                  >
                    Usar posición como inicio
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (videoRef.current) {
                        setGifEnd((Math.round(videoRef.current.currentTime * 10) / 10).toString())
                        clearResult()
                      }
                    }}
                  >
                    Usar posición como fin
                  </button>
                </div>
                <small>Elige hasta 15 segundos. El GIF no incluye audio.</small>
                {gifRangeError && (
                  <p className="converter-error-inline">
                    El fragmento debe durar entre 0 y 15 segundos y estar dentro del vídeo.
                  </p>
                )}
                <label className="converter-label" htmlFor="gif-width">
                  Ancho: {gifWidth} px
                </label>
                <input
                  id="gif-width"
                  type="range"
                  min="160"
                  max="800"
                  step="40"
                  value={gifWidth}
                  onChange={(event) => {
                    setGifWidth(Number(event.target.value))
                    clearResult()
                  }}
                />
                <label className="converter-label" htmlFor="gif-fps">
                  Fotogramas por segundo: {gifFps}
                </label>
                <input
                  id="gif-fps"
                  type="range"
                  min="5"
                  max="20"
                  value={gifFps}
                  onChange={(event) => {
                    setGifFps(Number(event.target.value))
                    clearResult()
                  }}
                />
                <small>
                  Estimación orientativa: {estimateLow.toFixed(1)}–{estimateHigh.toFixed(1)} MB. El
                  tamaño real puede variar mucho.
                </small>
              </>
            )}
          </fieldset>
          {busy ? (
            <button type="button" className="converter-primary is-cancel" onClick={cancel}>
              <X size={18} /> Cancelar conversión
            </button>
          ) : (
            <button
              type="button"
              className="converter-primary"
              disabled={!selected || Boolean(gifRangeError) || Boolean(invalidSvgWidth)}
              onClick={() => void start()}
            >
              <RefreshCw size={18} /> {result ? 'Convertir de nuevo' : 'Convertir archivo'}{' '}
              <ArrowRight size={18} />
            </button>
          )}
          <small className="converter-caption">
            {selected
              ? 'Mantén esta pestaña abierta durante la conversión.'
              : 'Selecciona un archivo para empezar.'}
          </small>
        </div>
      </section>

      {error && (
        <div className="converter-alert" role="alert">
          <Info size={20} />
          <span>{error}</span>
        </div>
      )}
      {busy && update && (
        <section className="converter-status" role="status">
          <LoaderCircle className="converter-spin" size={22} />
          <strong>{update.message}</strong>
          {update.progress !== null && <span>{Math.round(update.progress * 100)} %</span>}
        </section>
      )}
      {result && resultURL && selected && (
        <section className="converter-result" aria-live="polite">
          <div className="converter-result-heading">
            <Check size={24} />
            <div>
              <h2>Archivo convertido</h2>
              <p>
                {output.toUpperCase()} · {formatSize(result.size)}
              </p>
            </div>
          </div>
          {selected.kind === 'image' || output === 'gif' ? (
            <img src={resultURL} alt="Vista previa del archivo convertido" />
          ) : isAudioResult ? (
            <>
              <audio src={resultURL} controls preload="metadata" />
              <p className="converter-preview-note">
                La reproducción de algunos formatos de audio depende del navegador. El archivo
                descargado puede abrirse en un reproductor compatible.
              </p>
            </>
          ) : (
            <>
              <video src={resultURL} controls playsInline preload="metadata" />
              <p className="converter-preview-note">
                La vista previa depende del navegador. Si no se reproduce, descarga el archivo y
                ábrelo en un reproductor compatible.
              </p>
            </>
          )}
          <a href={resultURL} download={filename}>
            <ArrowDownToLine size={18} /> Descargar {output.toUpperCase()}
          </a>
        </section>
      )}
      <p className="converter-footnote">
        <Info size={15} /> Los formatos se procesan según el códec y la memoria disponibles en este
        navegador. Si uno no se puede leer, verás un error claro.
      </p>
    </div>
  )
}

export default ConverterPage
