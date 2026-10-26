import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { addOverlayPaperTrackAtCspTop, cellRectForHit, createDefaultProject, createSheetPages, standardA3SheetTemplate, timingHitForFrame, type SheetTimingRole } from '../../../packages/core/src/index'
import { overlayColumnRectForPage } from '../../../packages/ui/src/sheet-layers-hit-geometry'
import { waitForPaperPaint } from '../paper-paint-contract'

async function ready(page: Page) {
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
}
async function cell(page: Page, role: SheetTimingRole, frame: number) {
  const hit = timingHitForFrame(standardA3SheetTemplate, role, 'A', frame)!
  const rect = cellRectForHit(standardA3SheetTemplate, hit)!
  return page.locator('.sheetSvg').first().evaluate((svg, r) => {
    const b = svg.getBoundingClientRect()
    return { x: b.left + (r.x + r.w / 2) * b.width, y: b.top + (r.y + r.h / 2) * b.height }
  }, rect)
}
function event(page: Page, role: SheetTimingRole, frame: number, track = 'A') {
  return page.locator(`[data-timeline-event-role="${role}"][data-timeline-event-track="${track}"][data-timeline-event-frame="${frame}"] .eventText`)
}
async function clickCell(page: Page, role: SheetTimingRole, frame: number) {
  const p = await cell(page, role, frame)
  await page.mouse.click(p.x, p.y)
}
async function copyRange(page: Page, role: SheetTimingRole, start: number, end: number) {
  await ready(page)
  const a = await cell(page, role, start), b = await cell(page, role, end)
  // Start on the empty trailing frame: pressing a drawing itself can arm a move.
  await page.mouse.move(b.x, b.y)
  await page.mouse.down()
  await page.mouse.move(a.x, a.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.statusBar span').first()).toContainText(`${role.toUpperCase()} A ${String(start).padStart(3, '0')}-${String(end).padStart(3, '0')}`)
  await page.keyboard.press('ControlOrMeta+c')
}

for (const role of ['action', 'cell'] as const) test(`sheet input selects only one ${role} event and uses literal CLIP cell names`, async ({ page }, info) => {
  await page.goto('./')
  await ready(page)
  for (const [frame, value] of [[1, '001'], [5, '002'], [9, '001'], [13, '003'], [17, '001']] as const) {
    await clickCell(page, role, frame)
    await page.keyboard.type(value); await page.keyboard.press('Enter')
    await expect(event(page, role, frame)).toHaveText(value)
  }
  await clickCell(page, role, 9)
  await page.keyboard.type('004'); await page.keyboard.press('Enter')
  await expect(event(page, role, 9)).toHaveText('004')
  await expect(event(page, role, 1)).toHaveText('001')
  await expect(event(page, role, 17)).toHaveText('001')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(event(page, role, 9)).toHaveText('001')
  await page.keyboard.press('ControlOrMeta+y')
  await expect(event(page, role, 9)).toHaveText('004')
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  const names = page.locator('[data-clip-layer-id^="binding:"][data-clip-layer-parent="slot:slot_A"] .clipLayerName')
  await expect(names).toHaveCount(4)
  await expect(names).toHaveText(['004', '003', '002', '001'])
  await page.screenshot({ path: info.outputPath(`timing-cell-selection-${role}.png`) })
})

test('CLIP cel name sorting keeps sheet exposures and restores the whole order with Undo', async ({ page }, info) => {
  await page.goto('./')
  await ready(page)
  for (const [frame, value] of [[1, '1'], [9, '10'], [5, '2'], [13, '1']] as const) {
    await clickCell(page, 'cell', frame)
    await page.keyboard.type(value); await page.keyboard.press('Enter')
    await expect(event(page, 'cell', frame)).toHaveText(value)
  }
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  const rows = page.locator('[data-clip-layer-id^="binding:"][data-clip-layer-parent="slot:slot_A"]')
  const names = rows.locator('.clipLayerName')
  await expect(names).toHaveText(['2', '10', '1'])
  await activateControl(page, rows.first())
  await activateControl(page, page.getByLabel('レイヤーメニュー', { exact: true }))
  await expect(page.getByText('「A」のセル名で並べ替え', { exact: true })).toBeVisible()
  await activateControl(page, page.getByRole('button', { name: '上から昇順（1→2→10）', exact: true }))
  await expect(names).toHaveText(['1', '2', '10'])
  const geometry = await page.locator('.clipCelSort').evaluate(element => {
    const box = element.getBoundingClientRect(), panel = element.closest('.clipLayerPanel')!.getBoundingClientRect()
    return { overflow: element.scrollWidth > element.clientWidth, left: box.left >= panel.left, right: box.right <= panel.right }
  })
  expect(geometry).toEqual({ overflow: false, left: true, right: true })
  await page.screenshot({ path: info.outputPath('clip-cel-name-sort.png') })
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(names).toHaveText(['2', '10', '1'])
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(names).toHaveText(['1', '2', '10'])
  await activateControl(page, page.getByRole('button', { name: '上から降順（10→2→1）', exact: true }))
  await expect(names).toHaveText(['10', '2', '1'])
  for (const [frame, value] of [[1, '1'], [5, '2'], [9, '10'], [13, '1']] as const) await expect(event(page, 'cell', frame)).toHaveText(value)
})

test('copies ACTION to CELL and back with independent numbering and undo', async ({ page }, info) => {
  await page.goto('./')
  await ready(page)
  await clickCell(page, 'action', 1)
  await page.keyboard.press('1'); await page.keyboard.press('Enter')
  await clickCell(page, 'action', 3)
  await page.keyboard.press('2'); await page.keyboard.press('Enter')
  await copyRange(page, 'action', 1, 4)
  await clickCell(page, 'cell', 8)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(event(page, 'cell', 8)).toHaveText('1')
  await expect(event(page, 'cell', 10)).toHaveText('2')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(event(page, 'cell', 8)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+y')
  await expect(event(page, 'cell', 8)).toHaveText('1')
  await clickCell(page, 'cell', 8)
  await page.keyboard.press('5'); await page.keyboard.press('Enter')
  await expect(event(page, 'cell', 8)).toHaveText('5')
  await expect(event(page, 'action', 1)).toHaveText('1')
  await copyRange(page, 'cell', 8, 11)
  await clickCell(page, 'action', 14)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(event(page, 'action', 14)).toHaveText('5')
  await expect(event(page, 'action', 16)).toHaveText('2')
  await ready(page)
  await page.screenshot({ path: info.outputPath('cross-role-paste.png') })
})

test('CSP plus adds an ACTION column with working keyboard entry', async ({ page }, info) => {
  // The legacy CSP add menu belongs to Editor; Remap adds columns from its layer palette.
  await page.goto('./?app=editor')
  await ready(page)
  await activateControl(page, page.getByRole('button', { name: 'CSPレイヤー構成', exact: true }))
  await page.getByLabel('CSPレイヤー項目を追加', { exact: true }).click()
  await page.getByRole('button', { name: '追加セル列', exact: true }).click()
  await page.getByRole('button', { name: '追加セル列を作成', exact: true }).click()
  await expect(page.getByRole('button', { name: 'J追加セル列: 入力先', exact: true })).toBeVisible()
  const added = addOverlayPaperTrackAtCspTop(createDefaultProject(), { paperTrack: 'J' })
  const column = overlayColumnRectForPage(standardA3SheetTemplate, added.project, added.paperTrack, createSheetPages(standardA3SheetTemplate, 144, 1)[0])!
  const point = await page.locator('.sheetSvg').first().evaluate((svg, column) => {
    const b = svg.getBoundingClientRect()
    return { x: b.left + (column.rect.x + column.rect.w / 2) * b.width, y: b.top + (column.rect.y + column.rect.h / column.frames.rowCount / 2) * b.height }
  }, column)
  await page.mouse.click(point.x, point.y)
  await page.keyboard.press('7'); await page.keyboard.press('Enter')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('8'); await page.keyboard.press('Enter')
  await expect(event(page, 'action', 1, 'J')).toHaveText('7')
  await expect(event(page, 'action', 3, 'J')).toHaveText('8')
  await expect(event(page, 'cell', 1, 'J')).toHaveCount(0)
  await ready(page)
  await page.screenshot({ path: info.outputPath('csp-action-column.png') })
})
