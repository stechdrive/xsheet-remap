import { expect, test, type Page } from './fixtures'

async function recoveredName(page: Page): Promise<string | null> {
  return page.evaluate(() => new Promise<string | null>((resolve, reject) => {
    const request = indexedDB.open('xsheet-template-draft-recovery', 1)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('drafts')) { database.close(); resolve(null); return }
      const read = database.transaction('drafts').objectStore('drafts').get('current')
      read.onsuccess = () => { database.close(); resolve(read.result?.template?.name ?? null) }
      read.onerror = () => { database.close(); reject(read.error) }
    }
  }))
}

test('Remap and Corrector open an independent template-only editor at the deployment subpath', async ({ page, context }) => {
  for (const kind of ['remap', 'sheet-corrector']) {
    if (kind === 'sheet-corrector') await page.setViewportSize({ width: 900, height: 720 })
    await page.goto(`./?app=${kind}`)
    if (kind === 'remap') {
      await page.locator('summary[aria-label="画面切替"]').click()
      await expect(page.getByRole('button', { name: 'プロジェクトを開く…', exact: true })).toBeVisible()
    }
    if (kind === 'sheet-corrector') {
      const bounds = await page.locator('.sheetCorrectorCorrectionActions').boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(900)
    }
    const before = page.url()
    const opened = context.waitForEvent('page')
    await page.getByRole('button', { name: /テンプレートを作成・編集/ }).click()
    const editor = await opened
    await expect(editor).toHaveURL(/\/xsheet-remap\/\?app=template-editor$/)
    await expect(editor).toHaveTitle('xsheet-remap - Template')
    await expect(editor.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeVisible()
    expect(page.url()).toBe(before)
    await editor.close()
  }
})

test('template-only draft survives reopening and JSON saving clears recovery without applying a sheet', async ({ page }) => {
  await page.goto('./?app=template-editor')
  await page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
  const navigator = page.getByRole('complementary', { name: 'テンプレート構成' })
  await navigator.getByRole('button', { name: '用紙と見た目', exact: true }).click()
  await page.getByLabel('名前', { exact: true }).fill('Integration draft')
  await expect.poll(() => recoveredName(page)).toBe('Integration draft')
  page.on('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '下書きを復元' }).click()
  await navigator.getByRole('button', { name: '用紙と見た目', exact: true }).click()
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('Integration draft')
  await expect(page.getByRole('button', { name: 'プロジェクトへ反映' })).toHaveCount(0)
  const downloaded = page.waitForEvent('download')
  await page.getByRole('button', { name: 'テンプレートJSONを保存', exact: true }).click()
  const download = await downloaded
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  const stream = await download.createReadStream()
  if (!stream) throw new Error('Template JSON download is missing')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  expect(JSON.parse(Buffer.concat(chunks).toString('utf8')).name).toBe('Integration draft')
  await expect(page.getByText('保存済み', { exact: true })).toBeVisible()
  await expect.poll(() => recoveredName(page)).toBeNull()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeVisible()
  await expect(page.getByRole('button', { name: '下書きを復元' })).toHaveCount(0)
})
