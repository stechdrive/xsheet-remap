import { expect, test, type Page } from './fixtures'
import { cellRectForHit, standardA3SheetTemplate, timingHitForFrame } from '../../../packages/core/src/index'
import { waitForPaperPaint } from '../paper-paint-contract'

async function displaySettings(page: Page) {
  const trigger = page.getByLabel('表示設定', { exact: true })
  if (!await trigger.evaluate(element => element.closest('details')!.open)) await trigger.click()
  return page.locator('.actionMenuPortalContent.sheetDisplaySettingsMenu')
}
async function showPage(page: Page, index: number) {
  const trigger = page.getByLabel('表示ページ', { exact: true })
  if (!await trigger.evaluate(element => element.closest('details')!.open)) await trigger.click()
  await page.locator('.pageJumpPanel').getByRole('button', { name: `${index}P`, exact: true }).click()
  await trigger.click()
}
async function enterFrame(page: Page, frame: number, value: string, duration: number, origin: number) {
  const hit = timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', frame, duration, origin)!
  const rect = cellRectForHit(standardA3SheetTemplate, hit, duration, origin)!
  const svg = page.locator(`.sheetSvg[data-page-id="${hit.pageId}"]`)
  await expect(svg).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  const point = await svg.evaluate((element, rect) => {
    const box = element.getBoundingClientRect()
    return { x: box.left + (rect.x + rect.w / 2) * box.width, y: box.top + (rect.y + rect.h / 2) * box.height }
  }, rect)
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type(value)
  await page.keyboard.press('Enter')
}
function event(page: Page, frame: number) {
  return page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"] .eventText`)
}

test('edits post-roll on the next page and preserves it through independent toggles and undo', async ({ page }, info) => {
  await page.goto('./')
  const menu = await displaySettings(page)
  await expect(menu.getByRole('checkbox', { name: '開始前ダミー', exact: true })).not.toBeChecked()
  await expect(menu.getByRole('checkbox', { name: '終了後ダミー', exact: true })).not.toBeChecked()
  await menu.getByRole('button', { name: '1ページ', exact: true }).click()
  await (await displaySettings(page)).getByRole('checkbox', { name: '終了後ダミー', exact: true }).check()
  await showPage(page, 2)
  await enterFrame(page, 145, '7', 168, 1)
  await enterFrame(page, 153, '8', 168, 1)
  await expect(event(page, 145)).toHaveText('7')
  await expect(event(page, 153)).toHaveText('8')
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  await page.screenshot({ path: info.outputPath('post-roll-next-page.png') })

  await (await displaySettings(page)).getByRole('checkbox', { name: '終了後ダミー', exact: true }).uncheck()
  await expect(event(page, 145)).toHaveCount(0)
  await expect(page.getByLabel('表示ページ', { exact: true })).toContainText('1P')
  await page.getByRole('button', { name: '元に戻す', exact: true }).click()
  await expect(event(page, 145)).toHaveText('7')
  await page.getByRole('button', { name: 'やり直し', exact: true }).click()
  await expect(event(page, 145)).toHaveCount(0)

  await (await displaySettings(page)).getByRole('checkbox', { name: '開始前ダミー', exact: true }).check()
  await expect((await displaySettings(page)).getByRole('checkbox', { name: '終了後ダミー', exact: true })).not.toBeChecked()
  await (await displaySettings(page)).getByRole('checkbox', { name: '終了後ダミー', exact: true }).check()
  await showPage(page, 2)
  await expect(event(page, 145)).toHaveText('7')
  await expect(event(page, 153)).toHaveText('8')
  await (await displaySettings(page)).getByRole('checkbox', { name: '開始前ダミー', exact: true }).uncheck()
  await expect((await displaySettings(page)).getByRole('checkbox', { name: '終了後ダミー', exact: true })).toBeChecked()
  await expect(event(page, 145)).toHaveText('7')
  await page.getByLabel('カット情報', { exact: true }).click()
  await expect(page.getByLabel('尺 秒', { exact: true })).toHaveValue('06')
})
