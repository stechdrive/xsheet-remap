import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createProjectFromTemplate, createKey, setEvent, setTimingSpecialEvent, setTimingReferenceAt,
  registerAsset, upsertBinding, createProjectDocumentFromCutProject, standardA3SheetTemplate,
  digitalStandardSheetTemplate, updateLogicalSheetSettings, type TimelineInkMemo } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { createSheetRenderModelContext, inputTextRenderItemsForPage } from '../../../packages/ui/src/sheetRenderModel'
import { timelineMemoSegmentsForPage } from '../../../packages/ui/src/timelineMemoGeometry'
import { readPsdComposite, readPsdLayerAlphas } from '../psd-composite'
import { waitForPaperPaint } from '../paper-paint-contract'
import { channel, readRaster } from '../raster'

type Rect = { x: number; y: number; w: number; h: number }
const paperRgb = [228, 210, 189]

for (const preset of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
  test(`image exports omit editing cues and cell tint while retaining paper and content (${preset.templateId})`, async ({ page }, info) => {
    const template = { ...preset, theme: { ...preset.theme, paper: { ...preset.theme.paper, color: '#e4d2bd' } } }
    let project = createProjectFromTemplate(template)
    if (preset === digitalStandardSheetTemplate) project = updateLogicalSheetSettings(project, { durationFrames: 48 })
    for (const [track, label] of [['A', '1'], ['B', '2'], ['C', '3']]) {
      const created = createKey(project, track, label, 'manual', undefined, 'cell')
      project = setEvent(created.project, track, 10, created.key.keyId, 'cell')
      if (track === 'A') {
        const registered = registerAsset(project, { name: 'A_001.png', size: 1 })
        project = upsertBinding(registered.project, { slotId: project.cspTrackSlots.find(slot => slot.paperTrack === 'A')!.slotId,
          keyId: created.key.keyId, assetId: registered.asset.assetId })
      }
    }
    project = setTimingReferenceAt(project, 'C', 10, 'cell', true)
    project = setTimingSpecialEvent(project, 'D', 10, 'inbetween', 'cell')
    const memo: TimelineInkMemo = {
      kind: 'timeline', memoId: 'header-note', order: 1, anchor: { role: 'cell', paperTrack: 'A', frame: 10 },
      placement: { frameOffset: 0, pageOffsetYUnits: -18, crossOffsetUnits: 0, widthUnits: 6, heightFrames: 3 },
      strokes: [{ strokeId: 'ink', color: '#d000c0', widthUnits: .3, points: [{ x: 1, y: 2 }, { x: 5, y: 2 }] }],
      texts: [{ textId: 'text', text: 'MEMO', x: 1, y: .4 }],
      appearance: { background: { enabled: true, color: '#c8f4d0', opacity: 1 }, inkOpacity: 1, textOpacity: 1,
        text: { color: '#d000c0', fontSizeUnits: .8 } },
    }
    project = { ...project, memos: [memo] }
    const context = createSheetRenderModelContext(project, template)
    expect(context.pages).toHaveLength(1)
    const cells = inputTextRenderItemsForPage(context, context.pages[0])
    const pixelRect = (rect: Rect): Rect => ({ x: rect.x * context.pageSize.widthPx, y: rect.y * context.pageSize.heightPx,
      w: rect.w * context.pageSize.widthPx, h: rect.h * context.pageSize.heightPx })
    const a = pixelRect(cells.find(item => item.paperTrack === 'A')!.rect)
    const memoRect = pixelRect(timelineMemoSegmentsForPage(template, context.pages[0], memo, { paperTracks: context.paperTracks })[0]!.rect)
    const samples = [
      [3, 3], // Paper remains opaque and retains its selected color.
      [a.x + 4, a.y + 4], // Former rounded memo notification square.
      [a.x + a.w - 4, a.y + 4], // Asset notification corner.
      [a.x + a.w * .2, a.y + a.h * .7], // Registered cell, away from the numeral.
      [a.x + a.w * .2, a.y + a.h * 1.7], // Adjacent empty cell, same paper band.
      [memoRect.x + 2, memoRect.y + 2], // Intentional memo background.
    ]
    const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
    writeFileSync(info.outputPath('clean-sheet.xsr'), archive)
    await page.goto('./')
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'clean-sheet.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
    await page.evaluate(() => document.fonts.ready)
    await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
    const event = page.locator('[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="10"]')
    await expect(event.locator('.assetAssignedEventMarker')).toHaveCount(1)
    await expect(page.locator('.timelineMemoAnchorMarker')).toHaveCount(1)
    await expect(event.locator('.assetAssignedEventRect')).toHaveCSS('fill', 'rgba(255, 174, 43, 0.07)')
    const screen = await page.screenshot({ path: info.outputPath('app-cues-preserved.png') })
    const screenRect = await event.locator('.eventRect').evaluate(el => el.getBoundingClientRect().toJSON())
    const screenColors = await inspectRaster(screen, [], [{ x: screenRect.x, y: screenRect.y, w: screenRect.width, h: screenRect.height }], await page.evaluate(() => devicePixelRatio))
    expect(screenColors.areas[0].green, 'memo triangle remains visible in the app').toBeGreaterThan(1)
    expect(screenColors.areas[0].orange, 'asset triangle remains visible in the app').toBeGreaterThan(1)

    for (const format of ['PNG', 'JPG', 'PSD']) {
      await activateControl(page, page.getByLabel('画面切替', { exact: true }))
      await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
      await activateControl(page, page.getByRole('button', { name: `タイムシート画像を${format}形式で書き出す`, exact: true }))
      const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
      const pending = page.waitForEvent('download')
      await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
      const file = info.outputPath(`clean-sheet.${format.toLowerCase()}`); await (await pending).saveAs(file)
      await expect(dialog).toHaveCount(0)
      const bytes = readFileSync(file)
      const rects = cells.map(item => {
        const rect = pixelRect(item.rect)
        return { x: rect.x + rect.w * .15, y: rect.y + rect.h * .15, w: rect.w * .7, h: rect.h * .7 }
      })
      rects.push(memoRect)
      let pixels: number[][], ink: number[]
      if (format === 'PSD') {
        const image = readPsdComposite(bytes), size = image.width * image.height
        const rgb = (x: number, y: number) => [0, 1, 2].map(channel => image.planes[channel * size + Math.floor(y) * image.width + Math.floor(x)])
        pixels = samples.map(([x, y]) => rgb(x, y))
        ink = rects.map(rect => countRect(rect, (x, y) => isInk(rgb(x, y))))
        const layers = readPsdLayerAlphas(bytes)
        const alphaAt = (name: string, x: number, y: number) => {
          const layer = layers.find(layer => layer.name === name)!
          expect(layer, name).toBeDefined()
          return layer.alpha[(Math.floor(y) - layer.top) * layer.width + Math.floor(x) - layer.left]
        }
        expect(alphaAt('ACTION/CELL記号', ...samples[3] as [number, number]), 'no cell tint in the editable input layer').toBe(0)
        expect(alphaAt('メモ・手描き', ...samples[1] as [number, number]), 'no notification in the editable memo layer').toBe(0)
        expect(alphaAt('メモ・背景', ...samples[5] as [number, number])).toBe(255)
        expect(alphaAt('用紙色', 3, 3)).toBe(255)
      } else {
        const raster = await inspectRaster(bytes, samples, rects)
        pixels = raster.samples.map(color => color.slice(0, 3)); ink = raster.areas.map(area => area.ink)
        expect(raster.samples.every(color => color[3] === 255), 'paper composite remains opaque').toBe(true)
      }
      // JPEG is lossy: allow 12 channel levels, well below the old green
      // rectangle/tint difference on this warm paper color.
      const tolerance = format === 'JPG' ? 12 : 1
      expectColor(pixels[0], paperRgb, tolerance, `${format} paper`)
      for (const index of [1, 2, 3]) expectColor(pixels[index], pixels[4], tolerance, `${format} cue/tint ${index}`)
      expectColor(pixels[5], [200, 244, 208], tolerance, `${format} memo background`)
      ink.forEach((count, index) => expect(count, `${format} preserved numeral/symbol/memo ${index}`).toBeGreaterThan(8))
    }
  })
}

