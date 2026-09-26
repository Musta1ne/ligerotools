export const MAX_IMAGE_BYTES = 30_000_000
export const MAX_IMAGE_PIXELS = 12_000_000
export const MODEL_SIDE = 320

export type BrushMode = 'erase' | 'restore'
type Point = { x: number; y: number }
type Stroke = { mode: BrushMode; size: number; softness: number; points: Point[] }
type Rect = { left: number; top: number; right: number; bottom: number }

function strokeBounds(stroke: Stroke, from: Point, to: Point, width: number, height: number): Rect {
  const radius = Math.max(0.5, stroke.size * width / 2) + 2
  return {
    left: Math.max(0, Math.floor(Math.min(from.x, to.x) * width - radius)),
    top: Math.max(0, Math.floor(Math.min(from.y, to.y) * height - radius)),
    right: Math.min(width, Math.ceil(Math.max(from.x, to.x) * width + radius)),
    bottom: Math.min(height, Math.ceil(Math.max(from.y, to.y) * height + radius)),
  }
}

function canvas(width: number, height: number) {
  const node = document.createElement('canvas')
  node.width = width
  node.height = height
  return node
}

function context(node: HTMLCanvasElement) {
  const ctx = node.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('Este navegador no permite editar la imagen.')
  return ctx
}

function stamp(ctx: CanvasRenderingContext2D, stroke: Stroke, point: Point, width: number, height: number) {
  const x = point.x * width
  const y = point.y * height
  const radius = Math.max(0.5, stroke.size * width / 2)
  const rgb = stroke.mode === 'erase' ? '0,0,0' : '255,255,255'
  if (stroke.softness === 0) {
    ctx.fillStyle = `rgb(${rgb})`
  } else {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    gradient.addColorStop(0, `rgba(${rgb},1)`)
    gradient.addColorStop(1 - stroke.softness, `rgba(${rgb},1)`)
    gradient.addColorStop(1, `rgba(${rgb},0)`)
    ctx.fillStyle = gradient
  }
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fill()
}

function segment(ctx: CanvasRenderingContext2D, stroke: Stroke, from: Point, to: Point, width: number, height: number) {
  const distance = Math.hypot((to.x - from.x) * width, (to.y - from.y) * height)
  const step = Math.max(1, stroke.size * width / 6)
  const count = Math.max(1, Math.ceil(distance / step))
  for (let i = 1; i <= count; i++) {
    const t = i / count
    stamp(ctx, stroke, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, width, height)
  }
}

function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], width: number, height: number) {
  ctx.clearRect(0, 0, width, height)
  for (const stroke of strokes) {
    stamp(ctx, stroke, stroke.points[0], width, height)
    for (let i = 1; i < stroke.points.length; i++) segment(ctx, stroke, stroke.points[i - 1], stroke.points[i], width, height)
  }
}

function foregroundColors(mask: Uint8Array, pixels: Uint8ClampedArray) {
  const area = MODEL_SIDE * MODEL_SIDE
  const nearest = new Int32Array(area).fill(-1)
  const queue = new Uint32Array(area)
  let end = 0
  for (let i = 0; i < area; i++) {
    if (mask[i] < 235) continue
    nearest[i] = i
    queue[end++] = i
  }
  for (let start = 0; start < end; start++) {
    const i = queue[start]
    const x = i % MODEL_SIDE
    const y = Math.floor(i / MODEL_SIDE)
    const neighbors = [x > 0 ? i - 1 : -1, x < MODEL_SIDE - 1 ? i + 1 : -1, y > 0 ? i - MODEL_SIDE : -1, y < MODEL_SIDE - 1 ? i + MODEL_SIDE : -1]
    for (const neighbor of neighbors) {
      if (neighbor < 0 || nearest[neighbor] >= 0) continue
      nearest[neighbor] = nearest[i]
      queue[end++] = neighbor
    }
  }
  const colors = new Uint8ClampedArray(area * 4)
  for (let i = 0; i < area; i++) {
    const source = (nearest[i] >= 0 ? nearest[i] : i) * 4
    const target = i * 4
    colors[target] = pixels[source]
    colors[target + 1] = pixels[source + 1]
    colors[target + 2] = pixels[source + 2]
    colors[target + 3] = 255
  }
  return colors
}

