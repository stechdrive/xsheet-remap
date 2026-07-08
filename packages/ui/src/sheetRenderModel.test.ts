import { describe, expect, it } from 'vitest'
import {
  NULL_CELL_KEY_ID,
  addOverlayPaperTrack,
  createDefaultProject,
  createOrSetEvent,
  createStackGuideLabel,
  digitalStandardSheetTemplate,
  setEvent,
  standardA3SheetTemplate,
} from '@xsheet-remap/core'
import {
  createSheetRenderModelContext,
  hasOverlayRenderContent,
  inputTextRenderItemsForPage,
  overlayPaperTrackRenderItems,
  stackGuideFlagRenderItemsForPage,
} from './sheetRenderModel'
import { defaultTimingTextFontSizePx } from './sheetTextLayout'

describe('sheet render model', () => {
  it('builds overlay column and stack-guide label items independently from canvas rendering', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      label: 'J',
      insertAfterPaperTrack: 'A',
      snapIndex: 1,
      sheetRole: 'action',
    })
    const bg = createStackGuideLabel(overlay.project, {
      label: 'BG',
      kind: 'background',
      displayRole: 'action',
      insertAfterPaperTrack: 'A',
      gapIndex: 1,
    })
    const context = createSheetRenderModelContext(bg.project, standardA3SheetTemplate)
    const [page] = context.pages

    expect(context.paperTracks).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'])
    expect(context.overlayTracks.map(track => track.paperTrack)).toEqual(['J'])
    expect(hasOverlayRenderContent(context)).toBe(true)
    expect(overlayPaperTrackRenderItems(context, page).map(item => item.track.paperTrack)).toEqual(['J'])

    const stackGuideItems = stackGuideFlagRenderItemsForPage(context, page)
    expect(stackGuideItems).toHaveLength(1)
    expect(stackGuideItems[0]).toMatchObject({ label: 'BG', color: '#315bdc', align: 'start' })
    expect(stackGuideItems[0].geometry.labelWidth).toBeGreaterThan(0)
  })

  it('builds text items for standard tracks, overlay tracks, and null cells', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      label: 'J',
      insertAfterPaperTrack: 'A',
      snapIndex: 1,
      sheetRole: 'action',
    })
    const a = createOrSetEvent(overlay.project, 'A', 1, 'action')
    const j = createOrSetEvent(a.project, 'J', 2, 'action')
    const withNull = setEvent(j.project, 'B', 3, NULL_CELL_KEY_ID, 'action')
    const context = createSheetRenderModelContext(withNull, standardA3SheetTemplate)
    const items = inputTextRenderItemsForPage(context, context.pages[0])

    expect(items.map(item => [item.paperTrack, item.frame, item.text])).toEqual(expect.arrayContaining([
      ['A', 1, '1'],
      ['J', 2, '1'],
      ['B', 3, 'x'],
    ]))
    expect(items).toHaveLength(3)
    expect(items.every(item => item.rect.w > 0 && item.rect.h > 0)).toBe(true)
    expect(items.every(item => item.fontSizePx === defaultTimingTextFontSizePx(standardA3SheetTemplate, 'action'))).toBe(true)
  })

  it('resolves input text font size from the active display template', () => {
    const project = createOrSetEvent(createDefaultProject(), 'A', 1, 'action').project
    const context = createSheetRenderModelContext(project, digitalStandardSheetTemplate)
    const items = inputTextRenderItemsForPage(context, context.pages[0])

    expect(items).toHaveLength(1)
    expect(items[0]?.fontSizePx).toBe(defaultTimingTextFontSizePx(digitalStandardSheetTemplate, 'action'))
  })
})
