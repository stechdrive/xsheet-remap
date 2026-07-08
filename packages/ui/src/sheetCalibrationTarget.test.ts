import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { calibrationGridBoundsForTemplate, calibrationTargetRectForTemplate } from './sheetImages'
import {
  clearTemplateCalibrationTargetRect,
  updateTemplateCalibrationTargetRectEdge,
} from './templateEditing'

describe('sheet calibration target', () => {
  it('prefers the explicit calibration target over grid bounds', () => {
    const targetRect = rect(0.12, 0.2, 0.7, 0.6)
    const template = {
      ...templateWithGridBounds(),
      calibration: { targetRect },
    }

    expect(calibrationTargetRectForTemplate(template)).toEqual(targetRect)
  })

  it('falls back to action/sound/cell/camera grid bounds', () => {
    expectRectCloseTo(calibrationGridBoundsForTemplate(templateWithGridBounds()), rect(0.2, 0.1, 0.5, 0.7))
  })

  it('stores edited calibration target edges as explicit template calibration', () => {
    const template = templateWithGridBounds()
    const updated = updateTemplateCalibrationTargetRectEdge(template, rect(0.2, 0.2, 0.4, 0.4), 'left', { x: 0.1, y: 0.5 })

    expectRectCloseTo(updated.calibration?.targetRect ?? null, rect(0.1, 0.2, 0.5, 0.4))
  })

  it('clears empty explicit calibration target settings', () => {
    const template = {
      ...templateWithGridBounds(),
      calibration: { targetRect: rect(0.12, 0.2, 0.7, 0.6) },
    }

    expect(clearTemplateCalibrationTargetRect(template).calibration).toBeUndefined()
  })
})

function templateWithGridBounds(): SheetTemplate {
  return {
    ...standardA3SheetTemplate,
    calibration: undefined,
    regions: [
      gridRegion('action', rect(0.2, 0.1, 0.2, 0.4)),
      gridRegion('cell', rect(0.5, 0.3, 0.2, 0.5)),
      gridRegion('other', rect(0.05, 0.05, 0.9, 0.9)),
    ],
  }
}

function gridRegion(role: NonNullable<SheetTemplate['regions'][number]['grid']>['role'], rectValue: NormalizedRect): SheetTemplate['regions'][number] {
  return {
    regionId: `${role}_grid`,
    type: 'exposure-grid',
    label: role,
    rect: rectValue,
    usage: 'input',
    inputKind: 'timing-event',
    grid: {
      role,
      rowCount: 12,
      columns: [{ columnId: `${role}_1`, label: '1' }],
    },
  }
}

function rect(x: number, y: number, w: number, h: number): NormalizedRect {
  return { x, y, w, h }
}

function expectRectCloseTo(actual: NormalizedRect | null, expected: NormalizedRect) {
  expect(actual).not.toBeNull()
  expect(actual?.x).toBeCloseTo(expected.x, 10)
  expect(actual?.y).toBeCloseTo(expected.y, 10)
  expect(actual?.w).toBeCloseTo(expected.w, 10)
  expect(actual?.h).toBeCloseTo(expected.h, 10)
}
