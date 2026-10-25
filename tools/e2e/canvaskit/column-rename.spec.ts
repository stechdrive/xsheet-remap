import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { writeClip } from '../../../packages/adapters/src/clip/writer'
import { decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'
import { activeCutProjectFromDocument, digitalStandardSheetTemplate } from '../../../packages/core/src/index'
import { buildTemplateChromeRenderModel } from '../../../packages/ui/src/templateEditorGeometry'

const require = createRequire(import.meta.url)

for (const role of ['action', 'cell'] as const) test(`right-click selects the imported ${role} column and Enter renames that column through XSR`, async ({ page }, info) => {
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const clip = await writeClip(SQL, new Uint8Array(readFileSync('packages/adapters/src/clip/blank.clip')), {
    plan: { projectId: 'rename-fixture',
      folders: ['A_ブランケット', 'B'].map((name, index) => ({ id: `track${index}`, name, path: ['原画'], cels: [{ name: '001' }] })),
      timelines: [{ id: 'cut', name: 'C001', fps: 24, duration: 24, tracks: [0, 1].map(index => ({ folderId: `track${index}`, frames: [{ frame: 0, value: '001' }] })) }],
    },
    canvas: { width: 32, height: 24, dpi: 150, basisWidth: 32, basisHeight: 24, offsetX: 0, offsetY: 0 }, fit: 'crop', images: {},
  })
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '読み込み ›', exact: true }))
  await page.getByLabel('CLIPを読み込む…', { exact: true }).setInputFiles({ name: 'rename.clip', mimeType: 'application/octet-stream', buffer: Buffer.from(clip.bytes) })
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  await activateControl(page, dialog.getByRole('button', { name: role.toUpperCase(), exact: true }))
  await activateControl(page, dialog.getByRole('button', { name: 'タイムシートに読み込む', exact: true }))
  await expect(dialog).toHaveCount(0)
  await activateControl(page, page.getByLabel('表示設定', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'デジタル標準', exact: true }))
  await page.keyboard.press('Escape')
  await expect(page.locator('.sheetSvg')).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })

  // CanvasKit paints column headers directly; the SVG only retains style samples.
  const chrome = buildTemplateChromeRenderModel(digitalStandardSheetTemplate, ['A_ブランケット', 'B'], 24)
  const header = chrome.headers.find(item => item.regionId === `digital_${role}_grid`)!
  const point = async (index: number) => page.locator('.sheetSvg').evaluate((element, column) => {
    const box = element.getBoundingClientRect()
    return { x: box.x + column.x * box.width, y: box.y + column.y * box.height }
  }, header.columns[index])
  const timing = (track: string) => page.locator(`[data-timeline-event-role="${role}"][data-timeline-event-track="${track}"] .eventText`)
  await expect(timing('A_ブランケット')).toHaveText('001')
  await expect(timing('B')).toHaveText('001')
  const previous = await point(1)
  await page.mouse.click(previous.x, previous.y)
  const status = page.locator('.statusBar > span').first()
  await expect(status).toContainText(`${role.toUpperCase()} B 001-024`)
  const target = await point(0)
  await page.mouse.click(target.x, target.y, { button: 'right' })
  await expect(status).toContainText(`${role.toUpperCase()} A_ブランケット 001-024`)
  await activateControl(page, page.getByRole('menuitem', { name: 'セル列名を変更', exact: true }))
  const name = page.getByRole('textbox', { name: 'セル列名', exact: true })
  await expect(name).toHaveValue('A_ブランケット')
  await name.fill('A')
  await name.press('Enter')
  await expect(name).toHaveCount(0)
  await expect(timing('A_ブランケット')).toHaveCount(0)
  await expect(status).toContainText(`${role.toUpperCase()} A 001-024`)
  await expect(timing('A')).toHaveText('001')
  await expect(timing('B')).toHaveText('001')
  await page.screenshot({ path: info.outputPath('renamed-column-selected.png') })
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(timing('A_ブランケット')).toHaveText('001')
  await expect(timing('A')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(timing('A')).toHaveText('001')

  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const download = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('renamed.xsr')
  await (await download).saveAs(saved)
  const { document } = await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))
  const project = activeCutProjectFromDocument(document)
  expect(project.logicalSheet.paperTracks.map(track => track.paperTrack)).toEqual(['A', 'B'])
  expect(project.logicalSheet.events.map(event => [event.paperTrack, event.sheetRole])).toEqual([['A', role], ['B', role]])
  const slot = project.cspTrackSlots.find(slot => slot.paperTrack === 'A')!
  const folder = project.clipDocument!.targets.find(target => target.slotId === slot.slotId)!
  expect(project.clipDocument!.nodes.find(node => node.id === folder.folderId)?.name).toBe('A_ブランケット')
  await page.reload()
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles(saved)
  await expect(timing('A')).toHaveText('001')
  await expect(timing('B')).toHaveText('001')
  await page.mouse.click(target.x, target.y, { button: 'right' })
  await activateControl(page, page.getByRole('menuitem', { name: 'セル列名を変更', exact: true }))
  await expect(name).toHaveValue('A')
  await name.press('Escape')
})
