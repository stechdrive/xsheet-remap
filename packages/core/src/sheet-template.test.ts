import { describe, expect, it } from 'vitest'
import {
  cellRectForHit,
  hitTestSheetTemplate,
  resolveSheetTemplateGridLayout,
  resolveSheetTemplatePageSize,
  sheetGridCellRect,
  type SheetTemplate,
  standardA3SheetTemplate,
} from './sheet-template'

describe('sheet template layout', () => {
  it('keeps existing equal grid geometry when no sizing override is present', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_cell_grid')
    if (!region?.grid) throw new Error('left_cell_grid not found')

    const layout = resolveSheetTemplateGridLayout(standardA3SheetTemplate, region)
    expect(layout).not.toBeNull()
    expect(layout?.columns).toHaveLength(9)

    const firstCell = sheetGridCellRect(layout!, 0, 0)
    const hitRect = cellRectForHit(standardA3SheetTemplate, {
      regionId: region.regionId,
      role: 'cell',
      frame: 1,
      rowIndex: 0,
      columnIndex: 0,
      columnId: 'cell_A',
      label: 'A',
      paperTrack: 'A',
    })

    expect(firstCell).toEqual(hitRect)
    expect(layout?.columns[0]?.w).toBeCloseTo(region.rect.w / 9, 10)
  })

  it('resolves variable column widths and hit tests against the resolved columns', () => {
    const template = variableLayoutTemplate()
    const region = template.regions[0]!
    const layout = resolveSheetTemplateGridLayout(template, region)

    expect(layout?.columns.map(column => column.widthPx)).toEqual([50, 100, 150])
    expect(layout?.columns.map(column => column.w)).toEqual([50 / 300, 100 / 300, 150 / 300])

    const hit = hitTestSheetTemplate(template, { x: 0.34, y: 0.2 }, { role: 'cell' })
    expect(hit?.paperTrack).toBe('B')
    expect(hit?.columnIndex).toBe(1)
  })

  it('grows a continuous digital page when fixed row height needs more room', () => {
    const template = variableLayoutTemplate({
      rowSizing: {
        mode: 'fixed-height',
        rowHeightPx: 48,
      },
      rowCount: 8,
    })
    const pageSize = resolveSheetTemplatePageSize(template)
    const layout = resolveSheetTemplateGridLayout(template, template.regions[0]!)

    expect(pageSize.heightPx).toBe(564)
    expect(layout?.frames.rowHeightPx).toBe(48)
    expect(layout?.rect.h).toBeCloseTo((48 * 8) / 564, 10)
  })

  it('aligns the A3 process-check area to the built-in underlay ruling', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_process_check_area')
    expect(region).toBeTruthy()
    if (!region) throw new Error('top_process_check_area not found')

    const leftPx = region.rect.x * standardA3SheetTemplate.page.widthPx
    const rightPx = (region.rect.x + region.rect.w) * standardA3SheetTemplate.page.widthPx

    expect(leftPx).toBeCloseTo(35)
    expect(rightPx).toBeCloseTo(1633)
  })

  it('uses distinct 1 second, half-second, and 6-frame row weights across the A3 grids', () => {
    const grids = standardA3SheetTemplate.regions.flatMap(region => region.grid ? [region.grid] : [])

    expect(grids).toHaveLength(8)
    expect(grids.every(grid => grid.rowLineRules === grids[0]?.rowLineRules)).toBe(true)
    expect(grids[0]?.rowLineRules).toEqual([
      { every: 24, weight: 'strong' },
      { every: 12, weight: 'medium' },
      { every: 6, weight: 'regular' },
    ])
  })

  it('places optional shared cut numbers at the bottom of the A3 CUT field', () => {
    const cutRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_cut_field')
    const sharedRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_shared_cut_numbers_field')

    expect(cutRegion?.textStyleVariants?.sharedCutNumbersVisible).toMatchObject({ verticalAlign: 'top' })
    if (!sharedRegion) throw new Error('top_shared_cut_numbers_field not found')
    expect(sharedRegion?.binding).toEqual({
      target: 'cut-group',
      field: 'shared-cut-numbers',
      opening: '[',
      closing: ']',
      separator: '・',
    })
    expect(sharedRegion.rect.x * standardA3SheetTemplate.page.widthPx).toBeCloseTo(864)
    expect(sharedRegion.rect.y * standardA3SheetTemplate.page.heightPx).toBeCloseTo(198)
    expect(sharedRegion.rect.h * standardA3SheetTemplate.page.heightPx).toBeCloseTo(38)
    expect(sharedRegion.textStyle).toMatchObject({ fontSizePx: 13, lineHeightPx: 15, verticalAlign: 'top' })
  })
})

function variableLayoutTemplate(gridOverrides: Partial<NonNullable<SheetTemplate['regions'][number]['grid']>> = {}): SheetTemplate {
  return {
    schemaVersion: 1,
    templateId: 'test-variable-layout',
    name: 'Variable layout test',
    templateKind: 'digital-native',
    layoutMode: 'infinite-digital',
    viewLayout: {
      type: 'infinite',
      frameAxis: { type: 'infinite', overflow: 'scroll' },
      trackAxis: { type: 'logical-width', overflow: 'scroll' },
      surface: { type: 'continuous-canvas' },
    },
    page: {
      widthPx: 300,
      heightPx: 240,
      isPhysical: false,
      format: 'test',
      orientation: 'portrait',
      coordinateSpace: 'normalized',
    },
    defaults: {
      fps: 24,
      durationFrames: 12,
      frameOrigin: 1,
      paperTracks: ['A', 'B', 'C'],
    },
    regions: [
      {
        regionId: 'test_cell_grid',
        type: 'exposure-grid',
        label: 'CELL',
        rect: { x: 0, y: 0.125, w: 1, h: 0.25 },
        usage: 'input',
        inputKind: 'timing-event',
        grid: {
          role: 'cell',
          frameStart: 1,
          rowCount: 4,
          columnSizing: {
            mode: 'fixed-content',
            columns: {
              A: { widthPx: 50 },
              B: { widthPx: 100 },
              C: { widthPx: 150 },
            },
          },
          columns: [
            { columnId: 'cell_A', label: 'A', paperTrack: 'A', xdtsEligible: true },
            { columnId: 'cell_B', label: 'B', paperTrack: 'B', xdtsEligible: true },
            { columnId: 'cell_C', label: 'C', paperTrack: 'C', xdtsEligible: true },
          ],
          ...gridOverrides,
        },
      },
    ],
  }
}
