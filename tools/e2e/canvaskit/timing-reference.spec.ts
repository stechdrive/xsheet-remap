import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createProjectFromTemplate, createKey, setEvent, setTimingSpecialEvent, createProjectDocumentFromCutProject,
  digitalStandardSheetTemplate, standardA3SheetTemplate, activeCutProjectFromDocument } from '../../../packages/core/src/index'
import { encodeProjectArchive, decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'
import { createSheetRenderModelContext, inputTextRenderItemsForPage } from '../../../packages/ui/src/sheetRenderModel'
import { waitForPaperPaint } from '../paper-paint-contract'

for (const template of [digitalStandardSheetTemplate, standardA3SheetTemplate]) test(`reference triangle editing and circular pixels in screen/PNG (${template.templateId})`, async ({ page }, info) => {
  let project = createProjectFromTemplate(template)
  for (const [track, label] of [['A', '1'], ['B', '12'], ['C', '123']]) {
    const created = createKey(project, track, label, 'manual', undefined, 'cell')
    project = setEvent(created.project, track, 1, created.key.keyId, 'cell')
  }
  project = setTimingSpecialEvent(project, 'D', 1, 'inbetween', 'cell')
  const context = createSheetRenderModelContext(project, template)
  const circleRect = inputTextRenderItemsForPage(context, context.pages[0]).find(item => item.paperTrack === 'D')!.rect
  const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'symbols.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  const svg = page.locator('.sheetSvg').first()
  const ready = async () => {
    await expect(svg).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await page.evaluate(() => document.fonts.ready)
    await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  }
  await ready()
  // Expose the full cell group on narrow viewports before pointing at it.
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  await ready()
  const event = (track: string) => page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="${track}"][data-timeline-event-frame="1"]`)
  const contextMenu = async (track: string) => {
    // CanvasKit owns the visible paper; retained SVG shapes supply geometry,
    // while pointer input is routed through the paper hit tester.
    const box = await event(track).locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2, { button: 'right' })
  }
  for (const track of ['A', 'B', 'C']) {
    const ordinarySize = Number(await event(track).locator('.eventText').getAttribute('font-size'))
    await contextMenu(track)
    await activateControl(page, page.getByRole('menuitem', { name: '参考記号を付加（△）', exact: true }))
    await expect(event(track).locator('polygon.eventReferenceSymbol')).toHaveCount(1)
    const text = event(track).locator('.eventText')
    expect(Number(await text.getAttribute('font-size'))).toBeGreaterThanOrEqual(Math.min(ordinarySize, Math.max(12, Math.round(ordinarySize * .8))))
    await expect(text).toHaveCSS('paint-order', 'stroke')
    await expect(text).toHaveCSS('dominant-baseline', 'alphabetic')
  }
  await contextMenu('C')
  await activateControl(page, page.getByRole('menuitem', { name: '参考記号を解除', exact: true }))
  await expect(event('C').locator('polygon.eventReferenceSymbol')).toHaveCount(0)
  await expect(event('C').locator('.eventText')).toHaveText('123')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event('C').locator('polygon.eventReferenceSymbol')).toHaveCount(1)
  await ready()
  // Empty frame beneath A: uses the grid's ordinary pointer target.
  // SVG's transparent default stroke expands Playwright's boundingBox by a
  // normalized page unit. getBoundingClientRect measures the actual cell edges.
  const aBox = await event('A').locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  await page.mouse.click(aBox!.x + aBox!.width / 2, aBox!.y + aBox!.height * 2.5, { button: 'right' })
  await activateControl(page, page.getByRole('menuitem', { name: '参考記号を付加（△）', exact: true }))
  await expect(page.locator('.timingReferenceGraphics')).toHaveAttribute('data-paper-primitive-count', '1')
  await page.mouse.move(5, 5)
  await ready()
  const direct = await page.screenshot({ path: info.outputPath('reference-direct.png') })
  const symbolArea = await event('D').locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  const symbolClip = { x: aBox.x - 2, y: aBox.y - 2, width: symbolArea.right - aBox.x + 4, height: aBox.height * 3 + 4 }
  const directSymbols = await page.screenshot({ clip: symbolClip })
  await svg.evaluate(svg => { svg.dataset.paperModelMode = 'svg' })
  await ready()
  await page.screenshot({ path: info.outputPath('reference-svg.png') })
  const fallbackSymbols = await page.screenshot({ clip: symbolClip })
  // SVG matrix serialization can round antialiasing by one channel level;
  // the WebKit A3 trace showed exactly seven such pixels and no displaced ink.
  const pixelDifference = await page.evaluate(async ([a, b]) => {
    const decode = async (base64: string) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return ctx.getImageData(0, 0, image.width, image.height).data
    }
    const first = await decode(a), second = await decode(b)
    if (first.length !== second.length) return Infinity
    let maximum = 0
    for (let i = 0; i < first.length; i++) maximum = Math.max(maximum, Math.abs(first[i] - second[i]))
    return maximum
  }, [directSymbols.toString('base64'), fallbackSymbols.toString('base64')])
  expect(pixelDifference, 'direct and SVG symbol pixels agree within one antialiasing level').toBeLessThanOrEqual(1)
  await svg.evaluate(svg => { delete svg.dataset.paperModelMode })
  await ready()
  // Actual GPU pixels, with geometry from the on-screen cell only for the crop.
  const crop = await event('D').locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  const screenInk = await measureInk(direct.toString('base64'), { x: crop!.x, y: crop!.y, w: crop!.width, h: crop!.height }, await page.evaluate(() => devicePixelRatio))
  expect(Math.abs(screenInk.width - screenInk.height)).toBeLessThanOrEqual(2)
  expect(screenInk.width).toBeGreaterThan(2)

  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'タイムシート画像をPNG形式で書き出す', exact: true }))
  const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
  const pending = page.waitForEvent('download')
  await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
  const saved = info.outputPath('symbols.png'); await (await pending).saveAs(saved)
  await expect(dialog).toHaveCount(0)
  const pngInk = await measureInk(readFileSync(saved).toString('base64'), {
    x: circleRect.x * context.pageSize.widthPx, y: circleRect.y * context.pageSize.heightPx,
    w: circleRect.w * context.pageSize.widthPx, h: circleRect.h * context.pageSize.heightPx,
  }, 1)
  expect(Math.abs(pngInk.width - pngInk.height)).toBeLessThanOrEqual(1)
  expect(pngInk.width).toBeGreaterThan(Math.min(circleRect.w * context.pageSize.widthPx, circleRect.h * context.pageSize.heightPx) * .35)
  expect(pngInk.width).toBeLessThan(Math.min(circleRect.w * context.pageSize.widthPx, circleRect.h * context.pageSize.heightPx) * .55)
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const download = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const savedProject = info.outputPath('reference.xsr'); await (await download).saveAs(savedProject)
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(savedProject)))).document)
  expect(restored.logicalSheet.referenceMarks).toHaveLength(4)
  expect(restored.logicalSheet.events).toEqual(project.logicalSheet.events)
  expect(restored.logicalSheet.keys).toEqual(project.logicalSheet.keys)

  async function measureInk(base64: string, rect: { x: number; y: number; w: number; h: number }, scale: number) {
    return page.evaluate(async ({ base64, rect, scale }) => {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const x = Math.ceil((rect.x + rect.w * .15) * scale), y = Math.ceil((rect.y + rect.h * .15) * scale)
      const data = ctx.getImageData(x, y, Math.floor(rect.w * .7 * scale), Math.floor(rect.h * .7 * scale))
      const points = []
      for (let py = 0; py < data.height; py++) for (let px = 0; px < data.width; px++) {
        const i = (py * data.width + px) * 4
        if (data.data[i] < 140 && data.data[i + 1] < 160 && data.data[i + 2] < 140) points.push({ x: px, y: py })
      }
      return { width: Math.max(...points.map(p => p.x)) - Math.min(...points.map(p => p.x)) + 1,
        height: Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y)) + 1 }
    }, { base64, rect, scale })
  }
})
