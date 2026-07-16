import type { SheetHit } from '@xsheet-remap/core'
import type { SheetRangeSelection } from './appTypes'

export type DraftRangeInteraction = {
  pointerId: number
  anchor: SheetHit
  focus: SheetHit
  moved: boolean
  preserveRangeOnClick?: SheetRangeSelection
}

export type PendingTimelineEventInteraction = {
  pointerId: number
  sourceHit: SheetHit
  startX: number
  startY: number
  ready: boolean
}

export type TimelineEventDragInteraction = {
  pointerId: number
  sourceHit: SheetHit
  currentHit: SheetHit | null
  startX: number
  startY: number
  moved: boolean
}

export function releasePointerCaptureForElements(pointerId: number, elements: Iterable<Element | null | undefined>) {
  for (const element of elements) {
    if (!element?.hasPointerCapture?.(pointerId)) continue
    try {
      element.releasePointerCapture(pointerId)
    } catch {
      // The browser may already have released capture while dispatching pointerup/cancel.
    }
  }
}
