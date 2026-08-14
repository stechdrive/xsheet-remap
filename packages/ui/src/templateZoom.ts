import { TEMPLATE_ZOOM_MAX, TEMPLATE_ZOOM_MIN } from './sheetConstants'

export const TEMPLATE_ZOOM_SLIDER_MIN = 0
export const TEMPLATE_ZOOM_SLIDER_MAX = 1000

export function templateZoomToSliderValue(zoom: number): number {
  const clampedZoom = clampZoom(zoom)
  const ratio = Math.log(clampedZoom / TEMPLATE_ZOOM_MIN) / Math.log(TEMPLATE_ZOOM_MAX / TEMPLATE_ZOOM_MIN)
  return Math.round(TEMPLATE_ZOOM_SLIDER_MIN + ratio * (TEMPLATE_ZOOM_SLIDER_MAX - TEMPLATE_ZOOM_SLIDER_MIN))
}

export function templateZoomFromSliderValue(value: number): number {
  const clampedValue = Math.min(TEMPLATE_ZOOM_SLIDER_MAX, Math.max(TEMPLATE_ZOOM_SLIDER_MIN, value))
  const ratio = (clampedValue - TEMPLATE_ZOOM_SLIDER_MIN) / (TEMPLATE_ZOOM_SLIDER_MAX - TEMPLATE_ZOOM_SLIDER_MIN)
  return TEMPLATE_ZOOM_MIN * Math.pow(TEMPLATE_ZOOM_MAX / TEMPLATE_ZOOM_MIN, ratio)
}

function clampZoom(zoom: number): number {
  return Math.min(TEMPLATE_ZOOM_MAX, Math.max(TEMPLATE_ZOOM_MIN, zoom))
}
