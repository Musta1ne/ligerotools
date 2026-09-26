# Herramienta para eliminar el fondo de imágenes

## Objetivo

Permitir que una persona separe del fondo uno o varios sujetos principales en fotografías de productos o personas, corrija el resultado y descargue un PNG transparente. La primera versión procesa una imagen por vez y funciona en escritorio y móvil.

## Flujo acordado

1. Cargar una imagen JPG, PNG o WebP. Si hay una edición sin descargar, avisar antes de reemplazarla.
2. Elegir entre iniciar la eliminación automática con el botón «Quitar fondo» o comenzar a editar con pincel.
3. El automático intenta conservar todos los sujetos principales y eliminar el fondo, incluidas sus sombras. Se ejecuta en el navegador; antes de descargar el modelo, se informa el tamaño y se muestra el progreso. La descarga inicial necesaria para el automático tiene un tope de 100 MB.
4. Corregir con pinceles para borrar y recuperar. Ofrecer tamaño desde 1 px de la imagen de salida y suavidad ajustables, zoom, desplazamiento, deshacer, rehacer y restablecer. Si el automático se ejecuta después de una edición manual, las pinceladas se conservan sobre el resultado automático. El control «Bordes» ajusta la limpieza del contorno del resultado automático.
5. Previsualizar y descargar el resultado en PNG transparente, conservando las dimensiones originales cuando la imagen esté dentro del límite admitido.

## Fallos y límites

- Si el automático falla o no está disponible, informar el motivo y permitir la edición manual con la imagen y los cambios previos intactos.
- Permitir cancelar el automático sin perder la imagen ni las correcciones previas.
- Avisar antes de aceptar una imagen que exceda el límite de tamaño o dimensiones. El valor concreto se fijará con pruebas de memoria y exportación en móviles y escritorio.
- No se exige que la herramienta funcione sin conexión. La imagen permanece en el dispositivo durante el procesamiento.
- No se guardan proyectos ni se procesan lotes en la primera versión.

## Motor automático y validación

La implementación usa el modelo Silueta (U²-Net reducido, 44,2 MB) con ONNX Runtime Web (WASM, 14,2 MB). Ambos se sirven desde el mismo sitio y se cargan al pulsar «Quitar fondo». El modelo se ejecuta en un worker que puede terminarse para cancelar la operación. [Origen y comprobación del modelo](https://github.com/danielgatis/rembg/blob/main/rembg/sessions/silueta.py), [proyecto U²-Net](https://github.com/xuebinqin/U-2-Net).

La prueba en Chrome de escritorio incluyó una fotografía de retrato con cabello, otra con dos sujetos y una de producto. Las tres generaron un PNG transparente y preservaron los sujetos principales. La salida aplica una limpieza moderada de la máscara y sustituye parte del color contaminado de píxeles semitransparentes por el color cercano del sujeto; el control «Bordes» permite graduar o desactivar ese efecto. Queda pendiente evaluar memoria, tiempo y calidad en móviles y otros navegadores con una colección más amplia; el modelo de 320 × 320 puede perder detalles finos que requieran el pincel.

## Casos de aceptación

- Una foto de dos personas produce un PNG con ambas y fondo transparente; se pueden recuperar con pincel zonas quitadas por error.
- Una foto de producto con sombra en una mesa deja el producto y quita mesa y sombra; se puede ajustar el contorno con zoom.
- Si se empieza con el pincel y luego se ejecuta el automático, las pinceladas siguen aplicadas al resultado.
- Si se cancela o falla el automático, se puede seguir editando y descargar lo que ya se había trabajado.
- Antes de reemplazar una imagen editada sin descargar, la herramienta pide confirmación.
