import { describe, expect, it } from 'vitest'
import { createDefaultProject, createSheetPages, createTimedRangeCue, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { buildCameraCuePageLayouts, cameraCuePointLayoutsForPage } from './cameraCueGeometry'
import { buildSoundCuePageTextLayouts } from './soundCueGeometry'
import { layoutTimingCellText } from './timingCellTextLayout'
import { selectedSheetTextTargets } from './sheetTextSizing'
import { sheetTextFitStatus } from './sheetTextFitStatus'
import type { TextMeasurementProvider } from './textMetrics'

const template = standardA3SheetTemplate, pages = createSheetPages(template, 144, 1)
const measurement: TextMeasurementProvider = { measure: (text, font) => ({ widthPx: Array.from(text).length * font.sizePx, ascentPx: font.sizePx, descentPx: 0, exact: true }) }
describe('shared text size geometry', () => {
  it('keeps manual sizes and stored text while fitting only on request, including row height', () => {
    const rect = { x: .1, y: .1, w: .05, h: .02 }, size = { widthPx: 1000, heightPx: 1000 }
    const manual = layoutTimingCellText('1234', 32, 6, rect, size, measurement, false, false)
    expect(manual).toMatchObject({ fontSizePx: 32, fullText: '1234', overflow: true })
    const fitted = layoutTimingCellText('1234', 32, 6, rect, size, measurement, false, true, true)
    expect(fitted).toMatchObject({ fontSizePx: 11, text: '1234', overflow: false })
    expect(layoutTimingCellText('1', 32, 6, rect, size, measurement, false, true, true).fontSizePx).toBe(18)
    expect(layoutTimingCellText('1', 32, 6, rect, size, measurement).fontSizePx).toBe(32)
  })

  it('renders SOUND label/body sizes separately, reports overflow, and fits without moving the cue', () => {
    const cue: TimedRangeCue = { cueId: 'voice', role: 'sound', laneId: 'sound_lane_1', frameStart: 20, frameEnd: 24,
      label: 'A', text: 'あいうえお', source: 'manual', fontSizePx: 40, secondaryFontSizePx: 100, fontSizeMode: 'fixed' }
    const fixed = buildSoundCuePageTextLayouts(template, pages, [cue], template.page)[0]
    expect(fixed.textLayout.labelFontSizePx).toBe(40)
    expect(fixed.textLayout.textFontSizePx).toBe(100)
    expect(fixed.textLayout.truncatedText).toBe(true)
    const fitCue = { ...cue, fontSizeMode: 'fit' as const }
    const fit = buildSoundCuePageTextLayouts(template, pages, [fitCue], template.page)[0]
    expect(fit.segment).toEqual(fixed.segment)
    expect(fit.textLayout.textFontSizePx).toBeLessThan(100)
    expect(fit.textLayout.textGlyphs.map(glyph => glyph.value).join('')).toBe(cue.text)
    expect(fitCue.text).toBe(cue.text)
  })

  it('fits CAMERA text inside its manual label box without changing points, paths or timing', () => {
    const cue: TimedRangeCue = { cueId: 'pan', role: 'camera', laneId: 'camera_lane_1', frameStart: 20, frameEnd: 36,
      label: 'PAN', text: '', source: 'manual', fontSizePx: 72, secondaryFontSizePx: 48, fontSizeMode: 'fixed',
      camera: { shape: 'range', startLabel: 'A', endLabel: 'B',
        labelPlacement: { mode: 'manual', xRatio: .2, widthRatio: .5, frameOffset: 4, heightFrames: 2 } } }
    const fixed = buildCameraCuePageLayouts(template, pages[0], [cue], template.page)[0]
    const fixedPoints = cameraCuePointLayoutsForPage(template, cue, fixed.segments, template.page)
    expect(fixed.label).toMatchObject({ fontSizePx: 72, overflow: true, manual: true })
    expect(fixedPoints.every(point => point.fontSizePx === 48)).toBe(true)
    const fitted = { ...cue, fontSizeMode: 'fit' as const }
    const fit = buildCameraCuePageLayouts(template, pages[0], [fitted], template.page)[0]
    expect(fit.label?.fontSizePx).toBeLessThan(72)
    expect(fit.label?.overflow).toBe(false)
    expect(fit.label?.glyphs.map(glyph => glyph.value).join('')).toBe('PAN')
    expect(fit.label?.rect).toEqual(fixed.label?.rect)
    expect(fit.segments).toEqual(fixed.segments)
    const fitPoints = cameraCuePointLayoutsForPage(template, fitted, fit.segments, template.page)
    expect(fitPoints.map(point => point.anchor)).toEqual(fixedPoints.map(point => point.anchor))
    expect(fitPoints.every(point => point.fontSizePx < 48)).toBe(true)
  })

  it('shows actual overflow/fitting status from the shared layout without changing the stored text', () => {
    const project = createTimedRangeCue(createDefaultProject(), { role: 'sound', laneId: 'sound_lane_1', frameStart: 20, frameEnd: 24,
      label: 'A', text: 'あいうえお', fontSizePx: 18, secondaryFontSizePx: 100, fontSizeMode: 'fixed' }).project
    const selection = { kind: 'cue' as const, cueId: project.timedRangeCues[0].cueId }
    expect(sheetTextFitStatus(project, template, selectedSheetTextTargets(project, selection))).toContain('枠を超えています')
    const fit = { ...project, timedRangeCues: project.timedRangeCues.map(cue => ({ ...cue, fontSizeMode: 'fit' as const })) }
    expect(sheetTextFitStatus(fit, template, selectedSheetTextTargets(fit, selection))).toContain('小さく表示')
    expect(fit.timedRangeCues[0].text).toBe('あいうえお')
  })
})
