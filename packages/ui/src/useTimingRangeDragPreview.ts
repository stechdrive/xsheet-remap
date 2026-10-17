import { useMemo } from 'react'
import type { CutProject, SheetTemplate } from '@xsheet-remap/core'
import { paperTrackOrderForRole } from './app-sheet-geometry'
import { rangeSelectionFromHits, sheetRoleForHit } from './sheetInteraction'
import { planTimingRangeMove, prepareTimingRangeMove } from './timingEditing'
import type { TimelineEventDragInteraction } from './sheet-pointer-session'

export function useTimingRangeDragPreview(project: CutProject, template: SheetTemplate, drag: TimelineEventDragInteraction | null) {
  const sourceHit = drag?.sourceHit
  const sourceRange = drag?.sourceRange
  const targetHit = drag?.currentHit ?? null
  const source = useMemo(() => {
    if (!sourceHit) return null
    const order = paperTrackOrderForRole(project, sheetRoleForHit(sourceHit), template)
    const range = sourceRange ?? rangeSelectionFromHits(template, sourceHit, sourceHit, order)
    return range ? prepareTimingRangeMove(project, range, sourceHit, order) : null
  }, [project, template, sourceHit, sourceRange])
  const plan = useMemo(() => source ? planTimingRangeMove(source, targetHit) : null, [source, targetHit])
  return { source, plan }
}
