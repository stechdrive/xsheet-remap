import { describe, expect, it } from 'vitest'
import { sheetSvgTextGeometry, sheetSvgTextX, sheetSvgTextY } from './sheetSvgTextGeometry'

describe('normalized SVG sheet text', () => {
  it('converts normalized anchors into the template pixel coordinate space', () => {
    const pageSize = { widthPx: 1920, heightPx: 3600 }

    expect(sheetSvgTextGeometry(0.25, 0.5, 18, pageSize)).toEqual({
      x: 480,
      y: 1800,
      fontSize: 18,
      transform: `scale(${1 / 1920} ${1 / 3600})`,
    })
  })

  it('converts tspan anchors with the same page width contract', () => {
    expect(sheetSvgTextX(0.5, { widthPx: 1754, heightPx: 2481 })).toBe(877)
    expect(sheetSvgTextY(0.5, { widthPx: 1754, heightPx: 2480 })).toBe(1240)
  })

  it('keeps the requested font size unchanged for portrait and landscape pages', () => {
    const portrait = sheetSvgTextGeometry(0.5, 0.5, 18, { widthPx: 1920, heightPx: 3600 })
    const landscape = sheetSvgTextGeometry(0.5, 0.5, 18, { widthPx: 3600, heightPx: 1920 })

    expect(portrait.fontSize).toBe(18)
    expect(landscape.fontSize).toBe(18)
    expect(portrait.transform).not.toBe(landscape.transform)
  })
})
