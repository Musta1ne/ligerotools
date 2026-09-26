# Componentes de eliminación de fondo

- `public/models/silueta.onnx`: modelo Silueta de 44 173 029 bytes, descargado del [release de rembg](https://github.com/danielgatis/rembg/releases/download/v0.0.0/silueta.onnx). SHA-256: `75da6c8d2f8096ec743d071951be73b4a8bc7b3e51d9a6625d63644f90ffeedb`. rembg publica el [MD5 esperado](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/silueta.py): `55e59e0d8062d2f5d013f4725ee84782`.
- Silueta es una reducción de [U²-Net](https://github.com/xuebinqin/U-2-Net), publicado bajo [Apache 2.0](https://github.com/xuebinqin/U-2-Net/blob/master/LICENSE). El autor de la reducción compartió el modelo en [este hilo del proyecto](https://github.com/xuebinqin/U-2-Net/issues/295).
- `onnxruntime-web` 1.30.0 se distribuye bajo MIT. El WASM se emite como recurso local por Vite desde esa dependencia.

El modelo se carga en el navegador después de que el usuario inicia el modo automático. Las imágenes no se envían al origen ni a servicios externos.
