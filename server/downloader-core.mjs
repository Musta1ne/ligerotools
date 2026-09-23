const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  'instagram.com',
  'www.instagram.com',
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com',
])

export function parseVideoURL(input) {
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Pega un enlace válido.')
  let url
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error('Pega un enlace válido.')
  }
  if (
    url.protocol !== 'https:' ||
    !HOSTS.has(url.hostname.toLowerCase()) ||
    url.port ||
    url.username ||
    url.password
  ) {
    throw new Error('Usa un enlace HTTPS de YouTube, X, Instagram o TikTok.')
  }
  url.hash = ''
  return url.toString()
}

export function videoOptions(info) {
  const formats = Array.isArray(info.formats) ? info.formats : []
  const byHeight = new Map()
  for (const format of formats) {
    if (
      typeof format.format_id !== 'string' ||
      !format.format_id ||
      !format.vcodec ||
      format.vcodec === 'none'
    )
      continue
    const width = Number(format.width)
    const height = Number(format.height)
    const resolution = Math.round(width > 0 && height > 0 ? Math.min(width, height) : height)
    if (!Number.isInteger(resolution) || resolution < 144 || resolution > 4320) continue
    const score =
      (format.ext === 'mp4' ? 1_000_000 : 0) +
      (format.acodec && format.acodec !== 'none' ? 100_000 : 0) +
      (Number(format.tbr) || 0)
    const previous = byHeight.get(resolution)
    if (!previous || score > previous.score) {
      byHeight.set(resolution, {
        height: resolution,
        formatId: format.format_id,
        hasAudio: Boolean(format.acodec && format.acodec !== 'none'),
        portrait: height > width,
        score,
      })
    }
  }
  return [...byHeight.values()]
    .sort((a, b) => b.height - a.height)
    .map(({ height, formatId, hasAudio, portrait }) => ({ height, formatId, hasAudio, portrait }))
}

export function qualityOptions(info) {
  const available = videoOptions(info)
  if (!available.length) return []
  const standards = [2160, 1440, 1080, 720, 480, 360, 240]
  const heights = [
    ...new Set([
      ...available.map((option) => option.height),
      ...standards.filter((height) => height < available[0].height),
    ]),
  ].sort((a, b) => b - a)
  return heights.map((height) => {
    const exact = available.find((option) => option.height === height)
    if (exact) return { ...exact, transcode: false }
    const source = [...available].reverse().find((option) => option.height > height)
    return { ...source, height, transcode: true }
  })
}

export function safeFilename(title, extension) {
  const base =
    String(title || 'video')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._ -]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim()
      .slice(0, 90) || 'video'
  return `${base}.${extension}`
}
