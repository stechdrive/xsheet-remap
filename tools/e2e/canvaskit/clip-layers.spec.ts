import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { cellRectForHit, timingHitForFrame, standardA3SheetTemplate } from '../../../packages/core/src/index'
import { readClip } from '../../../packages/adapters/src/clip/reader'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
const image = (name: string) => ({ name, mimeType: 'image/png', buffer: png })
const row = (page: Page, name: string) => page.locator('.clipLayerRow').filter({ has: page.locator('.clipLayerName', { hasText: new RegExp(`^${name}$`) }) })
async function cell(page: Page, frame: number) {
  const rect = cellRectForHit(standardA3SheetTemplate, timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', frame)!)!
  return page.locator('.sheetSvg').first().evaluate((element, r) => {
    const box = element.getBoundingClientRect()
    return { x: box.x + (r.x + r.w / 2) * box.width, y: box.y + (r.y + r.h / 2) * box.height }
  }, rect)
}

test('two-pane layer workspace imports, previews, reuses cels, filters without changing exposure and exports static materials', async ({ page }, info) => {
  await page.goto('./?app=remap')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await expect(page.locator('#sheet-right-pane')).toHaveCount(0)
  const tree = page.getByRole('tree', { name: 'CLIPレイヤーツリー' })
  const pane = page.locator('.clipLayerPanel')
  await activateControl(page, page.locator('[data-clip-layer-id="slot:slot_A"]'))
  const process = await page.getByLabel('登録先工程', { exact: true }).inputValue()
  await pane.locator('input[type=file]').setInputFiles([image('001.png'), image('002.png')])
  await expect(row(page, '002')).toBeVisible()
  await expect(page.locator('.eventText')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: '001をクイックルック', exact: true }))
  const preview = page.getByRole('dialog', { name: '001のプレビュー', exact: true })
  await expect(preview.locator('img')).toBeVisible()
  expect(await preview.locator('img').evaluate(image => (image as HTMLImageElement).naturalWidth)).toBe(1)
  await activateControl(page, page.getByRole('button', { name: 'プレビューを閉じる', exact: true }))
  const event = (frame: number) => page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"] .eventText`)
  async function drag(frame: number, cancel = false) {
    await row(page, '001').evaluate(element => element.scrollIntoView({ block: 'nearest' }))
    const from = await row(page, '001').boundingBox(), to = await cell(page, frame)
    expect(to.x).toBeLessThan(page.viewportSize()!.width)
    expect(to.y).toBeLessThan(page.viewportSize()!.height)
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 8 })
    if (cancel) await page.keyboard.press('Escape')
    await page.mouse.up()
  }
  await drag(1, true)
  await expect(event(1)).toHaveCount(0)
  await drag(1)
  await expect(event(1)).toHaveText('1')
  await drag(7)
  await expect(event(7)).toHaveText('1')
  await expect(row(page, '001')).toHaveCount(1)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event(7)).toHaveCount(0)
  await expect(row(page, '001')).toHaveCount(1)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await page.getByLabel('シートは選択工程だけ表示', { exact: true }).check()
  const other = await page.getByLabel('登録先工程', { exact: true }).locator('option').evaluateAll((options, current) => (options as HTMLOptionElement[]).find(option => option.value !== current)!.value, process)
  await page.getByLabel('登録先工程', { exact: true }).selectOption(other)
  await expect(event(1)).toHaveCount(0)
  await page.getByLabel('登録先工程', { exact: true }).selectOption(process)
  await expect(event(1)).toHaveText('1')
  await expect(event(7)).toHaveText('1')
  const box = await tree.boundingBox()
  expect(box!.width).toBeGreaterThan(170)
  expect(box!.x + box!.width).toBeLessThan(page.viewportSize()!.width / 2)
  await page.screenshot({ path: info.outputPath('clip-layer-workspace.png') })

  // The tree background denotes the document root, independently of the selected cel.
  const transfer = await page.evaluateHandle(base64 => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([Uint8Array.from(atob(base64), char => char.charCodeAt(0))], 'BOOK.png', { type: 'image/png' }))
    return transfer
  }, png.toString('base64'))
  await pane.dispatchEvent('drop', { dataTransfer: transfer })
  await transfer.dispose()
  await expect(row(page, 'BOOK')).toBeAttached()
  await activateControl(page, row(page, 'BOOK'))
  await expect(page.getByLabel('レイヤーの移動先', { exact: true })).toHaveValue('')
  await activateControl(page, page.getByRole('button', { name: 'BOOK表示＋', exact: true }))
  await expect(row(page, 'BOOK')).toContainText('旗')

  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'CLIPを作成…', exact: true }))
  const dialog = page.getByRole('dialog', { name: 'CLIPを作成', exact: true })
  await dialog.getByLabel('作画サイズ（用紙サイズ） 幅（px）', { exact: true }).fill('32')
  await dialog.getByLabel('作画サイズ（用紙サイズ） 高さ（px）', { exact: true }).fill('24')
  await dialog.getByLabel('基準サイズ（撮影フレーム） 幅（px）', { exact: true }).fill('24')
  await dialog.getByLabel('基準サイズ（撮影フレーム） 高さ（px）', { exact: true }).fill('16')
  await activateControl(page, dialog.getByRole('button', { name: 'CELL', exact: true }))
  const download = page.waitForEvent('download')
  await activateControl(page, dialog.getByRole('button', { name: 'CLIPを作成して保存…', exact: true }))
  const saved = info.outputPath('tree.clip')
  await (await download).saveAs(saved)
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const data = await readClip(SQL, new Uint8Array(readFileSync(saved)), 'tree.clip')
  expect(data.layers!.find(node => node.name === 'BOOK')).toMatchObject({ kind: 'raster', parentId: null })
  const cel = data.layers!.find(node => node.name === '001')!
  expect(data.timelines[0].tracks.find(track => track.layerId === cel.parentId)?.frames).toEqual([{ frame: 0, value: '001' }, { frame: 6, value: '001' }])
  expect(data.layers!.filter(node => node.name === 'BOOK')).toHaveLength(1)
})
