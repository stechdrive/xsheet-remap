import { describe, expect, it } from 'vitest'
import { cellRectForHit, createDefaultProject, createOrSetEvent, digitalStandardSheetTemplate, standardA3SheetTemplate, timingHitForFrame, updateLogicalSheetSettings } from '@xsheet-remap/core'
import { continuationRenderItemsForPage, continuationRenderItemsForPages, createSheetRenderModelContext, inputTextRenderItemsForPage } from './sheetRenderModel'

describe('dummy frame rendering', () => {
  it.each([standardA3SheetTemplate, digitalStandardSheetTemplate])('continues CELL holds into the tail on $templateId', template => {
    let project = updateLogicalSheetSettings(createDefaultProject(), {
      durationFrames: 72,
      workRange: { preRollFrames: 24, postRollFrames: 24, showPreRoll: false, showPostRoll: true },
    })
    const first = createOrSetEvent(project, 'A', 68, 'cell')
    const next = createOrSetEvent(first.project, 'A', 84, 'cell')
    project = next.project
    const firstEventId = project.logicalSheet.events.find(event => event.keyId === first.key.keyId)!.eventId
    const nextEventId = project.logicalSheet.events.find(event => event.keyId === next.key.keyId)!.eventId
    const context = createSheetRenderModelContext(project, template)
    const perPage = continuationRenderItemsForPages(context, context.pages)
    for (const page of context.pages) expect(perPage.get(page.pageId)).toEqual(continuationRenderItemsForPage(context, page))
    const tail = [...perPage.values()].flat().filter(item => item.eventId === firstEventId).at(-1)!
    const lastHoldHit = timingHitForFrame(template, 'cell', 'A', 83, 96, 1)!
    const rect = cellRectForHit(template, lastHoldHit, 96, 1)!
    expect(tail.path.at(-1)?.y).toBeGreaterThan(rect.y)
    expect(tail.path.at(-1)?.y).toBeLessThanOrEqual(rect.y + rect.h)
    expect([...perPage.values()].flat().some(item => item.eventId === nextEventId)).toBe(true)
    expect(context.pages.flatMap(page => inputTextRenderItemsForPage(context, page)).map(item => item.frame)).toEqual([68, 84])

    const hidden = createSheetRenderModelContext(updateLogicalSheetSettings(project, {
      workRange: { ...project.logicalSheet.workRange, showPostRoll: false },
    }), template)
    expect(hidden.pages.flatMap(page => inputTextRenderItemsForPage(hidden, page)).map(item => item.frame)).toEqual([68])
    expect([...continuationRenderItemsForPages(hidden, hidden.pages).values()].flat().some(item => item.eventId === nextEventId)).toBe(false)
  })
})
