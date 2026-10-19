import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createOverflowClipFixture } from './clip-process-fixture'
import { readClip } from '../../../packages/adapters/src/clip/reader'
import { decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'
import { activeCutProjectFromDocument, clipImportFolders, openClipDocument, standardA3SheetTemplate, suggestClipProcessColumns } from '../../../packages/core/src/index'
import { overlayBandSegments, overlayPaperTracks } from '../../../packages/ui/src/app-sheet-geometry'

test('imported overflow flag moves together with its column, survives undo and saves its placement', async ({ page }, info) => {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const bytes = await createOverflowClipFixture(SQL), source = await readClip(SQL, bytes, 'overflow.clip')
  const columns = suggestClipProcessColumns(source, clipImportFolders(source.nodes).map(folder => folder.id))
  const project = activeCutProjectFromDocument(openClipDocument(source, 'data:,', { timelineIds: [source.timelines[0].id], role: 'cell', columns }))
  const track = overlayPaperTracks(project, standardA3SheetTemplate)[0]
  const segment = overlayBandSegments(standardA3SheetTemplate, project, 'cell')[0], slot = segment.slots[3]
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '読み込み ›', exact: true }))
  await page.locator('input[type=file][accept=".clip"]').setInputFiles({ name: 'overflow.clip', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  await activateControl(page, dialog.getByRole('button', { name: 'CELL', exact: true }))
  await activateControl(page, dialog.getByRole('button', { name: 'タイムシートに読み込む', exact: true }))
  const handle = page.getByRole('button', { name: new RegExp(`^${track.label}追加セル列:`) }).first()
  await handle.scrollIntoViewIfNeeded()
  const before = (await handle.boundingBox())!, paper = (await page.locator('.sheetSvg').first().boundingBox())!
  const initialColumn = await page.locator('.overlayPaperTrack.inputActive .overlayPaperTrackColumn').first().evaluate(element => element.getBoundingClientRect().toJSON())
  expect(Math.abs(initialColumn.x - (paper.x + (segment.rect.x + segment.rect.w) * paper.width))).toBeLessThan(1)
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  expect(Math.abs((await handle.boundingBox())!.x - before.x)).toBeLessThan(1)
  await page.mouse.move(paper.x + slot.x * paper.width, before.y + before.height / 2, { steps: 12 })
  await page.mouse.up()
  const moved = (await handle.boundingBox())!
  expect(before.x - moved.x).toBeGreaterThan(20)
  if (await handle.getAttribute('aria-pressed') !== 'true') await activateControl(page, handle)
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  const expanded = page.locator('.overlayPaperTrack.inputActive .overlayPaperTrackColumn').first()
  await expect(expanded).toHaveCount(1)
  expect(Math.abs((await expanded.boundingBox())!.x - (paper.x + slot.x * paper.width))).toBeLessThan(1)
  const content = page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="${track.paperTrack}"][data-timeline-event-frame="1"]`).first()
  // SVG groups containing clipped/transformed text have unreliable protocol box models.
  // Compare the browser's actual cell rect and verify native hit targeting at its center.
  const cell = await content.locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  const column = await expanded.evaluate(element => element.getBoundingClientRect().toJSON())
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-timeline-event-track]')?.getAttribute('data-timeline-event-track'), { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 })
  writeFileSync(info.outputPath('overflow-geometry.json'), JSON.stringify({ cell, column, hit }, null, 2))
  expect(Math.abs(cell.x - column.x)).toBeLessThan(1)
  expect(hit).toBe(track.paperTrack)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  expect(Math.abs((await handle.boundingBox())!.x - before.x)).toBeLessThan(1)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  expect(Math.abs((await handle.boundingBox())!.x - moved.x)).toBeLessThan(1)
  await page.screenshot({ path: info.outputPath('imported-overflow-moved.png') })
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const download = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('overflow.xsr'); await (await download).saveAs(saved)
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))).document)
  expect(restored.logicalSheet.paperTracks.find(item => item.paperTrack === track.paperTrack)?.viewPlacement).toMatchObject({ templateId: standardA3SheetTemplate.templateId, snapIndex: 3 })
})
