import { expect, test } from './fixtures'
import { activateControl } from './input'

for (const [queries, title] of [
  [['', '?app=remap'], 'xsheet-remap'],
  [['?app=editor'], 'xsheet-remap'],
  [['?app=template-editor'], 'xsheet-remap - Template'],
  [['?app=sheet-corrector'], 'シート画像補正'],
] as const) {
  test(`Pages loads the ${title} entry point (${queries.map(query => query || 'default').join(', ')})`, async ({ page }) => {
    const failures: string[] = []
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) failures.push(`${response.status()} ${response.url()}`)
    })
    for (const query of queries) {
      await page.goto('./' + query)
      await expect(page).toHaveTitle(title)
      await expect(page.getByRole('button', { name: 'ヘルプ', exact: true })).toBeVisible()
      const entryUrl = new URL(page.url())
      expect(entryUrl.pathname).toBe('/xsheet-remap/')
      expect(entryUrl.search).toBe(query)
      if (query === '' || query === '?app=remap') {
        // The shared title alone cannot distinguish Remap from the legacy Editor.
        const sheetMode = page.getByRole('button', { name: 'シート編集', exact: true })
        await expect(sheetMode).toHaveAttribute('aria-pressed', 'true')
        await expect(page.locator('.assetBrowser, .cspLayerTree, #sheet-left-pane')).toHaveCount(0)
        await expect(page.locator('.clipLayerPanel')).toHaveCount(0)
        // Check real WASM/font painting without measuring GPU speed.
        const paper = page.locator('.sheetSvg').first()
        await expect(paper).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 30_000 })
        await expect(paper).toHaveAttribute('data-canvaskit-ready', 'true')
        await expect(page.getByRole('button', { name: 'MEMOを編集', exact: true })).toBeVisible()
        await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
        await expect(page.locator('#sheet-right-pane .clipLayerPanel')).toBeVisible()
        await expect(page.getByRole('tree', { name: 'CLIPレイヤーツリー', exact: true })).toBeVisible()
        await activateControl(page, sheetMode)
        await expect(page.locator('.clipLayerPanel')).toHaveCount(0)
      } else if (query === '?app=editor') {
        await expect(page.locator('.remapWorkModes')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'CSPレイヤー構成', exact: true })).toBeVisible()
      }
    }
    expect(failures, 'failed same-origin application resources').toEqual([])
  })
}
