import { expect, test } from './fixtures'

for (const [query, title] of [
  ['', 'xsheet-editor'],
  ['?app=remap', 'xsheet-remap'],
  ['?app=template-editor', 'xsheet-template'],
  ['?app=sheet-corrector', 'シート画像補正'],
]) {
  test(`Pages loads the ${title} entry point`, async ({ page }) => {
    const failures: string[] = []
    page.on('response', response => {
      if (response.status() >= 400 && new URL(response.url()).origin === new URL(page.url()).origin) failures.push(`${response.status()} ${response.url()}`)
    })
    await page.goto('./' + query)
    await expect(page).toHaveTitle(title)
    await expect(page.getByRole('button', { name: 'ヘルプ', exact: true })).toBeVisible()
    if (query === '') {
      // Validate that the deployed WASM and fonts can actually paint, without
      // measuring GPU speed or waiting for synthetic pointer/frame stability.
      const paper = page.locator('.sheetSvg').first()
      await expect(paper).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 30_000 })
      await expect(paper).toHaveAttribute('data-canvaskit-ready', 'true')
      await expect(page.getByRole('button', { name: 'MEMOを編集', exact: true })).toBeVisible()
    }
    expect(failures, 'failed same-origin application resources').toEqual([])
  })
}
