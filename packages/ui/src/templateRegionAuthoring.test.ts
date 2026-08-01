import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate } from '@xsheet-remap/core'
import {
  duplicateTemplateRegion,
  editableTemplateRegionLabelCells,
  moveTemplateRegion,
  placeNewTemplateRegion,
  templateRegionAuthoringName,
  templateRegionKindLabel,
  templateRegionManagementNameHint,
  templateRegionPlacementDescription,
  templateRegionPlacementMode,
  templateRegionPurposeText,
  templateRegionUsageText,
  uniqueTemplateRegionId,
  updateTemplateFieldDefinition,
  updateTemplateRegionFormCell,
  updateTemplateRegionGridFrameRange,
} from './templateRegionAuthoring'

describe('template region authoring helpers', () => {
  it('uses an explicit authoring name before falling back to the functional label and id', () => {
    const source = standardA3SheetTemplate.regions[0]

    expect(templateRegionAuthoringName({ ...source, authoringName: '  上部の管理名  ' })).toBe('上部の管理名')
    expect(templateRegionAuthoringName(source)).toBe(source.label)
    expect(templateRegionAuthoringName({ ...source, authoringName: '', label: '' })).toBe(source.regionId)
  })

  it('duplicates a region with a unique authoring name without changing its functional label', () => {
    const source = standardA3SheetTemplate.regions[0]
    const first = duplicateTemplateRegion(standardA3SheetTemplate, source.regionId)
    const second = first && duplicateTemplateRegion(first.template, source.regionId)
    const firstCopy = first?.template.regions.find(region => region.regionId === first.regionId)
    const secondCopy = second?.template.regions.find(region => region.regionId === second.regionId)

    expect(firstCopy?.regionId).toMatch(`${source.regionId}_copy`)
    expect(firstCopy?.authoringName).toBe(`${templateRegionAuthoringName(source)} コピー`)
    expect(secondCopy?.authoringName).toBe(`${templateRegionAuthoringName(source)} コピー 2`)
    expect(firstCopy?.label).toBe(source.label)
    expect(firstCopy?.rect).not.toEqual(source.rect)
  })

  it('explains paper metadata headings and lists their printed label cells in reading order', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_metadata_form')!

    expect(templateRegionKindLabel(region)).toBe('固定見出し')
    expect(templateRegionPurposeText(region)).toContain('TITLEやCUT')
    expect(templateRegionManagementNameHint(region)).toContain('「表示文字」で別に編集')
    expect(editableTemplateRegionLabelCells(region).map(cell => cell.label)).toEqual([
      'TITLE', 'NO.', 'CUT', 'TIME', 'NAME', 'PAGE',
    ])
  })

  it('describes grids from their functional role rather than their generic region type', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_sound_grid')!

    expect(templateRegionKindLabel(region)).toBe('セリフ・音声タイムライン')
    expect(templateRegionPurposeText(region)).toContain('音声区間')
    expect(templateRegionManagementNameHint(region)).toContain('グリッド見出し')
    expect(templateRegionUsageText(region)).toContain('入力・選択')
  })

  it('describes decorative grids by their authoring purpose instead of a generic grid role', () => {
    const source = standardA3SheetTemplate.regions[0]
    const region = {
      ...structuredClone(source),
      type: 'decorative' as const,
      usage: 'render-only' as const,
      grid: { role: 'other' as const, rowCount: 2, columns: [{ columnId: 'line', label: '' }] },
    }

    expect(templateRegionKindLabel(region)).toBe('補助線・装飾')
    expect(templateRegionPurposeText(region)).toContain('入力機能を持たない')
    expect(templateRegionUsageText(region)).toContain('直接入力なし')
  })

  it('distinguishes memo and annotation authoring purposes', () => {
    const memo = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_memo_area')!
    const annotation = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_shooting_notes_area')!

    expect(templateRegionKindLabel(memo)).toBe('メモ欄')
    expect(templateRegionPurposeText(memo)).toContain('メモを入力・表示')
    expect(templateRegionKindLabel(annotation)).toBe('注釈欄')
    expect(templateRegionPurposeText(annotation)).toContain('手書き注釈')
  })

  it('updates one printed form label immutably', () => {
    const source = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_metadata_form')!
    const updated = updateTemplateRegionFormCell(source, 'metadata_label_title', { label: '作品名' })

    expect(updated).not.toBe(source)
    expect(updated.form?.cells).not.toBe(source.form?.cells)
    expect(updated.form?.cells?.find(cell => cell.cellId === 'metadata_label_title')?.label).toBe('作品名')
    expect(source.form?.cells?.find(cell => cell.cellId === 'metadata_label_title')?.label).toBe('TITLE')
  })

  it('updates one template field definition immutably', () => {
    const updated = updateTemplateFieldDefinition(standardA3SheetTemplate, 'memo.body', {
      label: '作画メモ',
      valueType: 'multiline',
    })

    expect(updated).not.toBe(standardA3SheetTemplate)
    expect(updated.fields).not.toBe(standardA3SheetTemplate.fields)
    expect(updated.fields?.find(field => field.fieldId === 'memo.body')).toMatchObject({
      label: '作画メモ',
      valueType: 'multiline',
    })
    expect(standardA3SheetTemplate.fields?.find(field => field.fieldId === 'memo.body')?.label).not.toBe('作画メモ')
  })

  it('keeps grid start, row count, and inclusive end synchronized', () => {
    const source = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_action_grid')!
    const updated = updateTemplateRegionGridFrameRange(source, { frameStart: 10, rowCount: 12 })

    expect(updated.grid).toMatchObject({ frameStart: 10, rowCount: 12, frameEnd: 21 })
    expect(source.grid).not.toMatchObject({ frameStart: 10, rowCount: 12, frameEnd: 21 })
  })

  it('identifies automatic placement so raw coordinates can be explained or hidden', () => {
    const span = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_metadata_form')!
    const flow = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_action_grid')!
    const free = standardA3SheetTemplate.regions.find(item => item.regionId === 'top_metadata_form')!

    expect(templateRegionPlacementMode(digitalStandardSheetTemplate, span)).toBe('horizontal-span')
    expect(templateRegionPlacementMode(digitalStandardSheetTemplate, flow)).toBe('horizontal-flow')
    expect(templateRegionPlacementMode(standardA3SheetTemplate, free)).toBe('free')
    expect(templateRegionPlacementDescription(digitalStandardSheetTemplate, flow)).toContain('自動調整')
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
