import { expect, test } from './fixtures'
import { activateControl } from './input'
import { waitForPaperPaint } from '../paper-paint-contract'

test('template panes and controls fit at desktop and narrow widths; help appears only on demand', async ({ page }) => {
  await page.goto('./?app=template-editor')
  await page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  for (const width of [1440, 1024, 768]) {
    await page.setViewportSize({ width, height: 900 })
    const panes = await page.locator('.templateRegionNavigator, .templateWorkspace > .templateDock, .templateEditorViewport').evaluateAll(elements => elements.map(element => {
      const r = element.getBoundingClientRect()
      return { x: r.x, right: r.right, width: r.width, height: r.height, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, canvas: element.matches('.templateEditorViewport') }
    }))
    expect(panes).toHaveLength(3)
    for (const pane of panes) {
      expect(pane.x).toBeGreaterThanOrEqual(0); expect(pane.right).toBeLessThanOrEqual(width + 1)
      expect(pane.width).toBeGreaterThan(100); expect(pane.height).toBeGreaterThan(100)
      if (!pane.canvas) expect(pane.scrollWidth).toBeLessThanOrEqual(pane.clientWidth + 1)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.mouse.move(1, 1)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  const help = page.getByRole('button', { name: 'ヘルプ', exact: true })
  await expect(help).not.toHaveAttribute('title')
  await help.hover()
  await expect(page.getByRole('tooltip')).toContainText('使い方')
  await page.mouse.move(1, 1)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
})

test('default Remap keeps a full-height sheet and toggles its current right layer pane', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto('./')
  const workspace = page.locator('.sheetWorkspace')
  const viewport = page.locator('.sheetViewportFrame')
  await expect(workspace).toBeVisible()
  await expect(workspace.locator('.panelResizeToggle')).toHaveCount(0)
  const sheetWidth = (await viewport.boundingBox())!.width
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await expect(page.locator('#sheet-left-pane')).toHaveCount(0)
  await expect(page.locator('#sheet-right-pane .clipLayerPanel')).toBeVisible()
  const toggle = workspace.locator('.panelResizeToggle')
  await expect(toggle).toHaveCount(1)
  expect((await viewport.boundingBox())!.width).toBeLessThan(sheetWidth)
  for (const expanded of [false, true, false]) {
    await activateControl(page, toggle)
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded))
    const size = await workspace.evaluate(element => ({
      outer: element.getBoundingClientRect().height,
      inner: element.querySelector('.sheetViewportFrame')!.getBoundingClientRect().height,
    }))
    expect(size.inner).toBeGreaterThan(size.outer * 0.95)
  }
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  await expect(workspace.locator('.panelResizeToggle')).toHaveCount(0)
  expect((await viewport.boundingBox())!.width).toBe(sheetWidth)
  expect(await page.evaluate(() => document.getElementById('root')!.getBoundingClientRect().height)).toBe(900)
})

test('legacy Editor pane toggles leave one full-height viewport when closed', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 900 })
  await page.goto('./?app=editor')
  const workspace = page.locator('.sheetWorkspace')
  await expect(workspace).toBeVisible()
  const toggles = workspace.locator('.panelResizeToggle')
  await expect(toggles).toHaveCount(2)
  for (let i = 0; i < 2; i++) if (await toggles.nth(i).getAttribute('aria-expanded') === 'true') await toggles.nth(i).click()
  await expect(workspace).toHaveClass(/leftDockClosed/)
  await expect(workspace).toHaveClass(/rightDockClosed/)
  const size = await workspace.evaluate(element => {
    const viewport = element.querySelector('.sheetViewportFrame') ?? element.querySelector('.sheetViewport')!
    return { outer: element.getBoundingClientRect().height, inner: viewport.getBoundingClientRect().height }
  })
  expect(size.inner).toBeGreaterThan(size.outer * 0.95)
  for (let i = 0; i < 2; i++) {
    await toggles.nth(i).click()
    await expect(toggles.nth(i)).toHaveAttribute('aria-expanded', 'true')
    expect(await page.locator('.sheetViewport').evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(150)
    await toggles.nth(i).click()
  }
  expect(await page.evaluate(() => document.getElementById('root')!.getBoundingClientRect().height)).toBe(900)
})
