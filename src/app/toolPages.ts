import { lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import type { ToolId } from '../catalog/tools'

export const toolPages: Record<ToolId, LazyExoticComponent<ComponentType>> = {
  'video-compressor': lazy(() => import('../tools/compressor/CompressorPage')),
  'video-downloader': lazy(() => import('../tools/downloader/DownloaderPage')),
}
