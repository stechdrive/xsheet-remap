import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createPreviewFixture } from '../../../packages/adapters/src/clip/fixtures/preview-fixture'
import { normalizedUuid } from '../../../packages/adapters/src/clip/layer-metadata'
import { writeClip } from '../../../packages/adapters/src/clip/writer'

test('CLIP base choice stays beside Import and saved folder disclosure leads to a vector Quick Look', async ({ page }, info) => {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const { clip, vectorId } = await createPreviewFixture(SQL)
  const folder = clip.rows('Layer').find(row => row.LayerFirstChildIndex === vectorId)!
  const folderId = normalizedUuid(folder.LayerUuid), bytes = Buffer.from(clip.bytes()); clip.close()
  await page.goto('./?app=remap')
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '読み込み ›', exact: true }))
  await page.getByLabel('CLIPを読み込む…', { exact: true }).setInputFiles({ name: 'preview.clip', mimeType: 'application/octet-stream', buffer: bytes })
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  const base = dialog.getByLabel('シートの基準にする工程を選択'), submit = dialog.getByRole('button', { name: 'タイムシートに読み込む' })
  await expect(base).toBeVisible()
  await expect(base).toHaveValue('xsheet-remap／作画')
  await expect(submit).toBeEnabled()
  const palette = await dialog.getByRole('complementary', { name: '読み込むCLIPのレイヤー' }).boundingBox()
  const settings = await dialog.locator('.clipImportSettings').boundingBox()
  expect(palette!.x).toBeGreaterThanOrEqual(settings!.x + settings!.width - 1)
  expect(Math.abs(palette!.height - settings!.height)).toBeLessThan(2)
  await expect(dialog.locator(`[data-clip-layer-id="${folderId}"]`).locator('..')).toHaveAttribute('aria-expanded', 'false')
  const bounds = await base.boundingBox(), button = await submit.boundingBox()
  expect(bounds!.y).toBeGreaterThan(0)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(page.viewportSize()!.height)
  expect(Math.abs(bounds!.y + bounds!.height - button!.y - button!.height)).toBeLessThan(100)
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: info.outputPath('base-choice.png') })
  await activateControl(page, submit)
  await expect(dialog).toHaveCount(0)
  const animation = page.locator(`[data-clip-layer-id="${folderId}"]`)
  await expect(animation.locator('..')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'vector-celをクイックルック', exact: true })).toHaveCount(0)
  await activateControl(page, animation.getByRole('button', { name: 'Aを展開', exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'vector-celをクイックルック', exact: true }))
  const preview = page.getByRole('dialog', { name: 'vector-celのプレビュー', exact: true })
  await expect(preview).toBeVisible()
  await expect(preview).toContainText('近似描画')
  const image = preview.locator('img').first()
  await expect(image).toBeVisible()
  expect(await image.evaluate(async node => {
    const image = node as HTMLImageElement; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    return { width: image.naturalWidth, height: image.naturalHeight, pixel: Array.from(context.getImageData(2, 2, 1, 1).data) }
  })).toEqual({ width: 6, height: 6, pixel: [0, 0, 0, 255] })
  await page.screenshot({ path: info.outputPath('vector-quick-look.png') })
})

test('large CLIP trees scroll independently while base selection and import stay visible', async ({ page }, info) => {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const folders = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, path: ['作画'], name: `列${i + 1}`, cels: [] }))
  const { bytes } = await writeClip(SQL, new Uint8Array(readFileSync('packages/adapters/src/clip/blank.clip')), {
    plan: { projectId: 'long-tree', folders, timelines: [{ id: 't', name: 'C001', fps: 24, duration: 24, tracks: [] }] },
    canvas: { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 }, fit: 'crop', images: {},
  })
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 540 })
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '読み込み ›', exact: true }))
  await page.getByLabel('CLIPを読み込む…', { exact: true }).setInputFiles({ name: 'long-tree.clip', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  const base = dialog.getByLabel('シートの基準にする工程を選択'), submit = dialog.getByRole('button', { name: 'タイムシートに読み込む' })
  await expect(base).toHaveValue('xsheet-remap／作画')
  const tree = dialog.getByRole('tree'), body = dialog.locator('.timingExportDialogBody')
  expect(await tree.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true)
  const buttonBefore = await submit.boundingBox(), baseBefore = await base.boundingBox()
  expect(buttonBefore!.y + buttonBefore!.height).toBeLessThanOrEqual(540)
  await tree.evaluate(node => { node.scrollTop = node.scrollHeight })
  await activateControl(page, dialog.getByRole('button', { name: 'xsheet-remap / 作画 / 列1の読み込み設定', exact: true }))
  await expect(dialog.getByLabel('xsheet-remap / 作画 / 列1のセル列名')).toHaveValue('列1')
  await body.evaluate(node => { node.scrollTop = node.scrollHeight })
  expect((await submit.boundingBox())!.y).toBeCloseTo(buttonBefore!.y, 0)
  expect((await base.boundingBox())!.y).toBeCloseTo(baseBefore!.y, 0)
  expect(await dialog.locator('.clipImportOrder').evaluate(node => getComputedStyle(node).position)).toBe('static')
  expect(await tree.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(false)
  await expect(submit).toBeEnabled()
  await page.screenshot({ path: info.outputPath('clip-independent-scrolling.png') })
  await activateControl(page, dialog.getByRole('button', { name: 'キャンセル', exact: true }))
  await expect(dialog).toHaveCount(0)
})
