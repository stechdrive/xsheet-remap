import { useEffect, type RefObject } from 'react'
import type { CanvasKitPaperSurface } from './canvasKitSurface'
import { CANVASKIT_PAPER_SOURCES as PAPER_SOURCES } from './canvasKitPaperSources'

/** The SVG tree continues to own keyboard/pointer targets; only painting changes. */
export function useCanvasKitPaper(host: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = host.current
    if (!element || typeof ResizeObserver === 'undefined' || typeof SVGGraphicsElement === 'undefined'
      || typeof SVGGraphicsElement.prototype.getScreenCTM !== 'function') return
    let stopped = false
    let mount: (() => void) | null = null
    const surfaces = new Map<SVGSVGElement, CanvasKitPaperSurface>()
    const invalidate = () => surfaces.forEach(surface => surface.invalidate())
    const onScroll = (event: Event) => {
      // Scrolling an asset pane or another page does not move this paper.
      if (event.target === document || event.target === window
        || (event.target instanceof Element && event.target.contains(element))) invalidate()
    }
    const restyle = () => surfaces.forEach(surface => surface.invalidate(true))
    const styles = new MutationObserver(restyle)
    styles.observe(document.head, { childList: true, characterData: true, subtree: true })
    styles.observe(document.documentElement, { attributes: true })
    styles.observe(document.body, { attributes: true })
    const observer = new MutationObserver(records => {
      if (records.some(record => record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].some(node =>
        node instanceof Element && (node.matches(PAPER_SOURCES) || (node.childElementCount > 0 && node.querySelector(PAPER_SOURCES)))))) mount?.()
      // Ancestor transforms (including zoom and drag previews) move the cached scene.
      const ancestors = records.filter(record => record.type === 'attributes' && record.target instanceof Element
        && !record.target.closest('svg, .canvasKitPaperCanvas')).map(record => record.target as Element)
      for (const [source, surface] of surfaces) {
        if (ancestors.some(ancestor => ancestor.contains(source))) surface.invalidate()
      }
    })
    void import('./canvasKitSurface').then(({ CanvasKitPaperSurface: Surface }) => {
      if (stopped) return
      mount = () => {
        for (const source of element.querySelectorAll<SVGSVGElement>(PAPER_SOURCES)) {
          if (!surfaces.has(source)) surfaces.set(source, new Surface(source))
        }
        for (const [source, surface] of surfaces) {
          if (!element.contains(source)) { surface.dispose(); surfaces.delete(source) }
        }
      }
      mount()
      observer.observe(element, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['style', 'class', 'data-paper-transform-preview', 'data-touch-pinch-preview'] })
    }).catch(error => console.warn('[paper-renderer] Could not load CanvasKit.', error))
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', invalidate)
    document.addEventListener('visibilitychange', invalidate)
    return () => {
      stopped = true; observer.disconnect(); styles.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', invalidate)
      document.removeEventListener('visibilitychange', invalidate)
      surfaces.forEach(surface => surface.dispose()); surfaces.clear()
    }
  }, [host])
}
