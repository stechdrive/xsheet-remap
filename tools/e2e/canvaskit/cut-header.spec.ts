import { readFileSync } from 'node:fs'
import type { Download } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, createProjectDocumentFromCutProject, createProjectFromTemplate, digitalStandardSheetTemplate, standardA3SheetTemplate, updateLogicalSheetSettings, type SheetTemplate } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { waitForPaperPaint } from '../paper-paint-contract'
import { channel, darkRowBands, readPng } from '../raster'

type Kind = 'paper' | 'digital' | 'custom'
const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
function templateFor(kind: Kind) {
  const template = structuredClone(kind === 'paper' ? standardA3SheetTemplate : digitalStandardSheetTemplate)
  if (kind === 'custom') {
    const field = template.regions.flatMap(region => region.form?.cells ?? []).find(cell => cell.fieldId === 'digital.cut')!
    field.textStyle = { ...field.textStyle, fontSize: { value: 48, unit: 'px' }, lineHeight: { value: 64, unit: 'px' } }
  }
  return template
}
function documentFor(template: SheetTemplate, count: number) {
  const project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 48 })
  let document = createProjectDocumentFromCutProject(project, { sheetTemplate: template })
  for (let index = 2; index <= count; index++) document = addBlankSharedCutToProjectDocument(document,
    activeCutProjectFromDocument(document), { cut: { cut: String(index).padStart(3, '0') } })
  document.activeCutId = document.cuts[0].cutId
  return document
}
async function openProject(page: Page, document: ReturnType<typeof documentFor>) {
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'shared-cuts.xsr',
    mimeType: 'application/octet-stream', buffer: Buffer.from(await encodeProjectArchive(document)) })
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await page.evaluate(() => window.document.fonts.ready)
  await paint(page)
}
function headerIds(kind: Kind) {
  const primary = kind === 'paper' ? 'top_cut_field' : 'digital_metadata_form:digital_cut_box'
  return { primary, shared: kind === 'paper' ? 'top_shared_cut_numbers_field' : primary + '__shared_cut_numbers' }
}

