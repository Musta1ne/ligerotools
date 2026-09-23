import { useEffect, useRef, useState } from 'react'
import { ArrowDownToLine, Link2, LoaderCircle, Music2, Video } from 'lucide-react'
import './downloader.css'

interface Inspection {
  id: string
  title: string
  platform: string
  duration: number | null
  qualities: number[]
}

type Job = { status: 'working' | 'ready' | 'error'; error?: string; fileUrl?: string }
const apiBase = (import.meta.env.VITE_DOWNLOADER_API_URL || '').replace(/\/$/, '')

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init)
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('El servicio de descargas no está disponible. Intenta de nuevo más tarde.')
  }
  const data: unknown = await response.json()
  if (!response.ok) {
    const error = data && typeof data === 'object' && 'error' in data ? String(data.error) : ''
    throw new Error(error || 'No se pudo conectar con el servicio de descargas.')
  }
  return data as T
}

function DownloaderPage() {
  const [url, setUrl] = useState('')
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [height, setHeight] = useState<number | null>(null)
  const [kind, setKind] = useState<'video' | 'audio'>('video')
  const [busy, setBusy] = useState(false)
  const [job, setJob] = useState<Job | null>(null)
  const [error, setError] = useState('')
  const [fileHref, setFileHref] = useState('')
  const currentRequest = useRef<AbortController | null>(null)
  const polling = useRef<ReturnType<typeof setInterval> | null>(null)
  const generation = useRef(0)

  useEffect(
    () => () => {
      generation.current++
      currentRequest.current?.abort()
      if (polling.current) clearInterval(polling.current)
    },
    [],
  )

  function reset() {
    generation.current++
    currentRequest.current?.abort()
    currentRequest.current = null
    if (polling.current) clearInterval(polling.current)
    polling.current = null
    setInspection(null)
    setJob(null)
    setFileHref('')
    setError('')
    setBusy(false)
  }

  async function inspect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!url.trim()) {
      setError('Pega el enlace de un video.')
      return
    }
    reset()
    const controller = new AbortController()
    currentRequest.current = controller
    setBusy(true)
    try {
      const result = await api<Inspection>('/api/downloader/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      })
      if (!controller.signal.aborted) {
        setInspection(result)
        setHeight(result.qualities[0] ?? null)
      }
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : 'No se pudo consultar el video.')
    } finally {
      if (currentRequest.current === controller) {
        currentRequest.current = null
        setBusy(false)
      }
    }
  }

  async function download() {
    if (!inspection || (kind === 'video' && height === null) || busy) return
    setError('')
    setJob(null)
    setFileHref('')
    setBusy(true)
    const requestGeneration = ++generation.current
    try {
      const created = await api<{ id: string }>('/api/downloader/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: inspection.id, kind, height }),
      })
      if (generation.current !== requestGeneration) return
      setJob({ status: 'working' })
      const check = async () => {
        try {
          const state = await api<Job>(`/api/downloader/jobs/${created.id}`)
          if (generation.current !== requestGeneration) return false
          setJob(state)
          if (state.status !== 'working') {
            if (polling.current) clearInterval(polling.current)
            polling.current = null
            setBusy(false)
            if (state.status === 'error') setError(state.error || 'No se pudo preparar el archivo.')
            if (state.status === 'ready' && state.fileUrl) setFileHref(`${apiBase}${state.fileUrl}`)
          }
          return state.status === 'working'
        } catch (cause) {
          if (generation.current !== requestGeneration) return false
          if (polling.current) clearInterval(polling.current)
          polling.current = null
          setBusy(false)
          setError(cause instanceof Error ? cause.message : 'No se pudo consultar la descarga.')
          return false
        }
      }
      if (await check())
        polling.current = setInterval(() => {
          void check()
        }, 2000)
    } catch (cause) {
      if (generation.current !== requestGeneration) return
      setBusy(false)
      setError(cause instanceof Error ? cause.message : 'No se pudo iniciar la descarga.')
    }
  }

  const minutes = inspection?.duration ? Math.ceil(inspection.duration / 60) : null

  return (
    <div className="downloader-tool">
      <section className="intro">
        <div className="eyebrow">
          <span className="tiny-line" /> LIGERO.DOWNLOADER
        </div>
        <h1>
          Tu video, <span>a tu manera.</span>
        </h1>
        <p>
          Pega un enlace, elige una calidad disponible y descarga el video en MP4 o su audio en MP3.
        </p>
        <div className="downloader-platforms" aria-label="Plataformas compatibles">
          <span>YouTube</span>
          <span>X / Twitter</span>
          <span>Instagram</span>
          <span>TikTok</span>
        </div>
      </section>

      <section className="downloader-panel" aria-label="Descargar video">
        <form onSubmit={inspect}>
          <label htmlFor="video-url">
            <Link2 size={18} aria-hidden="true" /> Enlace del video
          </label>
          <div className="downloader-input-row">
            <input
              id="video-url"
              type="url"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value)
                reset()
              }}
              placeholder="https://www.youtube.com/watch?v=..."
              autoComplete="url"
              required
            />
            <button type="submit" disabled={busy}>
              {busy && !job ? (
                <LoaderCircle size={18} className="downloader-spin" aria-hidden="true" />
              ) : (
                <Link2 size={18} aria-hidden="true" />
              )}
              Buscar calidades
            </button>
          </div>
        </form>
        <p className="downloader-hint">
          Solo videos públicos a los que tengas permiso de acceder y descargar. La disponibilidad
          depende de cada plataforma.
        </p>

        {inspection && (
          <div className="downloader-result">
            <div className="downloader-video-info">
              <span className="downloader-result-icon">
                <Video size={23} aria-hidden="true" />
              </span>
              <div>
                <h2>{inspection.title}</h2>
                <p>
                  {inspection.platform || 'Video'}
                  {minutes ? ` · ${minutes} min` : ''}
                </p>
              </div>
            </div>
            <fieldset className="downloader-format">
              <legend>Formato</legend>
              <label className={kind === 'video' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="format"
                  checked={kind === 'video'}
                  onChange={() => {
                    setKind('video')
                    setFileHref('')
                    setJob(null)
                  }}
                  disabled={busy}
                />
                <Video size={19} aria-hidden="true" /> Video MP4
              </label>
              <label className={kind === 'audio' ? 'selected' : ''}>
                <input
                  type="radio"
                  name="format"
                  checked={kind === 'audio'}
                  onChange={() => {
                    setKind('audio')
                    setFileHref('')
                    setJob(null)
                  }}
                  disabled={busy}
                />
                <Music2 size={19} aria-hidden="true" /> Audio MP3
              </label>
            </fieldset>
            {kind === 'video' && (
              <div className="downloader-quality">
                <label htmlFor="video-quality">Calidad del video</label>
                <select
                  id="video-quality"
                  value={height ?? ''}
                  onChange={(event) => {
                    setHeight(Number(event.target.value))
                    setFileHref('')
                    setJob(null)
                  }}
                  disabled={busy}
                >
                  {inspection.qualities.map((quality) => (
                    <option key={quality} value={quality}>
                      {quality}p{quality === inspection.qualities[0] ? ' · máxima disponible' : ''}
                    </option>
                  ))}
                </select>
                <p>
                  Si falta una calidad inferior, la preparamos a partir de una resolución mayor.
                </p>
              </div>
            )}
            <button className="downloader-start" type="button" onClick={download} disabled={busy}>
              {busy && job?.status === 'working' ? (
                <LoaderCircle size={19} className="downloader-spin" aria-hidden="true" />
              ) : (
                <ArrowDownToLine size={19} aria-hidden="true" />
              )}
              {busy ? 'Preparando archivo…' : `Preparar ${kind === 'audio' ? 'MP3' : 'MP4'}`}
            </button>
            {job?.status === 'working' && (
              <p role="status" className="downloader-status">
                Estamos preparando el archivo. Puede tardar unos minutos.
              </p>
            )}
            {fileHref && (
              <a className="downloader-file" href={fileHref}>
                <ArrowDownToLine size={19} aria-hidden="true" /> Descargar archivo listo
              </a>
            )}
          </div>
        )}
        {error && (
          <p className="downloader-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  )
}

export default DownloaderPage
