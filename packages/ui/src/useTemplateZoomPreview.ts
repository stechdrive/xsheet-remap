import { useLayoutEffect, useRef, type RefObject } from 'react'

/** Show every zoom step immediately; refresh sharp pixels once continuous input settles. */
export function useTemplateZoomPreview(viewportRef: RefObject<HTMLElement | null>, zoom: number) {
  const previous = useRef(zoom)
  useLayoutEffect(() => {
    const element = viewportRef.current
    if (!element || previous.current === zoom) return
    previous.current = zoom
    element.setAttribute('data-paper-transform-preview', 'true')
    const timer = window.setTimeout(() => { element.removeAttribute('data-paper-transform-preview') }, 140)
    return () => { window.clearTimeout(timer); element.removeAttribute('data-paper-transform-preview') }
  }, [viewportRef, zoom])
}
