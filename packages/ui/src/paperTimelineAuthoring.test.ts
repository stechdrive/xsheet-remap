import { parseSheetTemplate, standardA3SheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import {
  PAPER_TIMELINE_ROWS_PER_BLOCK,
  alignTemplateRegionToRect,
  canNudgePaperTimelineRoleWidthPx,
  detectPaperTimelineStructure,
  nudgePaperTimelineRoleWidthPx,
  normalizePaperTimelineRows,
  paperTimelineRegionMinimumWidthMm,
  paperTimelineGapPx,
  resizePaperTimelineColumns,
  setPaperTimelineGapPx,
  setPaperTimelineRoleWidthPx,
  transformPaperTimelineRect,
} from './paperTimelineAuthoring'

describe('paper timeline authoring', () => {
  it('derives the existing A3 3-second pair without adding stored layout data', () => {
    const structure = detectPaperTimelineStructure(standardA3SheetTemplate)

    expect(structure).not.toBeNull()
    expect(structure?.status).toBe('compatible')
    expect(structure?.rowTopPx).toBe(708)
    expect(structure?.rowBottomPx).toBe(2409)
    expect(structure?.outerRegionId).toBe('main_grid_outer_frame')
    expect(structure?.roles).toEqual({
      action: { leftRegionId: 'left_action_grid', rightRegionId: 'right_action_grid' },
      sound: { leftRegionId: 'left_sound_grid', rightRegionId: 'right_sound_grid' },
      cell: { leftRegionId: 'left_cell_grid', rightRegionId: 'right_cell_grid' },
      camera: { leftRegionId: 'left_camera_grid', rightRegionId: 'right_camera_grid' },
    })
    expect(structure?.auxiliaryRegionIds).toEqual(['left_action_reserve_grid', 'right_action_reserve_grid'])
    expect(Object.hasOwn(standardA3SheetTemplate, 'layoutGroups')).toBe(false)
  })

  it('resizes and moves the paper table atomically while keeping every logical identity', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const structure = detectPaperTimelineStructure(template)!
    const beforeIds = template.regions.map(region => region.regionId)
    const beforeBindings = template.regions.map(region => region.binding)
    const beforeFrames = template.regions.map(region => region.grid
      ? [region.regionId, region.grid.frameStart, region.grid.frameEnd, region.grid.rowCount]
      : null)
    const nextRect = {
      x: structure.rect.x + 10 / template.page.widthPx,
      y: structure.rect.y + 12 / template.page.heightPx,
      w: structure.rect.w - 20 / template.page.widthPx,
      h: structure.rect.h - 24 / template.page.heightPx,
    }

    const next = transformPaperTimelineRect(template, structure, nextRect)
    const nextStructure = detectPaperTimelineStructure(next)!

    expect(nextStructure.status).toBe('compatible')
    expect(nextStructure.rect.x * template.page.widthPx).toBeCloseTo(structure.rect.x * template.page.widthPx + 10)
    expect(nextStructure.rect.y * template.page.heightPx).toBeCloseTo(structure.rect.y * template.page.heightPx + 12)
    expect(next.regions.map(region => region.regionId)).toEqual(beforeIds)
    expect(next.regions.map(region => region.binding)).toEqual(beforeBindings)
    expect(next.regions.map(region => region.grid
      ? [region.regionId, region.grid.frameStart, region.grid.frameEnd, region.grid.rowCount]
      : null)).toEqual(beforeFrames)
    expect(next.calibration?.targetRect).toEqual(nextStructure.rect)
    expect(() => parseSheetTemplate(next)).not.toThrow()
  })

  it('keeps the standard A3 model byte-for-byte unchanged for a no-op table transform', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const before = JSON.stringify(template)
    const structure = detectPaperTimelineStructure(template)!

    const next = transformPaperTimelineRect(template, structure, structure.rect)

    expect(next).toBe(template)
    expect(JSON.stringify(next)).toBe(before)
  })

  it('moves paired column boundaries by the same pixel delta without flattening existing left-right differences', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const structure = detectPaperTimelineStructure(template)!
    const leftAction = region(template, 'left_action_grid')
    const rightAction = region(template, 'right_action_grid')
    const leftSound = region(template, 'left_sound_grid')
    const beforeDifferencePx = (leftAction.rect.w - rightAction.rect.w) * template.page.widthPx
    const targetWidthPx = leftAction.rect.w * template.page.widthPx + 12

    const next = setPaperTimelineRoleWidthPx(template, structure, 'action', targetWidthPx)
    const nextLeftAction = region(next, 'left_action_grid')
    const nextRightAction = region(next, 'right_action_grid')
    const nextLeftSound = region(next, 'left_sound_grid')

    expect((nextLeftAction.rect.w - leftAction.rect.w) * template.page.widthPx).toBeCloseTo(12)
    expect((nextRightAction.rect.w - rightAction.rect.w) * template.page.widthPx).toBeCloseTo(12)
    expect((nextLeftSound.rect.x - leftSound.rect.x) * template.page.widthPx).toBeCloseTo(12)
    expect((nextLeftSound.rect.w - leftSound.rect.w) * template.page.widthPx).toBeCloseTo(-12)
    expect((nextLeftAction.rect.w - nextRightAction.rect.w) * template.page.widthPx).toBeCloseTo(beforeDifferencePx)
    expect(detectPaperTimelineStructure(next)?.status).toBe('compatible')
  })

  it('nudges role boundaries by one physical pixel without stalling on rounded millimeters', () => {
    let template = structuredClone(standardA3SheetTemplate)
    template = resizePaperTimelineColumns(template, detectPaperTimelineStructure(template)!, 'cell', 5)

    for (let index = 0; index < 20; index += 1) {
      const structure = detectPaperTimelineStructure(template)!
      const beforeWidthPx = region(template, 'left_cell_grid').rect.w * template.page.widthPx
      expect(canNudgePaperTimelineRoleWidthPx(template, structure, 'cell', -1)).toBe(true)

      const next = nudgePaperTimelineRoleWidthPx(template, structure, 'cell', -1)

      expect(region(next, 'left_cell_grid').rect.w * next.page.widthPx).toBeCloseTo(Math.round(beforeWidthPx) - 1)
      template = next
    }
  })

  it('treats CAMERA as the inverse control for the shared CELL boundary', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const structure = detectPaperTimelineStructure(template)!
    const beforeCellWidthPx = region(template, 'left_cell_grid').rect.w * template.page.widthPx
    const beforeCameraWidthPx = region(template, 'left_camera_grid').rect.w * template.page.widthPx

    expect(canNudgePaperTimelineRoleWidthPx(template, structure, 'camera', 1)).toBe(true)
    const widerCamera = nudgePaperTimelineRoleWidthPx(template, structure, 'camera', 1)

    expect(region(widerCamera, 'left_cell_grid').rect.w * template.page.widthPx).toBeCloseTo(Math.round(beforeCellWidthPx) - 1)
    expect(region(widerCamera, 'left_camera_grid').rect.w * template.page.widthPx).toBeCloseTo(Math.round(beforeCameraWidthPx) + 1)
    expect(detectPaperTimelineStructure(widerCamera)?.status).toBe('compatible')
  })

  it('exposes and enforces the per-column physical minimum width', () => {
    let template = structuredClone(standardA3SheetTemplate)
    template = resizePaperTimelineColumns(template, detectPaperTimelineStructure(template)!, 'cell', 5)
    expect(paperTimelineRegionMinimumWidthMm(region(template, 'left_cell_grid'), template)).toBeCloseTo(12.5)

    for (let index = 0; index < 400; index += 1) {
      const structure = detectPaperTimelineStructure(template)!
      const next = nudgePaperTimelineRoleWidthPx(template, structure, 'cell', -1)
      if (next === template) break
      template = next
    }

    const structure = detectPaperTimelineStructure(template)!
    expect(canNudgePaperTimelineRoleWidthPx(template, structure, 'cell', -1)).toBe(false)
    expect(nudgePaperTimelineRoleWidthPx(template, structure, 'cell', -1)).toBe(template)
    expect(region(template, 'left_cell_grid').rect.w * template.page.widthPx).toBeGreaterThanOrEqual(5 * 2.5 * 150 / 25.4)
  })

  it('changes the shared paper tracks and paired timeline lanes without renumbering surviving ids', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const structure = detectPaperTimelineStructure(template)!
    const originalCellIds = region(template, 'left_cell_grid').grid!.columns.map(column => column.columnId)
    const originalSoundIds = region(template, 'left_sound_grid').grid!.columns.map(column => column.columnId)

    const expandedCells = resizePaperTimelineColumns(template, structure, 'cell', 12)
    const expandedStructure = detectPaperTimelineStructure(expandedCells)!
    expect(expandedCells.defaults.paperTracks).toHaveLength(12)
    for (const id of [
      expandedStructure.roles.action.leftRegionId,
      expandedStructure.roles.action.rightRegionId,
      expandedStructure.roles.cell.leftRegionId,
      expandedStructure.roles.cell.rightRegionId,
    ]) {
      expect(region(expandedCells, id).grid?.columns).toHaveLength(12)
    }
    expect(region(expandedCells, 'left_cell_grid').grid?.columns.slice(0, originalCellIds.length).map(column => column.columnId)).toEqual(originalCellIds)

    const expandedSound = resizePaperTimelineColumns(expandedCells, expandedStructure, 'sound', 6)
    expect(region(expandedSound, 'left_sound_grid').grid?.columns).toHaveLength(6)
    expect(region(expandedSound, 'right_sound_grid').grid?.columns).toHaveLength(6)
    expect(region(expandedSound, 'left_sound_grid').grid?.columns.slice(0, originalSoundIds.length).map(column => column.columnId)).toEqual(originalSoundIds)
    expect(() => parseSheetTemplate(expandedSound)).not.toThrow()
  })

  it('repairs legacy row drift and never exposes a different row count per side', () => {
    const template = structuredClone(standardA3SheetTemplate)
    region(template, 'right_camera_grid').rect.y += 3 / template.page.heightPx
    const drifted = detectPaperTimelineStructure(template)!

    expect(drifted.status).toBe('misaligned')
    const repaired = normalizePaperTimelineRows(template, drifted)
    const structure = detectPaperTimelineStructure(repaired)!
    expect(structure.status).toBe('compatible')
    for (const id of structure.requiredRegionIds) {
      expect(region(repaired, id).grid?.rowCount).toBe(PAPER_TIMELINE_ROWS_PER_BLOCK)
      expect(Math.round(region(repaired, id).rect.y * repaired.page.heightPx)).toBe(structure.rowTopPx)
      expect(Math.round((region(repaired, id).rect.y + region(repaired, id).rect.h) * repaired.page.heightPx)).toBe(structure.rowBottomPx)
    }
  })

  it('changes only the right block for the gap and aligns optional elements without touching the table', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const structure = detectPaperTimelineStructure(template)!
    const originalGap = paperTimelineGapPx(structure, template)
    const leftAction = structuredClone(region(template, 'left_action_grid').rect)
    const rightAction = structuredClone(region(template, 'right_action_grid').rect)

    const spaced = setPaperTimelineGapPx(template, structure, originalGap + 5)
    expect(region(spaced, 'left_action_grid').rect).toEqual(leftAction)
    expect((region(spaced, 'right_action_grid').rect.x - rightAction.x) * spaced.page.widthPx).toBeCloseTo(5)

    const metadata = spaced.regions.find(region => !detectPaperTimelineStructure(spaced)!.managedRegionIds.has(region.regionId))!
    const aligned = alignTemplateRegionToRect(spaced, metadata.regionId, structure.rect, 'left')
    expect(region(aligned, metadata.regionId).rect.x).toBeCloseTo(structure.rect.x)
    expect(region(aligned, 'left_action_grid').rect).toEqual(region(spaced, 'left_action_grid').rect)
  })
})

function region(template: typeof standardA3SheetTemplate, regionId: string) {
  const found = template.regions.find(region => region.regionId === regionId)
  if (!found) throw new Error(`${regionId} not found`)
  return found
}
