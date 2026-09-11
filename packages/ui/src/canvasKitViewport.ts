import type { SceneRect } from './canvasKitScene'

export interface PaperViewportPlan {
  /** Coordinates relative to the paper's unscaled CSS box. */
  rect: SceneRect
  ratio: number
  scaleX: number
  scaleY: number
  backingWidth: number
  backingHeight: number
  paperWidth: number
  paperHeight: number
  deviceRatio: number
}

export function containsPaperRect(outer: SceneRect, inner: SceneRect, tolerance = 0.5) {
  return inner.x >= outer.x - tolerance && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance
}

/** Retain pixels around the viewport; small scrolls only move the existing canvas. */
export function planPaperViewport(visible: SceneRect, width: number, height: number,
  scaleX: number, scaleY: number, deviceRatio: number, previous?: PaperViewportPlan | null, pinchPreview = false): PaperViewportPlan {
  const ratio = Math.min(2, Math.max(1, deviceRatio))
  if (previous && previous.deviceRatio === deviceRatio && previous.paperWidth === width && previous.paperHeight === height
    && (pinchPreview || (previous.scaleX === scaleX && previous.scaleY === scaleY))
    && containsPaperRect(previous.rect, visible)) return previous
  const marginX = Math.min(384 / scaleX, visible.width * 0.5)
  const marginY = Math.min(512 / scaleY, visible.height * 0.75)
  const boundedRatio = Math.min(ratio, Math.sqrt(6_000_000 / Math.max(1, visible.width * scaleX * visible.height * scaleY)))
  const size = (margin: number) => ({
    width: Math.min(width + 8 / scaleX, visible.width + marginX * 2 * margin),
    height: Math.min(height + 8 / scaleY, visible.height + marginY * 2 * margin),
  })
  // Spend spare pixels on overscan without reducing the visible area's resolution.
  let low = 0, high = 1
  for (let step = 0; step < 16; step++) {
    const mid = (low + high) / 2, candidate = size(mid)
    if (candidate.width * scaleX * candidate.height * scaleY * boundedRatio ** 2 <= 6_000_000) low = mid
    else high = mid
  }
  const { width: tileWidth, height: tileHeight } = size(low)
  const x = Math.max(-4 / scaleX, Math.min(width + 4 / scaleX - tileWidth, visible.x - (tileWidth - visible.width) / 2))
  const y = Math.max(-4 / scaleY, Math.min(height + 4 / scaleY - tileHeight, visible.y - (tileHeight - visible.height) / 2))
  return { rect: { x, y, width: tileWidth, height: tileHeight }, ratio: boundedRatio, scaleX, scaleY,
    paperWidth: width, paperHeight: height, deviceRatio,
    backingWidth: Math.max(1, Math.floor(tileWidth * scaleX * boundedRatio)),
    backingHeight: Math.max(1, Math.floor(tileHeight * scaleY * boundedRatio)) }
}
