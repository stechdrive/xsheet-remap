import type { SceneNode } from './canvasKitScene'

/** Cache computed SVG geometry, retaining inherited-style and definition invalidation. */
export class CanvasKitSceneCache {
  private nodes = new WeakMap<SVGElement, SceneNode | null>()
  capturedNodes = 0
  constructor(private root: SVGSVGElement) {}
  get(element: SVGElement) { return this.nodes.get(element) }
  set(element: SVGElement, node: SceneNode | null) { this.nodes.set(element, node); this.capturedNodes++ }
  clear() { this.nodes = new WeakMap() }

  invalidate(records: readonly MutationRecord[]) {
    for (const record of records) {
      const element = record.target instanceof Element ? record.target : record.target.parentElement
      if (!element || element === this.root || element.closest('defs, clipPath, filter, style')) { this.clear(); return }
      // Ancestor transforms, inherited paint and text layout affect the complete subtree.
      this.nodes.delete(element as SVGElement)
      for (const child of element.querySelectorAll('*')) this.nodes.delete(child as SVGElement)
      for (let parent = element.parentElement; parent && this.root.contains(parent); parent = parent.parentElement) {
        this.nodes.delete(parent as unknown as SVGElement)
      }
    }
  }
}
