import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, type ClipRegistrationPlan } from '../../../packages/core/src/index'
import { decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'
import { writeClip } from '../../../packages/adapters/src/clip/writer'

const require = createRequire(import.meta.url)
const plan: ClipRegistrationPlan = {
  projectId: 'import-browser', folders: [
    { id: 'long', path: ['任意の工程'], name: '長いフォルダー名', cels: [{ name: '001' }, { name: '2' }] },
    { id: 'short', path: ['別の工程'], name: 'A', cels: [{ name: '3' }] },
    { id: 'skip', path: ['別の工程'], name: '不要', cels: [{ name: '4' }] },
  ], timelines: [
    { id: 'c1', name: 'C001', fps: 24, duration: 24, tracks: [
      { folderId: 'long', frames: [{ frame: 0, value: '001' }, { frame: 4, value: null }, { frame: 8, value: '001' }] },
      { folderId: 'short', frames: [{ frame: 2, value: '3' }] },
    ] },
    { id: 'c2', name: 'C002', fps: 30, duration: 30, tracks: [
      { folderId: 'long', frames: [{ frame: 6, value: '001' }, { frame: 12, value: '2' }] },
    ] },
  ],
}

test('CLIP worker imports chosen folders as shared cuts, supports undo, and preserves timing/source through XSR', async ({ page }, info) => {
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const clip = await writeClip(SQL, new Uint8Array(readFileSync('packages/adapters/src/clip/blank.clip')), {
    plan, canvas: { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 }, fit: 'expand', images: {},
  })
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '読み込み ›', exact: true }))
  await page.getByLabel('CLIPを読み込む…', { exact: true }).setInputFiles({ name: 'shared.clip', mimeType: 'application/octet-stream', buffer: Buffer.from(clip.bytes) })
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  await expect(dialog.getByRole('checkbox', { name: /^C00/ })).toHaveCount(2)
  await dialog.getByRole('checkbox', { name: /^C001/ }).check()
  await dialog.getByRole('checkbox', { name: /^C002/ }).check()
  await dialog.getByLabel('xsheet-remap / 別の工程 / 不要を読み込む', { exact: true }).uncheck()
  await expect(dialog.getByLabel('xsheet-remap / 任意の工程 / 長いフォルダー名のセル列名')).toHaveValue('B')
  await expect(dialog.locator('.clipImportOrder')).toContainText('B → A')
  const box = await dialog.locator('.clipImportDialog').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath('clip-import-selection.png') })
  await activateControl(page, dialog.getByRole('button', { name: 'タイムシートに読み込む' }))
  await expect(dialog).toHaveCount(0)
  const timing = (frame: number) => page.locator(`[data-timeline-event-role="action"][data-timeline-event-track="B"][data-timeline-event-frame="${frame}"] .eventText`)
  await expect(timing(1)).toHaveText('001')
  await expect(timing(9)).toHaveText('001')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(timing(1)).toHaveCount(0)
  await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
  await expect(page.getByLabel('兼用カット', { exact: true }).locator('option')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(timing(1)).toHaveText('001')
  await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
  await expect(page.getByLabel('兼用カット', { exact: true }).locator('option')).toHaveCount(2)
  await page.getByLabel('兼用カット', { exact: true }).selectOption({ label: 'C002' })
  await page.keyboard.press('Escape')
  await expect(timing(7)).toHaveText('001')
  await expect(timing(13)).toHaveText('2')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const pending = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('imported.xsr')
  await (await pending).saveAs(saved)
  const { document } = await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))
  expect(document.cuts.map(cut => cut.metadata.cut)).toEqual(['C001', 'C002'])
  const projects = document.cuts.map(cut => activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId }))
  expect(projects.map(project => [project.logicalSheet.fps, project.logicalSheet.durationFrames])).toEqual([[24, 24], [30, 30]])
  expect(projects[0].logicalSheet.events.find(event => event.paperTrack === 'B' && event.frame === 1)?.keyId).toBe(projects[1].logicalSheet.events.find(event => event.paperTrack === 'B' && event.frame === 7)?.keyId)
  expect(projects[1].logicalSheet.paperTracks.find(track => track.paperTrack === 'B')?.clipSource).toMatchObject({ fileName: 'shared.clip', timelineName: 'C002', path: ['xsheet-remap', '任意の工程', '長いフォルダー名'] })
  await page.reload()
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles(saved)
  await expect(timing(7)).toHaveText('001')
  await expect(timing(13)).toHaveText('2')
})
