import { describe, expect, it } from 'vitest'
import {
  addOverlayPaperTrack, createDefaultProject, createKey, digitalStandardSheetTemplate, setEvent, setTimingReferenceAt, setTimingSpecialEvent,
  standardA3SheetTemplate, updateKey, updateLogicalSheetSettings, updateSheetViewState, type CutProject, type SheetTimingRole,
} from '@xsheet-remap/core'
import { createSheetRenderModelContext, continuationRenderItemsForPages, inputTextRenderItemsForPage, paperCellCarryItemsForPage } from './sheetRenderModel'
import { eventRectsForPage, overlayHitFromPoint, overlayRangeRectsForPage, projectTimingHitForFrame, rectForHit } from './sheet-layers-hit-geometry'

const paper = standardA3SheetTemplate
const sample = () => updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 150 })
function write(project: CutProject, track: string, frame: number, label: string, role: SheetTimingRole = 'cell') {
  const { project: withKey, key } = createKey(project, track, label, 'manual', undefined, role)
  return setEvent(withKey, track, frame, key.keyId, role)
}

describe('paper CEL block heads', () => {
  it('repeats the current text and blank in both folds and restarts the correct ink below each heading', () => {
    let project = write(sample(), 'A', 49, '10')
    project = setTimingReferenceAt(project, 'A', 49, 'cell', 'circle')
    project = setTimingSpecialEvent(project, 'B', 49, 'blank', 'cell')
    project = write(project, 'D', 49, 'action only', 'action')
    const original = JSON.stringify(project)
    const context = createSheetRenderModelContext(project, paper)
    const lines = continuationRenderItemsForPages(context, context.pages)
    for (const [index, page] of context.pages.entries()) {
      const head = index === 0 ? 73 : 145
      const entries = paperCellCarryItemsForPage(context, page)
      expect(entries.map(item => [item.paperTrack, item.frame, item.kind, item.text])).toEqual([['A', head, 'cell', '10'], ['B', head, 'blank', '']])
      for (const entry of entries) {
        expect(entry.textLayout.reference).toBeUndefined()
        const next = rectForHit(project, paper, projectTimingHitForFrame(paper, project, 'cell', entry.paperTrack, head + 1)!)!
        const line = lines.get(page.pageId)!.find(item => item.eventId === entry.eventId && Math.abs(item.path[0]!.x - (next.x + next.w / 2)) < 1e-8)!
        expect(line.kind).toBe(entry.kind === 'blank' ? 'wave' : 'straight')
        expect(line.path[0]!.y).toBeCloseTo(next.y + next.h / 2, 8)
      }
    }
    const key = project.logicalSheet.keys.find(key => key.displayLabel === '10')!
    const renamed = createSheetRenderModelContext(updateKey(project, key.keyId, { displayLabel: '０１０差分' }), paper)
    expect(renamed.pages.map(page => paperCellCarryItemsForPage(renamed, page)[0].text)).toEqual(['０１０差分', '０１０差分'])
    expect(JSON.stringify(project)).toBe(original)
  })

  it('keeps short holds legible with lines off, respects a new entry at the boundary, unused tracks and filters', () => {
    let project = write(sample(), 'A', 72, '01')
    project = write(project, 'A', 74, '02')
    project = write(project, 'B', 1, '1')
    project = setTimingSpecialEvent(project, 'B', 73, 'blank', 'cell')
    project = setTimingSpecialEvent(project, 'C', 72, 'inbetween', 'cell')
    project = setTimingSpecialEvent(project, 'D', 72, 'reverse', 'cell')
    project = write(project, 'E', 74, '1')
    project = updateSheetViewState(project, { continuationDisplay: { action: false, cell: false } })
    const ctx = createSheetRenderModelContext(project, paper), [page] = ctx.pages
    expect(paperCellCarryItemsForPage(ctx, page).map(item => [item.paperTrack, item.frame, item.text])).toEqual([['A', 73, '01']])
    expect(inputTextRenderItemsForPage(ctx, page).filter(item => item.frame === 73).map(item => item.kind)).toEqual(['blank'])
    expect(continuationRenderItemsForPages(ctx, [page]).get(page.pageId)).toEqual([])
    const filtered = { ...ctx, visibleKeyIds: new Set<string>() }
    expect(paperCellCarryItemsForPage(filtered, page)).toEqual([])
    expect(paperCellCarryItemsForPage(filtered, ctx.pages[1]).map(item => item.kind)).toEqual(['blank'])
    for (const template of [digitalStandardSheetTemplate, { ...paper, templateKind: 'digital-native' as const, layoutMode: 'paged-digital' as const }]) {
      const digital = createSheetRenderModelContext(project, template)
      expect(digital.pages.flatMap(p => paperCellCarryItemsForPage(digital, p))).toEqual([])
    }
  })

  it('uses template block ranges and the displayed page origin, including a hold from hidden pre-roll', () => {
    const template = { ...paper, regions: paper.regions.map(region => region.grid?.role !== 'cell' ? region : { ...region,
      grid: { ...region.grid, ...(region.grid.frameStart === 1 ? { frameEnd: 48, rowCount: 48 } : { frameStart: 49, rowCount: 96 }) } }) }
    const before = write(sample(), 'A', -1, 'hold')
    for (const [showPreRoll, expected] of [[false, [1, 49, 145]], [true, [25, 121]]] as const) {
      const project = updateLogicalSheetSettings(before, { workRange: { preRollFrames: 24, postRollFrames: 0, showPreRoll, showPostRoll: false } })
      const ctx = createSheetRenderModelContext(project, template)
      expect(ctx.pages.flatMap(page => paperCellCarryItemsForPage(ctx, page)).map(item => item.frame)).toEqual(expected)
    }
  })

  it('projects the same extra CEL column into its right block for entries, carry, range selections and pointer input', () => {
    const added = addOverlayPaperTrack(sample(), { paperTrack: 'J', insertAfterPaperTrack: 'I', sheetRole: 'cell', snapIndex: 10 })
    let project = write(added.project, 'J', 49, '10')
    project = write(project, 'J', 74, '11')
    const ctx = createSheetRenderModelContext(project, paper), [first, second] = ctx.pages
    const track = ctx.overlayTracks.find(item => item.paperTrack === 'J')!
    const range = overlayRangeRectsForPage(paper, project, track, 72, 74, first)
    expect(range).toHaveLength(2)
    expect(range[0].x).toBeLessThan(range[1].x)
    expect(range[1].h).toBeCloseTo(2 * range[0].h)
    const [carry] = paperCellCarryItemsForPage(ctx, first)
    expect(carry).toMatchObject({ frame: 73, text: '10', rect: { x: range[1].x, y: range[1].y } })
    expect(paperCellCarryItemsForPage(ctx, second)[0]).toMatchObject({ frame: 145, text: '11', rect: { x: range[0].x } })
    const entry = inputTextRenderItemsForPage(ctx, first).find(item => item.frame === 74)!
    expect(entry.rect.x).toBe(range[1].x)
    expect(eventRectsForPage(project, paper, first).find(item => item.event.frame === 74)?.rect).toEqual(entry.rect)
    expect(overlayHitFromPoint(paper, project, first, { x: entry.rect.x + entry.rect.w / 2, y: entry.rect.y + entry.rect.h / 2 }, 'J')).toMatchObject({ frame: 74, paperTrack: 'J' })
  })
})
