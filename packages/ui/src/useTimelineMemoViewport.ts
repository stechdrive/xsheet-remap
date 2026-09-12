import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import type { NormalizedRect, SheetMemo, SheetPage, SheetTemplate, SheetTemplateLayoutResolveOptions } from '@xsheet-remap/core'
import { timelineMemoSegmentsForPage } from './timelineMemoGeometry'

/** Expose a complete small memo or the writing origin of a larger one. */
export function memoRevealScrollOffset(start: number, size: number, current: number, viewportSize: number, contentSize: number, margin = 24): number {
  const inset = Math.min(margin, viewportSize / 4)
  const visibleSize = viewportSize - inset * 2
  const visibleEnd = start + Math.min(size, visibleSize)
  const next = start < current + inset ? start - inset
    : visibleEnd > current + viewportSize - inset ? visibleEnd - viewportSize + inset
    : current
  return Math.max(0, Math.min(Math.max(0, contentSize - viewportSize), next))
}

export function revealTimelineMemo(viewport: HTMLElement, svg: SVGSVGElement, rect: NormalizedRect): boolean {
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return false
  const clip = viewport.getBoundingClientRect()
  const page = svg.getBoundingClientRect()
  if (page.width <= 0 || page.height <= 0) return false
  const left = viewport.scrollLeft + page.left - clip.left - viewport.clientLeft + rect.x * page.width
  const top = viewport.scrollTop + page.top - clip.top - viewport.clientTop + rect.y * page.height
  viewport.scrollLeft = memoRevealScrollOffset(left, rect.w * page.width, viewport.scrollLeft, viewport.clientWidth, viewport.scrollWidth)
  viewport.scrollTop = memoRevealScrollOffset(top, rect.h * page.height, viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight)
  return true
}

/** Keep the editing page mounted, and reveal it once when its memo is selected. */
export function useTimelineMemoViewport({
  memoId, memos, pages, template, paperTracks, timelineLanes, layoutOverrides,
  viewportRef, svgRefs, singlePage, activePageIndex, setActivePageIndex, zoom,
}: {
  memoId: string | null
  memos: readonly SheetMemo[]
  pages: SheetPage[]
  template: SheetTemplate
  paperTracks: string[]
  timelineLanes: SheetTemplateLayoutResolveOptions['timelineLanes']
  layoutOverrides: SheetTemplateLayoutResolveOptions['layoutOverrides']
  viewportRef: RefObject<HTMLDivElement | null>
  svgRefs: RefObject<Record<string, SVGSVGElement | null>>
  singlePage: boolean
  activePageIndex: number
  setActivePageIndex: (index: number) => void
  zoom: number
}) {
  const revealedMemoId = useRef<string | null>(null)
  const target = useMemo(() => {
    const memo = memos.find(item => item.kind === 'timeline' && item.memoId === memoId)
    if (!memo || memo.kind !== 'timeline') return null
    const start = memo.anchor.frame + memo.placement.frameOffset
    const page = pages.find(item => item.frameEnd >= start && item.frameStart < start + memo.placement.heightFrames)
    if (!page) return null
    const segment = timelineMemoSegmentsForPage(template, page, memo, { paperTracks, timelineLanes, layoutOverrides })[0]
    return segment ? { memoId: memo.memoId, page, rect: segment.rect } : null
  }, [layoutOverrides, memoId, memos, pages, paperTracks, template, timelineLanes])

  useLayoutEffect(() => {
    if (!target) { revealedMemoId.current = null; return }
    if (revealedMemoId.current === target.memoId) return
    if (singlePage && activePageIndex !== target.page.pageIndex) {
      setActivePageIndex(target.page.pageIndex)
      return
    }
    const viewport = viewportRef.current
    const svg = svgRefs.current[target.page.pageId]
    if (viewport && svg && revealTimelineMemo(viewport, svg, target.rect)) revealedMemoId.current = target.memoId
  }, [activePageIndex, setActivePageIndex, singlePage, svgRefs, target, viewportRef, zoom])

  return target?.page.pageId
}
