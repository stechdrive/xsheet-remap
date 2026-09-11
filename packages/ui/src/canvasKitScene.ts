/** Serializable drawing boundary. Geometry is independent of DOM interaction ownership. */
export type SceneMatrix = [number, number, number, number, number, number]
export type SceneRect = { x: number; y: number; width: number; height: number }
export type SceneFilter = { matrix?: number[]; red?: number[]; green?: number[]; blue?: number[] }
export type ScenePaint = {
  fill: string; stroke: string; fillOpacity: number; strokeOpacity: number
  strokeWidth: number; dash: number[]; dashOffset: number
  cap: string; join: string; miter: number; nonScaling: boolean; evenOdd: boolean
  order?: string
}
export type SceneShape =
  | { kind: 'path'; d: string }
  | { kind: 'rect'; rect: SceneRect; rx: number; ry: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'polygon'; points: number[]; close: boolean }
export type SceneText = {
  value: string; x: number; y: number; size: number; weight: number
  italic: boolean; anchor: string; baseline: string; letterSpacing: number
  family?: string
}
export type SceneNode = {
  matrix: SceneMatrix; opacity: number; blend: string
  clips: { shape: SceneShape; matrix: SceneMatrix }[]
  paint: ScenePaint
  shape?: SceneShape; text?: SceneText
  image?: { url: string; rect: SceneRect; filters: SceneFilter[]; pixelated: boolean }
  children: SceneNode[]
}
export type CanvasKitScene = { width: number; height: number; nodes: SceneNode[] }

export const identitySceneMatrix: SceneMatrix = [1, 0, 0, 1, 0, 0]
export function skiaMatrix([a, b, c, d, e, f]: SceneMatrix): number[] {
  return [a, c, e, b, d, f, 0, 0, 1]
}
export function intersectSceneRects(a: SceneRect, b: SceneRect): SceneRect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null
}
export function scenePixelRatio(width: number, height: number, deviceRatio: number): number {
  return Math.min(2, Math.max(1, deviceRatio), Math.sqrt(6_000_000 / Math.max(1, width * height)))
}
export function sceneTextRequests(scene: CanvasKitScene): SceneText[] {
  const result: SceneText[] = []
  const visit = (node: SceneNode) => {
    if (node.text) result.push(node.text)
    node.children.forEach(visit)
  }
  scene.nodes.forEach(visit)
  return result
}
export function sceneImageKey(image: NonNullable<SceneNode['image']>): string {
  return JSON.stringify([image.url, image.filters])
}

const parsedFontRanges = new Map<string, [number, number][]>()
export function fontRangeIncludes(range: string, code: number): boolean {
  let intervals = parsedFontRanges.get(range)
  if (!intervals) {
    intervals = range.split(',').map(part => {
      const [low, high = low] = part.trim().replace(/^U\+/i, '').split('-')
      return [parseInt(low.replaceAll('?', '0'), 16), parseInt(high.replaceAll('?', 'f'), 16)]
    })
    parsedFontRanges.set(range, intervals)
  }
  return intervals.some(([low, high]) => code >= low && code <= high)
}

/** SVG component-transfer tables interpolate between samples in sRGB. */
export function applySceneFilters(data: Uint8ClampedArray, filters: SceneFilter[]): void {
  const channel = (value: number, table: number[] | undefined) => {
    if (!table?.length) return value
    const at = Math.max(0, Math.min(1, value)) * (table.length - 1)
    const index = Math.floor(at)
    return table[index] + ((table[index + 1] ?? table[index]) - table[index]) * (at - index)
  }
  if (filters.every(filter => !filter.matrix)) {
    // Reference tints/levels are separable. Compose 256 entries once, not per paper pixel.
    const tables = ['red', 'green', 'blue'].map(key => Uint8ClampedArray.from({ length: 256 }, (_, value) => {
      let mapped = value / 255
      for (const filter of filters) mapped = channel(mapped, filter[key as 'red' | 'green' | 'blue'])
      return Math.round(Math.max(0, Math.min(1, mapped)) * 255)
    }))
    for (let i = 0; i < data.length; i += 4) {
      data[i] = tables[0][data[i]]; data[i + 1] = tables[1][data[i + 1]]; data[i + 2] = tables[2][data[i + 2]]
    }
    return
  }
  for (let i = 0; i < data.length; i += 4) {
    let values = [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, data[i + 3] / 255]
    for (const filter of filters) {
      if (filter.matrix?.length === 20) {
        const matrix = filter.matrix
        values = [0, 1, 2, 3].map(row => Math.max(0, Math.min(1,
          values.reduce((sum, v, col) => sum + v * matrix[row * 5 + col], matrix[row * 5 + 4]),
        )))
      }
      values = [channel(values[0], filter.red), channel(values[1], filter.green), channel(values[2], filter.blue), values[3]]
    }
    for (let c = 0; c < 4; c++) data[i + c] = Math.round(Math.max(0, Math.min(1, values[c])) * 255)
  }
}
