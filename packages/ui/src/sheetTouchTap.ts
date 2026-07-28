import {
  sheetAnnotations,
  type AnnotationAnchor,
  type NormalizedPoint,
  type SheetHit,
  type SheetPage,
} from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'
import { nextAnnotationId } from './app-sheet-layers'
import type { SheetCanvasProps } from './app-sheet-canvas-types'
import { clampNumber } from './sheetInteraction'
import { resolveTimelineMemoContextTargets } from './timelineMemoEditing'
import type { SheetTouchTap } from './sheetTouchNavigation'

interface SheetTouchTapContext {
  props: SheetCanvasProps
  beforeTap: () => void
  pageHitUnderClientPoint: (
    clientX: number,
    clientY: number,
  ) => { page: SheetPage; hit: SheetHit | null } | null
  svgForPage: (page: SheetPage) => SVGSVGElement | null
  setActivePageIndexIfNeeded: (pageIndex: number) => void
  pageAnnotationAnchor: (page: SheetPage) => AnnotationAnchor
  paperTrackHeaderHitFromPoint: (
    point: NormalizedPoint,
    page: SheetPage,
    viewportHeightPx?: number,
  ) => SheetHit | null
  selectPaperTrackColumn: (hit: SheetHit) => void
  rangeFromHits: (anchorHit: SheetHit, focusHit: SheetHit) => SheetRangeSelection | null
}

export function runSheetTouchTap(
  { target, clientX, clientY }: SheetTouchTap,
  {
    props,
    beforeTap,
    pageHitUnderClientPoint,
    svgForPage,
    setActivePageIndexIfNeeded,
    pageAnnotationAnchor,
    paperTrackHeaderHitFromPoint,
    selectPaperTrackColumn,
    rangeFromHits,
  }: SheetTouchTapContext,
) {
  beforeTap()
  const pointed = pageHitUnderClientPoint(clientX, clientY)
  if (!pointed) {
    props.onClearSelection()
    return
  }

  const { page, hit } = pointed
  const svg = svgForPage(page)
  if (!svg) return
  setActivePageIndexIfNeeded(page.pageIndex)
  const box = svg.getBoundingClientRect()
  const point = {
    x: (clientX - box.left) / Math.max(1, box.width),
    y: (clientY - box.top) / Math.max(1, box.height),
  }
  const currentTarget = target?.isConnected ? target : document.elementFromPoint(clientX, clientY)
  const { timelineMemoIds, soundCueId, cameraCueId } = resolveTimelineMemoContextTargets(
    currentTarget instanceof Element ? currentTarget : null,
    props.project,
    props.template,
    hit,
  )
  if (timelineMemoIds?.length) {
    props.onSelectTimelineMemo(timelineMemoIds[0])
    return
  }
  if (props.selectedTimelineMemoId) {
    props.onSelectTimelineMemo(null)
    return
  }
  if (props.editMode === 'text') {
    if (props.editingTextAnnotationId) {
      props.onCommitFocusedTextAnnotationDraft()
      return
    }
    props.onTextAnnotation({
      annotationId: nextAnnotationId(sheetAnnotations(props.project)),
      pageId: page.pageId,
      kind: 'text',
      text: '',
      x: clampNumber(point.x, 0, 1),
      y: clampNumber(point.y, 0, 1),
      color: props.penColor,
      fontSizePx: props.textFontSizePx,
      coordinateSpace: 'view-surface',
      anchor: pageAnnotationAnchor(page),
    })
    return
  }
  if (soundCueId) {
    props.onSoundCueSelect(soundCueId)
    return
  }
  if (cameraCueId) {
    props.onCameraCueSelect(cameraCueId)
    return
  }

  const headerHit = paperTrackHeaderHitFromPoint(point, page, box.height)
  if (headerHit?.paperTrack) {
    selectPaperTrackColumn(headerHit)
    return
  }
  if (hit?.paperTrack && (hit.role === 'action' || hit.role === 'cell')) {
    props.onCellClick(hit)
    return
  }
  if (hit) {
    const range = rangeFromHits(hit, hit)
    if (range) props.onRangeSelect(range)
    return
  }
  props.onClearSelection()
}
