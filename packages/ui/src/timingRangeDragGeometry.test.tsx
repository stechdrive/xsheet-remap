import { cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { addOverlayPaperTrack, createDefaultProject, createOrSetEvent, digitalStandardSheetTemplate, setTimingReferenceAt, setTimingSpecialEvent, standardA3SheetTemplate, updateLogicalSheetSettings, type CutProject, type SheetTemplate } from '@xsheet-remap/core'
import { createSheetRenderModelContext } from './sheetRenderModel'
import { eventRectsForPages, projectTimingHitForFrame, rectForHit } from './sheet-layers-hit-geometry'
import { paperTrackOrderForRole } from './app-sheet-geometry'
import { rangeSelectionFromHits } from './sheetInteraction'
import { moveTimingEventsInRange, planTimingRangeMove, prepareTimingRangeMove } from './timingEditing'
import { timingDragGhostCellsForPage, timingDragRangeRectsForPage } from './timingRangeDragGeometry'
import { SheetTimingDragPreview } from './SheetTimingDragPreview'
import { useTimingRangeDragPreview } from './useTimingRangeDragPreview'
import type { TimelineEventDragInteraction } from './sheet-pointer-session'

afterEach(cleanup)

function fixture(template: SheetTemplate = standardA3SheetTemplate, project: CutProject = createDefaultProject()) {
  project = updateLogicalSheetSettings(project, { durationFrames: 288 })
  project = createOrSetEvent(project, 'A', 1, 'cell').project
  project = setTimingReferenceAt(project, 'A', 2, 'cell', true)
  project = setTimingSpecialEvent(project, 'A', 3, 'blank', 'cell')
  project = setTimingSpecialEvent(project, 'A', 4, 'inbetween', 'cell')
  project = setTimingSpecialEvent(project, 'A', 5, 'reverse', 'cell')
  const order = paperTrackOrderForRole(project, 'cell', template)
  const hit = (track: string, frame: number) => projectTimingHitForFrame(template, project, 'cell', track, frame)!
  const range = rangeSelectionFromHits(template, hit('A', 1), hit('A', 5), order)!
  const source = prepareTimingRangeMove(project, range, hit('A', 3), order)!
  const context = createSheetRenderModelContext(project, template)
  return { project, template, order, hit, range, source, context }
}

describe('timing drag projection', () => {
  it.each([73, 145])('projects the full range across block/page boundaries when the grabbed frame goes to %s', targetFrame => {
    const { project, template, order, hit, range, source, context } = fixture()
    const target = hit('B', targetFrame)
    const plan = planTimingRangeMove(source, target)
    const moved = moveTimingEventsInRange(project, range, source.sourceHit, target, order)
    const committed = eventRectsForPages(moved.project, template, context.pages)
    const ghost = context.pages.flatMap(page => timingDragGhostCellsForPage(context, page, source, plan, null))
    expect(ghost.map(cell => cell.frame)).toEqual([targetFrame - 2, targetFrame - 1, targetFrame, targetFrame + 1, targetFrame + 2])
    for (const cell of ghost) {
      const expected = [...committed.values()].flat().find(item => item.event.paperTrack === 'B' && item.event.frame === cell.frame)
      if (cell.item.kind === 'empty') expect(cell.textLayout.reference).toBeTruthy()
      else expect(cell.rect).toEqual(expected?.rect)
    }
    const bounds = context.pages.flatMap(page => timingDragRangeRectsForPage(context, page, {
      ...range, paperTracks: ['B'], frameStart: targetFrame - 2, frameEnd: targetFrame + 2,
    }))
    expect(bounds).toHaveLength(2)
    expect(project.logicalSheet.events.map(event => event.frame)).toEqual([1, 3, 4, 5])
  })

  it('uses the destination column width on a continuous sheet and bounds content to the render window', () => {
    const initial = createDefaultProject()
    initial.sheetView.layoutOverrides = { grids: { digital_cell_grid: { columnWidthsPx: { A: 60, B: 108 } } } }
    const { context, source, hit } = fixture(digitalStandardSheetTemplate, initial)
    const plan = planTimingRangeMove(source, hit('B', 13))
    const page = context.pages[0]
    const cells = timingDragGhostCellsForPage(context, page, source, plan, null, { start: 12, end: 14 })
    expect(cells.map(cell => cell.frame)).toEqual([12, 13, 14])
    const from = rectForHit(context.project, context.template, hit('A', 3))!
    const to = rectForHit(context.project, context.template, hit('B', 13))!
    expect(cells[1].rect).toEqual(to)
    expect(to.w).toBeGreaterThan(from.w)
  })

  it('projects into an auxiliary track with the same geometry as committed input', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), { paperTrack: 'J', label: 'J', insertAfterPaperTrack: 'A', snapIndex: 0, sheetRole: 'cell' })
    const { context, source, hit, range, order } = fixture(standardA3SheetTemplate, overlay.project)
    const target = hit('J', 13)
    const plan = planTimingRangeMove(source, target)
    const moved = moveTimingEventsInRange(context.project, range, source.sourceHit, target, order)
    const page = context.pages[0]
    const committed = eventRectsForPages(moved.project, context.template, [page], { activeOverlayPaperTrack: 'J' }).get(page.pageId)!
    const ghost = timingDragGhostCellsForPage(context, page, source, plan, 'J')
    expect(ghost).toHaveLength(5)
    expect(ghost[0].rect).toEqual(committed.find(item => item.event.frame === 11)?.rect)
    const bounds = timingDragRangeRectsForPage(context, page, { ...range, paperTracks: ['J'], frameStart: 11, frameEnd: 15 }, 'J')
    expect(bounds).toHaveLength(1)
    expect(bounds[0].x).toBeCloseTo(ghost[0].rect.x)
    expect(bounds[0].h).toBeCloseTo(ghost[0].rect.h * 5)
  })

  it('renders the reference-only cell and every symbol inside a non-interactive transient layer', () => {
    const { context, source, hit } = fixture()
    const plan = planTimingRangeMove(source, hit('B', 13))
    const { container } = render(<svg><SheetTimingDragPreview context={context} page={context.pages[0]} source={source} plan={plan}
      activeOverlayPaperTrack={null} width={1000} height={1400} /></svg>)
    expect(container.querySelectorAll('.timingDragGhostCell')).toHaveLength(5)
    expect(container.querySelector('.timingDragPreview')?.getAttribute('pointer-events')).toBe('none')
    expect(container.querySelector('[data-drag-frame="11"] .eventText')?.textContent).toBe('1')
    expect(container.querySelector('[data-drag-frame="12"] .eventReferenceSymbol')).toBeTruthy()
    expect(container.querySelector('[data-drag-frame="13"] .eventBlankSymbol')).toBeTruthy()
    expect(container.querySelector('[data-drag-frame="14"] .eventInbetweenSymbol')).toBeTruthy()
    expect(container.querySelector('[data-drag-frame="15"] .eventReverseSymbol')).toBeTruthy()
  })

  it('retains the source snapshot and snapped plan while only pointer coordinates change', () => {
    const { project, template, range, hit } = fixture()
    const drag: TimelineEventDragInteraction = { pointerId: 1, sourceHit: hit('A', 3), sourceRange: range, currentHit: hit('B', 13),
      startX: 0, startY: 0, clientX: 50, clientY: 50, moved: true }
    const { result, rerender } = renderHook(({ current }: { current: TimelineEventDragInteraction }) => useTimingRangeDragPreview(project, template, current), { initialProps: { current: drag } })
    const prepared = result.current.source
    const plan = result.current.plan
    for (let step = 0; step < 20; step++) rerender({ current: { ...drag, clientX: 50 + step } })
    expect(result.current.source).toBe(prepared)
    expect(result.current.plan).toBe(plan)
    rerender({ current: { ...drag, currentHit: hit('B', 14) } })
    expect(result.current.source).toBe(prepared)
    expect(result.current.plan?.destinationFrameStart).toBe(12)
  })
})
