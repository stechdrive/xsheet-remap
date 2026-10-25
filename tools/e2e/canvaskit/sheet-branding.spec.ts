import { readFileSync, writeFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { createProjectDocumentFromCutProject, createProjectFromTemplate, digitalStandardSheetTemplate,
  standardA3SheetTemplate, updateLogicalSheetSettings } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { buildTemplateChromeRenderModel } from '../../../packages/ui/src/templateEditorGeometry'
import { APP_LINK_QR_MODULE_COUNT, APP_LINK_QR_QUIET_ZONE, APP_LINK_QR_ROWS } from '../../../packages/ui/src/appLinkQr'
import { waitForPaperPaint } from '../paper-paint-contract'
import { channel, darkRowBands, readPng, type PixelRect, type Raster } from '../raster'

for (const kind of ['paper', 'digital'] as const) for (const custom of [false, true]) {
  test(`sheet branding survives GPU, print and PNG (${kind}, ${custom ? 'custom hidden' : 'standard'})`, async ({ page }, info) => {
    const base = kind === 'paper' ? standardA3SheetTemplate : digitalStandardSheetTemplate
    const template = structuredClone(base)
    if (custom) template.templateId += '-custom'
    const project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 48 })
    const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
    writeFileSync(info.outputPath('branding.xsr'), archive)
    await page.goto('./')
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({
      name: 'branding.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive),
    })
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await page.evaluate(() => document.fonts.ready)
    const model = buildTemplateChromeRenderModel(base, base.defaults.paperTracks, 48)
    const qr = model.branding!.qrRect
    await page.locator('.sheetZoomFloatingPalette').hover()
    await activateControl(page, page.locator('.zoomResetButton'))
    await page.locator('.sheetViewport').evaluate(element => { element.scrollLeft = element.scrollWidth; element.scrollTop = 0 })
    await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
    // A custom digital sheet uses this space for its worker field, so only the paper corner is blank.
    if (!custom || kind === 'paper') {
      const rect = await screenRect(page, qr)
      assertQr(await readPng(await page.screenshot({ path: info.outputPath('gpu.png') })), rect, !custom)
    }
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
    await page.emulateMedia({ media: 'print' })
    await expect(page.locator('.sheetSvg').first()).toHaveCSS('opacity', '1')
    await expect(page.locator('.sheetTemplateBranding')).toHaveCount(custom ? 0 : 1)
    if (!custom) {
      const rect = await screenRect(page, qr)
      assertQr(await readPng(await page.screenshot({ path: info.outputPath('print.png') })), rect, true)
      await expect(page.locator('.sheetTemplateBranding text')).toHaveText('xsheet-remap')
    }
    await page.emulateMedia({ media: 'screen' })
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
    await activateControl(page, page.getByRole('button', { name: 'タイムシート画像をPNG形式で書き出す', exact: true }))
    const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
    const pending = page.waitForEvent('download')
    await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
    const file = info.outputPath('sheet.png')
    await (await pending).saveAs(file)
    const image = await readPng(readFileSync(file))
    const rect = { x: qr.x * image.width, y: qr.y * image.height, width: qr.w * image.width, height: qr.h * image.height }
    if (!custom || kind === 'paper') assertQr(image, rect, !custom)
    const name = model.branding!.name
    const nameInk = darkRowBands(image, { x: name.x * image.width - 160, y: name.y * image.height - name.fontSizePx,
      width: 160, height: name.fontSizePx + 4 })
    expect(nameInk.length > 0).toBe(!custom)
  })
}

async function screenRect(page: Page, rect: { x: number; y: number; w: number; h: number }): Promise<PixelRect> {
  return page.locator('.sheetSvg').first().evaluate((element, rect) => {
    const box = element.getBoundingClientRect(), dpr = devicePixelRatio
    return { x: (box.x + rect.x * box.width) * dpr, y: (box.y + rect.y * box.height) * dpr,
      width: rect.w * box.width * dpr, height: rect.h * box.height * dpr }
  }, rect)
}

function assertQr(image: Raster, rect: PixelRect, visible: boolean) {
  for (let row = 0; row < APP_LINK_QR_MODULE_COUNT; row++) for (let col = 0; col < APP_LINK_QR_MODULE_COUNT; col++) {
    const expected = visible && APP_LINK_QR_ROWS[row - APP_LINK_QR_QUIET_ZONE]?.[col - APP_LINK_QR_QUIET_ZONE] === '1'
    const x = rect.x + (col + .5) * rect.width / APP_LINK_QR_MODULE_COUNT
    const y = rect.y + (row + .5) * rect.height / APP_LINK_QR_MODULE_COUNT
    const dark = [0, 1, 2].every(c => channel(image, x, y, c) < 128)
    expect(dark, `QR module ${col},${row}, including the quiet zone`).toBe(expected)
  }
}
