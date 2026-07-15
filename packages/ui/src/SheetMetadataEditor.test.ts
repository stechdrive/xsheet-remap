import { describe, expect, it } from 'vitest'
import { metadataEditIconSizePx } from './SheetMetadataEditor'

describe('metadata edit icon sizing', () => {
  const standardA3Page = { widthPx: 1754, heightPx: 2481 }
  const standardA3Field = { w: 173 / 1754, h: 71 / 2481 }

  it('uses the template field size while staying stable at normal zoom levels', () => {
    expect(metadataEditIconSizePx(standardA3Field, standardA3Page, { widthPx: 877, heightPx: 1241 })).toBe(23)
    expect(metadataEditIconSizePx(standardA3Field, standardA3Page, standardA3Page)).toBe(23)
    expect(metadataEditIconSizePx(standardA3Field, standardA3Page, { widthPx: 3508, heightPx: 4962 })).toBe(23)
  })

  it('shrinks only when the displayed field cannot comfortably contain the normal badge', () => {
    expect(metadataEditIconSizePx(standardA3Field, standardA3Page, { widthPx: 439, heightPx: 620 })).toBe(16)
  })

  it('adapts to digital and custom template field dimensions within readable bounds', () => {
    expect(metadataEditIconSizePx(
      { w: 160 / 1920, h: 60 / 3600 },
      { widthPx: 1920, heightPx: 3600 },
      { widthPx: 960, heightPx: 1800 },
    )).toBe(20)
    expect(metadataEditIconSizePx(
      { w: 0.2, h: 0.08 },
      { widthPx: 2400, heightPx: 3200 },
      { widthPx: 1200, heightPx: 1600 },
    )).toBe(26)
  })
})
