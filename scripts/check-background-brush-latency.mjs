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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(`${server.resolvedUrls.local[0]}quitar-fondo`)
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 3000
    canvas.height = 4000
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ddd'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/png').split(',')[1]
  })
  await page.locator('input[type=file]').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') })
  await page.waitForFunction(() => document.querySelector('.background-canvas')?.width === 1200)
  await page.locator('.background-viewport').scrollIntoViewIfNeeded()
  const box = await page.locator('.background-canvas').boundingBox()
  await page.mouse.move(box.x + 100, box.y + 150)
  await page.mouse.down()
  await page.evaluate(() => {
    window.brushFrameGaps = []
    window.trackBrushFrames = true
    let previous = 0
    function sample(now) {
      if (!window.trackBrushFrames) return
      if (previous) window.brushFrameGaps.push(now - previous)
      previous = now
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.mouse.move(box.x + 550, box.y + 450, { steps: 80 })
  const gaps = await page.evaluate(() => {
    window.trackBrushFrames = false
    return window.brushFrameGaps.sort((a, b) => a - b)
  })
  await page.mouse.up()
  const p95 = gaps[Math.floor(gaps.length * 0.95)]
  console.log(`brush frames: ${gaps.length}; p95=${p95?.toFixed(1)}ms; max=${gaps.at(-1)?.toFixed(1)}ms`)
  assert.ok(p95 < 16.7, `brush interaction should keep 95% of frames under 16.7ms; p95 was ${p95.toFixed(1)}ms`)
} finally {
  await browser?.close()
  await server.close()
}
