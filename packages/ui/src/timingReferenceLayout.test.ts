import { describe, expect, it } from 'vitest'
import { createDefaultProject, createKey, setEvent, setTimingReferenceAt, standardA3SheetTemplate, digitalStandardSheetTemplate, createProjectFromTemplate } from '@xsheet-remap/core'
import { layoutTimingCellText } from './timingCellTextLayout'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { createSheetRenderModelContext, inputTextRenderItemsForPage, referenceOnlyRenderItemsForPage } from './sheetRenderModel'
import type { TextMeasurementProvider } from './textMetrics'

const measurement: TextMeasurementProvider = { measure: (text, font) => ({ widthPx: text.length * font.sizePx * .6, ascentPx: font.sizePx * .8, descentPx: font.sizePx * .2, exact: true }) }
describe('readable reference triangles', () => {
  it('keeps identical typography and a true circular enclosure for long labels and enlarged text', () => {
    for (const text of ['1', '123', 'あいう', '000123456789']) for (const size of [18, 42]) {
      const page = { widthPx: 1200, heightPx: 2400 }, rect = { x: .1, y: .2, w: 90 / 1200, h: 20 / 2400 }
      const base = layoutTimingCellText(text, size, 6, rect, page, measurement)
      const circle = layoutTimingCellText(text, size, 6, rect, page, measurement, 'circle')
      expect(circle.fontSizePx).toBe(base.fontSizePx)
      expect(circle.text).toBe(base.text)
      expect(circle.clipRect).toEqual(base.clipRect)
      expect(circle.textPosition).toBe(base.textPosition)
      expect(circle.outlineWidthPx).toBeGreaterThan(0)
      expect(circle.reference?.circle?.r).toBeCloseTo(9.4)
    }
  })
  for (const [w, h] of [[90, 20], [35, 35], [20, 80]]) for (const text of ['', '1', '12', '123', '000123456789']) {
    it(`bounds ${text || 'empty'} in ${w}x${h} while limiting additional shrinking`, () => {
      const page = { widthPx: 1200, heightPx: 2400 }, rect = { x: .1, y: .2, w: w / 1200, h: h / 2400 }
      const base = layoutTimingCellText(text, 18, 6, rect, page, measurement)
      const result = layoutTimingCellText(text, 18, 6, rect, page, measurement, true)
      expect(result.fontSizePx).toBeGreaterThanOrEqual(Math.min(base.fontSizePx, Math.max(12, Math.round(base.fontSizePx * .8))))
      expect(result.text).toBe(base.text)
      expect(result.reference).toBeDefined()
      for (let i = 0; i < 6; i += 2) {
        expect(result.reference!.points[i]).toBeGreaterThan(rect.x * page.widthPx)
        expect(result.reference!.points[i]).toBeLessThan((rect.x + rect.w) * page.widthPx)
        expect(result.reference!.points[i + 1]).toBeGreaterThan(rect.y * page.heightPx)
        expect(result.reference!.points[i + 1]).toBeLessThan((rect.y + rect.h) * page.heightPx)
      }
      if (text) expect(result.outlineWidthPx).toBeGreaterThan(0)
    })
  }
  for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
    it(`matches screen/export, refreshes cached marks, and renders blanks within the visible range (${template.templateId})`, () => {
      const created = createKey(template === standardA3SheetTemplate ? createDefaultProject() : createProjectFromTemplate(template), 'A', '123', 'manual', undefined, 'cell')
      const plain = setEvent(created.project, 'A', 1, created.key.keyId, 'cell')
      const project = setTimingReferenceAt(setTimingReferenceAt(plain, 'A', 1, 'cell', true), 'A', 3, 'cell', true)
      const context = createSheetRenderModelContext(project, template), page = context.pages[0], cache = new WeakMap()
      const first = eventRectsForPages(plain, template, context.pages, { cache }).get(page.pageId)![0]
      const screen = eventRectsForPages(project, template, context.pages, { cache }).get(page.pageId)![0]
      expect(first.textLayout.reference).toBeUndefined()
      expect(screen.textLayout.reference).toBeDefined()
      expect(screen.textLayout).toEqual(inputTextRenderItemsForPage(context, page)[0].textLayout)
      const circled = setTimingReferenceAt(project, 'A', 1, 'cell', 'circle')
      const circle = eventRectsForPages(circled, template, context.pages, { cache }).get(page.pageId)![0]
      expect(circle.textLayout.reference?.circle).toBeDefined()
      expect(circle.textLayout.fontSizePx).toBe(first.textLayout.fontSizePx)
      expect(circle.textLayout).toEqual(inputTextRenderItemsForPage(createSheetRenderModelContext(circled, template), page)[0].textLayout)
      expect(referenceOnlyRenderItemsForPage(context, page).map(item => item.frame)).toEqual([3])
      expect(referenceOnlyRenderItemsForPage(context, page, { start: 1, end: 2 })).toEqual([])
    })
  }
})
