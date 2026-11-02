import type { SheetTemplate, TimedRangeCue } from '@xsheet-remap/core'
import { clampTextFontSizePx, defaultTimingTextFontSizePx, resolveGridTypographyFontSizes } from './sheetTextLayout'

export type CueTextSizeStyle = Pick<TimedRangeCue, 'fontSizePx' | 'secondaryFontSizePx' | 'fontSizeMode'>

export function cueTextSizes(template: SheetTemplate, cue: Pick<TimedRangeCue, 'role'> & CueTextSizeStyle,
  pageSize: { widthPx: number; heightPx: number } = template.page) {
  const typography = template.regions.find(region => region.grid?.role === cue.role)?.grid?.typography
  const defaults = cue.role === 'camera'
    ? { fontSizePx: defaultTimingTextFontSizePx(template, 'cell'), minFontSizePx: 6 }
    : resolveGridTypographyFontSizes(template, pageSize, typography, { fontSizePx: 14, minFontSizePx: 6 })
  const primary = cue.fontSizePx === undefined ? defaults.fontSizePx : clampTextFontSizePx(cue.fontSizePx)
  const secondary = cue.secondaryFontSizePx === undefined
    ? Math.max(6, primary * (cue.role === 'sound' ? .9 : 1)) : clampTextFontSizePx(cue.secondaryFontSizePx)
  return { primary, secondary, minimum: defaults.minFontSizePx, fit: cue.fontSizeMode !== 'fixed' }
}
