import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { enumerateTemplateTimingHits } from './sheetInteraction'

describe('template timing hit usage', () => {
  it('does not create interactive cells for ignored grid regions', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const ignored = template.regions.find(region => region.regionId === 'left_cell_grid')!
    ignored.usage = 'ignored'

    const hits = enumerateTemplateTimingHits(template, 'cell')

    expect(hits.some(hit => hit.regionId === ignored.regionId)).toBe(false)
    expect(hits.some(hit => hit.regionId === 'right_cell_grid')).toBe(true)
  })

  it('keeps render-only grids visible for output without creating editing hits', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const renderOnly = template.regions.find(region => region.regionId === 'right_cell_grid')!
    renderOnly.usage = 'render-only'

    const hits = enumerateTemplateTimingHits(template, 'cell')

    expect(hits.some(hit => hit.regionId === 'left_cell_grid')).toBe(true)
    expect(hits.some(hit => hit.regionId === renderOnly.regionId)).toBe(false)
  })

  it('keeps explicitly declared reference grids interactive', () => {
    const hits = enumerateTemplateTimingHits(structuredClone(standardA3SheetTemplate), 'action')

    expect(hits.some(hit => hit.regionId === 'left_action_grid')).toBe(true)
    expect(hits.some(hit => hit.regionId === 'right_action_grid')).toBe(true)
  })
})
