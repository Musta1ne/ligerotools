import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parseVideoURL,
  qualityOptions,
  safeFilename,
  videoOptions,
} from './server/downloader-core.mjs'

test('accepts supported HTTPS video hosts and rejects unsafe destinations', () => {
  assert.equal(parseVideoURL('https://youtu.be/abc#start'), 'https://youtu.be/abc')
  assert.equal(
    parseVideoURL('https://www.tiktok.com/@someone/video/123'),
    'https://www.tiktok.com/@someone/video/123',
  )
  for (const url of [
    'http://youtube.com/watch?v=abc',
    'https://youtube.com.evil.test/watch?v=abc',
    'https://localhost/video',
    'https://127.0.0.1/video',
    'https://user:pass@youtube.com/watch?v=abc',
    'https://youtube.com:8443/watch?v=abc',
    'javascript:alert(1)',
  ])
    assert.throws(() => parseVideoURL(url))
})

test('offers only actual video resolutions and picks the best format per size', () => {
  const options = videoOptions({
    formats: [
      { format_id: 'audio', acodec: 'aac', vcodec: 'none', height: 1080 },
      {
        format_id: 'small',
        vcodec: 'h264',
        acodec: 'aac',
        width: 1280,
        height: 720,
        ext: 'mp4',
        tbr: 500,
      },
      {
        format_id: 'better',
        vcodec: 'h264',
        acodec: 'aac',
        width: 1280,
        height: 720,
        ext: 'mp4',
        tbr: 900,
      },
      {
        format_id: 'vertical',
        vcodec: 'h264',
        acodec: 'none',
        width: 1080,
        height: 1920,
        ext: 'mp4',
        tbr: 2000,
      },
      { format_id: 'tiny', vcodec: 'h264', acodec: 'aac', width: 320, height: 240, ext: 'mp4' },
    ],
  })
  assert.deepEqual(options, [
    { height: 1080, formatId: 'vertical', hasAudio: false, portrait: true },
    { height: 720, formatId: 'better', hasAudio: true, portrait: false },
    { height: 240, formatId: 'tiny', hasAudio: true, portrait: false },
  ])
})

test('creates lower choices from a single available 1080p source', () => {
  const options = qualityOptions({
    formats: [
      { format_id: 'full', vcodec: 'h264', acodec: 'aac', width: 1920, height: 1080, ext: 'mp4' },
    ],
  })
  assert.deepEqual(
    options.map(({ height }) => height),
    [1080, 720, 480, 360, 240],
  )
  assert.equal(options[0].transcode, false)
  assert.ok(options.slice(1).every((option) => option.transcode && option.formatId === 'full'))
})

test('download filename cannot inject headers or path separators', () => {
  assert.equal(safeFilename('Canción\r\n../parte', 'mp3'), 'Cancion..parte.mp3')
})
