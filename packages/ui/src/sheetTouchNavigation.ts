import { clampSheetZoom } from './sheetInteraction'

export const SHEET_TOUCH_PAN_THRESHOLD_PX = 8

export interface SheetTouchTap {
  target: Element | null
  clientX: number
  clientY: number
}

export interface SheetTouchPoint {
  pointerId: number
  clientX: number
  clientY: number
}

export interface SheetTouchPairMetrics {
  clientX: number
  clientY: number
  distance: number
}

export interface SheetPinchPreview {
  zoom: number
  scale: number
  scrollLeft: number
  scrollTop: number
  centroidClientX: number
  centroidClientY: number
}

export type SheetViewportZoomAnchor = {
  kind: 'page'
  pageId: string
  x: number
  y: number
} | {
  kind: 'stack'
  x: number
  y: number
} | {
  kind: 'content'
  contentX: number
  contentY: number
  baseZoom: number
}

export interface PendingSheetZoomCommit {
  targetZoom: number
  anchor: SheetViewportZoomAnchor
  localX: number
  localY: number
}

export function sheetTouchPanExceededThreshold(
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
  thresholdPx = SHEET_TOUCH_PAN_THRESHOLD_PX,
): boolean {
  return Math.hypot(clientX - startX, clientY - startY) >= thresholdPx
}

export function sheetTouchPanScrollPosition(
  startScrollLeft: number,
  startScrollTop: number,
  startX: number,
  startY: number,
  clientX: number,
  clientY: number,
): { scrollLeft: number; scrollTop: number } {
  return {
    scrollLeft: startScrollLeft - (clientX - startX),
    scrollTop: startScrollTop - (clientY - startY),
  }
}

export function sheetTouchPairMetrics(
  first: Pick<SheetTouchPoint, 'clientX' | 'clientY'>,
  second: Pick<SheetTouchPoint, 'clientX' | 'clientY'>,
): SheetTouchPairMetrics {
  return {
    clientX: (first.clientX + second.clientX) / 2,
    clientY: (first.clientY + second.clientY) / 2,
    distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
  }
}

export function sheetPinchPreview(input: {
  baseZoom: number
  startDistance: number
  anchorContentX: number
  anchorContentY: number
  viewportLeft: number
  viewportTop: number
  first: Pick<SheetTouchPoint, 'clientX' | 'clientY'>
  second: Pick<SheetTouchPoint, 'clientX' | 'clientY'>
}): SheetPinchPreview {
  const metrics = sheetTouchPairMetrics(input.first, input.second)
  const distanceRatio = metrics.distance / Math.max(1, input.startDistance)
  const zoom = clampSheetZoom(input.baseZoom * distanceRatio)
  const scale = zoom / Math.max(Number.EPSILON, input.baseZoom)
  const localX = metrics.clientX - input.viewportLeft
  const localY = metrics.clientY - input.viewportTop
  return {
    zoom,
    scale,
    scrollLeft: input.anchorContentX * scale - localX,
    scrollTop: input.anchorContentY * scale - localY,
    centroidClientX: metrics.clientX,
    centroidClientY: metrics.clientY,
  }
}

export function isSheetTouchNavigationTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true
  return !target.closest([
    'button',
    'input',
    'select',
    'textarea',
    '[contenteditable="true"]',
    '.sheetContextMenu',
    '.timelineMemoTextEditor',
  ].join(','))
}

function pageSurfaceAtClientPoint(
  pageStack: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  return Array.from(pageStack.querySelectorAll<HTMLElement>('.sheetPageSurface[data-page-id]'))
    .find(surface => {
      const rect = surface.getBoundingClientRect()
      return clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom
    }) ?? null
}

export function captureSheetViewportZoomAnchor(
  viewport: HTMLElement,
  pageStack: HTMLElement,
  clientX: number,
  clientY: number,
  baseZoom: number,
): SheetViewportZoomAnchor {
  const surface = pageSurfaceAtClientPoint(pageStack, clientX, clientY)
  if (surface?.dataset.pageId) {
    const rect = surface.getBoundingClientRect()
    return {
      kind: 'page',
      pageId: surface.dataset.pageId,
      x: (clientX - rect.left) / Math.max(1, rect.width),
      y: (clientY - rect.top) / Math.max(1, rect.height),
    }
  }
  const rect = pageStack.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    const viewportRect = viewport.getBoundingClientRect()
    return {
      kind: 'content',
      contentX: viewport.scrollLeft + clientX - viewportRect.left,
      contentY: viewport.scrollTop + clientY - viewportRect.top,
      baseZoom,
    }
  }
  return {
    kind: 'stack',
    x: (clientX - rect.left) / Math.max(1, rect.width),
    y: (clientY - rect.top) / Math.max(1, rect.height),
  }
}

function pointForZoomAnchor(
  pageStack: HTMLElement,
  anchor: Exclude<SheetViewportZoomAnchor, { kind: 'content' }>,
): { clientX: number; clientY: number } {
  let element = pageStack
  if (anchor.kind === 'page') {
    const surface = Array.from(pageStack.querySelectorAll<HTMLElement>('.sheetPageSurface[data-page-id]'))
      .find(candidate => candidate.dataset.pageId === anchor.pageId)
    if (surface) element = surface
  }
  const rect = element.getBoundingClientRect()
  return {
    clientX: rect.left + rect.width * anchor.x,
    clientY: rect.top + rect.height * anchor.y,
  }
}

export function clearSheetPinchPreview(pageStack: HTMLElement) {
  pageStack.style.removeProperty('transform')
  pageStack.style.removeProperty('transform-origin')
  delete pageStack.dataset.touchPinchPreview
}

export function applySheetPinchPreview(pageStack: HTMLElement, scale: number) {
  pageStack.style.transformOrigin = '0 0'
  pageStack.style.transform = `scale(${scale})`
  pageStack.dataset.touchPinchPreview = 'true'
}

export function settleSheetViewportZoomAnchor(
  viewport: HTMLElement,
  pageStack: HTMLElement,
  pending: PendingSheetZoomCommit,
) {
  const viewportRect = viewport.getBoundingClientRect()
  const desiredClientX = viewportRect.left + pending.localX
  const desiredClientY = viewportRect.top + pending.localY
  if (pending.anchor.kind === 'content') {
    const ratio = pending.targetZoom / Math.max(Number.EPSILON, pending.anchor.baseZoom)
    viewport.scrollLeft = pending.anchor.contentX * ratio - pending.localX
    viewport.scrollTop = pending.anchor.contentY * ratio - pending.localY
    return
  }
  const actual = pointForZoomAnchor(pageStack, pending.anchor)
  viewport.scrollLeft += actual.clientX - desiredClientX
  viewport.scrollTop += actual.clientY - desiredClientY
}
