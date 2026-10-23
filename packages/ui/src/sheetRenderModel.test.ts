import { describe, expect, it } from 'vitest'
import {
  NULL_CELL_KEY_ID,
  addOverlayPaperTrack,
  createDefaultProject,
  createAlphabeticTrackLabels,
  updateProjectPaperTracks,
  updatePaperTrack,
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
  continuationRenderItemsForPages,
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
import { eventRectsForPages, overlayColumnRectForPage, overlayHitFromPoint, projectTimingHitForFrame, rectForHit } from './sheet-layers-hit-geometry'
import { overlayBandSegments, overlayPaperTracks } from './app-sheet-geometry'

describe('sheet render model', () => {
  it.each(['action', 'cell'] as const)('places imported %s overflow at its grid edge with matching content and input ownership', role => {
    const original = createOrSetEvent(updateProjectPaperTracks(createDefaultProject(), createAlphabeticTrackLabels(12)), 'J', 1, role).project
    const project = { ...original, logicalSheet: { ...original.logicalSheet, paperTracks: original.logicalSheet.paperTracks.map(track => ({ ...track, viewPlacement: { sheetRole: role } })) } }
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate), page = context.pages[0]
    const track = context.overlayTracks[0], segment = overlayBandSegments(standardA3SheetTemplate, project, role)[0]
    const column = overlayColumnRectForPage(standardA3SheetTemplate, project, track, page)!
    const event = inputTextRenderItemsForPage(context, page).find(item => item.paperTrack === 'J')!
    const hit = overlayHitFromPoint(standardA3SheetTemplate, project, page, { x: event.rect.x + event.rect.w / 2, y: event.rect.y + event.rect.h / 2 }, 'J')!
    expect(context.overlayTracks.map(track => track.paperTrack)).toEqual(['J', 'K', 'L'])
    expect(column.rect.x).toBeCloseTo(segment.rect.x + segment.rect.w)
    expect(event.rect.x).toBe(column.rect.x)
    expect(hit).toMatchObject({ role, paperTrack: 'J', frame: 1 })
    const destination = projectTimingHitForFrame(standardA3SheetTemplate, project, role, 'J', 1)!
    expect(destination).toMatchObject({ role, paperTrack: 'J' })
    expect(rectForHit(project, standardA3SheetTemplate, destination)).toEqual(event.rect)
  })

  it('uses each role capacity and keeps a same-named visible CELL event out of the ACTION overlay', () => {
    const template = { ...standardA3SheetTemplate, templateId: 'action-six-cell-nine', regions: standardA3SheetTemplate.regions.map(region => region.grid?.role === 'action' && region.grid.trackProjection
      ? { ...region, grid: { ...region.grid, columns: region.grid.columns.slice(0, 6) } } : region) }
    let project = updateProjectPaperTracks(createDefaultProject(), createAlphabeticTrackLabels(12))
    project = { ...project, logicalSheet: { ...project.logicalSheet, paperTracks: project.logicalSheet.paperTracks.map(track => ({ ...track, viewPlacement: { sheetRole: 'action' as const } })) } }
    project = createOrSetEvent(createOrSetEvent(project, 'G', 1, 'action').project, 'G', 1, 'cell').project
    const context = createSheetRenderModelContext(project, template), page = context.pages[0]
    expect(overlayPaperTracks(project, template).map(track => track.paperTrack)).toEqual(['G', 'H', 'I', 'J', 'K', 'L'])
    const content = inputTextRenderItemsForPage(context, page)
    const action = content.find(item => item.sheetRole === 'action')!, cell = content.find(item => item.sheetRole === 'cell')!
    expect(action.rect.x).not.toBe(cell.rect.x)
    for (const role of ['action', 'cell'] as const) {
      const destination = projectTimingHitForFrame(template, project, role, 'G', 1)!
      expect(rectForHit(project, template, destination)).toEqual(content.find(item => item.sheetRole === role)!.rect)
    }
    const events = eventRectsForPages(project, template, [page]).get(page.pageId)!
    expect(events.find(item => item.event.sheetRole === 'cell')!.rect).toEqual(cell.rect)
    expect(events.find(item => item.event.sheetRole === 'action')!.rect).toEqual(action.rect)
  })
  it('keeps imported overflow flags, expanded content and hit geometry together after moving and restoring a paper template', () => {
    const original = createOrSetEvent(updateProjectPaperTracks(createDefaultProject(), createAlphabeticTrackLabels(12)), 'J', 1, 'cell').project
    const positions: number[] = []
    for (const snapIndex of [2, 7]) {
      const moved = updatePaperTrack(original, 'J', { viewPlacement: { templateId: standardA3SheetTemplate.templateId, sheetRole: 'cell', snapIndex, expanded: true } })
      const project = JSON.parse(JSON.stringify(moved)) as typeof moved
      const digital = createSheetRenderModelContext(project, digitalStandardSheetTemplate)
      expect(digital.overlayTracks).toEqual([])
      const context = createSheetRenderModelContext(project, standardA3SheetTemplate), page = context.pages[0]
      const flag = overlayPaperTrackRenderItems(context, page).find(item => item.track.paperTrack === 'J')!
      const track = project.logicalSheet.paperTracks.find(track => track.paperTrack === 'J')!
      const expanded = overlayColumnRectForPage(standardA3SheetTemplate, project, track, page)!
      const content = inputTextRenderItemsForPage(context, page).find(item => item.paperTrack === 'J')!
      const hits = eventRectsForPages(project, standardA3SheetTemplate, [page], { activeOverlayPaperTrack: 'J' }).get(page.pageId)!
      expect(flag.column.rect.x).toBe(expanded.rect.x)
      expect(content.rect.x).toBe(expanded.rect.x)
      expect(hits.find(item => item.event.paperTrack === 'J')?.rect.x).toBe(expanded.rect.x)
      positions.push(flag.column.rect.x)
    }
    expect(positions[0]).not.toBe(positions[1])
    const context = createSheetRenderModelContext(original, standardA3SheetTemplate)
    expect(overlayPaperTrackRenderItems(context, context.pages[0])[0].column.rect.x).not.toBe(positions[0])
  })
  it('filters process text and holds without changing the next exposure boundary or source events', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 8, 'action')
    const project = updateSheetViewState(second.project, { continuationDisplay: { action: true, cell: true } })
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const full = continuationRenderItemsForPages(context, context.pages).get('page_1')!
    const filtered = { ...context, visibleKeyIds: new Set([first.key.keyId]) }
    expect(inputTextRenderItemsForPage(filtered, filtered.pages[0]).map(item => item.keyId)).toEqual([first.key.keyId])
    expect(continuationRenderItemsForPages(filtered, filtered.pages).get('page_1')).toEqual(full.filter(item => item.eventId === project.logicalSheet.events[0].eventId))
    expect(project.logicalSheet.events).toHaveLength(2)
    expect(continuationRenderItemsForPages(context, context.pages).get('page_1')).toEqual(full)
  })
  it('reprojects a changed hold while retaining unrelated column geometry across edits and undo', () => {
    let project = createOrSetEvent(createDefaultProject(), 'A', 1).project
    project = createOrSetEvent(project, 'B', 1).project
    project = updateSheetViewState(project, { continuationDisplay: { action: true, cell: true } })
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    const before = continuationRenderItemsForPages(context, context.pages).get('page_1')!
    const edited = createOrSetEvent(project, 'A', 24).project
    const after = continuationRenderItemsForPages({ ...context, project: edited }, context.pages).get('page_1')!
    expect(after.find(item => item.paperTrack === 'A')).not.toBe(before.find(item => item.paperTrack === 'A'))
    const oldB = before.filter(item => item.paperTrack === 'B')
    after.filter(item => item.paperTrack === 'B').forEach((item, index) => expect(item).toBe(oldB[index]))
    expect(continuationRenderItemsForPages(context, context.pages).get('page_1')).toEqual(before)
  })
  it('clips long continuation waves without changing their phase or visible cubic geometry', () => {
    let project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 14_400 })
    project = updateSheetViewState(project, { continuationDisplay: { action: true, cell: true } })
    project = setTimingSpecialEvent(project, 'A', 1, 'blank')
    const context = createSheetRenderModelContext(project, digitalStandardSheetTemplate)
    const full = continuationRenderItemsForPages(context, context.pages).get('page_1')!
    const clipped = continuationRenderItemsForPages(context, context.pages, { top: 0.4, bottom: 0.41 }).get('page_1')!
    expect(clipped.length).toBe(1)
    expect(clipped[0]!.path.length).toBeLessThan(full[0]!.path.length / 50)
    const fullCurves = full[0]!.path.filter(command => command.kind === 'cubic')
    const clippedCurves = clipped[0]!.path.filter(command => command.kind === 'cubic')
    expect(clippedCurves.length).toBeGreaterThan(1)
    expect(clippedCurves).toEqual(fullCurves.filter(command => clippedCurves.some(candidate => candidate.y === command.y)))
  })
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

  it('draws only the three frames after an ACTION key when its hold lasts at least four frames', () => {
    const exactHoldStart = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const exactHoldEnd = createOrSetEvent(exactHoldStart.project, 'A', 5, 'action')
    const exactContext = createSheetRenderModelContext(exactHoldEnd.project, standardA3SheetTemplate)
    const exactItem = continuationItemForKey(exactContext, exactHoldStart.key.keyId)

    const longHoldStart = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const longHoldEnd = createOrSetEvent(longHoldStart.project, 'A', 20, 'action')
    const longContext = createSheetRenderModelContext(longHoldEnd.project, standardA3SheetTemplate)
    const longItem = continuationItemForKey(longContext, longHoldStart.key.keyId)

    const shortHoldStart = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const shortHoldEnd = createOrSetEvent(shortHoldStart.project, 'A', 4, 'action')
    const shortContext = createSheetRenderModelContext(shortHoldEnd.project, standardA3SheetTemplate)
    const shortItem = continuationItemForKey(shortContext, shortHoldStart.key.keyId)

    expect(exactItem).toMatchObject({ kind: 'straight' })
    expect(longItem?.path).toEqual(exactItem?.path)
    expect(shortItem).toBeUndefined()
  })

  it('keeps CELL continuation lines across their full hold', () => {
    const start = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const end = createOrSetEvent(start.project, 'A', 20, 'cell')
    const context = createSheetRenderModelContext(end.project, standardA3SheetTemplate)
    const item = continuationItemForKey(context, start.key.keyId)

    const exactStart = createOrSetEvent(createDefaultProject(), 'A', 1, 'cell')
    const exactEnd = createOrSetEvent(exactStart.project, 'A', 5, 'cell')
    const exactContext = createSheetRenderModelContext(exactEnd.project, standardA3SheetTemplate)
    const exactItem = continuationItemForKey(exactContext, exactStart.key.keyId)

    expect(item).toMatchObject({ role: 'cell', kind: 'straight' })
    expect(item?.path.at(-1)?.y).toBeGreaterThan(exactItem?.path.at(-1)?.y ?? Number.POSITIVE_INFINITY)
  })

  it('keeps each ACTION continuation frame visible across a grid fold', () => {
    const straightStart = createOrSetEvent(createDefaultProject(), 'A', 70, 'action')
    const straightEnd = createOrSetEvent(straightStart.project, 'A', 80, 'action')
    const straightContext = createSheetRenderModelContext(straightEnd.project, standardA3SheetTemplate)
    const straightItems = continuationItemsForKey(straightContext, straightStart.key.keyId)

    const blankProject = setTimingSpecialEvent(createDefaultProject(), 'A', 70, 'blank', 'action')
    const blankEnd = createOrSetEvent(blankProject, 'A', 80, 'action')
    const blankContext = createSheetRenderModelContext(blankEnd.project, standardA3SheetTemplate)
    const blankItems = continuationItemsForKey(blankContext, NULL_CELL_KEY_ID)

    expect(straightItems).toHaveLength(2)
    expect(straightItems.every(item => item.path.length >= 2 && item.path[0]?.y !== item.path.at(-1)?.y)).toBe(true)
    expect(blankItems).toHaveLength(2)
    expect(blankItems.every(item => item.path.some(command => command.kind === 'cubic'))).toBe(true)
  })

  it('preserves exact continuation geometry when calculating all visible pages in one pass', () => {
    let project = updateLogicalSheetSettings(createDefaultProject(), {
      durationFrames: 360,
      workRange: {
        preRollFrames: 24,
        postRollFrames: 24,
        showPreRoll: true,
        showPostRoll: true,
      },
    })
    project = createOrSetEvent(project, 'A', -20, 'action').project
    project = createOrSetEvent(project, 'A', 1, 'action').project
    project = setTimingSpecialEvent(project, 'B', 138, 'blank', 'action')
    project = createOrSetEvent(project, 'B', 150, 'action').project
    project = createOrSetEvent(project, 'C', 140, 'cell').project
    project = setTimingSpecialEvent(project, 'C', 145, 'inbetween', 'cell')
    project = setTimingSpecialEvent(project, 'C', 152, 'reverse', 'cell')
    project = createOrSetEvent(project, 'C', 160, 'cell').project
    project = createOrSetEvent(project, 'D', 280, 'cell').project
    project = updateSheetViewState(project, {
      continuationDisplay: { action: true, cell: true },
    })
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)

    const allPages = continuationRenderItemsForPages(context, context.pages)
    for (const page of context.pages) {
      expect(allPages.get(page.pageId)).toEqual(continuationRenderItemsForPage(context, page))
    }

    const middlePage = context.pages[1]
    expect(middlePage).toBeDefined()
    const middleOnly = continuationRenderItemsForPages(context, [middlePage!])
    expect(middleOnly.get(middlePage!.pageId)).toEqual(continuationRenderItemsForPage(context, middlePage!))
    expect(middleOnly.size).toBe(1)

    const digitalContext = createSheetRenderModelContext(project, digitalStandardSheetTemplate)
    const digitalItems = continuationRenderItemsForPages(digitalContext, digitalContext.pages)
    for (const page of digitalContext.pages) {
      expect(digitalItems.get(page.pageId)).toEqual(continuationRenderItemsForPage(digitalContext, page))
    }

    const overlay = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      label: 'J',
      insertAfterPaperTrack: 'A',
      snapIndex: 1,
      sheetRole: 'action',
    })
    const overlayStart = createOrSetEvent(overlay.project, 'J', 1, 'action')
    const overlayEnd = createOrSetEvent(overlayStart.project, 'J', 12, 'action')
    const overlayProject = updateSheetViewState(overlayEnd.project, {
      continuationDisplay: { action: true, cell: false },
    })
    const overlayContext = createSheetRenderModelContext(overlayProject, standardA3SheetTemplate)
    const overlayItems = continuationRenderItemsForPages(overlayContext, overlayContext.pages)
    for (const page of overlayContext.pages) {
      expect(overlayItems.get(page.pageId)).toEqual(continuationRenderItemsForPage(overlayContext, page))
    }
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

  it('renders a page field default only where that page has no stored value', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const definition = template.fields?.find(field => field.fieldId === 'memo.body')
    if (!definition) throw new Error('memo field definition not found')
    definition.defaultValue = 'ページメモ未記入'

    const memo = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const extended = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 432 })
    const withFirstPage = updateSheetFormField(extended, memo, '1ページの保存値', 'page_1')
    const project = updateSheetFormField(withFirstPage, memo, '', 'page_2')
    const context = createSheetRenderModelContext(project, template)
    const memoForPage = (pageIndex: number) => metadataTextRenderItemsForPage(context, context.pages[pageIndex])
      .find(item => item.field === 'memo.body')

    expect(memoForPage(0)?.text).toBe('1ページの保存値')
    expect(memoForPage(1)).toBeUndefined()
    expect(memoForPage(2)?.text).toBe('ページメモ未記入')
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
    expect(visibleCut?.dominantBaseline).toBe('alphabetic')

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

  it('uses measured glyph widths for shared-cut wrapping and bounds overflowing shared-cut lists to the allocated field', () => {
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
      clipRect: shared!.rect,
    })
  })

  it('allocates shared-cut text inside the CUT field when no shared-cut region is defined', () => {
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
    expect(cut?.dominantBaseline).toBe('alphabetic')
  })
})

function continuationItemForKey(
  context: ReturnType<typeof createSheetRenderModelContext>,
  keyId: string,
) {
  return continuationItemsForKey(context, keyId)[0]
}

function continuationItemsForKey(
  context: ReturnType<typeof createSheetRenderModelContext>,
  keyId: string,
) {
  const eventId = context.project.logicalSheet.events.find(event => event.keyId === keyId)?.eventId
  return continuationRenderItemsForPage(context, context.pages[0]).filter(item => item.eventId === eventId)
}
