import { useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, SyntheticEvent } from 'react'
import { ArrowDownToLine, ArrowRight, Check, FileVideo, HardDrive, Info, LoaderCircle, LockKeyhole, Scissors, ShieldCheck, Upload, X } from 'lucide-react'
import { clampTrimEdge, disposeIdleEngine, formatTrimClock, MAX_INPUT_BYTES, trimRangeError, trimVideo } from '../../trimmer'
import type { TrimEdge, TrimResult, TrimUpdate } from '../../trimmer'
import './trimmer.css'

const size = (bytes: number) => `${(bytes / 1_000_000).toLocaleString('es', { maximumFractionDigits: 2 })} MB`

function percent(value: number, duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(100, Math.max(0, (value / duration) * 100))
}

function TrimBar({
  active,
  busy,
  start,
  end,
  duration,
  playhead,
  inactiveLabel,
  describedBy,
  onSeek,
  onChangeEdge,
  onNudge,
}: {
  active: boolean
  busy: boolean
  start: number
  end: number
  duration: number
  playhead: number
  inactiveLabel: string
  describedBy?: string
  onSeek: (seconds: number) => void
  onChangeEdge: (edge: TrimEdge, seconds: number) => void
  onNudge: (edge: TrimEdge, delta: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const startPct = percent(start, duration)
  const endPct = percent(end, duration)
  const playPct = percent(playhead, duration)

  function timeAt(clientX: number) {
    const track = trackRef.current
    if (!track || !Number.isFinite(duration) || duration <= 0) return 0
    const rect = track.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return ratio * duration
  }

  function onTrackPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || busy || !active) return
    if (event.target instanceof Element && event.target.closest('button')) return
    onSeek(timeAt(event.clientX))
  }

  function onHandlePointerDown(edge: TrimEdge, event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0 || busy || !active) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    onChangeEdge(edge, timeAt(event.clientX))
  }

  function onHandlePointerMove(edge: TrimEdge, event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    onChangeEdge(edge, timeAt(event.clientX))
  }

  function onHandleKeyDown(edge: TrimEdge, event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (busy || !active) return
    const step = event.shiftKey ? 1 : 0.1
    onNudge(edge, event.key === 'ArrowLeft' ? -step : step)
  }

  function handle(edge: TrimEdge, at: number, label: string, min: number, max: number) {
    return (
      <button
        type="button"
        role="slider"
        className={`trim-handle trim-handle-${edge}`}
        style={{ left: `${at}%` }}
        aria-label={label}
        aria-orientation="horizontal"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={edge === 'start' ? start : end}
        aria-valuetext={formatTrimClock(edge === 'start' ? start : end)}
        aria-describedby={describedBy}
        disabled={busy}
        onPointerDown={(event) => onHandlePointerDown(edge, event)}
        onPointerMove={(event) => onHandlePointerMove(edge, event)}
        onKeyDown={(event) => onHandleKeyDown(edge, event)}
      />
    )
  }

  return (
    <div className={`trim-bar${active ? '' : ' is-inactive'}`} role="group" aria-label="Barra de recorte" aria-disabled={active ? undefined : true}>
      <div className="trim-track" ref={trackRef} onPointerDown={onTrackPointerDown}>
        {active && (
          <>
            <div className="trim-selection" style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }} />
            <div className="trim-playhead" style={{ left: `${playPct}%` }} />
            {handle('start', startPct, 'Inicio del recorte', 0, Math.max(0, end - 0.1))}
            {handle('end', endPct, 'Fin del recorte', Math.min(duration, start + 0.1), duration)}
          </>
        )}
      </div>
      {active ? (
        <p className="trim-readout"><span>Inicio {formatTrimClock(start)}</span><span>Fin {formatTrimClock(end)}</span></p>
      ) : (
        <p className="trim-status">{inactiveLabel}</p>
      )}
    </div>
  )
}

