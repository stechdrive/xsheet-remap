import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import {
  activeCutProjectFromDocument, addAnnotation, addTimelineMemo, createProjectDocumentFromCutProject, createProjectFromTemplate,
  digitalStandardSheetTemplate, normalizeMemoAppearance, sheetAnnotations, standardA3SheetTemplate, timelineMemos,
  timedRangeCuePaint, updateLogicalSheetSettings, type AnnotationText, type SheetTemplate, type TimelineInkMemo,
} from '../../../packages/core/src/index'
import { decodeProjectFileBytes, encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { createSheetRenderModelContext } from '../../../packages/ui/src/sheetRenderModel'
import { timelineMemoSegmentsForPage } from '../../../packages/ui/src/timelineMemoGeometry'
import { buildTimelineMemoTextLayout } from '../../../packages/ui/src/timelineMemoTextLayout'
import { annotationVerticalLayout } from '../../../packages/ui/src/annotationTextLayout'
import { buildSoundCuePageTextLayouts } from '../../../packages/ui/src/soundCueGeometry'
import { readPsdComposite } from '../psd-composite'
import { waitForPaperPaint } from '../paper-paint-contract'

const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
const sourceText = '「コーヒー。」\n小さなゃゅょっ。'
const appearance = { ...normalizeMemoAppearance(), text: { color: '#10a040', fontSizeUnits: 2, writingMode: 'vertical' as const } }
const memo: TimelineInkMemo = { kind: 'timeline', memoId: 'vertical-memo', order: 1,
  anchor: { role: 'action', paperTrack: 'A', frame: 5 },
  placement: { frameOffset: 0, crossOffsetUnits: 1, widthUnits: 10, heightFrames: 10 },
  strokes: [], texts: [{ textId: 'vertical-memo-text', text: 'ー', x: 1, y: 1 }], appearance }

async function openProject(page: Page, bytes: Uint8Array) {
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({
    name: 'vertical-text.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes),
  })
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await page.evaluate(() => document.fonts.ready)
  await paint(page)
}

test('memo direction switches preserve drafts, Undo, new memo defaults and saved Unicode', async ({ page }, info) => {
  const project = createProjectFromTemplate(standardA3SheetTemplate)
  project.timedRangeCues = [{ cueId: 'voice', role: 'sound', laneId: 'sound_lane_1', frameStart: 3, frameEnd: 20,
    label: '声', text: '「コーヒー。」', source: 'manual' }]
  await openProject(page, await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate })))
  await activateControl(page, page.getByRole('button', { name: 'メモツールを開く', exact: true }))
  await activateControl(page, page.locator('.annotationFloatingPalette').getByRole('button', { name: 'テキスト', exact: true }))
  await expect(page.getByRole('button', { name: '横書き', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await activateControl(page, page.getByRole('button', { name: '縦書き', exact: true }))
  const surface = page.locator('.pageAnnotationInputSurface')
  const box = (await surface.boundingBox())!
  await page.mouse.click(box.x + box.width * .35, box.y + box.height * .10)
  const editor = page.locator('.annotationTextEditor')
  await editor.fill(sourceText)
  await editor.evaluate(element => {
    element.setSelectionRange(3, 3)
    element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
  })
  for (const direction of ['横書き', '縦書き']) {
    await activateControl(page, page.getByRole('button', { name: direction, exact: true }))
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue(sourceText)
    expect(await editor.evaluate(element => element.selectionStart)).toBe(3)
  }
  await editor.evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })))
  await editor.press('Control+Enter')
  await expect(page.locator('.annotationTextDisplay')).toHaveAttribute('data-writing-mode', 'vertical')
  await activateControl(page, page.getByRole('button', { name: '横書き', exact: true }))
  await expect(page.locator('.annotationTextDisplay')).toHaveAttribute('data-writing-mode', 'horizontal')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('.annotationTextDisplay')).toHaveAttribute('data-writing-mode', 'vertical')
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(page.locator('.annotationTextDisplay')).toHaveAttribute('data-writing-mode', 'horizontal')
  await activateControl(page, page.getByRole('button', { name: '縦書き', exact: true }))
  await activateControl(page, page.getByRole('button', { name: '完了', exact: true }))
  await activateControl(page, page.locator('[data-sound-cue-id="voice"] .soundCueBody'))
  await activateControl(page, page.getByRole('button', { name: 'メモツールを開く', exact: true }))
  await activateControl(page, page.locator('.annotationFloatingPalette').getByRole('button', { name: 'テキスト', exact: true }))
  const timelineEditor = page.getByRole('textbox', { name: 'メモ文字', exact: true })
  await expect(timelineEditor).toHaveCSS('writing-mode', 'vertical-rl')
  await timelineEditor.fill(sourceText)
  await activateControl(page, page.getByRole('button', { name: '横書き', exact: true }))
  await expect(timelineEditor).toBeFocused()
  await expect(timelineEditor).toHaveValue(sourceText)
  await activateControl(page, page.getByRole('button', { name: '縦書き', exact: true }))
  await timelineEditor.press('Control+Enter')
  await activateControl(page, page.getByRole('button', { name: '完了', exact: true }))
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const pending = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('vertical-text.xsr')
  await (await pending).saveAs(saved)
  const bytes = new Uint8Array(readFileSync(saved))
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(bytes)).document)
  expect(sheetAnnotations(restored)).toEqual([expect.objectContaining({ writingMode: 'vertical', text: sourceText })])
  expect(timelineMemos(restored)).toEqual([expect.objectContaining({ appearance: expect.objectContaining({
    text: expect.objectContaining({ writingMode: 'vertical' }),
  }), texts: [expect.objectContaining({ text: sourceText })] })])
  expect(restored.timedRangeCues[0].text).toBe('「コーヒー。」')
  await openProject(page, bytes)
  await expect(page.locator('.annotationTextDisplay')).toHaveAttribute('data-writing-mode', 'vertical')
  await page.screenshot({ path: info.outputPath('vertical-memos-reopened.png') })
})

