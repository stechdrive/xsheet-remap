import { expect, test, type Page } from './fixtures'
import { writeFile } from 'node:fs/promises'
import { createProjectFromTemplate, createProjectDocumentFromCutProject, createOrSetEvent, digitalStandardSheetTemplate,
  standardA3SheetTemplate, updateLogicalSheetSettings, validateProject, type SheetTemplate, type TimedRangeCue, type TimelineInkMemo } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { uiText } from '../../../packages/ui/src/i18n'
import { waitForPaperPaint } from '../paper-paint-contract'

const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
async function loadLongSheet(page: Page, template: SheetTemplate) {
  let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 14_400 })
  const created = createOrSetEvent(project, 'A', 1)
  project = { ...created.project, logicalSheet: { ...created.project.logicalSheet,
    events: Array.from({ length: 7200 }, (_, index) => ({ ...created.project.logicalSheet.events[0]!, eventId: `event_${index + 1}`, frame: index * 2 + 1 })),
  }, sheetView: { ...created.project.sheetView, viewMode: 'continuous' } }
  project.timedRangeCues = Array.from({ length: 100 }, (_, index) => (['sound', 'camera'] as const).map(role => ({
    cueId: `${role}_${index}`, role, laneId: `${role}_lane_1`, frameStart: index * 144 + 1, frameEnd: index * 144 + 72,
    label: role === 'sound' ? 'セリフ' : 'PAN', text: role === 'sound' ? '表示範囲を移動しても文章の位置を保つ。' : '', source: 'manual',
    camera: role === 'camera' ? { shape: 'range' } : undefined,
  } satisfies TimedRangeCue))).flat()
  project.memos = Array.from({ length: 100 }, (_, index): TimelineInkMemo => ({
    kind: 'timeline', memoId: `memo_${index}`, order: index, anchor: { role: 'cell', paperTrack: 'B', frame: index * 144 + 6 },
    placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 }, strokes: [],
    texts: [{ textId: `text_${index}`, x: 1, y: 1, text: `メモ ${index + 1}` }],
  }))
  expect(validateProject(project)).toEqual([])
  const bytes = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
  await page.goto('./')
  await paint(page)
  await page.getByLabel(uiText.nav.menu, { exact: true }).click()
  await page.locator('.appNavMenu input[accept*=".xsr"]').setInputFiles({ name: 'rendering-scale.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await expect(page.locator('[data-sheet-page-slot]')).toHaveCount(template.page.isPhysical ? 100 : 1)
  await paint(page)
}

test('physical pages retain scroll layout with bounded mounted content and print all pages', async ({ page }, info) => {
  await loadLongSheet(page, standardA3SheetTemplate)
  expect(await page.locator('.sheetSvg').count()).toBeLessThan(8)
  const height = await page.locator('.sheetViewport').evaluate(element => element.scrollHeight)
  await page.locator('[data-sheet-page-slot="page_50"]').scrollIntoViewIfNeeded()
  await expect(page.locator('.sheetSvg[data-page-id="page_50"]')).toHaveAttribute('data-canvaskit-state', 'active')
  await paint(page)
  expect(await page.locator('.sheetSvg').count()).toBeLessThan(9)
  expect(await page.locator('.sheetViewport').evaluate(element => element.scrollHeight)).toBe(height)
  const resources = await page.locator('.sheetSvg').evaluateAll(elements => elements.map(element => ({
    page: (element as SVGSVGElement).dataset.pageId, ...Object.fromEntries(Object.entries((element as SVGSVGElement).dataset).filter(([key]) => key.startsWith('canvaskit'))),
  })))
  await writeFile(info.outputPath('page-resources.json'), JSON.stringify(resources, null, 2))
  await page.screenshot({ path: info.outputPath('page-50.png') })
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await expect(page.locator('.sheetSvg')).toHaveCount(100)
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect.poll(() => page.locator('.sheetSvg').count()).toBeLessThan(9)
})

test('digital scrolling bounds rows and timing graphics and retains exact reconstructed pixels', async ({ page }, info) => {
  await loadLongSheet(page, digitalStandardSheetTemplate)
  const source = page.locator('.sheetSvg').first()
  for (const fraction of [0, .5, 1, .25, 0]) {
    await page.locator('.sheetViewport').evaluate((element, fraction) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction }, fraction)
    await paint(page)
    expect(await source.locator('[data-timeline-event-frame]').count()).toBeLessThan(600)
    expect(await source.locator('.soundCue').count()).toBeLessThan(12)
    expect(await source.locator('.cameraCue').count()).toBeLessThan(12)
    expect(await source.locator('[data-timeline-memo-id]').count()).toBeLessThan(24)
    if (fraction === 0) {
      expect(await source.locator('.soundCue').count()).toBeGreaterThan(0)
      expect(await source.locator('.cameraCue').count()).toBeGreaterThan(0)
      expect(await source.locator('[data-timeline-memo-id]').count()).toBeGreaterThan(0)
    }
    const primitives = await source.locator('[data-paper-primitive-count]').evaluateAll(elements => elements.reduce((count, element) => count + Number(element.getAttribute('data-paper-primitive-count')), 0))
    expect(primitives).toBeLessThan(5000)
    const retained = await page.screenshot()
    await source.evaluate((svg, value) => svg.setAttribute('data-e2e-rebuild', String(value)), fraction)
    await paint(page)
    expect((await page.screenshot()).equals(retained), `same pixels after rebuilding at ${fraction}`).toBe(true)
    await source.evaluate(svg => { svg.dataset.paperModelMode = 'svg' })
    await paint(page)
    expect((await page.screenshot()).equals(retained), `text and cue pixels match SVG capture at ${fraction}`).toBe(true)
    await source.evaluate(svg => { delete svg.dataset.paperModelMode })
    await paint(page)
  }
  await page.screenshot({ path: info.outputPath('digital-window.png') })
})