for (const kind of ['paper', 'digital', 'custom'] as const) {
  test(`shared cut header stays bounded in GPU and print (${kind})`, async ({ page }, info) => {
    const document = documentFor(templateFor(kind), 6)
    await openProject(page, document)
    // Keep the header inside the sheet viewport on narrow touch emulations.
    await activateControl(page, page.getByRole('button', { name: 'CSPレイヤー構成', exact: true }))
    await activateControl(page, page.getByRole('button', { name: '画像素材', exact: true }))
    await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '兼用カットを追加', exact: true }))
    await page.getByLabel('追加する兼用カット名', { exact: true }).fill('007')
    await activateControl(page, page.getByRole('button', { name: '兼用カットを作成', exact: true }))
    await page.getByRole('combobox', { name: '兼用カット', exact: true }).selectOption(document.cuts[0].cutId)
    const shared = page.locator(`.metadataFieldText[data-region-id="${headerIds(kind).shared}"]`)
    await expect(shared).toContainText('007')
    await activateControl(page, page.getByLabel('兼用カット名', { exact: true }))
    await expect(shared).toHaveCount(0)
    await activateControl(page, page.getByLabel('兼用カット名', { exact: true }))
    await expect(shared).toContainText('007')
    await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
    await paint(page)
    await inspectScreenHeader(page, kind, info.outputPath(`${kind}-gpu.png`))
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.sheetSvg').first()).toHaveCSS('opacity', '1')
    await expect(page.locator('.canvasKitPaperCanvas').first()).toBeHidden()
    await page.evaluate(() => window.document.fonts.ready)
    await expect(shared).toContainText('007')
    await inspectScreenHeader(page, kind, info.outputPath(`${kind}-print.png`))
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  })

  test(`PNG batch exports every cut with its own bounded header (${kind})`, async ({ page }, info) => {
    // Seven-cut wrapping stays in every GPU/print case and the unit matrix.
    // Exercise seven real outputs once, plus both other export geometries.
    const count = kind === 'paper' ? 7 : 3
    const document = documentFor(templateFor(kind), count)
    await openProject(page, document)
    const layouts = new Map<string, Awaited<ReturnType<typeof readHeaderLayout>>>()
    await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
    for (const cut of document.cuts) {
      await page.getByRole('combobox', { name: '兼用カット', exact: true }).selectOption(cut.cutId)
      await expect(page.locator(`.metadataFieldText[data-region-id="${headerIds(kind).primary}"]`)).toHaveText(cut.metadata.cut!)
      await paint(page)
      layouts.set(cut.metadata.cut!, await readHeaderLayout(page, kind))
    }
    await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
    await activateControl(page, page.getByRole('button', { name: 'タイムシート画像をPNG形式で書き出す', exact: true }))
    const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
    const downloads: Download[] = []
    const collect = (download: Download) => downloads.push(download)
    page.on('download', collect)
    try {
      await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
      // Preserve the former 30s batch-download budget; the dialog remains open
      // while every cut is rendered, before the first download can start.
      await expect.poll(() => downloads.length, { timeout: 30_000 }).toBe(count)
      await expect(dialog).toHaveCount(0)
      const cuts = downloads.map(download => /_(\d{3})_sheet01\.png$/.exec(download.suggestedFilename())?.[1])
      expect(cuts.slice().sort()).toEqual([...layouts.keys()].sort())
      for (const [index, download] of downloads.entries()) {
        const cut = cuts[index]!, layout = layouts.get(cut)!
        const saved = info.outputPath(`${kind}-${cut}.png`)
        await download.saveAs(saved)
        const actual = await readPng(readFileSync(saved))
        // A tiny independent Canvas2D reference retains page-pixel origins.
        const reference = await page.evaluate(({ lines, rect, paperColor }) => {
          const canvas = window.document.createElement('canvas'); canvas.width = rect.width; canvas.height = rect.height
          const ctx = canvas.getContext('2d')!
          ctx.fillStyle = paperColor; ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.translate(-rect.x, -rect.y)
          ctx.fillStyle = '#1f2421'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'
          for (const line of lines) { ctx.font = line.font; ctx.fillText(line.value, line.x, line.y) }
          return canvas.toDataURL('image/png').split(',')[1]
        }, { lines: layout.lines, rect: layout.exportRect, paperColor: templateFor(kind).theme.paper.color })
        const expected = await readPng(Buffer.from(reference, 'base64')), rect = layout.exportRect
        const bands = darkRowBands(actual, rect)
        expect(bands, `${cut}: every header row is exported`).toHaveLength(layout.lines.length)
        expect(bands).toEqual(darkRowBands(expected, { x: 0, y: 0, width: expected.width, height: expected.height })
          .map(band => ({ top: band.top + rect.y, bottom: band.bottom + rect.y })))
        // Row heights alone cannot detect a duplicate image with another cut number.
        const dark = (image: typeof actual, x: number, y: number) => [0, 1, 2].every(c => channel(image, x, y, c) < 150)
        let changedInk = 0
        for (let y = 0; y < expected.height; y++) for (let x = 0; x < expected.width; x++) {
          if (dark(actual, x + rect.x, y + rect.y) !== dark(expected, x, y)) changedInk++
        }
        expect(changedInk, `${cut}: actual glyphs match this cut, not another output`).toBe(0)
      }
      expect(downloads).toHaveLength(count)
    } finally { page.off('download', collect) }
  })
}