for (const original of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
  test(`vertical memo and SOUND glyph pixels survive GPU, SVG, print, PNG and PSD (${original.templateId})`, async ({ page }, info) => {
    // A renamed SOUND heading still uses its semantic role.
    const template: SheetTemplate = { ...original, regions: original.regions.map(region => region.grid?.role === 'sound'
      ? { ...region, label: 'セリフ' } : region) }
    let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 48 })
    const annotation: AnnotationText = { kind: 'text', annotationId: 'vertical-page', pageId: 'page_1',
      text: 'ー', x: .05, y: .12, color: '#e010b0', fontSizePx: 40, writingMode: 'vertical' }
    project = addTimelineMemo(addAnnotation(project, annotation), memo)
    project.timedRangeCues = [{ cueId: 'voice', role: 'sound', laneId: 'sound_lane_1', frameStart: 3, frameEnd: 20,
      label: '', text: 'ー', source: 'manual' }]
    const context = createSheetRenderModelContext(project, template)
    const segment = timelineMemoSegmentsForPage(template, context.pages[0], memo, context)[0]
    const timeline = buildTimelineMemoTextLayout(segment, memo.texts![0], appearance.text.fontSizeUnits, context.pageSize, undefined, 'vertical')
    const sound = buildSoundCuePageTextLayouts(template, context.pages, project.timedRangeCues, context.pageSize, context)[0].textLayout
    const targets = [
      { ...annotationVerticalLayout(annotation, context.pageSize).glyphs[0], size: 40, color: annotation.color },
      { ...timeline.glyphs![0], size: timeline.fontSizePx, color: appearance.text.color },
      { ...sound.textGlyphs[0], size: sound.textFontSizePx, color: timedRangeCuePaint(template.theme, 'sound', 0).textColor },
    ]
    await openProject(page, await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template })))
    const direct = await page.screenshot({ path: info.outputPath('vertical-gpu.png') })
    const svg = page.locator('.sheetSvg').first()
    const geometry = await svg.evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), ratio: devicePixelRatio }))
    const scale = geometry.rect.width / context.pageSize.widthPx
    const screenTargets = targets.map(target => ({ ...target,
      xPx: (geometry.rect.x + target.xPx * scale) * geometry.ratio,
      yPx: (geometry.rect.y + target.yPx * scale) * geometry.ratio,
      size: target.size * scale * geometry.ratio,
    }))
    const visible = await glyphInkBounds(page, direct, screenTargets, null, true)
    for (const [index, bound] of visible.entries()) {
      expect(bound.count, `GPU/glyph ${index}: visible ink`).toBeGreaterThan(0)
      expect(bound.height, `GPU/glyph ${index}: vertical long mark`).toBeGreaterThan(bound.width)
    }
    await svg.evaluate(element => { element.dataset.paperModelMode = 'svg' })
    await paint(page)
    const compatibility = await page.screenshot({ path: info.outputPath('vertical-svg.png') })
    // The WebKit touch trace differed at one edge pixel by one channel level,
    // due to SVG matrix serialization. Require the same geometry and ink.
    const difference = await page.evaluate(async ([a, b]) => {
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
    }, [direct.toString('base64'), compatibility.toString('base64')])
    expect(difference, 'GPU and SVG glyphs agree within one antialiasing level').toBeLessThanOrEqual(1)
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await expect(page.locator('.soundCueDialogue[data-vertical-glyph="ー"] path')).toHaveCount(1)
    await expect(page.locator('.annotationTextDisplay [data-vertical-glyph="ー"] path')).toHaveCount(1)
    await page.emulateMedia({ media: 'print' })
    await page.screenshot({ path: info.outputPath('vertical-print.png') })
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await svg.evaluate(element => { delete element.dataset.paperModelMode })
    await paint(page)
    for (const format of ['PNG', 'PSD']) {
      await activateControl(page, page.getByLabel('画面切替', { exact: true }))
      await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
      await activateControl(page, page.getByRole('button', { name: `タイムシート画像を${format}形式で書き出す`, exact: true }))
      const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
      const pending = page.waitForEvent('download')
      await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
      const saved = info.outputPath(`vertical.${format.toLowerCase()}`)
      await (await pending).saveAs(saved)
      const bytes = readFileSync(saved)
      const psd = format === 'PSD' ? readPsdComposite(bytes) : null
      const bounds = await glyphInkBounds(page, bytes, targets, psd)
      for (const [index, bound] of bounds.entries()) {
        expect(bound.count, `${format}/glyph ${index}: visible ink`).toBeGreaterThan(4)
        expect(bound.height, `${format}/glyph ${index}: vertical long mark`).toBeGreaterThan(bound.width * 2)
      }
      await expect(dialog).toHaveCount(0)
    }
  })
}


