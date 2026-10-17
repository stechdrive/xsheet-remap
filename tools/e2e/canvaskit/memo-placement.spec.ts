import { readFileSync } from 'node:fs'
import type { Download } from '@playwright/test'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { createProjectFromTemplate, updateLogicalSheetSettings, createProjectDocumentFromCutProject,
  activeCutProjectFromDocument, standardA3SheetTemplate, digitalStandardSheetTemplate, type TimelineInkMemo } from '../../../packages/core/src/index'
import { encodeProjectArchive, decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'
import { createSheetRenderModelContext } from '../../../packages/ui/src/sheetRenderModel'
import { timelineMemoSegmentsForPage } from '../../../packages/ui/src/timelineMemoGeometry'
import { waitForPaperPaint } from '../paper-paint-contract'
import { readPsdComposite } from '../psd-composite'
import { pinkPixelCount, psdRaster, readPng } from '../raster'

const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
const memo = (id: string, frame: number, heightFrames = 4): TimelineInkMemo => ({
  kind: 'timeline', memoId: id, order: 1, anchor: { role: 'action', paperTrack: 'A', frame },
  placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 7, heightFrames },
  strokes: [{ strokeId: `${id}-ink`, color: '#d000c0', widthUnits: .4, points: [{ x: 1, y: .75 }, { x: 5, y: heightFrames - .75 }] }],
  texts: [{ textId: `${id}-text`, text: '123', x: 1, y: 1 }],
  appearance: { background: { enabled: true, color: '#e0ffe0', opacity: 1 }, inkOpacity: 1, textOpacity: 1,
    text: { color: '#d000c0', fontSizeUnits: 1 } },
})

