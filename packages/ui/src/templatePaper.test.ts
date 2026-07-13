import { describe, expect, it } from 'vitest'
import { templatePaperPixelSize } from './templatePaper'

describe('template paper dimensions', () => {
  it('uses nearest-pixel ISO paper dimensions and swaps landscape axes', () => {
    expect(templatePaperPixelSize('A3', 'portrait', 150)).toEqual({ widthPx: 1754, heightPx: 2480 })
    expect(templatePaperPixelSize('A3', 'portrait', 300)).toEqual({ widthPx: 3508, heightPx: 4961 })
    expect(templatePaperPixelSize('A3', 'landscape', 150)).toEqual({ widthPx: 2480, heightPx: 1754 })
  })
})
