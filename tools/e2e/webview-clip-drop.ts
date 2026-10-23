import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, type Page } from '@playwright/test'
import { createOverflowClipFixture } from './canvaskit/clip-process-fixture'
import { activeCutProjectFromDocument, clipImportFolders, openClipDocument, standardA3SheetTemplate, suggestClipProcessColumns } from '../../packages/core/src/index'
import { readClip } from '../../packages/adapters/src/clip/reader'
import { overlayBandSegments } from '../../packages/ui/src/app-sheet-geometry'

export async function prepareNativeClipDrop(run: string) {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  fs.writeFileSync(path.join(run, '日本語 overflow.CLIP'), await createOverflowClipFixture(SQL))
}

/** Real native file read and production routing; event injection is not Explorer OS input. */
export async function verifyNativeClipDrop(page: Page, run: string, drop: (paths: string[]) => Promise<void>, reloadFixture: () => Promise<void>) {
  const require = createRequire(import.meta.url)
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(fs.readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const file = path.join(run, '日本語 overflow.CLIP')
  const source = await readClip(SQL, new Uint8Array(fs.readFileSync(file)), path.basename(file))
  const columns = suggestClipProcessColumns(source, clipImportFolders(source.nodes).map(node => node.id))
  for (const role of ['action', 'cell'] as const) {
    await reloadFixture()
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await drop([file])
    const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
    await expect(dialog).toContainText(path.basename(file))
    await dialog.getByRole('button', { name: role.toUpperCase(), exact: true }).click()
    await dialog.getByRole('button', { name: 'タイムシートに読み込む', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    const content = page.locator(`[data-timeline-event-role="${role}"][data-timeline-event-track="J"][data-timeline-event-frame="1"]`).first()
    await expect(content).toBeVisible()
    const project = activeCutProjectFromDocument(openClipDocument(source, 'data:,', { timelineIds: [source.timelines[0].id], columns, role }))
    const segment = overlayBandSegments(standardA3SheetTemplate, project, role)[0]
    const paper = (await page.locator('.sheetSvg').first().boundingBox())!
    const cell = await content.locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
    expect(Math.abs(cell.x - paper.x - (segment.rect.x + segment.rect.w) * paper.width)).toBeLessThan(1)
    await page.screenshot({ path: path.join(run, `screenshots/clip-drop-${role}.png`) })
  }
}
