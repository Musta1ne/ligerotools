import * as ort from 'onnxruntime-web/wasm'
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'

const SIDE = 320
const MODEL_BYTES = 44_173_029
const MODEL_URL = `${import.meta.env.BASE_URL}models/silueta.onnx`

ort.env.wasm.numThreads = 1
ort.env.wasm.wasmPaths = { wasm: wasmUrl }

type RunMessage = { type: 'run'; pixels: Uint8ClampedArray }
type WorkerMessage =
  | { type: 'progress'; phase: 'download' | 'processing'; percent: number }
  | { type: 'result'; mask: Uint8Array }
  | { type: 'error'; message: string }

let session: ort.InferenceSession | null = null

function send(message: WorkerMessage, transfer: Transferable[] = []) {
  self.postMessage(message, { transfer })
}

async function loadModel() {
  if (session) return session
  const response = await fetch(MODEL_URL, { cache: 'force-cache' })
  if (!response.ok || !response.body) throw new Error('No se pudo descargar el modelo.')
  const expected = Number(response.headers.get('content-length')) || MODEL_BYTES
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    received += value.byteLength
    send({ type: 'progress', phase: 'download', percent: Math.min(100, Math.round(received / expected * 100)) })
  }
  const model = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    model.set(chunk, offset)
    offset += chunk.byteLength
  }
  send({ type: 'progress', phase: 'processing', percent: 0 })
  session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] })
  return session
}

function tensorFromPixels(pixels: Uint8ClampedArray) {
  const area = SIDE * SIDE
  if (pixels.length !== area * 4) throw new Error('La imagen no se pudo preparar.')
  let max = 1
  for (let i = 0; i < pixels.length; i += 4) {
    max = Math.max(max, pixels[i], pixels[i + 1], pixels[i + 2])
  }
  const data = new Float32Array(area * 3)
  const mean = [0.485, 0.456, 0.406]
  const std = [0.229, 0.224, 0.225]
  for (let i = 0; i < area; i++) {
    for (let channel = 0; channel < 3; channel++) {
      data[channel * area + i] = (pixels[i * 4 + channel] / max - mean[channel]) / std[channel]
    }
  }
  return new ort.Tensor('float32', data, [1, 3, SIDE, SIDE])
}

async function run(pixels: Uint8ClampedArray) {
  const model = await loadModel()
  send({ type: 'progress', phase: 'processing', percent: 0 })
  const outputs = await model.run({ [model.inputNames[0]]: tensorFromPixels(pixels) })
  const prediction = outputs[model.outputNames[0]].data as Float32Array
  const area = SIDE * SIDE
  if (prediction.length < area) throw new Error('El modelo devolvió un resultado incompleto.')
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (let i = 0; i < area; i++) {
    min = Math.min(min, prediction[i])
    max = Math.max(max, prediction[i])
  }
  const span = Math.max(max - min, 1e-6)
  const mask = new Uint8Array(area)
  for (let i = 0; i < area; i++) mask[i] = Math.round((prediction[i] - min) / span * 255)
  send({ type: 'result', mask }, [mask.buffer])
}

self.onmessage = (event: MessageEvent<RunMessage>) => {
  if (event.data.type !== 'run') return
  void run(event.data.pixels).catch((error: unknown) => {
    send({ type: 'error', message: error instanceof Error ? error.message : 'No se pudo quitar el fondo.' })
  })
}
