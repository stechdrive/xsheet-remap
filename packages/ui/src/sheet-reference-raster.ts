import type { NormalizedRect, SheetTemplate } from '@xsheet-remap/core'
import { loadImage, resolveImageRefUrl } from './sheetImages'

export type SheetRaster = { image: HTMLImageElement; rect: NormalizedRect }
export const fullSheetRect: NormalizedRect = { x: 0, y: 0, w: 1, h: 1 }

export function resolveTemplateUnderlayDrawRect(
  template: Pick<SheetTemplate, 'page' | 'defaultUnderlay'>,
  width: number,
  height: number,
) {
  const placement = template.defaultUnderlay?.placement
  if (!placement) return null
  const sx = width / template.page.widthPx
  const sy = height / template.page.heightPx
  return {
    x: placement.offsetXPx * sx,
    y: placement.offsetYPx * sy,
    width: placement.renderedWidthPx * sx,
    height: placement.renderedHeightPx * sy,
  }
}

export function templateOverlayImageUrl(template: SheetTemplate): string | null {
  const underlay = template.defaultUnderlay
  return underlay
    ? resolveImageRefUrl({ ...underlay.imageRef, assetPath: underlay.assetPath || underlay.imageRef.assetPath })
    : null
}

// Share only the most recently requested sheet. Geometry and image revision can change under the same template ID.
let cached: { url: string; revision: string; value: Promise<SheetRaster | null> } | undefined

export function templateReferenceRaster(template: SheetTemplate): Promise<SheetRaster | null> {
  const url = templateOverlayImageUrl(template)
  if (!url) return Promise.resolve(null)
  const placement = resolveTemplateUnderlayDrawRect(template, 1, 1)
  const rect = placement ? { x: placement.x, y: placement.y, w: placement.width, h: placement.height } : fullSheetRect
  if (![rect.x, rect.y, rect.w, rect.h].every(Number.isFinite) || rect.w <= 0 || rect.h <= 0)
    return Promise.resolve(null)
  const ref = template.defaultUnderlay!.imageRef
  const revision = [ref.contentHash, ref.lastModified, ref.size, rect.x, rect.y, rect.w, rect.h].join('|')
  if (cached?.url === url && cached.revision === revision) return cached.value
  const value = loadImage(url)
    .then(image => ({ image, rect }))
    .catch(() => {
      if (cached?.value === value) cached = undefined
      return null
    })
  cached = { url, revision, value }
  return value
}

export function paintSheetRaster(raster: SheetRaster, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas 2D unavailable')
  context.fillStyle = 'white'
  context.fillRect(0, 0, width, height)
  const { x, y, w, h } = raster.rect
  context.drawImage(raster.image, x * width, y * height, w * width, h * height)
  return context.getImageData(0, 0, width, height)
}

export function sheetAnalysisSize(template: SheetTemplate, maxShortSide: number, maxLongSide: number) {
  const { widthPx, heightPx } = template.page
  const scale = Math.min(1, maxShortSide / Math.min(widthPx, heightPx), maxLongSide / Math.max(widthPx, heightPx))
  return { width: Math.max(1, Math.round(widthPx * scale)), height: Math.max(1, Math.round(heightPx * scale)) }
}
