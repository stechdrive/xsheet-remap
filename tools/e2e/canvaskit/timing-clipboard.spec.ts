import { expect, test, type Page } from './fixtures'
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
  await page.goto('./?app=remap')
  await ready(page)
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