async function readHeaderLayout(page: Page, kind: Kind) {
  const ids = headerIds(kind)
  const lines = await page.locator(`.metadataFieldText[data-region-id="${ids.primary}"], .metadataFieldText[data-region-id="${ids.shared}"]`).evaluateAll(elements => {
    const ctx = document.createElement('canvas').getContext('2d')!
    return elements.flatMap(element => {
      const text = element as SVGTextElement, style = getComputedStyle(text)
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
      ctx.textAlign = 'center'
      const matrix = text.getScreenCTM()!
      const parent = text.parentElement as unknown as SVGGElement
      const clipId = /#([^)]*)/.exec(parent.getAttribute('clip-path')!)![1]
      const clip = document.getElementById(clipId)!.querySelector('rect')!
      const parentMatrix = parent.getScreenCTM()!
      const corner = new DOMPoint(clip.x.baseVal.value, clip.y.baseVal.value).matrixTransform(parentMatrix)
      const opposite = new DOMPoint(clip.x.baseVal.value + clip.width.baseVal.value, clip.y.baseVal.value + clip.height.baseVal.value).matrixTransform(parentMatrix)
      return Array.from(text.querySelectorAll('tspan')).map(line => {
        const metrics = ctx.measureText(line.textContent ?? ''), x = Number(line.getAttribute('x')), y = Number(line.getAttribute('y'))
        const left = x - metrics.actualBoundingBoxLeft, right = x + metrics.actualBoundingBoxRight
        const top = y - metrics.actualBoundingBoxAscent, bottom = y + metrics.actualBoundingBoxDescent
        const start = new DOMPoint(left, top).matrixTransform(matrix), end = new DOMPoint(right, bottom).matrixTransform(matrix)
        return { value: line.textContent ?? '', x, y, font: ctx.font, top, bottom, left, right, baseline: style.dominantBaseline,
          screen: { left: start.x, top: start.y, right: end.x, bottom: end.y },
          clip: { left: corner.x, top: corner.y, right: opposite.x, bottom: opposite.y } }
      })
    })
  })
  expect(lines.length).toBeGreaterThanOrEqual(2)
  for (const [index, line] of lines.entries()) {
    expect(line.baseline).toBe('alphabetic')
    if (index) expect(line.top).toBeGreaterThan(lines[index - 1].bottom)
    expect(line.screen.left).toBeGreaterThanOrEqual(line.clip.left - .01)
    expect(line.screen.right).toBeLessThanOrEqual(line.clip.right + .01)
    expect(line.screen.top).toBeGreaterThanOrEqual(line.clip.top - .01)
    expect(line.screen.bottom).toBeLessThanOrEqual(line.clip.bottom + .01)
  }
  const x = Math.floor(Math.min(...lines.map(line => line.left))) - 2, y = Math.floor(lines[0].top) - 2
  return { lines, exportRect: { x, y, width: Math.ceil(Math.max(...lines.map(line => line.right))) - x + 2,
    height: Math.ceil(lines.at(-1)!.bottom) - y + 2 } }
}

async function inspectScreenHeader(page: Page, kind: Kind, file: string) {
  const { lines } = await readHeaderLayout(page, kind)
  // Capture the viewport so WebKit's print compositor paints the whole header.
  // Inspect the original device pixels, without browser-side crop translation.
  const image = await readPng(await page.screenshot({ path: file }))
  const scale = await page.evaluate(() => devicePixelRatio)
  // At 50% display scale adjacent bracket rows can touch after rasterization.
  // Inspect each expected row's interior, so a missing row cannot be replaced
  // by one edge pixel from its neighbour. Logical non-overlap is checked above.
  for (const line of lines) {
    const rect = { x: line.screen.left * scale, y: line.screen.top * scale,
      width: (line.screen.right - line.screen.left) * scale, height: (line.screen.bottom - line.screen.top) * scale }
    // Tiny print-preview glyphs have partially covered foreground pixels
    // (the captured trace has RGB 145..194 across the last row). Require about
    // 20% ink coverage against this fixture's >=244 paper, not full-size ink.
    const bands = darkRowBands(image, rect, 200)
    const occupiedRows = bands.reduce((count, band) => count + band.bottom - band.top + 1, 0)
    expect(occupiedRows, `GPU/print row ${line.value} has actual ink across its height`).toBeGreaterThanOrEqual(Math.ceil(rect.height * .5))
    expect(darkRowBands(image, { ...rect, y: rect.y + rect.height * .25, height: rect.height * .5 }, 200),
      `GPU/print row ${line.value} has ink in its own interior`).not.toHaveLength(0)
    expect(bands[0].top).toBeGreaterThanOrEqual(rect.y - 1)
    expect(bands.at(-1)!.bottom).toBeLessThanOrEqual(rect.y + rect.height + 1)
  }
}
