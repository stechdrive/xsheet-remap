import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createKey, createSheetPages, setEvent, standardA3SheetTemplate } from '@xsheet-remap/core'
import { layoutTimingCellText } from './timingCellTextLayout'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { createSheetRenderModelContext, inputTextRenderItemsForPage } from './sheetRenderModel'
import type { TextMeasurementProvider } from './textMetrics'

const measure = vi.fn((text: string, font: { sizePx: number }) => ({ widthPx: Array.from(text).length * font.sizePx, ascentPx: font.sizePx, descentPx: 0, exact: true }))
const measurement: TextMeasurementProvider = { measure }
const pageSize = { widthPx: 1000, heightPx: 2000 }
const rect = { x: 0.1, y: 0.2, w: 0.04, h: 0.02 }

describe('timing cell text layout', () => {
  it('keeps short labels and requested font size, and shrinks four digits without changing their content', () => {
    expect(layoutTimingCellText('1', 18, 6, rect, pageSize, measurement)).toMatchObject({ text: '1', fontSizePx: 18, overflow: false })
    const four = layoutTimingCellText('0001', 18, 6, rect, pageSize, measurement)
    expect(four).toMatchObject({ text: '0001', fullText: '0001', fontSizePx: 9, overflow: false })
    expect(measure('0001', { sizePx: four.fontSizePx }).widthPx).toBeLessThanOrEqual(36)
  })
  it('indicates overflow at the readable minimum and retains the complete stored label', () => {
    const full = '12345678901234567890'
    const layout = layoutTimingCellText(full, 18, 8, rect, pageSize, measurement)
    expect(layout).toMatchObject({ text: '123…', fullText: full, fontSizePx: 8, overflow: true })
    expect(layout.clipRect).toEqual({ x: rect.x, y: 0, w: rect.w, h: 1 })
    expect(layoutTimingCellText(full, 6, 12, rect, pageSize, measurement).fontSizePx).toBe(6)
  })
  it('never splits combining graphemes and bounds measurements for long labels', () => {
    measure.mockClear()
    const layout = layoutTimingCellText('か\u3099'.repeat(1000), 18, 8, rect, pageSize, measurement)
    expect(layout.text.endsWith('…')).toBe(true)
    expect(layout.text.slice(0, -1)).toMatch(/^(か\u3099)*$/)
    expect(measure.mock.calls.length).toBeLessThan(20)
    expect(layoutTimingCellText('1234', 18, 6, { ...rect, w: .001 }, pageSize, measurement).text).toBe('…')
  })
  it('uses identical fitted labels for on-screen and exported timing with stable cached items', () => {
    const created = createKey(createDefaultProject(), 'A', '0001234567890123456789', 'import', undefined, 'action')
    const project = setEvent(created.project, 'A', 1, created.key.keyId, 'action')
    const pages = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames, 1)
    const cache = new WeakMap()
    const first = eventRectsForPages(project, standardA3SheetTemplate, pages, { cache }).get('page_1')![0]
    const second = eventRectsForPages(project, standardA3SheetTemplate, pages, { cache }).get('page_1')![0]
    expect(second).toBe(first)
    const context = createSheetRenderModelContext(project, standardA3SheetTemplate)
    expect(inputTextRenderItemsForPage(context, pages[0])[0].textLayout).toEqual(first.textLayout)
    expect(project.logicalSheet.keys[0].displayLabel).toBe(created.key.displayLabel)
    expect(project.logicalSheet.events[0].fontSizePx).toBeUndefined()
  })
})
