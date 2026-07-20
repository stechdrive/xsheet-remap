import { describe, expect, it } from 'vitest'
import {
  NULL_CELL_KEY_ID,
  addOverlayPaperTrack,
  createDefaultProject,
  createOrSetEvent,
  createStackGuideLabel,
  digitalStandardSheetTemplate,
  setEvent,
  setTimingSpecialEvent,
  standardA3SheetTemplate,
  updateLogicalSheetSettings,
  updateSheetFormField,
  updateSheetViewState,
} from '@xsheet-remap/core'
import {
  createSheetRenderModelContext,
  continuationRenderItemsForPage,
  hasOverlayRenderContent,
  inputTextRenderItemsForPage,
  metadataTextRenderItemsForPage,
  overlayPaperTrackRenderItems,
  sheetContinuationPathData,
  stackGuideFlagRenderItemsForPage,
  workRangeShadeRenderItemsForPage,
} from './sheetRenderModel'
import { defaultTimingTextFontSizePx } from './sheetTextLayout'
import type { TextMeasurementProvider } from './textMetrics'

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
      label: 'BOOK_BACKGROUND_REFERENCE_LAYER_01',
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
    const overlayItems = overlayPaperTrackRenderItems(context, page)
    expect(overlayItems.map(item => item.track.paperTrack)).toEqual(['J'])
    expect(overlayItems[0]?.column.rowLineRules).toEqual([
      { every: 24, weight: 'strong' },
      { every: 12, weight: 'medium' },
      { every: 6, weight: 'regular' },
    ])

    const stackGuideItems = stackGuideFlagRenderItemsForPage(context, page)
    expect(stackGuideItems).toHaveLength(1)
    expect(stackGuideItems[0]).toMatchObject({
      label: 'BOOK_BACKGROUND_REFERENCE_LAYER_01',
      color: '#315bdc',
      align: 'start',
      geometry: {
        displayText: 'BOOK_BACKGROUND_REFERENCE_LAYER_01',
        truncated: false,
      },
    })
    expect(stackGuideItems[0].geometry.labelWidth).toBeGreaterThan(0)
  })

  it('builds input items for standard tracks, overlay tracks, and SVG timing symbols', () => {
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
      ['B', 3, ''],
    ]))
    expect(items.find(item => item.paperTrack === 'B')).toMatchObject({ kind: 'blank' })
    expect(items).toHaveLength(3)
    expect(items.every(item => item.rect.w > 0 && item.rect.h > 0)).toBe(true)
    expect(items.every(item => item.fontSizePx === defaultTimingTextFontSizePx(standardA3SheetTemplate, 'action'))).toBe(true)
  })

  it('projects ACTION and CELL events once when an A3 page folds between frames 72 and 73', () => {
    let project = createDefaultProject()
    for (const role of ['action', 'cell'] as const) {
      for (const frame of [70, 73]) project = createOrSetEvent(project, 'A', frame, role).project
    }
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const items = inputTextRenderItemsForPage(context, context.pages[0])

    expect(items).toHaveLength(4)
    expect(new Set(items.map(item => item.eventId)).size).toBe(4)
    for (const role of ['action', 'cell'] as const) {
      const roleEventIds = project.logicalSheet.events
        .filter(event => event.sheetRole === role)
        .map(event => event.eventId)
      const roleItems = items.filter(item => roleEventIds.includes(item.eventId)).sort((left, right) => left.frame - right.frame)
      expect(roleItems.map(item => item.frame)).toEqual([70, 73])
      expect(roleItems[0]?.rect.x).not.toBe(roleItems[1]?.rect.x)
    }
  })

  it('shares out-of-duration shading geometry between paper and digital templates including dummy frames', () => {
    const shortened = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 72 })
    const paperContext = createSheetRenderModelContext(shortened, standardA3SheetTemplate)
    expect(paperContext.pages.flatMap(page => workRangeShadeRenderItemsForPage(paperContext, page))).toHaveLength(4)

    const withDummyFrames = updateLogicalSheetSettings(shortened, {
      workRange: { ...shortened.logicalSheet.workRange, showPreRoll: true },
    })
    const paperDummyContext = createSheetRenderModelContext(withDummyFrames, standardA3SheetTemplate)
    expect(paperDummyContext.pages.flatMap(page => workRangeShadeRenderItemsForPage(paperDummyContext, page))).toHaveLength(8)

    const digitalContext = createSheetRenderModelContext(withDummyFrames, digitalStandardSheetTemplate)
    const digitalShade = digitalContext.pages.flatMap(page => workRangeShadeRenderItemsForPage(digitalContext, page))
    expect(new Set(digitalShade.map(item => item.regionId)).size).toBeGreaterThanOrEqual(4)
    expect(digitalShade.every(item => item.rect.w > 0 && item.rect.h > 0)).toBe(true)
  })

  it('derives optional straight and wave continuation geometry from explicit events', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 5, 'action')
    const blank = setTimingSpecialEvent(second.project, 'B', 1, 'blank', 'action')
    const endBlank = createOrSetEvent(blank, 'B', 5, 'action').project
    const project = updateSheetViewState(endBlank, {
      continuationDisplay: { action: true, cell: false },
    })
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const items = continuationRenderItemsForPage(context, context.pages[0])

    expect(items.map(item => [item.paperTrack, item.kind])).toEqual(expect.arrayContaining([
      ['A', 'straight'],
      ['B', 'wave'],
    ]))
    expect(items.every(item => item.path.length >= 2 && item.strokeWidth > 0)).toBe(true)
    const straight = items.find(item => item.kind === 'straight')
    const wave = items.find(item => item.kind === 'wave')
    expect(straight?.path.map(command => command.kind)).toEqual(['move', 'line'])
    expect(wave?.path[0]?.kind).toBe('move')
    expect(wave?.path.slice(1).every(command => command.kind === 'cubic')).toBe(true)
    expect(sheetContinuationPathData(wave?.path ?? [])).toMatch(/^M .* C /)
    expect(sheetContinuationPathData(wave?.path ?? [])).not.toContain(' L ')
    const hiddenContext = createSheetRenderModelContext(updateSheetViewState(project, {
      continuationDisplay: { action: false, cell: false },
    }), standardA3SheetTemplate)
    const hidden = continuationRenderItemsForPage(hiddenContext, hiddenContext.pages[0])
    expect(hidden).toHaveLength(0)
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

  it('renders digital built-in metadata from the same form fields used for editing', () => {
    const source = createDefaultProject()
    const project = {
      ...source,
      cut: { title: '作品タイトル', episode: '03', scene: '12', cut: '101', worker: '作業者A' },
      logicalSheet: { ...source.logicalSheet, durationFrames: 150 },
    }
    const context = createSheetRenderModelContext(project, digitalStandardSheetTemplate)
    const items = metadataTextRenderItemsForPage(context, context.pages[0])

    expect(Object.fromEntries(items.map(item => [item.field, item.text]))).toEqual({
      title: '作品タイトル',
      episode: '03',
      scene: '12',
      cut: '101',
      duration: '06+06',
      worker: '作業者A',
      page: '1/1',
    })
    expect(items.every(item => item.regionId.startsWith('digital_metadata_form:'))).toBe(true)
  })

  it('renders wrapped A3 memo text independently for each physical page', () => {
    const memo = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const extended = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 288 })
    const firstText = `1ページ目\n${'メ'.repeat(100)}`
    const first = updateSheetFormField(extended, memo, firstText, 'page_1')
    const project = updateSheetFormField(first, memo, '2ページ目', 'page_2')
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const firstMemo = metadataTextRenderItemsForPage(context, context.pages[0]).find(item => item.field === 'memo.body')
    const secondMemo = metadataTextRenderItemsForPage(context, context.pages[1]).find(item => item.field === 'memo.body')

    expect(firstMemo).toMatchObject({ text: firstText, textAnchor: 'start', dominantBaseline: 'text-before-edge' })
    expect(firstMemo?.lines[0]).toBe('1ページ目')
    expect(firstMemo?.lines.length).toBeGreaterThan(2)
    expect(secondMemo).toMatchObject({ text: '2ページ目', lines: ['2ページ目'] })
    expect(firstMemo?.rect).toEqual(secondMemo?.rect)
  })

  it('shrinks multiline form text vertically and reports unavoidable overflow', () => {
    const memo = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const fittingProject = updateSheetFormField(createDefaultProject(), memo, 'メ'.repeat(1800), 'page_1')
    const fittingContext = createSheetRenderModelContext(fittingProject, standardA3SheetTemplate)
    const fittingMemo = metadataTextRenderItemsForPage(fittingContext, fittingContext.pages[0])
      .find(item => item.field === 'memo.body')

    expect(fittingMemo?.fontSizePx).toBeGreaterThanOrEqual(10)
    expect(fittingMemo?.fontSizePx).toBeLessThan(16)
    expect(fittingMemo?.overflow).toBe(false)

    const overflowingProject = updateSheetFormField(createDefaultProject(), memo, 'メ'.repeat(4000), 'page_1')
    const overflowingContext = createSheetRenderModelContext(overflowingProject, standardA3SheetTemplate)
    const overflowingMemo = metadataTextRenderItemsForPage(overflowingContext, overflowingContext.pages[0])
      .find(item => item.field === 'memo.body')

    expect(overflowingMemo).toMatchObject({ fontSizePx: 10, overflow: true })
  })

  it('resolves physical form typography at the paper template DPI for display and export models', () => {
    const memo = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const project = updateSheetFormField(createDefaultProject(), memo, 'DPI追従', 'page_1')
    const template300 = {
      ...standardA3SheetTemplate,
      page: {
        ...standardA3SheetTemplate.page,
        widthPx: standardA3SheetTemplate.page.widthPx * 2,
        heightPx: standardA3SheetTemplate.page.heightPx * 2,
        dpi: 300,
      },
    }
    const context = createSheetRenderModelContext(project, template300)
    const item = metadataTextRenderItemsForPage(context, context.pages[0])
      .find(candidate => candidate.field === 'memo.body')

    expect(context.pageSize).toMatchObject({ widthPx: 3508, heightPx: 4962 })
    expect(item).toMatchObject({ fontSizePx: 32, lineHeightPx: 40, overflow: false })
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

    expect(visibleItems.find(item => item.field === 'shared-cut-numbers')).toMatchObject({
      text: '[002・003]',
      lines: ['[002・003]'],
    })
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

  it('wraps shared cut numbers by label and keeps the bracket pair around the whole group', () => {
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
        ...['002', '003', '004', '005', '006', '007'].map((cut, index) => ({
          cutId: `cut_${index + 2}`,
          order: index + 1,
          metadata: { cut },
        })),
      ],
    }
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate, { cutGroup })
    const shared = metadataTextRenderItemsForPage(context, context.pages[0]).find(item => item.field === 'shared-cut-numbers')

    expect(shared?.lines.length).toBeGreaterThan(1)
    expect(shared?.lines[0]?.startsWith('[')).toBe(true)
    expect(shared?.lines.at(-1)?.endsWith(']')).toBe(true)
    expect(shared?.lines.flatMap(line => line.match(/\d+/g) ?? [])).toEqual(['002', '003', '004', '005', '006', '007'])
  })

  it('uses measured glyph widths for shared-cut wrapping and allows vertical overflow only to the page edge', () => {
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
        ...Array.from({ length: 40 }, (_, index) => ({
          cutId: `cut_${index + 2}`,
          order: index + 1,
          metadata: { cut: `W${String(index + 2).padStart(2, '0')}` },
        })),
      ],
    }
    const measurement: TextMeasurementProvider = {
      measure(text, font) {
        return {
          widthPx: Array.from(text).length * font.sizePx,
          ascentPx: font.sizePx * 0.8,
          descentPx: font.sizePx * 0.2,
          exact: true,
        }
      },
    }
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate, { cutGroup })
    const shared = metadataTextRenderItemsForPage(context, context.pages[0], measurement)
      .find(item => item.field === 'shared-cut-numbers')

    expect(shared).toBeTruthy()
    const fieldWidthPx = shared!.rect.w * context.pageSize.widthPx
    expect(shared!.lines.every(line => measurement.measure(line, {
      family: 'test',
      sizePx: shared!.fontSizePx,
      weight: shared!.fontWeight,
    }).widthPx <= fieldWidthPx)).toBe(true)
    expect(shared).toMatchObject({
      overflow: true,
      clipRect: { x: shared!.rect.x, y: 0, w: shared!.rect.w, h: 1 },
    })
  })

  it('falls back to the lower half of the CUT field when no shared-cut region is defined', () => {
    const base = createDefaultProject()
    const project = {
      ...base,
      sheetView: {
        ...base.sheetView,
        metadataDisplay: { sharedCutNumbers: true },
      },
    }
    const template = {
      ...standardA3SheetTemplate,
      templateId: 'test-cut-field-fallback',
      regions: standardA3SheetTemplate.regions.filter(region => region.binding?.target !== 'cut-group'),
    }
    const cutGroup = {
      activeCutId: 'cut_1',
      cuts: [
        { cutId: 'cut_1', order: 0, metadata: { cut: '001' } },
        { cutId: 'cut_2', order: 1, metadata: { cut: '002' } },
      ],
    }
    const context = createSheetRenderModelContext(project, template, { cutGroup })
    const items = metadataTextRenderItemsForPage(context, context.pages[0])
    const cut = items.find(item => item.field === 'cut')
    const shared = items.find(item => item.field === 'shared-cut-numbers')

    expect(shared).toMatchObject({ text: '[002]', lines: ['[002]'] })
    expect(shared?.regionId).toBe('top_cut_field__shared_cut_numbers')
    expect(shared?.rect.y).toBeGreaterThan(cut?.rect.y ?? 0)
    expect(cut?.dominantBaseline).toBe('hanging')
  })
})