export class BackgroundEditor {
  readonly image: HTMLImageElement
  readonly width: number
  readonly height: number
  readonly previewWidth: number
  readonly previewHeight: number
  private preview: HTMLCanvasElement
  private sourcePreview: HTMLCanvasElement
  private corrections: HTMLCanvasElement
  private strokes: Stroke[] = []
  private position = 0
  private current: Stroke | null = null
  private mask: Uint8Array | null = null
  private maskCanvas: HTMLCanvasElement | null = null
  private foregroundCanvas: HTMLCanvasElement | null = null
  private edgeCleanup = 0.5
  private frame = 0
  private dirty: Rect | null = null

  constructor(image: HTMLImageElement, preview: HTMLCanvasElement) {
    this.image = image
    this.width = image.naturalWidth
    this.height = image.naturalHeight
    this.previewWidth = Math.min(this.width, 1200)
    this.previewHeight = Math.max(1, Math.round(this.height * this.previewWidth / this.width))
    this.preview = preview
    this.preview.width = this.previewWidth
    this.preview.height = this.previewHeight
    this.sourcePreview = canvas(this.previewWidth, this.previewHeight)
    context(this.sourcePreview).drawImage(image, 0, 0, this.previewWidth, this.previewHeight)
    this.corrections = canvas(this.previewWidth, this.previewHeight)
    this.render()
  }

  get canUndo() { return this.position > 0 }
  get canRedo() { return this.position < this.strokes.length }
  get hasChanges() { return this.position > 0 || this.mask !== null }
  get hasAutomaticMask() { return this.mask !== null }

