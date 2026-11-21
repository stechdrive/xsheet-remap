import { describe, expect, it } from 'vitest'
import { createDefaultProject, createKey, setEvent, setTimingReferenceAt, standardA3SheetTemplate, digitalStandardSheetTemplate, createProjectFromTemplate } from '@xsheet-remap/core'
import { layoutTimingCellText } from './timingCellTextLayout'
import { eventRectsForPages } from './sheet-layers-hit-geometry'
import { createSheetRenderModelContext, inputTextRenderItemsForPage, referenceOnlyRenderItemsForPage } from './sheetRenderModel'
import type { TextMeasurementProvider } from './textMetrics'

const measurement: TextMeasurementProvider = { measure: (text, font) => ({ widthPx: text.length * font.sizePx * .6, ascentPx: font.sizePx * .8, descentPx: font.sizePx * .2, exact: true }) }
describe('timing reference enclosures', () => {
  it('widens the enclosure around text without changing typography or crossing cell edges', () => {
    for (const [w, h] of [[90, 20], [35, 35], [20, 80], [1, 1], [0, 0]])
      for (const text of ['', '1', '12', '123', 'あいう', '000123456789']) for (const size of [18, 42]) {
      const page = { widthPx: 1200, heightPx: 2400 }, rect = { x: .1, y: .2, w: w / 1200, h: h / 2400 }
      const base = layoutTimingCellText(text, size, 6, rect, page, measurement)
      const circle = layoutTimingCellText(text, size, 6, rect, page, measurement, 'circle')
      expect(circle.fontSizePx).toBe(base.fontSizePx)
      expect(circle.text).toBe(base.text)
      expect(circle.clipRect).toEqual(base.clipRect)
      expect(circle.outlineWidthPx).toBeGreaterThan(0)
      const { rx, ry, cx, cy } = circle.reference!.ellipse!
      const halfStroke = circle.reference!.strokeWidthPx / 2
      expect(rx).toBeGreaterThanOrEqual(ry)
      expect(rx + halfStroke).toBeLessThanOrEqual(w / 2 + 1e-8)
      expect(ry + halfStroke).toBeLessThanOrEqual(h / 2 + 1e-8)
      expect(cx).toBeCloseTo(rect.x * page.widthPx + w / 2)
      expect(cy).toBeCloseTo(rect.y * page.heightPx + h / 2)
      if (w === 90 && text === '12') expect(rx).toBeGreaterThan(ry * 1.3)
      if (!text) expect(rx).toBe(ry)
    }
  })
  it.each([[90, 20], [35, 35], [20, 80], [1, 1], [0, 0]])('preserves the ordinary label and bounds the triangle in a %dx%d cell', (w, h) => {
    const page = { widthPx: 1200, heightPx: 2400 }, rect = { x: .1, y: .2, w: w / 1200, h: h / 2400 }
    const left = rect.x * page.widthPx, top = rect.y * page.heightPx
    for (const text of ['', '1', '12', '123', 'あいう', '000123456789']) for (const size of [18, 42]) {
      for (const [fit, fitHeight] of [[false, false], [true, false], [true, true]]) {
        const base = layoutTimingCellText(text, size, 6, rect, page, measurement, false, fit, fitHeight)
        const triangle = layoutTimingCellText(text, size, 6, rect, page, measurement, 'triangle', fit, fitHeight)
        const { reference, outlineWidthPx, ...label } = triangle
        expect(label).toEqual(base)
        if (base.text.trim()) expect(outlineWidthPx).toBeGreaterThan(0)
        const [tipX, tipY, rightX, rightY, leftX, leftY] = reference!.points
        const halfStroke = reference!.strokeWidthPx / 2
        expect(tipX).toBeCloseTo(left + w / 2)
        expect(rightX - tipX).toBeCloseTo(tipX - leftX)
        expect(rightY).toBe(leftY)
        expect(leftX - halfStroke).toBeGreaterThanOrEqual(left - 1e-8)
        expect(rightX + halfStroke).toBeLessThanOrEqual(left + w + 1e-8)
        expect(tipY - halfStroke).toBeGreaterThanOrEqual(top - 1e-8)
        expect(leftY + halfStroke).toBeLessThanOrEqual(top + h + 1e-8)
        if (w > 0 && h > 0) {
          expect(rightX).toBeGreaterThan(leftX)
          expect(leftY).toBeGreaterThan(tipY)
        }
      }
    }
  })
  it('widens a triangle for two digits and keeps a compact standalone mark on an empty frame', () => {
    const page = { widthPx: 200, heightPx: 100 }, rect = { x: 0, y: 0, w: .5, h: .3 }
    const points = (text: string) => layoutTimingCellText(text, 18, 6, rect, page, measurement, 'triangle').reference!.points
    const width = (p: number[]) => p[2] - p[4]
    const single = points('1'), double = points('12'), empty = points('')
    expect(width(double)).toBeGreaterThan(width(single))
    expect(double[1]).toBe(single[1])
    expect(width(empty)).toBeLessThan(width(single))
    expect(width(empty) * Math.sqrt(3) / 2).toBeCloseTo(empty[3] - empty[1])
  })
  for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
    it(`matches screen/export, refreshes cached marks, and renders blanks within the visible range (${template.templateId})`, () => {
      const created = createKey(template === standardA3SheetTemplate ? createDefaultProject() : createProjectFromTemplate(template), 'A', '123', 'manual', undefined, 'cell')
      const plain = setEvent(created.project, 'A', 1, created.key.keyId, 'cell')
      const project = setTimingReferenceAt(setTimingReferenceAt(plain, 'A', 1, 'cell', true), 'A', 3, 'cell', true)
      const context = createSheetRenderModelContext(project, template), page = context.pages[0], cache = new WeakMap()
      const first = eventRectsForPages(plain, template, context.pages, { cache }).get(page.pageId)![0]
      const screen = eventRectsForPages(project, template, context.pages, { cache }).get(page.pageId)![0]
      expect(first.textLayout.reference).toBeUndefined()
      expect(screen.textLayout.reference?.points).toHaveLength(6)
      expect(screen.textLayout.fontSizePx).toBe(first.textLayout.fontSizePx)
      expect(screen.textLayout.clipRect).toEqual(first.textLayout.clipRect)
      expect(screen.textLayout).toEqual(inputTextRenderItemsForPage(context, page)[0].textLayout)
      const circled = setTimingReferenceAt(project, 'A', 1, 'cell', 'circle')
      const circle = eventRectsForPages(circled, template, context.pages, { cache }).get(page.pageId)![0]
      expect(circle.textLayout.reference?.ellipse).toBeDefined()
      expect(circle.textLayout.fontSizePx).toBe(first.textLayout.fontSizePx)
      expect(circle.textLayout).toEqual(inputTextRenderItemsForPage(createSheetRenderModelContext(circled, template), page)[0].textLayout)
      expect(referenceOnlyRenderItemsForPage(context, page).map(item => item.frame)).toEqual([3])
      expect(referenceOnlyRenderItemsForPage(context, page, { start: 1, end: 2 })).toEqual([])
    })
  }
})
