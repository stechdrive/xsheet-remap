import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createOverflowClipFixture } from './clip-process-fixture'

test('CLIP drop cancellation, invalid files and mixed drops preserve the current work', async ({ page }) => {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const bytes = await createOverflowClipFixture(SQL)
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  const originalLayers = await page.locator('.clipLayerName').allTextContents()
  const drop = (files: { name: string; bytes: number[] }[]) => page.evaluate(files => {
    const transfer = new DataTransfer()
    files.forEach(file => transfer.items.add(new File([new Uint8Array(file.bytes)], file.name)))
    document.querySelector('.clipLayerPanel')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, files)
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  await drop([{ name: 'valid.CLIP', bytes: [...bytes] }])
  await expect(dialog.getByRole('button', { name: 'タイムシートに読み込む', exact: true })).toBeEnabled()
  // A second drop cannot replace a document currently owned by the import dialog.
  await drop([{ name: 'ignored.clip', bytes: [1, 2, 3] }])
  await expect(dialog).toContainText('valid.CLIP')
  await activateControl(page, dialog.getByRole('button', { name: 'キャンセル', exact: true }))
  expect(await page.locator('.clipLayerName').allTextContents()).toEqual(originalLayers)
  await drop([{ name: 'broken.clip', bytes: [1, 2, 3] }])
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'タイムシートに読み込む', exact: true })).toBeDisabled()
  await activateControl(page, dialog.getByRole('button', { name: 'キャンセル', exact: true }))
  expect(await page.locator('.clipLayerName').allTextContents()).toEqual(originalLayers)
  const alert = page.waitForEvent('dialog')
  const rejected = drop([{ name: 'one.clip', bytes: [...bytes] }, { name: 'image.png', bytes: [1] }])
  const message = await alert
  expect(message.message()).toContain('1件だけ')
  await message.accept(); await rejected
  await expect(dialog).toHaveCount(0)
  expect(await page.locator('.clipLayerName').allTextContents()).toEqual(originalLayers)
})
