import { Download, FileVideo, Scissors } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export interface ToolMetadata {
  id: string
  path: `/${string}`
  name: string
  brandSuffix: string
  description: string
  category: string
  icon: LucideIcon
}

export const tools = [
  {
    id: 'video-compressor',
    path: '/compressor',
    name: 'Compresor de video',
    brandSuffix: 'Compressor',
    description:
      'Reduce el peso de un video con un presupuesto en MB y descarga el resultado en MP4. Procesamiento en tu navegador.',
    category: 'Video',
    icon: FileVideo,
  },
  {
    id: 'video-downloader',
    path: '/downloader',
    name: 'Descargador de videos',
    brandSuffix: 'Downloader',
    description:
      'Descarga videos públicos de YouTube, X, Instagram y TikTok en la calidad disponible que elijas, o extrae su audio en MP3.',
    category: 'Video y audio',
    icon: Download,
  },
  {
    id: 'video-trimmer',
    path: '/trimmer',
    name: 'Recortador de video',
    brandSuffix: 'Trimmer',
    description:
      'Elige el inicio y el fin de un video y descarga el recorte en MP4. Procesamiento en tu navegador.',
    category: 'Video',
    icon: Scissors,
  },
] as const satisfies readonly ToolMetadata[]

export type ToolId = (typeof tools)[number]['id']

export function findTool(pathname: string) {
  return tools.find((tool) => tool.path === pathname.replace(/\/+$/, ''))
}