function expectColor(actual: number[], expected: number[], tolerance: number, message: string) {
  expect(Math.max(...actual.map((channel, i) => Math.abs(channel - expected[i]))), message).toBeLessThanOrEqual(tolerance)
}
function isInk(rgb: number[]) { return rgb[0] < 120 && rgb[1] < 160 && rgb[2] < 140 || rgb[0] > 120 && rgb[1] < 100 && rgb[2] > 100 }
function countRect(rect: Rect, predicate: (x: number, y: number) => boolean) {
  let count = 0
  for (let y = Math.ceil(rect.y); y < rect.y + rect.h; y++) for (let x = Math.ceil(rect.x); x < rect.x + rect.w; x++) if (predicate(x, y)) count++
  return count
}
async function inspectRaster(bytes: Buffer, samples: number[][], rects: Rect[], scale = 1) {
  const image = await readRaster(bytes)
  const rgb = (x: number, y: number) => [0, 1, 2, 3].map(c => channel(image, x, y, c))
  const areas = rects.map(rect => {
    let green = 0, orange = 0, ink = 0
    for (let y = Math.ceil(rect.y * scale); y < (rect.y + rect.h) * scale; y++) for (let x = Math.ceil(rect.x * scale); x < (rect.x + rect.w) * scale; x++) {
      const [r, g, b] = rgb(x, y)
      if (g > r + 20 && g > b + 10 && g < 180) green++
      if (r > 180 && g > 70 && g < 170 && b < 50) orange++
      if (isInk([r, g, b])) ink++
    }
    return { green, orange, ink }
  })
  return { samples: samples.map(([x, y]) => rgb(x * scale, y * scale)), areas }
}
