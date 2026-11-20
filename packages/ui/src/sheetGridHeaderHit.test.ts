import { expect, it } from 'vitest'
import { createDefaultProject, digitalStandardSheetTemplate, projectSheetLayoutOptions, resolveSheetTemplateGridLayout, standardA3SheetTemplate } from '@xsheet-remap/core'
import { buildTemplateChromeRenderModel } from './templateEditorGeometry'
import { gridColumnHeaderHitFromPoint } from './sheetGridHeaderHit'

it.each([standardA3SheetTemplate, digitalStandardSheetTemplate])('hits the rendered title and column rows without stealing adjacent roles: $templateId', template => {
  const project = createDefaultProject()
  const resolved = projectSheetLayoutOptions(project, template)
  const options = { ...resolved, timelineLanes: resolved.timelineLanes, layoutOverrides: resolved.layoutOverrides }
  const chrome = buildTemplateChromeRenderModel(template, [], undefined, options)
  for (const header of chrome.headers) {
    const region = template.regions.find(item => item.regionId === header.regionId)
    if (!region?.grid || !['action', 'cell', 'sound', 'camera'].includes(region.grid.role)) continue
    const layout = resolveSheetTemplateGridLayout(template, region, options)!
    const point = { x: header.rect.x + header.rect.w / 2, y: header.rect.y + header.rect.h / 2 }
    const hitOptions = { ...options, template, point, roles: [region.grid.role], paperTracks: project.logicalSheet.paperTracks.map(track => track.paperTrack), durationFrames: 144, frameOrigin: 1, includeTitle: true }
    expect(gridColumnHeaderHitFromPoint(hitOptions)).toMatchObject({ part: 'title', hit: { role: region.grid.role, regionId: region.regionId } })
    expect(gridColumnHeaderHitFromPoint({ ...hitOptions, point: { x: point.x, y: layout.rect.y + layout.rect.h / 10 } })).toBeNull()
    expect(gridColumnHeaderHitFromPoint({ ...hitOptions, point: { x: layout.rect.x - 0.0001, y: point.y } })).toBeNull()
    expect(gridColumnHeaderHitFromPoint({ ...hitOptions, includeTitle: false })).toBeNull()
  }
})

it.each([standardA3SheetTemplate, digitalStandardSheetTemplate])('lets the visible vertical glyphs open the column menu above the column border: $templateId', template => {
  const names = ['口パク差し替え用ー確認', 'B', 'C']
  const options = projectSheetLayoutOptions(createDefaultProject(), template)
  const chrome = buildTemplateChromeRenderModel(template, names, 144)
  const header = chrome.headers.find(h => h.regionId.endsWith('_cell_grid'))!
  const column = header.columns[0]
  const glyph = column.glyphs![0]
  const point = { x: glyph.xPx / chrome.pageSize.widthPx, y: (glyph.yPx - column.fontSizePx / 2) / chrome.pageSize.heightPx }
  expect(point.y).toBeLessThan(header.columnHeaderRect.y)
  if (template.page.isPhysical) expect(point.y).toBeLessThan(header.rect.y)
  expect(gridColumnHeaderHitFromPoint({ template, point, paperTracks: names, timelineLanes: options.timelineLanes, layoutOverrides: options.layoutOverrides,
    durationFrames: 144, frameOrigin: 1, roles: ['cell'], includeTitle: true })).toMatchObject({ part: 'column', hit: { paperTrack: names[0] } })
  expect(column.glyphs!.every(g => g.yPx < (header.columnHeaderRect.y + header.columnHeaderRect.h) * chrome.pageSize.heightPx)).toBe(true)
  expect(header.columns[1].glyphs).toBeUndefined()
})

it('honors custom pixel header dimensions at every viewport scale', () => {
  const template = { ...digitalStandardSheetTemplate, regions: digitalStandardSheetTemplate.regions.map(region => region.grid?.role === 'sound'
    ? { ...region, grid: { ...region.grid, header: { ...region.grid.header, topOffsetPx: 90, heightPx: 60, columnHeightPx: 30 } } } : region) }
  const project = createDefaultProject()
  const resolved = projectSheetLayoutOptions(project, template)
  const options = { ...resolved, timelineLanes: resolved.timelineLanes, layoutOverrides: resolved.layoutOverrides }
  const region = template.regions.find(item => item.grid?.role === 'sound')!
  const layout = resolveSheetTemplateGridLayout(template, region, options)!
  for (const viewportHeightPx of [500, 1000, 4000]) {
    for (const [offsetPx, part] of [[50, 'title'], [15, 'column']] as const) {
      const hit = gridColumnHeaderHitFromPoint({ ...options, template, roles: ['sound'], paperTracks: [], durationFrames: 144, frameOrigin: 1, includeTitle: true, viewportHeightPx,
        point: { x: layout.rect.x + layout.rect.w / 8, y: layout.rect.y - offsetPx / layout.pageSize.heightPx } })
      expect(hit).toMatchObject({ part, timelineLaneId: 'sound_lane_1' })
    }
  }
})
