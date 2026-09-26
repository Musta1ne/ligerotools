import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, PointerEvent } from 'react'
import { ArrowDownToLine, Brush, Eraser, Hand, ImagePlus, LoaderCircle, Maximize2, Minimize2, Moon, Redo2, RotateCcw, ShieldCheck, Sparkles, Undo2, Upload, ZoomIn, ZoomOut } from 'lucide-react'
import { BackgroundEditor, MAX_IMAGE_BYTES, MAX_IMAGE_PIXELS } from './editor'
import type { BrushMode } from './editor'
import './background.css'

type Progress = { phase: 'download' | 'processing'; percent: number }
type Tool = BrushMode | 'pan'
type BrushCursor = { x: number; y: number; stageHeight: number }
const accepted = ['image/jpeg', 'image/png', 'image/webp']
const MAX_ZOOM = 8

function BrushSetting({ label, unit, min, max, value, disabled, title, onChange }: {
  label: string
  unit: string
  min: number
  max: number
  value: number
  disabled: boolean
  title?: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState<string | null>(null)

  function commit() {
    const text = draft ?? String(value)
    const number = Number(text)
    const next = text.trim() !== '' && Number.isFinite(number)
      ? Math.min(max, Math.max(min, Math.round(number)))
      : value
    onChange(next)
    setDraft(null)
  }

  return <div className="background-brush-setting" title={title}>
    <span>{label}</span>
    <input type="range" aria-label={label} min={min} max={max} value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />
    <div className="background-number">
      <input type="number" aria-label={`${label} en ${unit === 'px' ? 'píxeles' : 'porcentaje'}`} min={min} max={max} step="1" inputMode="numeric" value={draft ?? value} disabled={disabled} onFocus={(event) => { setDraft(String(value)); event.target.select() }} onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        const number = Number(text)
        if (text.trim() && Number.isInteger(number) && number >= min && number <= max) onChange(number)
      }} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }} />
      <span aria-hidden="true">{unit}</span>
    </div>
  </div>
}

