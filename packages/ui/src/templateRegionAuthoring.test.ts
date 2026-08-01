import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { duplicateTemplateRegion, moveTemplateRegion, placeNewTemplateRegion, uniqueTemplateRegionId } from './templateRegionAuthoring'

describe('template region authoring helpers', () => {
  it('duplicates a region after its source with a unique id and visible offset', () => {
    const source = standardA3SheetTemplate.regions[0]
    const duplicated = duplicateTemplateRegion(standardA3SheetTemplate, source.regionId)
    expect(duplicated).not.toBeNull()
    expect(duplicated?.template.regions[1].regionId).toMatch(`${source.regionId}_copy`)
    expect(duplicated?.template.regions[1].label).toContain('コピー')
    expect(duplicated?.template.regions[1].rect).not.toEqual(source.rect)
  })

  it('moves regions without changing their content', () => {
    const source = standardA3SheetTemplate.regions[1]
    const moved = moveTemplateRegion(standardA3SheetTemplate, source.regionId, -1)
    expect(moved.regions[0].regionId).toBe(source.regionId)
    expect(moveTemplateRegion(moved, source.regionId, -1)).toBe(moved)
  })

  it('cascades a new region away from an existing matching rectangle', () => {
    const source = standardA3SheetTemplate.regions[0]
    const placed = placeNewTemplateRegion(standardA3SheetTemplate, source.rect)
    expect(placed).not.toEqual(source.rect)
    expect(placed.x).toBeGreaterThanOrEqual(0)
    expect(placed.y).toBeGreaterThanOrEqual(0)
    expect(placed.x + placed.w).toBeLessThanOrEqual(1)
    expect(placed.y + placed.h).toBeLessThanOrEqual(1)
  })

  it('never reuses an id after an earlier sibling was deleted', () => {
    const template = structuredClone(standardA3SheetTemplate)
    template.regions.push(
      { ...structuredClone(template.regions[0]), regionId: 'custom_form_17' },
      { ...structuredClone(template.regions[0]), regionId: 'custom_form_18' },
    )
    template.regions = template.regions.filter(region => region.regionId !== 'custom_form_17')

    expect(uniqueTemplateRegionId(template, 'custom_form_18')).toBe('custom_form_18_2')
  })
})