function TrimmerPage() {
  const [file, setFile] = useState<File | null>(null)
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState<number | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [playhead, setPlayhead] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [update, setUpdate] = useState<TrimUpdate | null>(null)
  const [result, setResult] = useState<TrimResult | null>(null)
  const [downloadURL, setDownloadURL] = useState('')
  const [previewURL, setPreviewURL] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const controller = useRef<AbortController | null>(null)
  const mounted = useRef(false)
  const endTouched = useRef(false)
  const objectURLs = useRef({ preview: '', download: '' })
  const spanRef = useRef({ start: 0, end: 0 })
  const durationRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    durationRef.current = duration
  }, [duration])

  useLayoutEffect(() => {
    mounted.current = true
    const urls = objectURLs.current
    return () => {
      mounted.current = false
      controller.current?.abort()
      controller.current = null
      disposeIdleEngine()
      for (const url of Object.values(urls)) { if (url) URL.revokeObjectURL(url) }
      urls.preview = ''
      urls.download = ''
    }
  }, [])

  function replaceURL(kind: 'preview' | 'download', blob?: Blob) {
    if (!mounted.current) return
    const previous = objectURLs.current[kind]
    const next = blob ? URL.createObjectURL(blob) : ''
    objectURLs.current[kind] = next
    if (previous) URL.revokeObjectURL(previous)
    if (kind === 'preview') setPreviewURL(next)
    else setDownloadURL(next)
  }

  function clearResult() { setResult(null); replaceURL('download'); setUpdate(null) }

  function resetRange() {
    endTouched.current = false
    spanRef.current = { start: 0, end: 0 }
    setStartSec(0)
    setEndSec(null)
    setDuration(null)
    setPlayhead(0)
  }

  function removeFile() {
    resetRange()
    setFile(null)
    replaceURL('preview')
    clearResult()
    setError('')
  }

  function selectFiles(files: FileList | null) {
    if (!mounted.current || controller.current || !files?.length) return
    setError('')
    if (files.length > 1) { setError('Selecciona un solo video a la vez.'); return }
    const selected = files[0]
    if (!selected.type.startsWith('video/') && !/\.(mp4|mov|avi|mkv|webm|m4v|mpeg|mpg|3gp|mts)$/i.test(selected.name)) {
      setError('Selecciona un archivo de video: MP4, MOV, AVI, MKV o WebM.'); return
    }
    if (!selected.size || selected.size > MAX_INPUT_BYTES) {
      setError('El video debe pesar entre 1 byte y 500 MB.'); return
    }
    resetRange()
    setFile(selected)
    replaceURL('preview', selected)
    clearResult()
  }

  function showFrame(seconds: number, hold: boolean) {
    const video = videoRef.current
    if (!video || !Number.isFinite(seconds)) return
    if (hold) video.pause()
    const limit = Number.isFinite(video.duration) ? video.duration : seconds
    const next = Math.min(Math.max(0, seconds), limit)
    video.currentTime = next
    setPlayhead(next)
  }

  function onMetadata(event: SyntheticEvent<HTMLVideoElement>) {
    const next = event.currentTarget.duration
    setDuration(Number.isFinite(next) ? next : Number.NaN)
    if (!endTouched.current && Number.isFinite(next) && next > 0) {
      spanRef.current = { start: 0, end: next }
      setStartSec(0)
      setEndSec(next)
    }
  }

  function changeEdge(edge: TrimEdge, seconds: number) {
    const length = durationRef.current
    if (length === null || !Number.isFinite(length) || length <= 0) return
    const next = clampTrimEdge(edge, seconds, spanRef.current.start, spanRef.current.end, length)
    spanRef.current = next
    endTouched.current = true
    setStartSec(next.start)
    setEndSec(next.end)
    showFrame(edge === 'start' ? next.start : next.end, true)
    clearResult()
    setError('')
  }

  async function startTrim() {
    if (!mounted.current || !file || controller.current || endSec === null) return
    const known = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : undefined
    const rangeError = trimRangeError(startSec, endSec, known)
    if (rangeError) { setError(rangeError); return }
    const current = new AbortController()
    controller.current = current
    setBusy(true)
    setError('')
    clearResult()
    try {
      const output = await trimVideo(file, { startSec, endSec }, (value) => {
        if (controller.current === current) setUpdate(value)
      }, current.signal)
      if (controller.current === current) {
        setResult(output)
        replaceURL('download', output.blob)
      }
    } catch (cause) {
      if (controller.current === current && !current.signal.aborted) {
        setError(cause instanceof Error ? cause.message : 'No se pudo recortar el video. Intenta con un archivo más pequeño.')
      }
    } finally {
      if (controller.current === current) { controller.current = null; setBusy(false) }
    }
  }

  function cancel() {
    controller.current?.abort()
    controller.current = null
    setBusy(false)
    setUpdate(null)
  }

  const knownDuration = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null
  const rangeReady = endSec !== null && knownDuration !== null
  const rangeMessage = file && rangeReady ? trimRangeError(startSec, endSec, knownDuration) : ''
  const canStart = Boolean(file) && rangeReady && rangeMessage === ''
  const percentDone = Math.round((update?.progress ?? 0) * 100)
  const showPercent = update?.phase === 'trimming' || update?.phase === 'finalizing'
  const inactiveLabel = duration !== null && !Number.isFinite(duration) ? 'No se pudo leer la duración.' : 'Esperando la duración del video…'

  return (
    <div className="trimmer-tool">
      <section className="intro">
        <div className="eyebrow"><span className="tiny-line" /> UN TRAMO. EL RESTO NO.</div>
        <h1>Recorta el video <span>en tu navegador.</span></h1>
        <p>Elige el inicio y el fin, y descarga el MP4.<br className="desktop-break" /> Sin cuentas y sin subir el archivo.</p>
        <div className="intro-tags"><span><ShieldCheck size={15} /> Privado por naturaleza</span><span><Check size={15} /> Sin cuentas</span><span><HardDrive size={15} /> Procesado en tu dispositivo</span></div>
      </section>

      <section className="workspace" aria-label="Recortador de video">
        <div className="upload-panel">
          <div className="section-title"><span className="step">01</span><h2>Tu video</h2><span className="section-note">El original no se modifica</span></div>
          <input ref={inputRef} type="file" id="trim-video-input" className="sr-only" accept="video/*,.mp4,.mov,.avi,.mkv,.webm,.m4v,.mpeg,.mpg,.3gp,.mts" aria-label="Elegir video" disabled={busy} onChange={(event) => { selectFiles(event.target.files); event.target.value = '' }} />
          {!file ? (
            <button type="button" className={`dropzone ${dragging ? 'dragging' : ''}`} onClick={() => inputRef.current?.click()} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); selectFiles(event.dataTransfer.files) }}>
              <div className="file-illustration"><span className="illustration-back" /><span className="illustration-front"><FileVideo size={36} strokeWidth={1.4} /><span className="mini-badge"><ArrowDownToLine size={14} /></span></span></div>
              <strong>Arrastra tu video aquí</strong><span className="drop-description">o selecciónalo desde tu dispositivo</span>
              <span className="select-button"><Upload size={16} /> Elegir video</span>
              <span className="formats">MP4, MOV, AVI, MKV, WebM · Hasta 500 MB</span>
            </button>
          ) : (
            <div className="selected-video">
              <div className="player">
                <div className="preview"><video ref={videoRef} key={previewURL} src={previewURL} controls playsInline preload="metadata" onLoadedMetadata={onMetadata} onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)} /></div>
                <TrimBar active={rangeReady} busy={busy} start={startSec} end={endSec ?? 0} duration={knownDuration ?? 0} playhead={playhead} inactiveLabel={inactiveLabel} describedBy={rangeMessage ? 'trim-range-error' : undefined} onSeek={(seconds) => showFrame(seconds, false)} onChangeEdge={changeEdge} onNudge={(edge, delta) => changeEdge(edge, (edge === 'start' ? spanRef.current.start : spanRef.current.end) + delta)} />
              </div>
              <span className="preview-note">Vista previa · según compatibilidad del navegador</span>
              <div className="file-details"><FileVideo size={25} /><div><strong title={file.name}>{file.name}</strong><span>{size(file.size)} · Video original</span></div><button type="button" className="icon-button" disabled={busy} aria-label="Quitar video" onClick={removeFile}><X size={18} /></button></div>
            </div>
          )}
          <div className="local-note"><LockKeyhole size={16} /><p>Tu video se queda contigo.<br /><span>Todo el procesamiento ocurre en este navegador.</span></p></div>
        </div>

        <div className="settings-panel">
          <div className="section-title"><span className="step">02</span><h2>Elige el tramo</h2><Scissors className="settings-icon" size={17} /></div>
          <fieldset disabled={busy}>
            <p className="field-hint">Arrastra las asas bajo el video. Con el teclado, las flechas mueven 0,1 s y Shift las mueve 1 s.</p>
            {rangeMessage && <p className="range-error" id="trim-range-error" role="status">{rangeMessage}</p>}
            <div className="output-format"><span>Salida</span><strong>MP4 <span>H.264 · AAC si hay audio</span></strong></div>
          </fieldset>
          {busy ? <button type="button" className="primary-button cancel" onClick={cancel}><X size={17} /> Cancelar recorte</button> : <button type="button" className="primary-button" disabled={!canStart} onClick={() => void startTrim()}><Scissors size={18} /> {result ? 'Recortar de nuevo' : 'Recortar video'}<ArrowRight size={17} /></button>}
          <p className="button-caption">{file ? 'Mantén esta pestaña abierta durante el proceso.' : 'Selecciona un video para comenzar.'}</p>
        </div>
      </section>

      {error && <div className="error-message" role="alert"><Info size={20} /><span>{error}</span></div>}
      {busy && update && <section className="status-card" aria-live="polite"><div className="status-heading"><LoaderCircle className="spin" size={21} /><strong>{update.message}</strong><span>{showPercent ? `${percentDone} %` : 'Un momento…'}</span></div><div className={`progress-track ${update.phase === 'loading' || update.phase === 'analyzing' ? 'indeterminate' : ''}`} role="progressbar" aria-label="Progreso del recorte" aria-valuemin={0} aria-valuemax={100} aria-valuenow={showPercent ? percentDone : undefined}><div style={{ width: `${percentDone}%` }} /></div><p>Los videos largos pueden tardar varios minutos. No cierres esta pestaña.</p></section>}
      {result && file && downloadURL && <section className="result-card" aria-live="polite"><div className="result-heading"><span className="success-icon"><Check size={24} /></span><div><h2>Recorte listo.</h2><p>{formatTrimClock(result.startSec)} – {formatTrimClock(result.endSec)} · {formatTrimClock(result.durationSec)} · {size(result.blob.size)}</p></div></div><a className="download-button" href={downloadURL} download={`${file.name.replace(/\.[^.]+$/, '')}-recorte.mp4`}><ArrowDownToLine size={18} /> Descargar MP4</a></section>}

      <div className="under-workspace"><Info size={15} /><span>El corte se reencodifica para no depender de los keyframes. La resolución no cambia.</span><span className="engine-label">POWERED BY FFMPEG.WASM</span></div>
    </div>
  )
}

export default TrimmerPage
