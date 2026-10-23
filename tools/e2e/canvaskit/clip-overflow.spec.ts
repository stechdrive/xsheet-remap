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

for (const role of ['action', 'cell'] as const) test(`dropped CLIP ${role} overflow moves with its column, survives undo and saves its placement`, async ({ page }, info) => {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const bytes = await createOverflowClipFixture(SQL), source = await readClip(SQL, bytes, 'overflow.clip')
  const columns = suggestClipProcessColumns(source, clipImportFolders(source.nodes).map(folder => folder.id))
  const project = activeCutProjectFromDocument(openClipDocument(source, 'data:,', { timelineIds: [source.timelines[0].id], role, columns }))
  const track = overlayPaperTracks(project, standardA3SheetTemplate)[0]
  const segment = overlayBandSegments(standardA3SheetTemplate, project, role)[0], slot = segment.slots[3]
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  // Browser DOM drop exercises capture routing through the sheet material target.
  await page.evaluate(data => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(data)], '日本語 overflow.CLIP'))
    document.querySelector('.sheetSvg')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, [...bytes])
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  await activateControl(page, dialog.getByRole('button', { name: role.toUpperCase(), exact: true }))
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
  const content = page.locator(`[data-timeline-event-role="${role}"][data-timeline-event-track="${track.paperTrack}"][data-timeline-event-frame="1"]`).first()
  // SVG groups containing clipped/transformed text have unreliable protocol box models.
  // Compare the browser's actual cell rect and verify DOM hit targeting at its center.
  const cell = await content.locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  const column = await expanded.evaluate(element => element.getBoundingClientRect().toJSON())
  const hit = await page.evaluate(({ x, y }) => {
    const event = document.elementFromPoint(x, y)?.closest('[data-timeline-event-track]')
    return { track: event?.getAttribute('data-timeline-event-track'), role: event?.getAttribute('data-timeline-event-role') }
  }, { x: cell.x + cell.width / 2, y: cell.y + cell.height / 2 })
  writeFileSync(info.outputPath('overflow-geometry.json'), JSON.stringify({ cell, column, hit }, null, 2))
  expect(Math.abs(cell.x - column.x)).toBeLessThan(1)
  expect(hit).toEqual({ track: track.paperTrack, role })
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
  expect(restored.logicalSheet.paperTracks.find(item => item.paperTrack === track.paperTrack)?.viewPlacement).toMatchObject({ templateId: standardA3SheetTemplate.templateId, sheetRole: role, snapIndex: 3 })
  // Reopen the actual saved archive and verify the displayed position as well as its bytes.
  await page.keyboard.press('Escape')
  const choosing = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+o')
  await (await choosing).setFiles(saved)
  await expect(handle).toBeVisible()
  expect(Math.abs((await handle.boundingBox())!.x - moved.x)).toBeLessThan(1)
})
