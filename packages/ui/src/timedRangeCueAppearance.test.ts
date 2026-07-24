import { describe, expect, it } from 'vitest'
import { createDefaultSheetTemplateTheme } from '@xsheet-remap/core'
import { colorWithOpacity, timedRangeCueColumnPaint, timedRangeCueColumnStyle } from './timedRangeCueAppearance'

describe('timed range cue appearance', () => {
  it('uses the resolved column index instead of cue order', () => {
    const theme = createDefaultSheetTemplateTheme()

    expect(timedRangeCueColumnPaint(theme, 'sound', 0).fillColor).toBe(theme.timedRangeCues.sound.columnColors[0])
    expect(timedRangeCueColumnPaint(theme, 'sound', 1).fillColor).toBe(theme.timedRangeCues.sound.columnColors[1])
    expect(timedRangeCueColumnPaint(theme, 'sound', 2).fillColor).toBe(theme.timedRangeCues.sound.columnColors[0])
  })

  it('creates identical SVG and canvas fill colors from one theme paint', () => {
    const theme = createDefaultSheetTemplateTheme()
    const paint = timedRangeCueColumnPaint(theme, 'camera', 1)
    const style = timedRangeCueColumnStyle(theme, 'camera', 1)

    expect(style['--timed-range-cue-fill']).toBe(colorWithOpacity(paint.fillColor, paint.fillOpacity))
    expect(style['--timed-range-cue-stroke']).toBe(paint.strokeColor)
    expect(style['--timed-range-cue-text']).toBe(paint.textColor)
  })
})
