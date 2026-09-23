// Prueba local: se ejecuta solo cuando la persona abre este comando.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function available(command, versionArg) {
  const result = spawnSync(command, [versionArg], { windowsHide: true, stdio: 'ignore' })
  return !result.error && result.status === 0
}

function findYtDlp() {
  if (process.env.YT_DLP_PATH) return process.env.YT_DLP_PATH
  if (available('yt-dlp', '--version')) return 'yt-dlp'
  const root = process.env.APPDATA && join(process.env.APPDATA, 'Python')
  if (!root || !existsSync(root)) return null
  const versions = readdirSync(root).filter((name) => /^Python\d+$/.test(name)).sort().reverse()
  for (const version of versions) {
    const candidate = join(root, version, 'Scripts', 'yt-dlp.exe')
    if (existsSync(candidate)) return candidate
  }
  return null
}

const ytDlp = findYtDlp()
if (!ytDlp || !available(ytDlp, '--version')) {
  console.error('No encuentro yt-dlp. Instalalo o indica su ruta con YT_DLP_PATH.')
  process.exit(1)
}
if (!available(process.env.FFMPEG_PATH || 'ffmpeg', '-version')) {
  console.error('No encuentro FFmpeg. Agregalo a PATH o indica su ruta con FFMPEG_PATH.')
  process.exit(1)
}

process.env.YT_DLP_PATH = ytDlp
process.env.DOWNLOADER_LOCAL_HELPER = '1'
process.env.DOWNLOADER_HOST = '127.0.0.1'
process.env.DOWNLOADER_PORT = '8788'

console.log('Ayudante local para YouTube. Cerrar esta terminal lo detiene.')
console.log('También se cierra solo tras 30 minutos sin uso.')
await import('./downloader.mjs')
