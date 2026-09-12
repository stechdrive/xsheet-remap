import { createContext, useCallback, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SheetPage, SheetViewMode } from '@xsheet-remap/core'
import { flushSync } from 'react-dom'

export type SheetRenderWindow = { top: number; bottom: number } | null
export const SheetRenderWindowContext = createContext<SheetRenderWindow>(null)
const OVERSCAN = 1024
const BLOCK = 1024

/** Quantized page coordinates keep display lists stable during small scrolls. */
export function sheetRenderWindow(top: number, bottom: number, height: number): SheetRenderWindow {
  if (height <= 0 || height <= bottom - top + 2 * OVERSCAN) return null
  return {
    top: Math.max(0, Math.floor((top - OVERSCAN) / BLOCK) * BLOCK / height),
    bottom: Math.min(1, Math.ceil((bottom + OVERSCAN) / BLOCK) * BLOCK / height),
  }
}

/** Empty page slots preserve layout; native focus and captured input pin their page. */
export function useSheetRenderWindow({ pages, mode, activePageIndex, requestedPageId, editingPageId, continuous, viewportRef, width, height }: {
  pages: SheetPage[]; mode: SheetViewMode; activePageIndex: number; requestedPageId?: string
  continuous: boolean; viewportRef: RefObject<HTMLDivElement | null>; width: number; height: number
  editingPageId?: string
}) {
  const [near, setNear] = useState<ReadonlySet<string>>(() => new Set(pages.slice(0, 2).map(page => page.pageId)))
  const [pinned, setPinned] = useState<ReadonlySet<string>>(() => new Set())
  const [printing, setPrinting] = useState(false)
  const [window, setWindow] = useState<SheetRenderWindow>(null)
  const elements = useRef(new Map<string, HTMLElement>())
  const observer = useRef<IntersectionObserver | null>(null)
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>())
  const registerPage = useCallback((id: string, element: HTMLElement | null) => {
    const previous = elements.current.get(id)
    if (previous === element) return
    if (previous) observer.current?.unobserve(previous)
    if (element) { elements.current.set(id, element); observer.current?.observe(element) }
    else elements.current.delete(id)
  }, [])
  const pageRef = useCallback((id: string) => {
    let callback = callbacks.current.get(id)
    if (!callback) { callback = element => registerPage(id, element); callbacks.current.set(id, callback) }
    return callback
  }, [registerPage])
  const displayPages = useMemo(() => mode === 'single-page' ? pages.filter(page => page.pageIndex === activePageIndex) : pages, [activePageIndex, mode, pages])
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const captured = new Map<number, string>()
    let composingPage: string | undefined
    const pageId = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>('[data-sheet-page-slot]')?.dataset.sheetPageSlot : undefined
    const publishPins = () => {
      const ids = new Set(captured.values())
      const focused = pageId(document.activeElement)
      if (focused) ids.add(focused)
      if (composingPage) ids.add(composingPage)
      setPinned(previous => sameIds(previous, ids) ? previous : ids)
    }
    const capture = (event: PointerEvent) => { const id = pageId(event.target); if (id) captured.set(event.pointerId, id); publishPins() }
    const release = (event: PointerEvent) => { captured.delete(event.pointerId); publishPins() }
    const compositionStart = (event: CompositionEvent) => { composingPage = pageId(event.target); publishPins() }
    const compositionEnd = () => { composingPage = undefined; publishPins() }
    const focus = () => queueMicrotask(publishPins)
    viewport.addEventListener('gotpointercapture', capture)
    viewport.addEventListener('lostpointercapture', release)
    viewport.addEventListener('focusin', focus)
    viewport.addEventListener('focusout', focus)
    viewport.addEventListener('compositionstart', compositionStart)
    viewport.addEventListener('compositionend', compositionEnd)
    const beforePrint = () => flushSync(() => setPrinting(true))
    const afterPrint = () => flushSync(() => setPrinting(false))
    globalThis.addEventListener('beforeprint', beforePrint)
    globalThis.addEventListener('afterprint', afterPrint)
    if (globalThis.IntersectionObserver) {
      observer.current = new IntersectionObserver(entries => setNear(previous => {
        const ids = new Set(previous)
        for (const entry of entries) {
          const id = (entry.target as HTMLElement).dataset.sheetPageSlot!
          if (entry.isIntersecting) ids.add(id); else ids.delete(id)
        }
        return sameIds(previous, ids) ? previous : ids
      }), { root: viewport, rootMargin: `${OVERSCAN}px` })
      for (const element of elements.current.values()) observer.current.observe(element)
    }
    return () => {
      observer.current?.disconnect(); observer.current = null
      viewport.removeEventListener('gotpointercapture', capture)
      viewport.removeEventListener('lostpointercapture', release)
      viewport.removeEventListener('focusin', focus)
      viewport.removeEventListener('focusout', focus)
      viewport.removeEventListener('compositionstart', compositionStart)
      viewport.removeEventListener('compositionend', compositionEnd)
      globalThis.removeEventListener('beforeprint', beforePrint)
      globalThis.removeEventListener('afterprint', afterPrint)
    }
  }, [viewportRef])
  useLayoutEffect(() => {
    if (!continuous) return
    const viewport = viewportRef.current
    if (!viewport) return
    let frame = 0
    const measure = () => {
      frame = 0
      const page = elements.current.values().next().value as HTMLElement | undefined
      if (!page) return
      const rect = page.getBoundingClientRect(), clip = viewport.getBoundingClientRect()
      const next = sheetRenderWindow(clip.top - rect.top, clip.bottom - rect.top, rect.height)
      setWindow(previous => previous?.top === next?.top && previous?.bottom === next?.bottom ? previous : next)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    viewport.addEventListener('scroll', schedule, { passive: true })
    const resize = globalThis.ResizeObserver ? new ResizeObserver(schedule) : null
    resize?.observe(viewport)
    globalThis.addEventListener('resize', schedule)
    return () => { cancelAnimationFrame(frame); viewport.removeEventListener('scroll', schedule); resize?.disconnect(); globalThis.removeEventListener('resize', schedule) }
  }, [continuous, displayPages, height, viewportRef, width])
  const mountedSignature = displayPages.map(page => printing || continuous || !globalThis.IntersectionObserver
    || near.has(page.pageId) || pinned.has(page.pageId) || page.pageIndex === activePageIndex || page.pageId === requestedPageId || page.pageId === editingPageId ? '1' : '0').join('')
  const mountedPages = useMemo(() => displayPages.filter((_, index) => mountedSignature[index] === '1'), [displayPages, mountedSignature])
  const mountedPageIds = useMemo(() => new Set(mountedPages.map(page => page.pageId)), [mountedPages])
  const initialWindow = useMemo(() => sheetRenderWindow(0, globalThis.innerHeight || 1000, height), [height])
  return { displayPages, mountedPages, mountedPageIds, pageRef, renderWindow: printing ? null : continuous ? window ?? initialWindow : null }
}

function sameIds(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every(id => right.has(id))
}