async function glyphInkBounds(page: Page, bytes: Buffer,
  targets: Array<{ xPx: number; yPx: number; size: number; color: string }>,
  psd: ReturnType<typeof readPsdComposite> | null = null, screenAntialias = false) {
  return page.evaluate(async ({ targets, base64, psd, screenAntialias }) => {
    let width: number, height: number, pixel: (index: number, channel: number) => number
    if (psd) {
      width = psd.width; height = psd.height
      const planes = Uint8Array.from(atob(psd.planes), char => char.charCodeAt(0))
      pixel = (index, channel) => planes[index + width * height * channel]
    } else {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      width = image.width; height = image.height
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, width, height).data
      pixel = (index, channel) => data[index * 4 + channel]
    }
    return targets.map(target => {
      const rgb = target.color.match(/[0-9a-f]{2}/gi)!.map(value => parseInt(value, 16))
      let minX = width, maxX = -1, minY = height, maxY = -1, count = 0
      for (let y = Math.max(0, Math.floor(target.yPx - target.size * .88)); y < Math.min(height, target.yPx + target.size * .12); y++) {
        for (let x = Math.max(0, Math.floor(target.xPx - target.size / 2)); x < Math.min(width, target.xPx + target.size / 2); x++) {
          const actual = rgb.map((_, channel) => pixel(y * width + x, channel))
          // At 50% zoom a 12.6px SOUND stroke can cover only part of a pixel.
          // Require its foreground hue and at least 60% coverage above the white halo.
          const coverage = rgb.reduce((sum, value, channel) => sum + (255 - actual[channel]) / Math.max(1, 255 - value), 0) / 3
          const antialiasedInk = screenAntialias && coverage >= .6 && coverage <= 1.05
            && rgb.every((value, channel) => Math.abs(actual[channel] - (255 + (value - 255) * coverage)) < 12)
          if (antialiasedInk || rgb.every((value, channel) => Math.abs(actual[channel] - value) < 25)) {
            minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); count++
          }
        }
      }
      return { width: maxX - minX + 1, height: maxY - minY + 1, count }
    })
  }, { targets, screenAntialias, base64: psd ? '' : bytes.toString('base64'),
    psd: psd ? { width: psd.width, height: psd.height, planes: Buffer.from(psd.planes).toString('base64') } : null })
}