for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
  test(`anchored memos can be dragged into paper headers and reselected (${template.templateId})`, async ({ page }, info) => {
    const paper = template === standardA3SheetTemplate
    let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: paper ? 288 : 48 })
    project = { ...project, sheetView: { ...project.sheetView, viewMode: 'continuous' },
      memos: (paper ? [10, 80, 154] : [10]).map(frame => memo(`memo-${frame}`, frame)) }
    const context = createSheetRenderModelContext(project, template)
    const movedOffsets = new Map<string, number>()
    await openProject(page, await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template })))
    await activateControl(page, page.getByRole('button', { name: 'CSPレイヤー構成', exact: true }))
    await activateControl(page, page.getByRole('button', { name: '画像素材', exact: true }))
    for (const source of project.memos as TimelineInkMemo[]) {
      const pageModel = context.pages.find(p => p.frameStart <= source.anchor.frame && p.frameEnd >= source.anchor.frame)!
      const original = timelineMemoSegmentsForPage(template, pageModel, source, { paperTracks: ['A'] })[0]!
      const svg = page.locator(`.sheetSvg[data-page-id="${pageModel.pageId}"]`)
      // Scroll through the viewport, preserving the real hit-test path.
      const group = page.locator(`.timelineMemoSegment[data-timeline-memo-id="${source.memoId}"]`)
      await group.scrollIntoViewIfNeeded()
      const ink = await group.locator('.timelineMemoStrokeHit').evaluate(el => el.getBoundingClientRect().toJSON())
      await page.mouse.click(ink.x + ink.width / 2, ink.y + ink.height / 2, { button: 'right' })
      await activateControl(page, page.getByRole('menuitem', { name: 'メモを編集', exact: true }))
      const surface = group.locator('.timelineMemoMoveFrame')
      await expect(surface).toHaveCount(1)
      await svg.evaluate(svg => {
        const viewport = svg.closest('.sheetViewport')!
        viewport.scrollTop += svg.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 16
      })
      await paint(page)
      const box = await surface.evaluate(el => el.getBoundingClientRect().toJSON())
      const pageBox = await svg.evaluate(el => el.getBoundingClientRect().toJSON())
      const localRow = (source.anchor.frame - pageModel.frameStart) % 72
      const gridTop = original.rect.y - localRow * original.rowHeightY
      const targetY = Math.max(.002, gridTop - original.rect.h - original.rowHeightY / 2)
      const dy = (targetY - original.rect.y) * pageBox.height
      await page.mouse.move(box.x + box.width / 2, box.y)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2, box.y + dy, { steps: 8 })
      await page.mouse.up()
      // WebKit rounds mouse coordinates to CSS pixels. Check the drag in that
      // physical space; pure geometry tests retain the exact logical checks.
      await expect.poll(async () => Math.abs(Number(await surface.getAttribute('y')) - targetY) * pageBox.height).toBeLessThanOrEqual(1)
      const draggedY = Number(await surface.getAttribute('y'))
      movedOffsets.set(source.memoId, (draggedY - original.rect.y) / original.rowHeightY)
      expect(Number(await surface.getAttribute('height'))).toBeCloseTo(original.rect.h, 5)
      expect(await page.locator(`[data-timeline-memo-ids="${source.memoId}"]`).getAttribute('data-timeline-memo-anchor-frame')).toBe(String(source.anchor.frame))
      const background = group.locator('.timelineMemoBackground')
      await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
      await expect.poll(async () => Number(await background.getAttribute('y'))).toBeCloseTo(original.rect.y, 5)
      await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
      await expect.poll(async () => Number(await background.getAttribute('y'))).toBeCloseTo(draggedY, 5)
      await page.keyboard.press('Escape')
      await paint(page)
      const movedInk = await group.locator('.timelineMemoStrokeHit').evaluate(el => el.getBoundingClientRect().toJSON())
      await page.mouse.click(movedInk.x + movedInk.width / 2, movedInk.y + movedInk.height / 2, { button: 'right' })
      // Header context actions must not steal a memo's own menu.
      await activateControl(page, page.getByRole('menuitem', { name: 'メモを編集', exact: true }))
      await expect(surface).toHaveCount(1)
      // Finish editing so the floating tool palette cannot cover the pixels
      // being inspected on a narrow viewport.
      await page.keyboard.press('Escape')
      await expect(surface).toHaveCount(0)
      await paint(page)
      const screenshot = await page.screenshot({ path: info.outputPath(`${source.memoId}-header.png`) })
      const visible = await background.evaluate(el => el.getBoundingClientRect().toJSON())
      const ratio = await page.evaluate(() => devicePixelRatio)
      expect(pinkPixelCount(await readPng(screenshot), { x: visible.x * ratio, y: visible.y * ratio,
        width: visible.width * ratio, height: visible.height * ratio })).toBeGreaterThan(8)
    }
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
    const pending = page.waitForEvent('download')
    await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
    const saved = info.outputPath('header-memos.xsr'); await (await pending).saveAs(saved)
    const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))).document)
    expect(restored.memos.map(item => item.kind === 'timeline' ? item.memoId : item.kind))
      .toEqual((project.memos as TimelineInkMemo[]).map(item => item.memoId))
    restored.memos.forEach((item, i) => {
      expect(item.kind).toBe('timeline')
      const actual = item as TimelineInkMemo, before = project.memos[i] as TimelineInkMemo
      expect(actual.anchor).toEqual(before.anchor)
      expect(actual.strokes).toEqual(before.strokes)
      expect(actual.texts).toEqual(before.texts)
      expect(actual.placement.frameOffset).toBe(0)
      expect(actual.placement.pageOffsetYUnits).toBeLessThan(0)
      expect(actual.placement.pageOffsetYUnits).toBeCloseTo(movedOffsets.get(actual.memoId)!, 5)
    })
    await openProject(page, new Uint8Array(readFileSync(saved)))
    for (const source of project.memos as TimelineInkMemo[]) {
      const pageModel = context.pages.find(p => p.frameStart <= source.anchor.frame && p.frameEnd >= source.anchor.frame)!
      await page.locator(`.sheetSvg[data-page-id="${pageModel.pageId}"]`).scrollIntoViewIfNeeded()
      await expect(page.locator(`.timelineMemoSegment[data-timeline-memo-id="${source.memoId}"]`)).toHaveCount(1)
    }
  })

  test(`header and margin memo pixels survive PNG/PSD export, wraps and page boundaries (${template.templateId})`, async ({ page }, info) => {
    const paper = template === standardA3SheetTemplate
    let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: paper ? 288 : 48 })
    const memos = [memo('header', 10), memo('footer', 30), ...(paper ? [memo('wrap', 70, 8), memo('page-wrap', 142, 8)] : [])]
    const context = createSheetRenderModelContext(project, template)
    for (const item of memos) {
      const segment = timelineMemoSegmentsForPage(template, context.pages[0]!, item, { paperTracks: ['A'] })[0]!
      const targetY = item.memoId === 'header' ? .03 : item.memoId === 'footer' ? 1 - segment.rect.h / 2 : null
      item.placement.pageOffsetYUnits = targetY === null ? -3 : (targetY - segment.rect.y) / segment.rowHeightY
      if (item.memoId === 'footer') item.placement.crossOffsetUnits = 12
    }
    project = { ...project, memos }
    const segments = context.pages.flatMap(pageModel => memos.flatMap(item =>
      timelineMemoSegmentsForPage(template, pageModel, item, { paperTracks: ['A'] }).map(segment => ({ item, pageModel, segment }))))
    // Explicit coverage, independent of the production segmentation result: an
    // omitted continuation must fail before its pixel loop can become empty.
    expect(segments.map(({ item, pageModel, segment }) => [item.memoId, pageModel.pageId, segment.regionId, segment.memoYStart, segment.memoYEnd]))
      .toEqual(paper ? [
        ['header', 'page_1', 'left_action_grid', 0, 4], ['footer', 'page_1', 'left_action_grid', 0, 4],
        ['wrap', 'page_1', 'left_action_grid', 0, 3], ['wrap', 'page_1', 'right_action_grid', 3, 8],
        ['page-wrap', 'page_1', 'right_action_grid', 0, 3], ['page-wrap', 'page_2', 'left_action_grid', 3, 8],
      ] : [['header', 'page_1', 'digital_action_grid', 0, 4], ['footer', 'page_1', 'digital_action_grid', 0, 4]])
    await openProject(page, await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template })))
    for (const format of ['PNG', 'PSD']) {
      await activateControl(page, page.getByLabel('画面切替', { exact: true }))
      await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
      await activateControl(page, page.getByRole('button', { name: `タイムシート画像を${format}形式で書き出す`, exact: true }))
      const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
      const downloads: Download[] = []
      const collectDownload = (download: Download) => downloads.push(download)
      page.on('download', collectDownload)
      await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
      await expect.poll(() => downloads.length).toBe(context.pages.length)
      page.off('download', collectDownload)
      const images: Buffer[] = []
      for (const [index, download] of downloads.entries()) {
        const saved = info.outputPath(`memos-page-${index + 1}.${format.toLowerCase()}`); await download.saveAs(saved)
        images.push(readFileSync(saved))
      }
      await expect(dialog).toHaveCount(0)
      const rasters = await Promise.all(images.map(image => format === 'PSD' ? psdRaster(readPsdComposite(image)) : readPng(image)))
      for (const image of rasters) expect([image.width, image.height]).toEqual([context.pageSize.widthPx, context.pageSize.heightPx])
      for (const { item, pageModel, segment } of segments) {
          const rect = { x: segment.rect.x * context.pageSize.widthPx,
            y: segment.rect.y * context.pageSize.heightPx,
            width: segment.rect.w * context.pageSize.widthPx, height: Math.min(segment.rect.h, 1 - segment.rect.y) * context.pageSize.heightPx }
          expect(pinkPixelCount(rasters[pageModel.pageIndex], rect), `${format}/${item.memoId}/${pageModel.pageId}/${segment.regionId}`).toBeGreaterThan(8)
      }
      if (paper) {
        const footer = timelineMemoSegmentsForPage(template, context.pages[0]!, memos[1], { paperTracks: ['A'] })[0]!
        expect(pinkPixelCount(rasters[1], { x: footer.rect.x * context.pageSize.widthPx,
          y: 0, width: footer.rect.w * context.pageSize.widthPx,
          height: footer.rect.h * context.pageSize.heightPx / 2 }), 'page-one ink must not bleed into page two').toBe(0)
      }
    }
  })
}

async function openProject(page: Page, bytes: Uint8Array) {
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'memos.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await page.evaluate(() => document.fonts.ready)
  await paint(page)
}
