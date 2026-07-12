import { describe, expect, it } from 'vitest'
import { digitalStandardSheetTemplate, standardA3SheetTemplate, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import {
  buildTemplateChromeRenderModel,
  buildTemplateEditorRegionRenderModel,
  buildTemplateEditorRenderModel,
  buildTemplateGridOverlayRenderModel,
  gridRowLineClassName,
  hitTestTemplateEditorTarget,
  pointInExpandedNormalizedRect,
  snapTemplateEditorPointToPagePixels,
  templateEditorPointFromClientRect,
  templateEditorNormalizedRectValue,
  templateEditorRectPixelValue,
} from './templateEditorGeometry'

describe('template editor geometry', () => {
  it.each([standardA3SheetTemplate, digitalStandardSheetTemplate])(
    'builds the active-region preview without changing full-model output for $templateId',
    template => {
      const full = buildTemplateEditorRenderModel(template)

      for (const region of template.regions) {
        const active = buildTemplateEditorRegionRenderModel(template, region.regionId)

        expect(active).not.toBeNull()
        expect(active?.chrome).toEqual({
          ...full.chrome,
          showOuterFrame: false,
          referenceRegions: full.chrome.referenceRegions.filter(item => item.regionId === region.regionId),
          headers: full.chrome.headers.filter(item => item.regionId === region.regionId),
        })
        expect(active?.gridOverlay).toEqual(full.gridOverlays.find(item => item.regionId === region.regionId) ?? null)
      }
    },
  )

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

  it('places even absolute frame numbers at the lower-right edge of paper ACTION rows', () => {
    const leftRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_action_grid')
    const rightRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'right_action_grid')

    const left = buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, leftRegion!, { pageFrameStart: 145 })
    const right = buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, rightRegion!, { pageFrameStart: 145 })

    expect(left?.frameNumbers.map(item => item.text)).toEqual(Array.from({ length: 36 }, (_, index) => String(146 + index * 2)))
    expect(right?.frameNumbers.map(item => item.text)).toEqual(Array.from({ length: 36 }, (_, index) => String(218 + index * 2)))
    expect(left?.frameNumbers[0]).toMatchObject({ text: '146' })
    expect(left!.frameNumbers[0].x).toBeGreaterThan(leftRegion!.rect.x + leftRegion!.rect.w)
    expect(left!.frameNumbers[0].fontSizePx).toBe(9)
  })

  it('uses the continuous timeline origin for digital ACTION frame numbers', () => {
    const region = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_action_grid')
    const model = buildTemplateGridOverlayRenderModel(digitalStandardSheetTemplate, region!, {
      durationFrames: 8,
      frameOrigin: 101,
      pageFrameStart: 101,
    })

    expect(model?.frameNumbers.map(item => item.text)).toEqual(['102', '104', '106', '108'])
    expect(model!.frameNumbers[0].fontSizePx).toBe(9)
    expect(model?.pageSize).toEqual({ widthPx: 1920, heightPx: 3600 })
  })

  it('places elapsed seconds at the lower-left edge of paper CELL grids across pages', () => {
    const leftRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_cell_grid')
    const rightRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'right_cell_grid')

    const left = buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, leftRegion!, { pageFrameStart: 145 })
    const right = buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, rightRegion!, { pageFrameStart: 145 })

    expect(left?.secondCounters.map(item => item.text)).toEqual(['7', '8', '9'])
    expect(right?.secondCounters.map(item => item.text)).toEqual(['10', '11', '12'])
    expect(left?.secondCounters[0]).toMatchObject({ textAnchor: 'end' })
    expect(left!.secondCounters[0].x).toBeLessThan(leftRegion!.rect.x)
  })

  it('places digital seconds beside CELL and keeps SOUND column-only', () => {
    const cellRegion = digitalStandardSheetTemplate.regions.find(item => item.grid?.role === 'cell')
    const actionRegion = digitalStandardSheetTemplate.regions.find(item => item.grid?.role === 'action')
    const region = digitalStandardSheetTemplate.regions.find(item => item.grid?.role === 'sound')
    expect(region?.grid && cellRegion?.grid && actionRegion?.grid).toBeTruthy()

    const sound = buildTemplateGridOverlayRenderModel(digitalStandardSheetTemplate, region!)
    const cell = buildTemplateGridOverlayRenderModel(digitalStandardSheetTemplate, cellRegion!)
    const action = buildTemplateGridOverlayRenderModel(digitalStandardSheetTemplate, actionRegion!)

    expect(sound?.rowPaths).toHaveLength(0)
    expect(sound?.columnPath).not.toBeNull()
    expect(sound?.labels).toHaveLength(0)
    expect(cell?.secondCounters.map(item => item.text)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(cell!.secondCounters[0].fontSizePx).toBe(17)
    expect(cell!.pageSize).toEqual({ widthPx: 1920, heightPx: 3600 })
    expect(cell!.secondCounters[0].fontSizePx).toBeGreaterThan(action!.frameNumbers[0].fontSizePx)
  })

  it('keeps digital seconds cumulative when the visible timeline starts after frame one', () => {
    const region = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_cell_grid')
    const model = buildTemplateGridOverlayRenderModel(digitalStandardSheetTemplate, region!, {
      durationFrames: 48,
      frameOrigin: 101,
      pageFrameStart: 101,
    })

    expect(model?.secondCounters.map(item => item.text)).toEqual(['5', '6'])
  })

  it('omits second counters when the template display setting is off', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_cell_grid')
    const template = { ...standardA3SheetTemplate, style: { ...standardA3SheetTemplate.style, secondCounter: undefined } }

    expect(buildTemplateGridOverlayRenderModel(template, region!)?.secondCounters).toHaveLength(0)
  })

  it('renders current paper-track names at the page bottom for physical templates', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_cell_grid')
    const model = buildTemplateGridOverlayRenderModel(standardA3SheetTemplate, region!, {
      paperTracks: ['LO', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    })

    expect(model?.bottomTrackLabels.map(item => item.text)).toEqual(['LO', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
    expect(model?.bottomTrackLabels.every(item => item.y < 1 && item.opacity === 0.55)).toBe(true)
  })

  it('omits bottom paper-track names when the display setting is off', () => {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_cell_grid')
    const template = {
      ...standardA3SheetTemplate,
      style: {
        ...standardA3SheetTemplate.style,
        bottomTrackLabels: { visible: false },
      },
    } as SheetTemplate
    const model = buildTemplateGridOverlayRenderModel(template, region!)

    expect(model?.bottomTrackLabels).toHaveLength(0)
  })

  it('supports bottom paper-track names in user-created physical templates but not digital templates', () => {
    const paperRegion = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_action_grid')
    const paperTemplate = {
      ...standardA3SheetTemplate,
      templateId: 'studio-paper-template',
      style: { ...standardA3SheetTemplate.style, bottomTrackLabels: { visible: true } },
    } as SheetTemplate
    const digitalRegion = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_cell_grid')
    const digitalTemplate = {
      ...digitalStandardSheetTemplate,
      style: { ...digitalStandardSheetTemplate.style, bottomTrackLabels: { visible: true } },
    } as SheetTemplate

    expect(buildTemplateGridOverlayRenderModel(paperTemplate, paperRegion!)?.bottomTrackLabels).toHaveLength(9)
    expect(buildTemplateGridOverlayRenderModel(digitalTemplate, digitalRegion!)?.bottomTrackLabels).toHaveLength(0)
  })

  it('uses the resolved dimensions of a user-created landscape template for every text layer', () => {
    const template = {
      ...standardA3SheetTemplate,
      templateId: 'studio-landscape-template',
      page: {
        ...standardA3SheetTemplate.page,
        widthPx: 3200,
        heightPx: 1800,
        format: 'custom-landscape',
      },
    } as SheetTemplate
    const region = template.regions.find(item => item.regionId === 'left_action_grid')
    const chrome = buildTemplateChromeRenderModel(template)
    const grid = buildTemplateGridOverlayRenderModel(template, region!)

    expect(chrome.pageSize).toEqual({ widthPx: 3200, heightPx: 1800 })
    expect(grid?.pageSize).toEqual(chrome.pageSize)
    expect(grid?.frameNumbers[0].fontSizePx).toBeGreaterThan(0)
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

  it('snaps editor points and numeric fields to source page pixels', () => {
    const page = { widthPx: 1754, heightPx: 2481 }
    const point = snapTemplateEditorPointToPagePixels({ x: 864.4 / 1754, y: 165.4 / 2481 }, page)

    expect(point).toEqual({ x: 864 / 1754, y: 165 / 2481 })
    expect(templateEditorRectPixelValue({ x: point.x, y: point.y, w: 173 / 1754, h: 71 / 2481 }, 'x', page)).toBe(864)
    expect(templateEditorRectPixelValue({ x: point.x, y: point.y, w: 173 / 1754, h: 71 / 2481 }, 'h', page)).toBe(71)
    expect(templateEditorNormalizedRectValue(173, 'w', page)).toBe(173 / 1754)
    expect(templateEditorNormalizedRectValue(71, 'h', page)).toBe(71 / 2481)
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