function BackgroundPage() {
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [tool, setTool] = useState<Tool>('erase')
  const [brushSize, setBrushSize] = useState(44)
  const [softness, setSoftness] = useState(35)
  const [edgeCleanup, setEdgeCleanup] = useState(50)
  const [zoom, setZoom] = useState(1)
  const [fitWidth, setFitWidth] = useState(900)
  const [revision, setRevision] = useState(0)
  const [editor, setEditor] = useState<BackgroundEditor | null>(null)
  const [downloaded, setDownloaded] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [darkGrid, setDarkGrid] = useState(false)
  const [panning, setPanning] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [brushCursor, setBrushCursor] = useState<BrushCursor | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const workspaceRef = useRef<HTMLElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<BackgroundEditor | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const sourceURL = useRef('')
  const downloadURL = useRef('')
  const pointer = useRef<{ id: number; x: number; y: number; pan: boolean; button: number } | null>(null)
  const token = useRef(0)

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => setFitWidth(Math.max(100, viewport.clientWidth - 28)))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    function onFullscreenChange() { setFullscreen(document.fullscreenElement === workspaceRef.current) }
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange)
  }, [])

  useEffect(() => () => {
    token.current += 1
    workerRef.current?.terminate()
    editorRef.current?.dispose()
    if (sourceURL.current) URL.revokeObjectURL(sourceURL.current)
    if (downloadURL.current) URL.revokeObjectURL(downloadURL.current)
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!editorRef.current || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      if (event.shiftKey) editorRef.current.redo()
      else editorRef.current.undo()
      setDownloaded(false)
      setRevision((n) => n + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function cancelAuto() {
    workerRef.current?.terminate()
    workerRef.current = null
    setBusy(false)
    setProgress(null)
  }

  async function selectFile(selected?: File) {
    if (!selected) return
    setError('')
    if (!accepted.includes(selected.type)) {
      setError('Elige una imagen JPG, PNG o WebP.')
      return
    }
    if (selected.size === 0 || selected.size > MAX_IMAGE_BYTES) {
      setError('La imagen debe pesar hasta 30 MB.')
      return
    }
    if (editorRef.current?.hasChanges && !downloaded && !window.confirm('Hay cambios sin descargar. ¿Reemplazar esta imagen?')) return
    const currentToken = ++token.current
    const url = URL.createObjectURL(selected)
    const image = new Image()
    image.src = url
    try {
      await image.decode()
      if (currentToken !== token.current) { URL.revokeObjectURL(url); return }
      if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS) {
        throw new Error('La imagen debe tener hasta 12 megapíxeles.')
      }
      cancelAuto()
      editorRef.current?.dispose()
      if (sourceURL.current) URL.revokeObjectURL(sourceURL.current)
      sourceURL.current = url
      const node = canvasRef.current
      if (!node) throw new Error('No se pudo abrir el editor.')
      editorRef.current = new BackgroundEditor(image, node)
      setEditor(editorRef.current)
      setFile(selected)
      setDownloaded(false)
      setEdgeCleanup(50)
      setZoom(1)
      setBrushCursor(null)
      setRevision((n) => n + 1)
    } catch (cause) {
      URL.revokeObjectURL(url)
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir la imagen.')
    }
  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    void selectFile(event.target.files?.[0])
    event.target.value = ''
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    if (event.dataTransfer.files.length > 1) {
      setError('Selecciona una sola imagen a la vez.')
      return
    }
    void selectFile(event.dataTransfer.files[0])
  }

  function runAutomatic() {
    const current = editorRef.current
    if (!current || busy) return
    setError('')
    setBusy(true)
    setProgress({ phase: 'download', percent: 0 })
    let worker: Worker
    try {
      worker = new Worker(new URL('./background.worker.ts', import.meta.url), { type: 'module' })
    } catch {
      setBusy(false)
      setProgress(null)
      setError('El modo automático no está disponible en este navegador. Puedes continuar con el pincel.')
      return
    }
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<
      | { type: 'progress'; phase: 'download' | 'processing'; percent: number }
      | { type: 'result'; mask: Uint8Array }
      | { type: 'error'; message: string }
    >) => {
      if (workerRef.current !== worker) return
      if (event.data.type === 'progress') setProgress(event.data)
      if (event.data.type === 'result') {
        try {
          current.setMask(event.data.mask)
          setDownloaded(false)
          setRevision((n) => n + 1)
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'No se pudo usar el resultado automático.')
        }
        cancelAuto()
      }
      if (event.data.type === 'error') {
        setError(`${event.data.message} Puedes continuar con el pincel.`)
        cancelAuto()
      }
    }
    worker.onerror = () => {
      if (workerRef.current !== worker) return
      setError('El modo automático no está disponible en este navegador. Puedes continuar con el pincel.')
      cancelAuto()
    }
    try {
      const pixels = current.inputPixels()
      worker.postMessage({ type: 'run', pixels }, [pixels.buffer])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo preparar la imagen.')
      cancelAuto()
    }
  }

  async function download() {
    const current = editorRef.current
    if (!current) return
    setError('')
    try {
      const blob = await current.exportPNG()
      if (editorRef.current !== current) return
      if (downloadURL.current) URL.revokeObjectURL(downloadURL.current)
      const url = URL.createObjectURL(blob)
      downloadURL.current = url
      const link = document.createElement('a')
      link.href = url
      link.download = `${file?.name.replace(/\.[^.]+$/, '') || 'imagen'}-sin-fondo.png`
      link.click()
      setDownloaded(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo descargar el PNG.')
    }
  }

  function pointAt(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  function updateBrushCursor(event: PointerEvent<HTMLCanvasElement>) {
    const current = editorRef.current
    const stage = stageRef.current
    if (!current || !stage || tool === 'pan' || pointer.current?.pan) { setBrushCursor(null); return }
    const canvasRect = event.currentTarget.getBoundingClientRect()
    if (event.clientX < canvasRect.left || event.clientX > canvasRect.right || event.clientY < canvasRect.top || event.clientY > canvasRect.bottom) {
      setBrushCursor(null)
      return
    }
    const stageRect = stage.getBoundingClientRect()
    setBrushCursor({
      x: event.clientX - stageRect.left,
      y: event.clientY - stageRect.top,
      stageHeight: stageRect.height,
    })
  }

  function onPointerDown(event: PointerEvent<HTMLCanvasElement>) {
    if (!editorRef.current || (event.button !== 0 && event.button !== 2)) return
    const pan = tool === 'pan' || event.button === 2
    if (event.button === 2) event.preventDefault()
    if (pan) { setBrushCursor(null); setPanning(true) }
    else updateBrushCursor(event)
    event.currentTarget.setPointerCapture(event.pointerId)
    pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan, button: event.button }
    if (pan) return
    editorRef.current.begin(tool, brushSize, softness / 100, pointAt(event))
    setDownloaded(false)
    setRevision((n) => n + 1)
  }

  function onPointerMove(event: PointerEvent<HTMLCanvasElement>) {
    const current = pointer.current
    if (current?.id === event.pointerId && !(event.buttons & (current.button === 2 ? 2 : 1))) {
      onPointerEnd(event)
      return
    }
    updateBrushCursor(event)
    if (!current || current.id !== event.pointerId) return
    if (current.pan) {
      viewportRef.current?.scrollBy(current.x - event.clientX, current.y - event.clientY)
      current.x = event.clientX
      current.y = event.clientY
    } else editorRef.current?.move(pointAt(event))
  }

  function onPointerEnd(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current?.id !== event.pointerId) return
    editorRef.current?.end()
    pointer.current = null
    setPanning(false)
    if (event.pointerType === 'touch' || event.type === 'pointercancel') setBrushCursor(null)
    else updateBrushCursor(event)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  function resetBrushStrokes() {
    if (!editorRef.current?.canUndo || !window.confirm('¿Restablecer todas las pinceladas? Se perderán los cambios hechos con el pincel.')) return
    editorRef.current.reset()
    setDownloaded(false)
    setRevision((n) => n + 1)
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === workspaceRef.current) await document.exitFullscreen()
      else await workspaceRef.current?.requestFullscreen()
    } catch {
      setError('No se pudo abrir el editor en pantalla completa.')
    }
  }

  const displayWidth = editor ? Math.min(editor.previewWidth, fitWidth) * zoom : 0
  const brushDiameter = editor ? brushSize * displayWidth / editor.width : 0

  return (
    <div className="background-page">
      <section className="background-intro">
        <div className="eyebrow">IMÁGENES · EN TU DISPOSITIVO</div>
        <h1>Quita el fondo de tus imágenes.</h1>
        <p>Hazlo en un toque o ajusta cada detalle con el pincel. Tu imagen se procesa en este navegador.</p>
      </section>

      <section ref={workspaceRef} className="background-workspace" aria-label="Editor de fondo">
        <div className="background-toolbar">
          <div className="background-toolbar-group">
            <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={onInput} aria-label="Elegir imagen" />
            <button type="button" className="background-button background-button-outline" onClick={() => inputRef.current?.click()}>
              <ImagePlus size={17} aria-hidden="true" /> {file ? 'Otra imagen' : 'Elegir imagen'}
            </button>
            <button type="button" className="background-button background-button-primary" disabled={!file || busy} onClick={runAutomatic}>
              <Sparkles size={17} aria-hidden="true" /> Quitar fondo
            </button>
            {busy && <button type="button" className="background-button background-button-outline" onClick={cancelAuto}>Cancelar</button>}
          </div>
          <div className="background-toolbar-actions">
            {file && <>
              <div className="background-edit-actions" role="group" aria-label="Historial de pinceladas">
                <button type="button" title="Deshacer pincelada" aria-label="Deshacer pincelada" disabled={!editor?.canUndo} onClick={() => { editorRef.current?.undo(); setDownloaded(false); setRevision((n) => n + 1) }}><Undo2 size={18} /></button>
                <button type="button" title="Rehacer pincelada" aria-label="Rehacer pincelada" disabled={!editor?.canRedo} onClick={() => { editorRef.current?.redo(); setDownloaded(false); setRevision((n) => n + 1) }}><Redo2 size={18} /></button>
                <button type="button" title="Restablecer pinceladas" aria-label="Restablecer pinceladas" disabled={!editor?.canUndo} onClick={resetBrushStrokes}><RotateCcw size={18} /></button>
              </div>
              <div className="background-zoom" role="group" aria-label="Zoom de la imagen"><button type="button" aria-label="Alejar" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, value - 0.25))}><ZoomOut size={18} /></button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Acercar" disabled={zoom >= MAX_ZOOM} onClick={() => setZoom((value) => Math.min(MAX_ZOOM, value + 0.25))}><ZoomIn size={18} /></button></div>
              <button type="button" className="background-button background-button-outline background-fullscreen" aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} title={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} disabled={!document.fullscreenEnabled} onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}</button>
            </>}
            <button type="button" className="background-button background-button-download" disabled={!file || busy} onClick={() => void download()}>
              <ArrowDownToLine size={17} aria-hidden="true" /> Descargar PNG
            </button>
          </div>
        </div>

        {file && (
          <div className="background-controls" aria-label="Controles del pincel">
            <div className="background-tool-group" role="group" aria-label="Herramienta">
              <button type="button" className={tool === 'erase' ? 'is-active' : ''} aria-pressed={tool === 'erase'} onClick={() => setTool('erase')}><Eraser size={17} aria-hidden="true" /> Borrar</button>
              <button type="button" className={tool === 'restore' ? 'is-active' : ''} aria-pressed={tool === 'restore'} onClick={() => setTool('restore')}><Brush size={17} aria-hidden="true" /> Recuperar</button>
              <button type="button" className={tool === 'pan' ? 'is-active' : ''} aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}><Hand size={17} aria-hidden="true" /> Mover</button>
            </div>
            <button type="button" className={`background-grid-toggle${darkGrid ? ' is-active' : ''}`} aria-pressed={darkGrid} onClick={() => setDarkGrid((value) => !value)}><Moon size={17} aria-hidden="true" /> Cuadrícula oscura</button>
            <BrushSetting label="Tamaño" unit="px" min={1} max={160} value={brushSize} disabled={tool === 'pan'} onChange={setBrushSize} />
            <BrushSetting label="Suavidad" unit="%" min={0} max={100} value={softness} disabled={tool === 'pan'} onChange={setSoftness} />
            <BrushSetting label="Bordes" unit="%" min={0} max={100} value={edgeCleanup} disabled={!editor?.hasAutomaticMask} title="Disponible después de quitar el fondo. Aumenta para reducir halos de color; baja si desaparecen detalles finos." onChange={(value) => { setEdgeCleanup(value); editorRef.current?.setEdgeCleanup(value / 100); setDownloaded(false) }} />
          </div>
        )}

        <div ref={stageRef} className={`background-stage${dragging ? ' is-dragging' : ''}${darkGrid ? ' is-dark-grid' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
          {!file && <div className="background-empty"><Upload size={34} aria-hidden="true" /><h2>Arrastra tu imagen aquí</h2><p>O elige un archivo JPG, PNG o WebP de hasta 30 MB y 12 megapíxeles.</p><button type="button" className="background-button background-button-primary" onClick={() => inputRef.current?.click()}>Elegir imagen</button></div>}
          <div ref={viewportRef} className={`background-viewport${file ? '' : ' is-empty'}`}>
            <canvas ref={canvasRef} className={`background-canvas tool-${tool}${panning ? ' is-panning' : ''}`} style={{ width: displayWidth || undefined }} onContextMenu={(event) => event.preventDefault()} onPointerEnter={updateBrushCursor} onPointerLeave={() => setBrushCursor(null)} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd} aria-label="Vista previa editable de la imagen" />
          </div>
          {brushCursor && tool !== 'pan' && <div className={`background-brush-cursor mode-${tool}`} style={{ left: brushCursor.x, top: brushCursor.y }} aria-hidden="true">
            <span className="background-brush-outline" style={{ width: brushDiameter, height: brushDiameter }} />
            <span className="background-brush-center" />
            <span className="background-brush-caption" style={{ top: brushCursor.y + brushDiameter / 2 + 38 > brushCursor.stageHeight ? -brushDiameter / 2 - 32 : brushDiameter / 2 + 10 }}>{tool === 'erase' ? 'Borrar' : 'Recuperar'} · {brushSize} px</span>
          </div>}
        </div>

        {file && <div className="background-statusline"><span>{file.name} · {editor?.width} × {editor?.height} px</span><span>{tool === 'pan' ? 'Arrastra para mover la vista.' : 'Usa el botón derecho para mover la vista sin cambiar de herramienta.'}</span></div>}
        {busy && <div className="background-progress" role="status"><LoaderCircle size={18} className="background-spin" aria-hidden="true" /><span>{progress?.phase === 'download' ? `Descargando modelo… ${progress.percent}%` : 'Quitando fondo…'}</span>{progress?.phase === 'download' && <progress value={progress.percent} max="100" />}</div>}
        {error && <p className="background-error" role="alert">{error}</p>}
      </section>

      <div className="background-notes"><p><ShieldCheck size={18} aria-hidden="true" /> La imagen permanece en tu dispositivo.</p><p>El modo automático descarga alrededor de 60 MB la primera vez. Puedes usar el pincel sin esperar al modelo.</p></div>
      <span className="background-sr-only" aria-live="polite">{revision > 0 && editor?.hasChanges ? 'Imagen editada' : ''}</span>
    </div>
  )
}

export default BackgroundPage
