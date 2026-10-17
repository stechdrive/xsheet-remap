import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { cellRectForHit, standardA3SheetTemplate, timingHitForFrame } from '../../../packages/core/src/index'
import { waitForPaperPaint } from '../paper-paint-contract'

async function cell(page: Page, track: string, frame: number) {
  const hit = timingHitForFrame(standardA3SheetTemplate, 'cell', track, frame)!
  const rect = cellRectForHit(standardA3SheetTemplate, hit)!
  return page.locator('.sheetSvg').first().evaluate((svg, r) => {
    const b = svg.getBoundingClientRect()
    return { x: b.left + (r.x + r.w / 2) * b.width, y: b.top + (r.y + r.h / 2) * b.height }
  }, rect)
}

function event(page: Page, track: string, frame: number) {
  return page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="${track}"][data-timeline-event-frame="${frame}"]`)
}

test('range drag shows the grabbed offset, collision and cancellation without committing until release', async ({ page }, info) => {
  await page.goto('./?app=remap')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByRole('button', { name: 'CSPレイヤー構成', exact: true }))
  await activateControl(page, page.getByRole('button', { name: '画像素材', exact: true }))
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  for (const [track, frame, label] of [['A', 1, '1'], ['A', 5, '2'], ['A', 9, '3'], ['B', 13, '4']] as const) {
    const p = await cell(page, track, frame)
    await page.mouse.click(p.x, p.y)
    await page.keyboard.press(label)
    await page.keyboard.press('Enter')
    await expect(event(page, track, frame).locator('.eventText')).toHaveText(label)
  }
  const beginDrag = async () => {
    // Escape also clears the selection. Establish each scenario's range using
    // ordinary input instead of relying on selection state after cancellation.
    const start = await cell(page, 'A', 12), end = await cell(page, 'A', 1)
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(end.x, end.y, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator('.statusBar span').first()).toContainText('CELL A 001-012')
    const grabbed = await cell(page, 'A', 5), target = await cell(page, 'B', 17)
    await page.mouse.move(grabbed.x, grabbed.y)
    await page.mouse.down()
    await page.mouse.move(target.x, target.y, { steps: 5 })
    await expect(page.locator('.timingDragStatus')).toContainText('A 001–012 → B 013–024')
  }
  await beginDrag()
  const preview = page.locator('.timingDragPreview')
  await expect(preview).toHaveAttribute('data-drag-validity', 'collision')
  await expect(page.locator('.timingDragGhostCell')).toHaveCount(3)
  await expect(page.locator('[data-drag-collision]')).toHaveAttribute('data-drag-frame', '13')
  await expect(page.locator('.timingDragStatus')).toContainText('1セルに既存の入力あり')
  for (const frame of [1, 5, 9]) await expect(event(page, 'A', frame)).toHaveCount(1)
  await expect(event(page, 'B', 17)).toHaveCount(0)
  expect(await preview.evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none')
  const before = await page.locator('.timingDragGhostCell .timingDragCellFill').evaluateAll(cells => cells.map(c => c.getBoundingClientRect().toJSON()))
  await page.screenshot({ path: info.outputPath('range-ghost-before-drop.png') })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(preview).toHaveCount(0)
  for (const frame of [1, 5, 9]) await expect(event(page, 'A', frame)).toHaveCount(1)

  await beginDrag()
  await page.mouse.move(3, 3)
  await expect(page.locator('.timingDragStatus')).toHaveAttribute('data-drag-validity', 'invalid')
  await page.mouse.up()
  await expect(preview).toHaveCount(0)
  for (const frame of [1, 5, 9]) await expect(event(page, 'A', frame)).toHaveCount(1)

  await beginDrag()
  const dialog = page.waitForEvent('dialog').then(async confirmation => {
    expect(confirmation.message()).toContain('1')
    await confirmation.accept()
  })
  await page.mouse.up()
  await dialog
  await expect(preview).toHaveCount(0)
  for (const [index, frame] of [13, 17, 21].entries()) {
    await expect(event(page, 'B', frame).locator('.eventText')).toHaveText(String(index + 1))
    const committed = await event(page, 'B', frame).locator('.eventRect').evaluate(el => el.getBoundingClientRect().toJSON())
    for (const key of ['x', 'y', 'width', 'height'] as const) expect(committed[key]).toBeCloseTo(before[index][key], 1)
  }
  for (const frame of [1, 5, 9]) await expect(event(page, 'A', frame)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+z')
  for (const frame of [1, 5, 9]) await expect(event(page, 'A', frame)).toHaveCount(1)
  await expect(event(page, 'B', 13).locator('.eventText')).toHaveText('4')
  await expect(event(page, 'B', 17)).toHaveCount(0)
  await page.keyboard.press('ControlOrMeta+y')
  await expect(event(page, 'B', 17).locator('.eventText')).toHaveText('2')
})
