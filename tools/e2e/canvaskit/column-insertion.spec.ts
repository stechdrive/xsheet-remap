import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { standardA3SheetTemplate } from '../../../packages/core/src/index'
import { sheetGridHeaderGeometry } from '../../../packages/ui/src/sheetGridHeaderGeometry'
import { uiText } from '../../../packages/ui/src/i18n'

async function point(page: Page, x: number, y: number) {
  return page.locator('.sheetSvg').first().evaluate((svg, p) => {
    const box = svg.getBoundingClientRect()
    return { x: box.left + p.x * box.width, y: box.top + p.y * box.height }
  }, { x, y })
}

test('column menus share placement, automatic names, hidden status and Undo on paper and digital', async ({ page }, info) => {
  const input = info.project.name.endsWith('-touch') ? 'touch' : 'mouse'
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByLabel('表示設定', { exact: true }), input)
  await activateControl(page, page.getByRole('button', { name: 'A3標準', exact: true }), input)
  await page.keyboard.press('Escape')
  await expect(page.locator('.sheetDisplaySettingsMenu.actionMenuContent')).toHaveCount(0)
  const headers = await page.locator('.templateHeaderText').allTextContents()
  for (const role of ['action', 'cell', 'sound', 'camera'] as const) {
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === `left_${role}_grid`)!
    const h = sheetGridHeaderGeometry(standardA3SheetTemplate, region, region.rect, standardA3SheetTemplate.page.heightPx)
    for (const y of [h.title.y + h.title.h / 2, h.columns.y + h.columns.h / 2, region.rect.y + 0.06]) {
      const p = await point(page, region.rect.x + region.rect.w / 8, y)
      await page.mouse.click(p.x, p.y, { button: 'right' })
      const name = role === 'action' || role === 'cell' ? 'BG/BOOK追加' : `${role.toUpperCase()}列を追加`
      await expect(page.getByRole('menuitem', { name, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(page.locator('.sheetContextMenu')).toHaveCount(0)
    }
  }
  const camera = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_camera_grid')!
  const cameraBody = await point(page, camera.rect.x + camera.rect.w / 8, camera.rect.y + 0.06)
  await page.mouse.click(cameraBody.x, cameraBody.y, { button: 'right' })
  await activateControl(page, page.getByRole('menuitem', { name: 'CAMERA列を追加', exact: true }), input)
  await expect(page.getByRole('group', { name: 'CAMERAの挿入位置を選択' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.columnInsertionSurface')).toHaveCount(0)
  await expect(page.locator('.sheetHiddenColumnsNotice')).toHaveCount(0)

  await activateControl(page, page.getByLabel('列を追加', { exact: true }), input)
  await activateControl(page, page.getByRole('menuitem', { name: 'SOUND列を追加', exact: true }), input)
  const sound = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_sound_grid')!
  const first = await point(page, sound.rect.x, sound.rect.y + 0.06)
  await page.mouse.move(first.x, first.y)
  await expect(page.locator('.columnInsertionCaption')).toContainText('先頭')
  await expect(page.locator('.columnInsertionCaption')).toContainText('S4')
  const captionRows = await page.locator('.columnInsertionCaption').evaluate(element => Array.from(element.children).map(child => child.getBoundingClientRect().toJSON()))
  for (const [index, row] of captionRows.entries()) {
    expect(row.height).toBeGreaterThan(10)
    if (index > 0) expect(row.y).toBeGreaterThanOrEqual(captionRows[index - 1].bottom)
  }
  const marker = await page.locator('.columnInsertionMarker').boundingBox()
  expect(Math.abs(marker!.x - first.x)).toBeLessThan(2)
  expect(marker!.height).toBeGreaterThan(100)
  const shot = await page.screenshot({ path: info.outputPath('sound-insertion-preview.png') })
  const bluePixels = await page.evaluate(async ({ base64, marker }) => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const scale = image.width / innerWidth
    const pixels = context.getImageData(Math.floor((marker.x - 1) * scale), Math.ceil((marker.y + 12) * scale), Math.ceil(6 * scale), Math.floor(Math.min(100, innerHeight - marker.y - 20) * scale)).data
    let blue = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2] > 130 && pixels[i + 2] > pixels[i] * 1.5 && pixels[i + 2] > pixels[i + 1] * 1.3) blue++
    return blue
  }, { base64: shot.toString('base64'), marker: marker! })
  expect(bluePixels, 'the vertical insertion marker contributes actual pixels').toBeGreaterThan(80)
  if (input === 'touch') await page.touchscreen.tap(first.x, first.y)
  else await page.mouse.click(first.x, first.y)
  await expect(page.locator('.columnInsertionSurface')).toHaveCount(0)
  await expect(page.locator('.timelineLaneEditorPopover')).toHaveCount(0)
  await expect(page.locator('.templateHeaderText')).toHaveText(headers)
  await activateControl(page, page.getByLabel('このテンプレートでは1列が非表示'), input)
  await expect(page.locator('.sheetHiddenColumnsMenu li')).toHaveText('SOUND：S4')
  await activateControl(page, page.getByRole('button', { name: 'デジタル標準で表示' }), input)
  await expect(page.locator('.sheetHiddenColumnsNotice')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }), input)
  await expect(page.getByLabel('このテンプレートでは1列が非表示')).toBeVisible()
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }), input)
  await expect(page.locator('.sheetHiddenColumnsNotice')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }), input)
  await expect(page.getByLabel('このテンプレートでは1列が非表示')).toBeVisible()
  await page.screenshot({ path: info.outputPath('paper-hidden-status.png') })
})

test('BG/BOOK and cell additions use the same marker and preserve the chosen role', async ({ page }, info) => {
  const input = info.project.name.endsWith('-touch') ? 'touch' : 'mouse'
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByLabel('表示設定', { exact: true }), input)
  await activateControl(page, page.getByRole('button', { name: 'A3標準', exact: true }), input)
  await page.keyboard.press('Escape')
  for (const [role, menu, field, label, result] of [
    ['cell', uiText.stackGuides.add, uiText.stackGuides.inputLabel, 'BOOK', '.stackGuideLabel[data-stack-guide-role="cell"]'],
    ['action', uiText.stackGuides.addOverlayTrack, uiText.sheet.addOverlayTrackName, 'J', '.overlayPaperTrackLabelText'],
  ]) {
    await activateControl(page, page.getByLabel('列を追加', { exact: true }), input)
    await activateControl(page, page.getByRole('menuitem', { name: menu, exact: true }), input)
    await expect(page.locator('.columnInsertionSurface')).toBeVisible()
    const region = standardA3SheetTemplate.regions.find(item => item.regionId === `left_${role}_grid`)!
    const p = await point(page, region.rect.x + region.rect.w / 3, region.rect.y + 0.06)
    await page.mouse.move(p.x, p.y)
    await expect(page.locator('.columnInsertionMarker')).toHaveAttribute('data-insertion-target', new RegExp(`^left_${role}_grid:`))
    if (input === 'touch') await page.touchscreen.tap(p.x, p.y)
    else await page.mouse.click(p.x, p.y)
    await page.getByLabel(field, { exact: true }).fill(label)
    await activateControl(page, page.getByRole('button', { name: uiText.stackGuides.confirm, exact: true }), input)
    await expect(page.locator(result).first()).toHaveText(label)
    await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }), input)
    await expect(page.locator(result)).toHaveCount(0)
  }
})
