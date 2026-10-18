// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
/** Only canvases allocated inside this synchronous render may be released. */
let allocations: Set<OffscreenCanvas> | undefined

export function createRenderCanvas(width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  allocations?.add(canvas)
  return canvas
}

export function releaseCanvas(canvas: OffscreenCanvas): void {
  canvas.width = 1; canvas.height = 1
}

export function withCanvasResources<T>(render: () => T,
  retain: (result: T, owned: ReadonlySet<OffscreenCanvas>) => Iterable<OffscreenCanvas>): T {
  const parent = allocations, owned = new Set<OffscreenCanvas>()
  allocations = owned
  let kept = new Set<OffscreenCanvas>()
  try {
    const result = render()
    kept = new Set(retain(result, owned))
    return result
  } finally {
    allocations = parent
    for (const canvas of owned) {
      if (kept.has(canvas)) parent?.add(canvas)
      else releaseCanvas(canvas)
    }
  }
}

export interface PixelBounds { left: number; top: number; width: number; height: number }
const bounds = new WeakMap<OffscreenCanvas, PixelBounds>()
export function setCanvasBounds(canvas: OffscreenCanvas, value: PixelBounds): void { bounds.set(canvas, value) }

/** Conservative integer bounds, including interpolation at fractional positions. */
export function canvasBounds(canvas: OffscreenCanvas, left: number, top: number, width: number, height: number, padding = 0): PixelBounds {
  const area = bounds.get(canvas) ?? { left: 0, top: 0, width: canvas.width, height: canvas.height }
  if (!area.width || !area.height) return { left: 0, top: 0, width: 0, height: 0 }
  const x0 = Math.max(0, Math.floor(left + area.left) - padding)
  const y0 = Math.max(0, Math.floor(top + area.top) - padding)
  const x1 = Math.min(width, Math.ceil(left + area.left + area.width) + padding)
  const y1 = Math.min(height, Math.ceil(top + area.top + area.height) + padding)
  return { left: x0, top: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) }
}

export function unionBounds(areas: PixelBounds[]): PixelBounds {
  const nonempty = areas.filter(a => a.width && a.height)
  if (!nonempty.length) return { left: 0, top: 0, width: 0, height: 0 }
  const left = Math.min(...nonempty.map(a => a.left)), top = Math.min(...nonempty.map(a => a.top))
  return { left, top, width: Math.max(...nonempty.map(a => a.left + a.width)) - left,
    height: Math.max(...nonempty.map(a => a.top + a.height)) - top }
}
