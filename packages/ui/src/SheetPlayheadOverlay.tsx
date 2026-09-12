import { useSyncExternalStore } from 'react'
import { sheetGridRowY, type SheetGridLayout, type SheetPage } from '@xsheet-remap/core'
import type { AudioPlayheadStore } from './audioPlayheadStore'

const subscribeNone = () => () => {}
const noSnapshot = () => null
export function SheetPlayheadOverlay({ store, frame, cutId, layout, page, continuous }: {
  store?: AudioPlayheadStore; frame: number | null; cutId: string
  layout: SheetGridLayout | null; page: SheetPage; continuous: boolean
}) {
  const snapshot = useSyncExternalStore(store?.subscribe ?? subscribeNone, store?.getSnapshot ?? noSnapshot, noSnapshot)
  const current = frame === null ? null : snapshot?.cutId === cutId ? snapshot.frame : frame
  if (!layout || current === null || current < page.frameStart || current > page.frameEnd) return null
  const localFrame = continuous ? current : current - page.frameStart + layout.frames.frameStart
  const row = localFrame - layout.frames.frameStart
  if (row < 0 || row >= layout.frames.rowCount) return null
  const y = sheetGridRowY(layout, row) + layout.frames.rowHeight / 2
  return <svg className="sheetTransientOverlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
    <line className="audioSheetPlayhead" x1="0" x2="1" y1={y} y2={y} />
  </svg>
}
