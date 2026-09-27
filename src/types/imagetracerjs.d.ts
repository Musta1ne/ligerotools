declare module 'imagetracerjs' {
  const ImageTracer: {
    imagedataToSVG(image: ImageData, options: Record<string, number | boolean>): string
  }
  export default ImageTracer
}
