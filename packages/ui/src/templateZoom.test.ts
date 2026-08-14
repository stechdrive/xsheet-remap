import { describe, expect, it } from 'vitest'
import { TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'
import {
  TEMPLATE_ZOOM_SLIDER_MAX,
  TEMPLATE_ZOOM_SLIDER_MIN,
  templateZoomFromSliderValue,
  templateZoomToSliderValue,
} from './templateZoom'

describe('template zoom slider mapping', () => {
  it('maps the full authoring range to a logarithmic slider', () => {
    expect(templateZoomToSliderValue(TEMPLATE_ZOOM_MIN)).toBe(TEMPLATE_ZOOM_SLIDER_MIN)
    expect(templateZoomToSliderValue(TEMPLATE_ZOOM_MAX)).toBe(TEMPLATE_ZOOM_SLIDER_MAX)
    expect(templateZoomFromSliderValue(TEMPLATE_ZOOM_SLIDER_MIN)).toBe(TEMPLATE_ZOOM_MIN)
    expect(templateZoomFromSliderValue(TEMPLATE_ZOOM_SLIDER_MAX)).toBe(TEMPLATE_ZOOM_MAX)
  })

  it('gives the normal 25%-400% range substantial travel', () => {
    const normalRangeTravel = templateZoomToSliderValue(4) - templateZoomToSliderValue(0.25)

    expect(normalRangeTravel).toBeGreaterThan(300)
    for (const zoom of [0.25, 0.5, 1, 2, 4, 8, 16, 32]) {
      expect(templateZoomFromSliderValue(templateZoomToSliderValue(zoom))).toBeCloseTo(zoom, 1)
    }
  })
})
