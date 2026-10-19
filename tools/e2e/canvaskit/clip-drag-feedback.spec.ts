import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { cellRectForHit, standardA3SheetTemplate, timingHitForFrame } from '../../../packages/core/src/index'
import { waitForPaperPaint } from '../paper-paint-contract'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const row = (page: Page, name: string) => page.locator('.clipLayerRow').filter({ has: page.locator('.clipLayerName', { hasText: new RegExp(`^${name}$`) }) })
const cell = cellRectForHit(standardA3SheetTemplate, timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 7)!)!
const event = (page: Page) => page.locator('[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="7"]')

test('layer tooltips match the app and layer ghosts leave enlarged cells and insertion lines readable', async ({ page }, info) => {
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await page.locator('[data-clip-layer-id="slot:slot_A"]').scrollIntoViewIfNeeded()
  await activateControl(page, page.locator('[data-clip-layer-id="slot:slot_A"]'))
  await page.locator('.clipLayerPanel input[type=file]').setInputFiles(['001', '002'].map(name => ({ name: `${name}.png`, mimeType: 'image/png', buffer: png })))
  await row(page, '001').scrollIntoViewIfNeeded()
  await activateControl(page, row(page, '001').locator('.clipLayerName'))

  const tooltipStyle = () => page.getByRole('tooltip').evaluate(element => {
    const style = getComputedStyle(element)
    return [style.backgroundColor, style.color, style.fontFamily, style.fontSize, style.borderRadius, style.padding]
  })
  await page.getByRole('button', { name: '元に戻す', exact: true }).hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  const commonStyle = await tooltipStyle()
  for (const control of [
    page.getByRole('button', { name: '新規ラスターレイヤー', exact: true }),
    page.getByRole('button', { name: '新規レイヤーフォルダー', exact: true }),
    page.getByRole('button', { name: '新規アニメーションフォルダー', exact: true }),
    page.getByRole('button', { name: 'レイヤーを削除', exact: true }),
    page.getByLabel('レイヤーの合成モード', { exact: true }),
    page.getByLabel('レイヤーの不透明度', { exact: true }),
    row(page, '001').locator('.clipLayerEye'), row(page, '001').locator('.clipLayerThumbnail'),
    row(page, '001').locator('.clipLayerName'),
  ]) {
    await page.mouse.move(1, 1)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
    await control.hover()
    await expect(page.getByRole('tooltip')).toBeVisible()
    await expect(control).not.toHaveAttribute('title')
    expect(await tooltipStyle()).toEqual(commonStyle)
  }
  await page.screenshot({ path: info.outputPath('shared-layer-tooltip.png') })

  await page.locator('.sheetZoomFloatingPalette').hover()
  await page.locator('.zoomSliderControl input').focus()
  await page.locator('.zoomSliderControl input').press('End')
  await expect(page.locator('.sheetZoomFloatingPalette button').first()).toHaveText('300%')
  await page.keyboard.press('Escape')
  await page.locator('.sheetSvg').first().evaluate((svg, rect) => {
    const viewport = svg.closest<HTMLElement>('.sheetViewport')!, box = svg.getBoundingClientRect(), view = viewport.getBoundingClientRect()
    viewport.scrollLeft += box.left + (rect.x + rect.w / 2) * box.width - (view.left + view.width / 2)
    viewport.scrollTop += box.top + (rect.y + rect.h / 2) * box.height - (view.top + view.height / 2)
  }, cell)
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  const point = await page.locator('.sheetSvg').first().evaluate((svg, rect) => {
    const box = svg.getBoundingClientRect()
    return { x: box.left + rect.x * box.width + 3, y: box.top + rect.y * box.height + 3 }
  }, cell)
  const ghost = page.locator('.pointerDragGhost')
  async function begin(name: string) {
    await row(page, name).scrollIntoViewIfNeeded()
    const source = (await row(page, name).locator('.clipLayerThumbnail').boundingBox())!
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(point.x, point.y, { steps: 10 })
  }
  async function readable(target: { x: number; y: number; width: number; height: number }) {
    await expect(ghost).toBeVisible()
    const box = (await ghost.boundingBox())!
    expect(box.x + box.width <= target.x || box.x >= target.x + target.width
      || box.y + box.height <= target.y || box.y >= target.y + target.height).toBe(true)
    expect(box.x <= point.x && point.x <= box.x + box.width && box.y <= point.y && point.y <= box.y + box.height).toBe(false)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  }
  await begin('001')
  await expect(ghost).toContainText('001')
  await expect(ghost.locator('img')).toBeVisible()
  await expect(page.locator('.sheetDropTargetCue')).toHaveAttribute('data-drop-validity', 'valid')
  const target = (await page.locator('.sheetDropTargetFill').boundingBox())!
  expect(target.height).toBeGreaterThan(20)
  await readable(target)
  await page.screenshot({ path: info.outputPath('layer-ghost-enlarged-cell.png') })
  await page.mouse.move(10, 10, { steps: 4 })
  await expect(page.locator('.sheetDropTargetCue')).toHaveCount(0)
  await expect(page.locator('body')).not.toHaveAttribute('data-internal-drag-validity')
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(ghost).toHaveCount(0); await expect(event(page)).toHaveCount(0)

  await begin('001'); await readable(target); await page.mouse.up()
  await expect(event(page).locator('.eventText')).toHaveText('1')
  await expect(page.locator('.sheetViewport')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+z'); await expect(event(page)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+y'); await expect(event(page).locator('.eventText')).toHaveText('1')

  // The enlarged SVG extends behind the right pane; only the visible tree may receive this drag.
  await begin('002')
  const first = (await row(page, '001').boundingBox())!
  await page.mouse.move(first.x + first.width / 2, first.y + 2, { steps: 8 })
  await expect(row(page, '001').locator('..')).toHaveClass(/clipDropBefore/)
  await expect(page.locator('.sheetDropTargetCue')).toHaveCount(0)
  await readable(first)
  await page.screenshot({ path: info.outputPath('layer-ghost-insertion.png') })
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(ghost).toHaveCount(0)
  await expect(row(page, '001').locator('..')).not.toHaveClass(/clipDropBefore/)

  const names = () => page.locator('.clipLayerName').filter({ hasText: /^00[12]$/ }).allTextContents()
  const originalOrder = await names()
  await begin('002')
  await page.mouse.move(first.x + first.width / 2, first.y + 2, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.clipLayerPanel')).toBeFocused()
  expect(await names()).toEqual(['002', '001'])
  await page.keyboard.press('ControlOrMeta+z')
  expect(await names()).toEqual(originalOrder)
  await page.keyboard.press('ControlOrMeta+y')
  expect(await names()).toEqual(['002', '001'])

  const root = page.locator('[data-clip-layer-id="process:layer_sakuga"]')
  await root.scrollIntoViewIfNeeded()
  const folder = (await root.locator('.clipLayerName').boundingBox())!
  await page.mouse.move(folder.x + 10, folder.y + folder.height / 2); await page.mouse.down()
  await page.mouse.move(point.x, point.y, { steps: 8 })
  await expect(ghost).toContainText('作画')
  await expect(page.locator('.sheetDropTargetCue')).toHaveAttribute('data-drop-validity', 'invalid')
  await readable(target)
  await page.mouse.up()
  await expect(ghost).toHaveCount(0)
  await expect(event(page).locator('.eventText')).toHaveText('1')
})
