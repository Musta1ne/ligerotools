import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium } from 'playwright-core'

const chrome = process.env.CHROME_PATH || (process.platform === 'win32'
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : '/usr/bin/google-chrome')

const server = await createServer({ server: { host: '127.0.0.1', port: 0 } })
let browser
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: chrome, headless: true })
  const page = await browser.newPage()
  await page.goto(`${server.resolvedUrls.local[0]}quitar-fondo`)
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 800
    canvas.height = 450
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ddd'
    ctx.fillRect(0, 0, 800, 450)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'zoom.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })
  const canvas = page.locator('.background-canvas')
  await page.waitForFunction(() => document.querySelector('.background-canvas')?.width === 800)
  const borderNumber = page.getByRole('spinbutton', { name: 'Bordes en porcentaje' })
  assert.ok(await borderNumber.isDisabled(), 'edge cleanup must be visible but disabled before automatic removal')
  await page.evaluate(() => {
    window.Worker = class {
      postMessage() { setTimeout(() => this.onmessage?.({ data: { type: 'result', mask: new Uint8Array(320 * 320).fill(255) } }), 0) }
      terminate() {}
    }
  })
  await page.getByRole('button', { name: 'Quitar fondo' }).click()
  await borderNumber.waitFor({ state: 'visible' })
  await page.waitForFunction(() => !document.querySelector('input[aria-label="Bordes en porcentaje"]')?.disabled)
  await borderNumber.fill('64')
  assert.equal(await page.getByRole('slider', { name: 'Bordes' }).inputValue(), '64')
  await borderNumber.press('ArrowUp')
  assert.equal(await page.getByRole('slider', { name: 'Bordes' }).inputValue(), '65')
  const initialBox = await canvas.boundingBox()
  const initialWidth = initialBox.width
  await page.mouse.move(initialBox.x + 200, initialBox.y + 100)
  const cursor = page.locator('.background-brush-cursor')
  const outline = page.locator('.background-brush-outline')
  assert.ok(await cursor.isVisible(), 'brush preview must appear before painting')
  const initialDiameter = (await outline.boundingBox()).width
  assert.ok(Math.abs(initialDiameter - 44) <= 2, `44px brush preview measured ${initialDiameter}px`)
  const lightOutline = await outline.evaluate((node) => ({ border: getComputedStyle(node).borderTopColor, fill: getComputedStyle(node).backgroundColor }))
  assert.equal(lightOutline.border, 'rgb(17, 17, 17)')
  assert.equal(lightOutline.fill, 'rgba(0, 0, 0, 0)')
  const gridToggle = page.getByRole('button', { name: 'Cuadrícula oscura' })
  await gridToggle.click()
  assert.equal(await gridToggle.getAttribute('aria-pressed'), 'true')
  assert.ok(await page.locator('.background-stage').evaluate((node) => node.classList.contains('is-dark-grid')))
  await page.mouse.move(initialBox.x + 200, initialBox.y + 100)
  assert.equal(await outline.evaluate((node) => getComputedStyle(node).borderTopColor), 'rgb(255, 255, 255)')
  const sizeNumber = page.getByRole('spinbutton', { name: 'Tamaño en píxeles' })
  const softnessNumber = page.getByRole('spinbutton', { name: 'Suavidad en porcentaje' })
  assert.equal(await sizeNumber.inputValue(), '44')
  await sizeNumber.fill('17')
  assert.equal(await page.getByRole('slider', { name: 'Tamaño' }).inputValue(), '17')
  await sizeNumber.press('ArrowUp')
  assert.equal(await page.getByRole('slider', { name: 'Tamaño' }).inputValue(), '18')
  await softnessNumber.fill('72')
  assert.equal(await page.getByRole('slider', { name: 'Suavidad' }).inputValue(), '72')
  await softnessNumber.fill('999')
  await softnessNumber.press('Enter')
  assert.equal(await softnessNumber.inputValue(), '100')
  assert.equal(await page.getByRole('slider', { name: 'Suavidad' }).inputValue(), '100')
  await page.getByRole('slider', { name: 'Tamaño' }).fill('80')
  assert.equal(await sizeNumber.inputValue(), '80')
  await page.mouse.move(initialBox.x + 200, initialBox.y + 100)
  const largerDiameter = (await outline.boundingBox()).width
  assert.ok(Math.abs(largerDiameter - 80) <= 2, `80px brush preview measured ${largerDiameter}px`)
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Acercar' }).click()
  const zoomedWidth = (await canvas.boundingBox()).width
  const label = await page.locator('.background-zoom span').textContent()
  assert.equal(await page.locator('.background-stage .background-zoom').count(), 0, 'zoom controls must stay outside the image area')
  assert.equal(label, '200%')
  assert.ok(zoomedWidth >= initialWidth * 1.9, `200% displayed as ${zoomedWidth}px from ${initialWidth}px`)
  const viewport = page.locator('.background-viewport')
  await viewport.scrollIntoViewIfNeeded()
  const viewportBox = await viewport.boundingBox()
  const visibleX = viewportBox.x + 200
  const visibleY = viewportBox.y + 100
  await page.mouse.move(visibleX, visibleY)
  const zoomedDiameter = (await outline.boundingBox()).width
  assert.ok(Math.abs(zoomedDiameter - 160) <= 2, `200% zoom should display 80px brush as 160px, got ${zoomedDiameter}px`)
  await page.getByRole('button', { name: 'Recuperar' }).click()
  await viewport.scrollIntoViewIfNeeded()
  const restoreBox = await viewport.boundingBox()
  await page.mouse.move(restoreBox.x + 200, restoreBox.y + 100)
  const restoredPreview = await cursor.evaluateAll((nodes) => nodes.map((node) => node.className))
  assert.ok(restoredPreview.some((name) => name.includes('mode-restore')), 'preview must reflect restore mode')
  const overflow = await viewport.evaluate((node) => node.scrollWidth > node.clientWidth)
  assert.ok(overflow, 'zoomed canvas must be scrollable')
  await page.getByRole('button', { name: 'Mover' }).click()
  assert.equal(await cursor.count(), 0, 'pan mode must hide the brush preview')
  await viewport.scrollIntoViewIfNeeded()
  const panBox = await viewport.boundingBox()
  await page.mouse.move(panBox.x + 450, panBox.y + 200)
  await page.mouse.down()
  await page.mouse.move(panBox.x + 250, panBox.y + 200, { steps: 4 })
  await page.mouse.up()
  assert.ok(await viewport.evaluate((node) => node.scrollLeft > 0), 'pan must scroll the zoomed image')
  await page.getByRole('button', { name: 'Borrar' }).click()
  const beforeRightPan = await viewport.evaluate((node) => node.scrollLeft)
  await page.mouse.move(panBox.x + 450, panBox.y + 200)
  await page.mouse.down({ button: 'right' })
  assert.equal(await cursor.count(), 0, 'right-button pan must hide the brush preview')
  await page.mouse.move(panBox.x + 300, panBox.y + 200, { steps: 4 })
  await page.mouse.up({ button: 'right' })
  assert.ok(await viewport.evaluate((node) => node.scrollLeft) > beforeRightPan, 'right-button pan must scroll while the brush tool is selected')
  assert.equal(await canvas.evaluate((node) => node.getContext('2d').getImageData(100, 100, 1, 1).data[3]), 255, 'right-button pan must not erase pixels')
  const brush = page.getByRole('slider', { name: 'Tamaño' })
  assert.equal(await brush.getAttribute('min'), '1')
  await brush.fill('1')
  assert.equal(await brush.inputValue(), '1')
  for (let i = 0; i < 24; i++) await page.getByRole('button', { name: 'Acercar' }).click()
  assert.equal(await page.locator('.background-zoom span').textContent(), '800%')
  assert.ok(await page.getByRole('button', { name: 'Acercar' }).isDisabled(), 'zoom must stop at 800%')
  const maximumWidth = (await canvas.boundingBox()).width
  assert.ok(maximumWidth >= initialWidth * 7.9, `800% displayed as ${maximumWidth}px from ${initialWidth}px`)
  await viewport.scrollIntoViewIfNeeded()
  const maximumBox = await viewport.boundingBox()
  await page.mouse.move(maximumBox.x + 200, maximumBox.y + 100)
  const maximumBrushDiameter = (await outline.boundingBox()).width
  assert.ok(Math.abs(maximumBrushDiameter - 8) <= 2, `1px brush at 800% measured ${maximumBrushDiameter}px`)
  for (let i = 0; i < 28; i++) await page.getByRole('button', { name: 'Alejar' }).click()
  assert.equal(await page.locator('.background-zoom span').textContent(), '100%')
  const box = await canvas.boundingBox()
  await page.mouse.click(box.x + 100.5, box.y + 100.5)
  const changed = await canvas.evaluate((node) => {
    const pixels = node.getContext('2d').getImageData(97, 97, 7, 7).data
    let count = 0
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] < 255) count++
    return count
  })
  assert.ok(changed >= 1 && changed <= 4, `1px brush changed ${changed} pixels`)
  const brushPixels = () => canvas.evaluate((node) => Array.from(node.getContext('2d').getImageData(97, 97, 7, 7).data))
  const beforeReset = await brushPixels()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Restablecer pinceladas' }).click()
  assert.deepEqual(await brushPixels(), beforeReset, 'dismissing reset confirmation must keep the brush edits')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Restablecer pinceladas' }).click()
  assert.ok((await brushPixels()).filter((_, index) => index % 4 === 3).every((alpha) => alpha === 255), 'confirming reset must clear brush edits')
  await page.getByRole('button', { name: 'Pantalla completa' }).click()
  assert.ok(await page.evaluate(() => document.fullscreenElement?.classList.contains('background-workspace')), 'fullscreen must contain the editor and toolbar')
  assert.ok(await page.getByRole('button', { name: 'Borrar' }).isVisible(), 'brush controls must remain visible in fullscreen')
  await page.getByRole('button', { name: 'Salir de pantalla completa' }).click()
  assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'fullscreen exit button must restore the page')
  const previewMismatch = await page.evaluate(async () => {
    const { BackgroundEditor, MODEL_SIDE } = await import('/src/tools/background/editor.ts')
    const source = document.createElement('canvas')
    source.width = 800
    source.height = 500
    const sourceContext = source.getContext('2d')
    sourceContext.fillStyle = '#dcdcdc'
    sourceContext.fillRect(0, 0, source.width, source.height)
    const image = new Image()
    image.src = source.toDataURL()
    await image.decode()
    const preview = document.createElement('canvas')
    const testEditor = new BackgroundEditor(image, preview)
    const mask = new Uint8Array(MODEL_SIDE * MODEL_SIDE)
    for (let y = 0; y < MODEL_SIDE; y++) for (let x = 0; x < MODEL_SIDE; x++) mask[y * MODEL_SIDE + x] = x < MODEL_SIDE / 2 ? 255 : 0
    testEditor.setMask(mask)
    testEditor.begin('erase', 44, 0.35, { x: 0.42, y: 0.3 })
    testEditor.move({ x: 0.55, y: 0.7 })
    testEditor.end()
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const incremental = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data.slice()
    testEditor.render()
    const full = preview.getContext('2d').getImageData(0, 0, preview.width, preview.height).data
    testEditor.dispose()
    let mismatches = 0
    for (let i = 0; i < full.length; i++) if (incremental[i] !== full[i]) mismatches++
    return mismatches
  })
  assert.equal(previewMismatch, 0, 'incremental brush preview must match a full render with an automatic mask')
  await page.setViewportSize({ width: 1100, height: 900 })
  const controls = page.locator('.background-controls')
  const controlRows = await Promise.all(['.background-tool-group', '.background-grid-toggle', '.background-brush-setting'].map(async (selector) => {
    const boxes = await controls.locator(selector).evaluateAll((nodes) => nodes.map((node) => { const box = node.getBoundingClientRect(); return box.top + box.height / 2 }))
    return boxes
  }))
  assert.ok(controlRows.flat().every((center) => Math.abs(center - controlRows[0][0]) < 5), 'all brush controls must stay in one row at 1100px')
  const controlWidths = await controls.evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }))
  assert.ok(controlWidths.scroll <= controlWidths.client + 1, `brush controls must fit without horizontal scrolling at 1100px: ${JSON.stringify(controlWidths)}`)
  console.log('Background numeric brush controls, preview, 800% zoom, pan, and 1px brush passed')
} finally {
  await browser?.close()
  await server.close()
}
