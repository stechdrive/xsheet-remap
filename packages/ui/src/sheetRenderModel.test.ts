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
  metadataTextRenderItemsForPage,
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

  it('resolves cut metadata, duration, and page numbers into template field rectangles', () => {
    const project = {
      ...createDefaultProject(),
      cut: {
        title: '作品タイトル',
        episode: '03',
        scene: '12',
        cut: '101',
        worker: '作業者A',
      },
      logicalSheet: {
        ...createDefaultProject().logicalSheet,
        durationFrames: 150,
      },
    }
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const firstPage = metadataTextRenderItemsForPage(context, context.pages[0])
    const secondPage = metadataTextRenderItemsForPage(context, context.pages[1])

    expect(Object.fromEntries(firstPage.map(item => [item.field, item.text]))).toEqual({
      title: '作品タイトル',
      episode: '03',
      cut: '101',
      duration: '06+06',
      worker: '作業者A',
      page: '1/2',
    })
    expect(secondPage.find(item => item.field === 'page')?.text).toBe('2/2')
    expect(firstPage.every(item => item.rect.w > 0 && item.fontSizePx > 0)).toBe(true)
  })

  it('renders other shared cut numbers only when the per-cut display option is enabled', () => {
    const base = createDefaultProject()
    const project = {
      ...base,
      sheetView: {
        ...base.sheetView,
        metadataDisplay: { sharedCutNumbers: true },
      },
    }
    const cutGroup = {
      activeCutId: 'cut_1',
      cuts: [
        { cutId: 'cut_1', order: 0, metadata: { cut: '001' } },
        { cutId: 'cut_2', order: 1, metadata: { cut: '002' } },
        { cutId: 'cut_3', order: 2, metadata: { cut: '003' } },
      ],
    }
    const visibleContext = createSheetRenderModelContext(project, standardA3SheetTemplate, { cutGroup })
    const visibleItems = metadataTextRenderItemsForPage(visibleContext, visibleContext.pages[0])
    const visibleCut = visibleItems.find(item => item.field === 'cut')

    expect(visibleItems.find(item => item.field === 'shared-cut-numbers')?.text).toBe('兼用 002・003')
    expect(visibleCut?.dominantBaseline).toBe('hanging')

    const hiddenProject = {
      ...project,
      sheetView: {
        ...project.sheetView,
        metadataDisplay: { sharedCutNumbers: false },
      },
    }
    const hiddenContext = createSheetRenderModelContext(hiddenProject, standardA3SheetTemplate, { cutGroup })
    const hiddenItems = metadataTextRenderItemsForPage(hiddenContext, hiddenContext.pages[0])

    expect(hiddenItems.some(item => item.field === 'shared-cut-numbers')).toBe(false)
    expect(hiddenItems.find(item => item.field === 'cut')?.dominantBaseline).toBe('central')
  })
})
