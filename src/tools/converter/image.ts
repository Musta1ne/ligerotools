export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'svg'
export type Quality = 'alta' | 'equilibrada' | 'pequena'

export interface ImageOptions {
  format: ImageFormat
  quality: Quality
  background: string
  width?: number
  colors: number
  detail: number
}

export const MAX_IMAGE_BYTES = 30_000_000
const MAX_CANVAS_PIXELS = 20_000_000
const MIME: Record<Exclude<ImageFormat, 'svg'>, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

export function imageFormat(file: File): ImageFormat | null {
  const match = /\.(png|jpe?g|webp|svg)$/i.exec(file.name)
  if (!match) return null
  const extension = match[1].toLowerCase()
  return extension === 'jpg' ? 'jpeg' : extension === 'jpeg' ? 'jpeg' : (extension as ImageFormat)
}

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Conversión cancelada.', 'AbortError')
}

function loadImage(
  file: File,
  signal: AbortSignal,
): Promise<{ image: HTMLImageElement; release: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    let settled = false
    const release = () => URL.revokeObjectURL(url)
    const cleanup = () => {
      image.onload = null
      image.onerror = null
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      cleanup()
      image.src = ''
      release()
      reject(new DOMException('Conversión cancelada.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    image.onload = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve({ image, release })
    }
    image.onerror = () => {
      if (settled) return
      settled = true
      cleanup()
      release()
      reject(
        new Error('No se pudo abrir la imagen. Revisa que sea un PNG, JPEG, WebP o SVG válido.'),
      )
    }
    image.src = url
    if (signal.aborted) abort()
  })
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('No se pudo crear la imagen de salida.'))
        else if (blob.type !== type)
          reject(new Error('Este navegador no puede exportar el formato elegido.'))
        else resolve(blob)
      },
      type,
      quality,
    )
  })
}

function trace(
  imageData: ImageData,
  colors: number,
  detail: number,
  signal: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./trace.worker.ts', import.meta.url), { type: 'module' })
    let settled = false
    const finish = () => {
      worker.terminate()
      signal.removeEventListener('abort', abort)
    }
    const abort = () => {
      if (settled) return
      settled = true
      finish()
      reject(new DOMException('Conversión cancelada.', 'AbortError'))
    }
    signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<{ svg?: string; error?: string }>) => {
      if (settled) return
      settled = true
      finish()
      if (event.data.error) reject(new Error(event.data.error))
      else if (event.data.svg) resolve(event.data.svg)
      else reject(new Error('No se pudo vectorizar la imagen.'))
    }
    worker.onerror = () => {
      if (settled) return
      settled = true
      finish()
      reject(new Error('No se pudo iniciar la vectorización.'))
    }
    worker.postMessage(
      { width: imageData.width, height: imageData.height, data: imageData.data, colors, detail },
      [imageData.data.buffer],
    )
    if (signal.aborted) abort()
  })
}

export async function convertImage(
  file: File,
  options: ImageOptions,
  signal: AbortSignal,
  onStage: (message: string) => void,
): Promise<Blob> {
  abortIfNeeded(signal)
  const source = imageFormat(file)
  if (!source || !file.size || file.size > MAX_IMAGE_BYTES)
    throw new Error('Selecciona un PNG, JPEG, WebP o SVG de hasta 30 MB.')
  if (source === options.format)
    throw new Error('Elige un formato diferente al del archivo original.')
  if (source === 'svg' && options.format === 'svg') throw new Error('Este SVG ya es vectorial.')
  if (options.format === 'svg' && source === 'svg')
    throw new Error('Selecciona una imagen de píxeles para vectorizar.')
  onStage('Abriendo la imagen…')
  const { image, release } = await loadImage(file, signal)
  try {
    abortIfNeeded(signal)
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    if (!naturalWidth || !naturalHeight) throw new Error('La imagen no tiene dimensiones válidas.')
    const desiredWidth = source === 'svg' && options.width ? options.width : naturalWidth
    if (!Number.isFinite(desiredWidth) || desiredWidth < 1)
      throw new Error('Indica un ancho válido.')
    const scale =
      options.format === 'svg' ? Math.min(1, 1200 / Math.max(naturalWidth, naturalHeight)) : 1
    const width = Math.max(1, Math.round(desiredWidth * scale))
    const height = Math.max(1, Math.round((naturalHeight / naturalWidth) * width))
    if (width * height > MAX_CANVAS_PIXELS)
      throw new Error(
        source === 'svg'
          ? 'La salida supera los 20 megapíxeles. Reduce el ancho elegido.'
          : 'La imagen supera los 20 megapíxeles que admite esta conversión.',
      )
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { willReadFrequently: options.format === 'svg' })
    if (!context) throw new Error('No se pudo preparar el lienzo de imagen.')
    if (options.format === 'jpeg') {
      context.fillStyle = options.background
      context.fillRect(0, 0, width, height)
    }
    context.drawImage(image, 0, 0, width, height)
    abortIfNeeded(signal)
    if (options.format === 'svg') {
      onStage('Trazando formas vectoriales…')
      const svg = await trace(
        context.getImageData(0, 0, width, height),
        options.colors,
        options.detail,
        signal,
      )
      abortIfNeeded(signal)
      return new Blob([svg], { type: 'image/svg+xml' })
    }
    onStage('Creando la imagen de salida…')
    const quality =
      options.quality === 'alta' ? 0.94 : options.quality === 'equilibrada' ? 0.82 : 0.68
    const blob = await canvasBlob(canvas, MIME[options.format], quality)
    abortIfNeeded(signal)
    return blob
  } finally {
    release()
  }
}
