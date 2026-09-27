# Convertidor de formatos

## Objetivo

Una herramienta independiente del catálogo convierte una imagen, un vídeo o un audio por vez en el dispositivo del usuario. La interfaz ofrece una lista explícita de formatos y solo combinaciones de origen y destino admitidas. [Decisión sobre procesamiento local](adr/0002-procesar-conversiones-en-el-navegador.md).

## Imágenes

- Entradas iniciales: PNG, JPEG, WebP y SVG; máximo 30 MB.
- Salidas: PNG, JPEG, WebP y SVG. No se ofrece como destino el mismo formato de origen.
- PNG/JPEG/WebP a SVG significa vectorización real, con formas editables y escalables. Se priorizan logos, iconos e ilustraciones de colores definidos. Hay ajustes simples de colores y detalle y una vista previa del resultado. La fidelidad de fotografías detalladas queda fuera del objetivo inicial.
- SVG a PNG/JPEG/WebP rasteriza el dibujo. Se puede elegir el ancho de salida y se conserva la proporción.
- Al convertir transparencia a JPEG, el fondo es blanco por defecto y se puede elegir otro color.
- JPEG y WebP ofrecen calidad alta, equilibrada o archivo más pequeño. La orientación visual se aplica y el archivo descargado no conserva metadatos de cámara, ubicación o fecha.
- GIF animado como entrada queda fuera de la primera versión.

## Vídeos

- Entradas iniciales: MP4, MOV, WebM, MKV y AVI; máximo 500 MB.
- Salidas de vídeo completo: MP4, MOV, MKV, AVI y WebM. No se ofrece como destino el mismo formato de origen. Se conservan duración, dimensiones y audio cuando el formato y el códec lo permiten. MP4, MOV y MKV usan H.264 y AAC; AVI usa MPEG-4 y MP3; WebM usa VP8 y Opus. La calidad se elige entre alta, equilibrada y archivo más pequeño; ninguna opción garantiza un tamaño exacto.
- GIF usa un fragmento continuo elegido por el usuario de hasta 15 segundos. No contiene audio. Se puede ajustar el ancho y la cantidad de fotogramas por segundo, con una estimación orientativa de tamaño.
- MP3 extrae la pista de audio del vídeo completo. Un vídeo sin audio informa que no hay ninguna pista para extraer.

## Audios

- Entradas y salidas iniciales: MP3, WAV, M4A, AAC, FLAC, OGG (Vorbis) y Opus; máximo 100 MB de entrada. No se ofrece como destino el mismo formato de origen.
- MP3, M4A, AAC, OGG y Opus ofrecen niveles de calidad alta, equilibrada y archivo más pequeño. WAV (PCM) y FLAC son salidas sin pérdida adicional; no recuperan calidad que ya se perdió en un origen comprimido. Una salida WAV estimada en más de 200 MB se rechaza antes de convertir para evitar agotar la memoria.
- Se convierte la primera pista de audio completa. La vista previa depende de los formatos que el navegador pueda reproducir; la descarga sigue disponible aunque el reproductor integrado no la abra.

## Experiencia y límites

- Mostrar vista previa cuando el navegador pueda reproducir el archivo; permitir elegir el fragmento GIF mediante la posición del reproductor o valores de inicio y fin.
- Mostrar progreso o estado, permitir cancelar y ofrecer descarga y vista previa del resultado cuando el navegador pueda mostrarlo.
- Admitir móviles compatibles e informar cuando el archivo o sus recursos superen la capacidad del dispositivo.
- La extensión del archivo no garantiza que su códec se pueda leer. Un fallo de lectura o conversión debe explicarse sin ofrecer una descarga vacía. Las combinaciones publicadas necesitan comprobación en navegador antes de prometer compatibilidad general.

## Casos de aceptación

- Un logo PNG se convierte en un SVG con trazados vectoriales reales; los controles de colores y detalle cambian la vista previa y el archivo descargado.
- Un SVG se exporta a PNG con el ancho elegido y la proporción original.
- Un PNG transparente convertido a JPEG usa blanco o el color de fondo elegido.
- Un MOV con audio se convierte a MP4 completo y conserva audio y duración cuando sus códecs son compatibles.
- Un MP4 ofrece MOV, MKV y AVI como destinos, además de WebM y GIF. Cada resultado descargado contiene pistas de vídeo y audio compatibles con su contenedor.
- Un vídeo se convierte en GIF desde el fragmento elegido, sin audio y con un máximo de 15 segundos.
- Un vídeo con audio se convierte en MP3 sin pista de imagen; uno sin audio muestra un error claro.
- Un MP3 se convierte a WAV, M4A, AAC, FLAC, OGG y Opus; cada archivo descargado contiene una pista de audio legible.
- La cancelación detiene la conversión y el usuario puede volver a intentarlo con el mismo archivo.
