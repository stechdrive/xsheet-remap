import {
  type CanvasKitScene, type SceneFilter, type SceneMatrix, type SceneNode,
  type ScenePaint, type SceneShape, identitySceneMatrix,
} from './canvasKitScene'

const numbers = (value: string | null) => (value?.trim().split(/[\s,]+/).filter(Boolean).map(Number) ?? [])
const attribute = (node: Element, name: string, fallback = 0) => {
  const value = node.getAttribute(name)
  return value === null ? fallback : Number.parseFloat(value) || 0
}

export function svgSceneShape(element: Element): SceneShape | undefined {
  switch (element.localName) {
    case 'path': return { kind: 'path', d: element.getAttribute('d') ?? '' }
    case 'rect': return {
      kind: 'rect', rect: { x: attribute(element, 'x'), y: attribute(element, 'y'), width: attribute(element, 'width'), height: attribute(element, 'height') },
      rx: attribute(element, 'rx', attribute(element, 'ry')), ry: attribute(element, 'ry', attribute(element, 'rx')),
    }
    case 'circle': case 'ellipse': return {
      kind: 'ellipse', cx: attribute(element, 'cx'), cy: attribute(element, 'cy'),
      rx: attribute(element, 'rx', attribute(element, 'r')), ry: attribute(element, 'ry', attribute(element, 'r')),
    }
    case 'line': return { kind: 'polygon', points: [attribute(element, 'x1'), attribute(element, 'y1'), attribute(element, 'x2'), attribute(element, 'y2')], close: false }
    case 'polygon': case 'polyline': return { kind: 'polygon', points: numbers(element.getAttribute('points')), close: element.localName === 'polygon' }
    default: return undefined
  }
}

export function captureSvgScene(root: SVGSVGElement): CanvasKitScene {
  const bounds = root.getBoundingClientRect()
  const width = root.clientWidth || bounds.width, height = root.clientHeight || bounds.height
  const rootScaleX = bounds.width / Math.max(1, width), rootScaleY = bounds.height / Math.max(1, height)
  const toScene = (element: SVGGraphicsElement): SceneMatrix => {
    const matrix = element.getScreenCTM()
    return matrix ? [matrix.a / rootScaleX, matrix.b / rootScaleY, matrix.c / rootScaleX,
      matrix.d / rootScaleY, (matrix.e - bounds.left) / rootScaleX, (matrix.f - bounds.top) / rootScaleY] : identitySceneMatrix
  }
  const definition = (url: string) => {
    const id = url.match(/#([^)'"\s]+)/)?.[1]
    return id ? root.querySelector(`[id="${CSS.escape(id)}"]`) : null
  }
  const filtersFor = (url: string): SceneFilter[] => {
    const filter = definition(url)
    return filter ? Array.from(filter.children).map(child => {
      if (child.localName === 'feColorMatrix') return { matrix: numbers(child.getAttribute('values')) }
      if (child.localName === 'feComponentTransfer') return {
        red: numbers(child.querySelector('feFuncR')?.getAttribute('tableValues') ?? null),
        green: numbers(child.querySelector('feFuncG')?.getAttribute('tableValues') ?? null),
        blue: numbers(child.querySelector('feFuncB')?.getAttribute('tableValues') ?? null),
      }
      throw new Error(`Unsupported paper image filter: ${child.localName}`)
    }) : []
  }
  const capture = (element: SVGElement, inheritedFilters: SceneFilter[]): SceneNode | null => {
    if (['defs', 'title', 'desc', 'clipPath', 'filter'].includes(element.localName)) return null
    if (!(element instanceof SVGGraphicsElement)) throw new Error(`Unsupported paper element: ${element.localName}`)
    const style = getComputedStyle(element)
    if (style.display === 'none' || style.visibility === 'hidden') return null
    const opacity = element === root ? Number(root.style.opacity || root.getAttribute('opacity') || 1) : Number(style.opacity || 1)
    if (opacity === 0) return null
    const matrix = toScene(element)
    const paint: ScenePaint = {
      fill: style.fill || '#000', stroke: style.stroke || 'none', fillOpacity: Number(style.fillOpacity || 1),
      strokeOpacity: Number(style.strokeOpacity || 1), strokeWidth: parseFloat(style.strokeWidth || '1'),
      dash: style.strokeDasharray === 'none' ? [] : (style.strokeDasharray.match(/[\d.e+-]+/g)?.map(Number) ?? []),
      dashOffset: parseFloat(style.strokeDashoffset || '0'), cap: style.strokeLinecap, join: style.strokeLinejoin,
      miter: parseFloat(style.strokeMiterlimit || '4'), nonScaling: style.vectorEffect === 'non-scaling-stroke',
      evenOdd: style.fillRule === 'evenodd',
      order: style.paintOrder,
    }
    const clips: SceneNode['clips'] = []
    if (element === root && style.overflow !== 'visible') clips.push({
      shape: { kind: 'rect', rect: { x: 0, y: 0, width, height }, rx: 0, ry: 0 }, matrix: identitySceneMatrix,
    })
    const clip = definition(style.clipPath)
    if (clip) {
      if (clip.getAttribute('clipPathUnits') === 'objectBoundingBox') throw new Error('Unsupported paper objectBoundingBox clip')
      for (const child of clip.children) {
        const shape = svgSceneShape(child)
        if (shape) clips.push({ shape, matrix })
      }
    }
    const filters = [...filtersFor(style.filter), ...inheritedFilters]
    const node: SceneNode = { matrix, opacity, blend: style.mixBlendMode, paint, clips, children: [] }
    node.shape = svgSceneShape(element)
    if (element.localName === 'image') node.image = {
      url: element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '',
      rect: { x: attribute(element, 'x'), y: attribute(element, 'y'), width: attribute(element, 'width'), height: attribute(element, 'height') },
      filters, pixelated: style.imageRendering === 'pixelated',
    }
    else if (element.localName === 'text' || element.localName === 'tspan') {
      const directText = Array.from(element.childNodes).filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join('')
      if (directText.trim()) node.text = {
        value: directText, x: attribute(element, 'x', attribute(element.parentElement!, 'x')) + attribute(element, 'dx'),
        y: attribute(element, 'y', attribute(element.parentElement!, 'y')) + attribute(element, 'dy'),
        size: parseFloat(style.fontSize), weight: style.fontWeight === 'bold' ? 700 : Number(style.fontWeight) || 400,
        italic: style.fontStyle === 'italic', anchor: style.textAnchor, baseline: style.dominantBaseline,
        letterSpacing: parseFloat(style.letterSpacing) || 0,
        family: style.fontFamily,
      }
    } else if (!node.shape && !['g', 'svg', 'a'].includes(element.localName)) {
      throw new Error(`Unsupported paper primitive: ${element.localName}`)
    }
    node.children = Array.from(element.children).map(child => capture(child as SVGElement, filters)).filter((child): child is SceneNode => child !== null)
    return node
  }
  const node = capture(root, [])
  return { width, height, nodes: node ? [node] : [] }
}
