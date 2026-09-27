import ImageTracer from 'imagetracerjs'

self.onmessage = (
  event: MessageEvent<{
    width: number
    height: number
    data: Uint8ClampedArray
    colors: number
    detail: number
  }>,
) => {
  try {
    const { width, height, data, colors, detail } = event.data
    const pixels = new Uint8ClampedArray(new ArrayBuffer(data.byteLength))
    pixels.set(data)
    const image = new ImageData(pixels, width, height)
    const svg = ImageTracer.imagedataToSVG(image, {
      numberofcolors: Math.max(2, Math.min(32, Math.round(colors))),
      pathomit: detail === 3 ? 0 : detail === 2 ? 4 : 10,
      ltres: detail === 3 ? 0.5 : detail === 2 ? 1 : 2,
      qtres: detail === 3 ? 0.5 : detail === 2 ? 1 : 2,
      viewbox: true,
      roundcoords: 2,
    })
    self.postMessage({ svg })
  } catch {
    self.postMessage({ error: 'No se pudo vectorizar esta imagen. Prueba con una más simple.' })
  }
}
