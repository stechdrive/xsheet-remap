import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import {
  buildTemplateGridOverlayRenderModel,
  gridRowLineClassName,
  hitTestTemplateEditorTarget,
  pointInExpandedNormalizedRect,
  templateEditorPointFromClientRect,
} from './templateEditorGeometry'

describe('template editor geometry', () => {
  it('compacts grid row and column lines into SVG paths', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.grid?.role === 'action')
    expect(region?.grid).toBeTruthy()

    const model = buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, region!)

    expect(model).not.toBeNull()
    expect(model?.rowPaths.length).toBeLessThan(region!.grid!.rowCount)
    expect(pathCommandCount(model?.rowPaths.map(path => path.d).join(' ') ?? '')).toBe(region!.grid!.rowCount + 1)
    expect(model?.rowPaths.flatMap(path => path.segments)).toHaveLength(region!.grid!.rowCount + 1)
    expect(model?.columnPath).not.toBeNull()
    expect(pathCommandCount(model?.columnPath?.d ?? '')).toBe(region!.grid!.columns.length + 1)
    expect(model?.columnPath?.segments).toHaveLength(region!.grid!.columns.length + 1)
    expect(gridRowLineClassName(region!.grid!, 1)).toBe('gridLine')
    expect(gridRowLineClassName(region!.grid!, 6)).toContain('gridLineRegular')
    expect(gridRowLineClassName(region!.grid!, 12)).toContain('gridLineMedium')
    expect(gridRowLineClassName(region!.grid!, 24)).toContain('gridLineStrong')
    expect(model?.rowPaths.find(path => path.className.includes('gridLineStrong'))?.segments).toHaveLength(4)
    expect(model?.rowPaths.find(path => path.className.includes('gridLineMedium'))?.segments).toHaveLength(3)
    expect(model?.rowPaths.find(path => path.className.includes('gridLineRegular'))?.segments).toHaveLength(6)
  })

  it('keeps the digital SOUND overlay column-only with row labels', () => {
    const region = digitalStandardSheetTemplate.regions.find(item => item.grid?.role === 'sound')
    expect(region?.grid).toBeTruthy()

    const model = buildTemplateGridOverlayRenderModel(digitalStandardSheetTemplate, region!)

    expect(model).not.toBeNull()
    expect(model?.rowPaths).toHaveLength(0)
    expect(model?.columnPath).not.toBeNull()
    expect(model?.labels.map(label => label.text)).toEqual(['1', '2', '3', '4', '5', '6'])
  })

  it('omits paper SOUND overlays as before', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.grid?.role === 'sound')
    expect(region?.grid).toBeTruthy()

    expect(buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, region!)).toBeNull()
  })

  it('hit-tests calibration target edges before template regions without blocking the target interior', () => {
    const template = templateWithOverlappingRegions()
    const hitRadius = { x: 0.01, y: 0.01 }

    expect(hitTestTemplateEditorTarget(template, { x: 0.1, y: 0.28 }, {
      calibrationTargetRect: template.calibration?.targetRect,
      calibrationHitRadius: hitRadius,
      regionHitRadius: hitRadius,
    })).toEqual({ kind: 'calibration-target' })

    expect(hitTestTemplateEditorTarget(template, { x: 0.3, y: 0.3 }, {
      calibrationTargetRect: template.calibration?.targetRect,
      calibrationHitRadius: hitRadius,
      regionHitRadius: hitRadius,
    })).toEqual({ kind: 'region', regionId: 'top_region' })
  })

  it('uses the latest region as the top hit target for overlapping regions', () => {
    expect(hitTestTemplateEditorTarget(templateWithOverlappingRegions(), { x: 0.5, y: 0.5 })).toEqual({
      kind: 'region',
      regionId: 'top_region',
    })
  })

  it('converts client coordinates into normalized template coordinates', () => {
    expect(templateEditorPointFromClientRect({ left: 10, top: 20, width: 200, height: 400 }, 60, 120)).toEqual({
      x: 0.25,
      y: 0.25,
    })
  })

  it('expands normalized rect hit areas by independent x and y radii', () => {
    expect(pointInExpandedNormalizedRect({ x: 0.095, y: 0.2 }, rect(0.1, 0.1, 0.2, 0.2), { x: 0.01, y: 0 })).toBe(true)
    expect(pointInExpandedNormalizedRect({ x: 0.095, y: 0.095 }, rect(0.1, 0.1, 0.2, 0.2), { x: 0.01, y: 0 })).toBe(false)
  })
})

function templateWithOverlappingRegions(): SheetTemplate {
  return {
    ...standardA3SheetTemplate,
    calibration: { targetRect: rect(0.1, 0.1, 0.4, 0.4) },
    regions: [
      { ...standardA3SheetTemplate.regions[0], regionId: 'bottom_region', rect: rect(0.2, 0.2, 0.5, 0.5) },
      { ...standardA3SheetTemplate.regions[1], regionId: 'top_region', rect: rect(0.25, 0.25, 0.5, 0.5) },
    ],
  }
}

function rect(x: number, y: number, w: number, h: number): NormalizedRect {
  return { x, y, w, h }
}

function pathCommandCount(pathData: string): number {
  return pathData.match(/\bM\b/g)?.length ?? 0
}