  inputPixels() {
    const node = canvas(MODEL_SIDE, MODEL_SIDE)
    const ctx = context(node)
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, MODEL_SIDE, MODEL_SIDE)
    ctx.drawImage(this.image, 0, 0, MODEL_SIDE, MODEL_SIDE)
    return ctx.getImageData(0, 0, MODEL_SIDE, MODEL_SIDE).data
  }

  setMask(mask: Uint8Array) {
    if (mask.length !== MODEL_SIDE * MODEL_SIDE) throw new Error('El resultado automático está incompleto.')
    this.mask = mask
    const small = canvas(MODEL_SIDE, MODEL_SIDE)
    const smallCtx = context(small)
    const maskImage = smallCtx.createImageData(MODEL_SIDE, MODEL_SIDE)
    for (let i = 0; i < mask.length; i++) {
      const n = i * 4
      maskImage.data[n] = maskImage.data[n + 1] = maskImage.data[n + 2] = mask[i]
      maskImage.data[n + 3] = 255
    }
    smallCtx.putImageData(maskImage, 0, 0)
    this.maskCanvas = small
    const foreground = canvas(MODEL_SIDE, MODEL_SIDE)
    context(foreground).putImageData(new ImageData(foregroundColors(mask, this.inputPixels()), MODEL_SIDE, MODEL_SIDE), 0, 0)
    this.foregroundCanvas = foreground
    this.render()
  }

  setEdgeCleanup(value: number) {
    this.edgeCleanup = Math.min(1, Math.max(0, value))
    this.render()
  }

  begin(mode: BrushMode, size: number, softness: number, point: Point) {
    this.strokes.length = this.position
    this.current = { mode, size: size / this.width, softness, points: [point] }
    this.strokes.push(this.current)
    this.position += 1
    stamp(context(this.corrections), this.current, point, this.previewWidth, this.previewHeight)
    this.scheduleRender(strokeBounds(this.current, point, point, this.previewWidth, this.previewHeight))
  }

  move(point: Point) {
    if (!this.current) return
    const previous = this.current.points.at(-1)!
    this.current.points.push(point)
    segment(context(this.corrections), this.current, previous, point, this.previewWidth, this.previewHeight)
    this.scheduleRender(strokeBounds(this.current, previous, point, this.previewWidth, this.previewHeight))
  }

  end() { this.current = null }

  undo() {
    if (!this.canUndo) return
    this.position -= 1
    this.rebuildCorrections()
  }

  redo() {
    if (!this.canRedo) return
    this.position += 1
    this.rebuildCorrections()
  }

  reset() {
    this.strokes = []
    this.position = 0
    this.current = null
    this.rebuildCorrections()
  }

  dispose() { cancelAnimationFrame(this.frame); this.dirty = null }

  private rebuildCorrections() {
    drawStrokes(context(this.corrections), this.strokes.slice(0, this.position), this.previewWidth, this.previewHeight)
    this.render()
  }

  private scheduleRender(rect: Rect) {
    this.dirty = this.dirty ? {
      left: Math.min(this.dirty.left, rect.left),
      top: Math.min(this.dirty.top, rect.top),
      right: Math.max(this.dirty.right, rect.right),
      bottom: Math.max(this.dirty.bottom, rect.bottom),
    } : rect
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      const dirty = this.dirty
      this.dirty = null
      if (dirty) this.render(dirty)
    })
  }

  private applyMask(node: HTMLCanvasElement, corrections: HTMLCanvasElement, rect: Rect = { left: 0, top: 0, right: node.width, bottom: node.height }) {
    const { width, height } = node
    const ctx = context(node)
    const correctionCtx = context(corrections)
    const columns = rect.right - rect.left
    for (let top = rect.top; top < rect.bottom; top += 256) {
      const rows = Math.min(256, rect.bottom - top)
      const imageData = ctx.getImageData(rect.left, top, columns, rows)
      const pixels = imageData.data
      const correctionPixels = correctionCtx.getImageData(rect.left, top, columns, rows).data
      let basePixels: Uint8ClampedArray | null = null
      let foregroundPixels: Uint8ClampedArray | null = null
      if (this.maskCanvas) {
        const scaled = canvas(columns, rows)
        const scaledCtx = context(scaled)
        scaledCtx.imageSmoothingQuality = 'high'
        scaledCtx.drawImage(this.maskCanvas, -rect.left, -top, width, height)
        basePixels = scaledCtx.getImageData(0, 0, columns, rows).data
        if (this.foregroundCanvas && this.edgeCleanup > 0) {
          scaledCtx.clearRect(0, 0, columns, rows)
          scaledCtx.drawImage(this.foregroundCanvas, -rect.left, -top, width, height)
          foregroundPixels = scaledCtx.getImageData(0, 0, columns, rows).data
        }
      }
      for (let i = 0; i < pixels.length; i += 4) {
        const coverage = correctionPixels[i + 3] / 255
        const rawBase = basePixels ? basePixels[i] / 255 : 1
        const edge = 0.08 * this.edgeCleanup
        const base = basePixels ? Math.min(1, Math.max(0, (rawBase - edge) / (1 - 2 * edge))) * 255 : 255
        const alpha = base * (1 - coverage) + correctionPixels[i] * coverage
        if (foregroundPixels && alpha > 0 && alpha < 255) {
          const blend = this.edgeCleanup * 0.9 * (1 - alpha / 255)
          for (let channel = 0; channel < 3; channel++) {
            pixels[i + channel] = Math.round(pixels[i + channel] * (1 - blend) + foregroundPixels[i + channel] * blend)
          }
        }
        pixels[i + 3] = Math.round(pixels[i + 3] * alpha / 255)
      }
      ctx.putImageData(imageData, rect.left, top)
    }
  }

  render(rect?: Rect) {
    if (!rect && this.frame) { cancelAnimationFrame(this.frame); this.frame = 0; this.dirty = null }
    const ctx = context(this.preview)
    const area = rect ?? { left: 0, top: 0, right: this.previewWidth, bottom: this.previewHeight }
    const columns = area.right - area.left
    const rows = area.bottom - area.top
    if (!columns || !rows) return
    ctx.clearRect(area.left, area.top, columns, rows)
    ctx.drawImage(this.sourcePreview, area.left, area.top, columns, rows, area.left, area.top, columns, rows)
    this.applyMask(this.preview, this.corrections, area)
  }

  async exportPNG() {
    const result = canvas(this.width, this.height)
    context(result).drawImage(this.image, 0, 0)
    const corrections = canvas(this.width, this.height)
    drawStrokes(context(corrections), this.strokes.slice(0, this.position), this.width, this.height)
    this.applyMask(result, corrections)
    return new Promise<Blob>((resolve, reject) => {
      result.toBlob((blob) => blob ? resolve(blob) : reject(new Error('No se pudo crear el PNG.')), 'image/png')
    })
  }
}
