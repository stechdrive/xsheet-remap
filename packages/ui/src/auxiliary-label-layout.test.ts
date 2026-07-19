import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { auxiliaryLabelMetrics, auxiliaryLabelTextLayout, overlayAuxiliaryLabelGeometry } from './auxiliary-label-layout'

describe('auxiliary sheet label layout', () => {
  it('derives compact lane spacing from the template label height and physical gap', () => {
    const metrics = auxiliaryLabelMetrics(standardA3SheetTemplate, 'stack-guide')

    expect(metrics.laneGapPx).toBeCloseTo((1.35 * standardA3SheetTemplate.page.dpi!) / 25.4, 4)
    expect(metrics.lanePitchPx).toBeCloseTo(metrics.labelHeightPx + metrics.laneGapPx, 4)
    expect(metrics.laneGapPx).toBeGreaterThan(6)
    expect(metrics.laneGapPx).toBeLessThan(metrics.labelHeightPx)
  })

  it('keeps legacy custom-template lane pitch as a derived clear gap', () => {
    const template = {
      ...standardA3SheetTemplate,
      style: {
        ...standardA3SheetTemplate.style,
        bgBookLabel: {
          ...standardA3SheetTemplate.style?.bgBookLabel,
          laneGapMm: undefined,
          lanePitchMm: 3.39,
        },
      },
    }
    const metrics = auxiliaryLabelMetrics(template, 'stack-guide')

    expect(metrics.laneGapPx).toBeCloseTo(((3.39 - 2.37) * template.page.dpi!) / 25.4, 4)
    expect(metrics.lanePitchPx).toBeCloseTo(metrics.labelHeightPx + metrics.laneGapPx, 4)
  })

  it('keeps practical BG/BOOK labels intact and sizes the box from measured text', () => {
    const metrics = auxiliaryLabelMetrics(standardA3SheetTemplate, 'stack-guide')
    const layout = auxiliaryLabelTextLayout('BOOK_BACKGROUND_REFERENCE_LAYER_01', metrics, { extraWidthPx: 3 })

    expect(layout.displayText).toBe('BOOK_BACKGROUND_REFERENCE_LAYER_01')
    expect(layout.truncated).toBe(false)
    expect(layout.labelWidthPx).toBeGreaterThanOrEqual(layout.textWidthPx + metrics.textPaddingPx * 2)
    expect(layout.labelWidthPx).toBeLessThan(metrics.maxWidthPx)
  })

  it('ellipsizes only when the full name cannot fit within the physical page width', () => {
    const metrics = auxiliaryLabelMetrics(standardA3SheetTemplate, 'stack-guide')
    const layout = auxiliaryLabelTextLayout('背景'.repeat(200), metrics, { extraWidthPx: 3 })

    expect(layout.truncated).toBe(true)
    expect(layout.displayText.endsWith('…')).toBe(true)
    expect(layout.labelWidthPx).toBeLessThanOrEqual(standardA3SheetTemplate.page.widthPx - metrics.pageMarginPx * 2)
  })

  it('uses the same resolved typography and explicit overflow policy for added columns', () => {
    const template = {
      ...standardA3SheetTemplate,
      style: {
        ...standardA3SheetTemplate.style,
        bgBookLabel: {
          ...standardA3SheetTemplate.style?.bgBookLabel,
          maxWidthMm: 5,
          minFontSizePt: 4,
          fontFamily: 'Test Sheet Font, sans-serif',
          fontWeight: 800,
        },
      },
    }
    const geometry = overlayAuxiliaryLabelGeometry(
      template,
      { x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
      template.page,
      { label: '非常に長い追加セル列名' },
      { rect: { x: 0.2, y: 0.3, w: 0.04, h: 0.5 } },
      0,
      8,
    )

    expect(geometry.fontFamily).toBe('Test Sheet Font, sans-serif')
    expect(geometry.fontWeight).toBe(800)
    expect(geometry.truncated).toBe(true)
    expect(geometry.displayText.endsWith('…')).toBe(true)
  })

  it('keeps a practical added-column label intact when the page has physical room', () => {
    const geometry = overlayAuxiliaryLabelGeometry(
      standardA3SheetTemplate,
      { x: 0.2, y: 0.3, w: 0.4, h: 0.5 },
      standardA3SheetTemplate.page,
      { label: 'BOOK_BACKGROUND_REFERENCE_LAYER_01' },
      { rect: { x: 0.2, y: 0.3, w: 0.04, h: 0.5 } },
      0,
      8,
    )

    expect(geometry.displayText).toBe('BOOK_BACKGROUND_REFERENCE_LAYER_01')
    expect(geometry.truncated).toBe(false)
    expect(geometry.labelWidth * standardA3SheetTemplate.page.widthPx).toBeLessThan(
      standardA3SheetTemplate.page.widthPx,
    )
  })
})
