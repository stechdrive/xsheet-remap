import { describe, expect, it } from 'vitest'
import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { auxiliaryLabelMetrics, auxiliaryLabelTextLayout, overlayAuxiliaryLabelGeometry } from './auxiliary-label-layout'

describe('auxiliary sheet label layout', () => {
  it('keeps ordinary BG/BOOK labels inside the computed box', () => {
    const metrics = auxiliaryLabelMetrics(standardA3SheetTemplate, 'stack-guide')
    const layout = auxiliaryLabelTextLayout('BOOK', metrics, 3)

    expect(layout.displayText).toBe('BOOK')
    expect(layout.truncated).toBe(false)
    expect(layout.labelWidthPx).toBeGreaterThanOrEqual(layout.textWidthPx + metrics.textPaddingPx * 2)
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
})
