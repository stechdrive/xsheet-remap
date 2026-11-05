import { expect, test } from './fixtures'
import { activateControl } from './input'
import { startPagesServer } from './pages-server.mjs'

for (const query of ['?app=remap', '?app=sheet-corrector']) {
  test(`searchable in-app licenses and full notices: ${query}`, async ({ page }) => {
    await page.goto('./' + query)
    await activateControl(page, page.getByRole('button', { name: 'ヘルプ', exact: true }))
    await activateControl(page, page.getByRole('tab', { name: 'ライセンス・謝辞', exact: true }))
    const search = page.getByRole('searchbox', { name: 'ライブラリ名・ライセンスで検索' })
    await search.fill('celcodec')
    const entry = page.locator('.licenseEntry').filter({ has: page.getByText('celcodec', { exact: true }) })
    await expect(entry).toContainText('0.8.10 · MIT')
    await activateControl(page, entry.locator('summary'))
    await expect(entry).toContainText('Copyright (c) 2025-2026 stechdrive')
    await search.fill('LAME')
    const encoder = page.locator('.licenseEntry').filter({ has: page.getByText('LAME MP3 encoder', { exact: true }) })
    await activateControl(page, encoder.locator('summary'))
    await expect(encoder).toContainText('GNU LIBRARY GENERAL PUBLIC LICENSE')
    await expect(encoder.getByRole('link', { name: /sourceforge.net/ })).toHaveAttribute('href', /3.100/)
    const bounds = await page.getByRole('article', { name: 'ライセンス・謝辞' }).evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
    expect(bounds.content).toBeLessThanOrEqual(bounds.width + 1)
  })
}

test.describe('offline license notices', () => {
  test.use({ serviceWorkers: 'allow' })
  test('retains opened license texts when the origin is disconnected', async ({ page }) => {
    const server = await startPagesServer()
    try {
      await page.goto(server.url + '?app=help&view=licenses')
      await page.evaluate(async () => { await navigator.serviceWorker.ready })
      await page.reload()
      await expect(page.getByRole('searchbox')).toBeVisible()
      await expect.poll(() => page.evaluate(async () => {
        for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) {
          if (new URL(request.url).pathname.includes('/license-data-')) return true
        }
        return false
      })).toBe(true)
      await server.close()
      await page.reload()
      await page.getByRole('searchbox').fill('sql.js')
      const entry = page.locator('.licenseEntry').filter({ has: page.getByText('sql.js', { exact: true }) })
      await activateControl(page, entry.locator('summary'))
      await expect(entry).toContainText('Copyright (c) 2017 sql.js authors')
    } finally { await server.close() }
  })
})
