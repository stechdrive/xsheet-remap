import type { CSSProperties } from 'react'
import type { SceneMatrix, SceneNode, ScenePaint, SceneShape, SceneText } from './canvasKitScene'

export type PaperStyleSample = { tag: 'rect' | 'path' | 'text'; className: string; style?: CSSProperties }
export type PaperPrimitive = {
  style: string
  shape?: SceneShape
  text?: Pick<SceneText, 'value' | 'x' | 'y' | 'size' | 'anchor' | 'baseline'> & { weight?: number }
  opacity?: number
  paint?: Partial<ScenePaint>
}
export interface DirectPaperModel {
  pageSize: { widthPx: number; heightPx: number }
  styles: Record<string, PaperStyleSample>
  primitives: PaperPrimitive[]
}

export type PaperStyle = { paint: ScenePaint; opacity: number; visible: boolean; family: string; weight: number; italic: boolean; spacing: number }
export function paperStyle(element: Element): PaperStyle {
  const style = getComputedStyle(element)
  return { visible: style.display !== 'none' && style.visibility !== 'hidden', opacity: Number(style.opacity || 1),
    family: style.fontFamily, weight: style.fontWeight === 'bold' ? 700 : Number(style.fontWeight) || 400,
    italic: style.fontStyle === 'italic', spacing: parseFloat(style.letterSpacing) || 0,
    paint: { fill: style.fill || '#000', stroke: style.stroke || 'none', fillOpacity: Number(style.fillOpacity || 1),
      strokeOpacity: Number(style.strokeOpacity || 1), strokeWidth: parseFloat(style.strokeWidth || '1'),
      dash: style.strokeDasharray === 'none' ? [] : (style.strokeDasharray.match(/[\d.e+-]+/g)?.map(Number) ?? []),
      dashOffset: parseFloat(style.strokeDashoffset || '0'), cap: style.strokeLinecap, join: style.strokeLinejoin,
      miter: parseFloat(style.strokeMiterlimit || '4'), nonScaling: style.vectorEffect === 'non-scaling-stroke',
      evenOdd: style.fillRule === 'evenodd', order: style.paintOrder },
  }
}

/** Geometry comes directly from the document model; only the small shared style palette uses DOM. */
export function compileDirectPaperModel(model: DirectPaperModel, matrix: SceneMatrix, styleFor: (key: string) => PaperStyle): SceneNode[] {
  const nodes: SceneNode[] = [], styles = new Map<string, PaperStyle>()
  for (const primitive of model.primitives) {
    let style = styles.get(primitive.style)
    if (!style) { style = styleFor(primitive.style); styles.set(primitive.style, style) }
    if (!style.visible) continue
    const node: SceneNode = { matrix, paint: { ...style.paint, ...primitive.paint }, opacity: (primitive.opacity ?? 1) * style.opacity,
      blend: 'normal', clips: [], children: [], shape: primitive.shape }
    if (primitive.text) {
      const { widthPx: w, heightPx: h } = model.pageSize
      const [a, b, c, d, e, f] = matrix
      node.matrix = [a / w, b / w, c / h, d / h, e, f]
      node.text = { ...primitive.text, x: primitive.text.x * w, y: primitive.text.y * h,
        family: style.family, weight: primitive.text.weight ?? style.weight, italic: style.italic, letterSpacing: style.spacing }
    }
    nodes.push(node)
  }
  return nodes
}

const models = new WeakMap<SVGElement, DirectPaperModel>()
const listeners = new Map<SVGSVGElement, Set<() => void>>()
let printing = false
export function registerPaperModel(element: SVGElement, model: DirectPaperModel) {
  models.set(element, model)
  element.setAttribute('data-paper-model-revision', String(Number(element.getAttribute('data-paper-model-revision') ?? 0) + 1))
  return () => { models.delete(element) }
}
export function directPaperModel(element: SVGElement) {
  return printing || element.ownerSVGElement?.dataset.paperModelMode === 'svg' ? undefined : models.get(element)
}
export function paperModelReady(source: SVGSVGElement | null) {
  return !!source && !printing && source.dataset.paperModelMode !== 'svg' && source.dataset.canvaskitReady === 'true'
}
export function subscribePaperModel(source: SVGSVGElement | null, listener: () => void) {
  if (!source) return () => {}
  let callbacks = listeners.get(source)
  if (!callbacks) { callbacks = new Set(); listeners.set(source, callbacks) }
  callbacks.add(listener)
  return () => { callbacks.delete(listener); if (!callbacks.size) listeners.delete(source) }
}
export function notifyPaperModel(source: SVGSVGElement) { listeners.get(source)?.forEach(callback => callback()) }
export function setPaperModelPrinting(value: boolean) {
  printing = value
  for (const callbacks of listeners.values()) callbacks.forEach(callback => callback())
}
