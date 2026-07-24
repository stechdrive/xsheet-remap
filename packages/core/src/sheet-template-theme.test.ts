import { describe, expect, it } from 'vitest'
import {
  cloneSheetTemplateTheme,
  createDefaultSheetTemplateTheme,
  isSheetTemplateTheme,
  sheetTemplateLineColor,
  timedRangeCuePaint,
} from './sheet-template-theme'

describe('sheet template theme', () => {
  it('resolves adjacent timed-range columns without depending on cue order', () => {
    const theme = createDefaultSheetTemplateTheme()

    expect(timedRangeCuePaint(theme, 'sound', 0).fillColor).toBe(theme.timedRangeCues.sound.columnColors[0])
    expect(timedRangeCuePaint(theme, 'sound', 1).fillColor).toBe(theme.timedRangeCues.sound.columnColors[1])
    expect(timedRangeCuePaint(theme, 'sound', 2).fillColor).toBe(theme.timedRangeCues.sound.columnColors[0])
    expect(timedRangeCuePaint(theme, 'camera', 1).fillColor).toBe(theme.timedRangeCues.camera.columnColors[1])
  })

  it('maps semantic line weights to theme colors', () => {
    const theme = createDefaultSheetTemplateTheme()
    expect(sheetTemplateLineColor(theme, 'thin')).toBe(theme.ink.lines.thin)
    expect(sheetTemplateLineColor(theme, 'strong')).toBe(theme.ink.lines.strong)
    expect(sheetTemplateLineColor(theme, 'outer')).toBe(theme.ink.lines.outer)
  })

  it('clones nested color structures and validates strict theme input', () => {
    const source = createDefaultSheetTemplateTheme()
    const clone = cloneSheetTemplateTheme(source)
    clone.timedRangeCues.sound.columnColors[0] = '#abcdef'

    expect(source.timedRangeCues.sound.columnColors[0]).not.toBe('#abcdef')
    expect(isSheetTemplateTheme(clone)).toBe(true)
    expect(isSheetTemplateTheme({ ...clone, paper: { ...clone.paper, color: 'white' } })).toBe(false)
  })
})
