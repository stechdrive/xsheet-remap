import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, type ClipRegistrationPlan } from '../../../packages/core/src/index'
import { decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'
import { writeClip } from '../../../packages/adapters/src/clip/writer'
import { ClipContainer } from '../../../packages/adapters/src/clip/container'

const require = createRequire(import.meta.url)
const plan: ClipRegistrationPlan = {
  projectId: 'import-browser', folders: [
    { id: 'long', path: ['任意の工程'], name: '長いフォルダー名', cels: [{ name: '001' }, { name: '2' }] },
    { id: 'short', path: ['別の工程'], name: 'A', cels: [{ name: '3' }] },
    { id: 'skip', path: ['別の工程'], name: '不要', cels: [{ name: '4' }] },
  ], timelines: [
    { id: 'c1', name: 'C001', fps: 24, duration: 84, tracks: [
      { folderId: 'long', frames: [{ frame: 0, value: '001' }, { frame: 30, value: '001' }, { frame: 34, value: null }, { frame: 38, value: '001' }, { frame: 54, value: '2' }, { frame: 66, value: '2' }] },
      { folderId: 'short', frames: [{ frame: 2, value: '3' }] },
    ] },
    { id: 'c2', name: 'C002', fps: 30, duration: 30, tracks: [
      { folderId: 'long', frames: [{ frame: 6, value: '001' }, { frame: 12, value: '2' }] },
    ] },
  ],
}

test('CLIP worker imports chosen folders as shared cuts, resets history, and preserves layers/timing/source through XSR', async ({ page }, info) => {
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  const clip = await writeClip(SQL, new Uint8Array(readFileSync('packages/adapters/src/clip/blank.clip')), {
    plan, canvas: { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 0, offsetY: 0 }, fit: 'expand', images: {},
  })
  const container = new ClipContainer(SQL, clip.bytes)
  const firstTimeline = container.rows('TimeLine').find(row => row.TimeLineName === 'C001')!
  container.update('TimeLine', firstTimeline.MainId, { StartFrame: 30, EndFrame: 54 })
  const source = container.bytes()
  container.close()
  await page.goto('./?app=remap')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '読み込み ›', exact: true }))
  await page.getByLabel('CLIPを読み込む…', { exact: true }).setInputFiles({ name: 'shared.clip', mimeType: 'application/octet-stream', buffer: Buffer.from(source) })
  const dialog = page.getByRole('dialog', { name: 'CLIPを読み込む', exact: true })
  await expect(dialog.getByRole('checkbox', { name: /^C00/ })).toHaveCount(2)
  await dialog.getByRole('checkbox', { name: /^C001/ }).check()
  await dialog.getByRole('checkbox', { name: /^C002/ }).check()
  await dialog.getByLabel('xsheet-remap / 別の工程 / 不要のセル指定を取り込む', { exact: true }).uncheck()
  await expect(dialog.getByLabel('xsheet-remap / 任意の工程 / 長いフォルダー名のセル列名')).toHaveValue('長いフォルダー名')
  await expect(dialog.locator('.clipImportOrder').first()).toContainText('長いフォルダー名 → A')
  await dialog.getByLabel('読み込み後の基準工程').selectOption({ label: 'xsheet-remap／任意の工程' })
  const box = await dialog.locator('.clipImportDialog').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath('clip-import-selection.png') })
  await activateControl(page, dialog.getByRole('button', { name: 'タイムシートに読み込む' }))
  await expect(dialog).toHaveCount(0)
  const timing = (frame: number) => page.locator(`[data-timeline-event-role="action"][data-timeline-event-track="長いフォルダー名"][data-timeline-event-frame="${frame}"] .eventText`)
  await expect(timing(1)).toHaveText('001')
  await expect(timing(9)).toHaveText('001')
  await expect(timing(-29)).toHaveText('001')
  await expect(timing(25)).toHaveText('2')
  await expect(timing(37)).toHaveText('2')
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'やり直し', exact: true })).toBeDisabled()
  await expect(page.locator('#sheet-right-pane .clipLayerPanel')).toBeVisible()
  const animation = page.locator('.clipLayerRow').filter({ has: page.locator('.clipLayerName', { hasText: '長いフォルダー名' }) })
  await activateControl(page, animation)
  await page.getByLabel('レイヤーの不透明度', { exact: true }).fill('50')
  await page.getByLabel('レイヤーの不透明度', { exact: true }).press('Enter')
  await expect(animation).toContainText('50%')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.getByLabel('レイヤーの不透明度', { exact: true })).toHaveValue('100')
  async function setDummyVisible(visible: boolean) {
    const trigger = page.getByLabel('表示設定', { exact: true })
    if (!await trigger.evaluate(element => element.closest('details')!.open)) await activateControl(page, trigger)
    const menu = page.locator('.actionMenuPortalContent.sheetDisplaySettingsMenu')
    await menu.getByRole('checkbox', { name: '開始前ダミー', exact: true }).setChecked(visible)
    await menu.getByRole('checkbox', { name: '終了後ダミー', exact: true }).setChecked(visible)
    await activateControl(page, trigger)
  }
  await setDummyVisible(false)
  await expect(timing(-29)).toHaveCount(0)
  await expect(timing(25)).toHaveCount(0)
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
  expect(document.clipDocument?.source?.fileName).toBe('shared.clip')
  expect(document.clipDocument?.nodes.some(node => node.name === '不要')).toBe(true)
  expect(document.cuts.map(cut => cut.metadata.cut)).toEqual(['C001', 'C002'])
  const projects = document.cuts.map(cut => activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId }))
  expect(projects.map(project => [project.logicalSheet.fps, project.logicalSheet.durationFrames])).toEqual([[24, 24], [30, 30]])
  expect(projects[0].logicalSheet.workRange).toEqual({ preRollFrames: 30, postRollFrames: 13, showPreRoll: false, showPostRoll: false })
  expect(projects[0].logicalSheet.events.filter(event => event.paperTrack === '長いフォルダー名').map(event => event.frame)).toEqual([-29, 1, 5, 9, 25, 37])
  expect(projects[0].logicalSheet.events.find(event => event.paperTrack === '長いフォルダー名' && event.frame === 1)?.keyId).toBe(projects[1].logicalSheet.events.find(event => event.paperTrack === '長いフォルダー名' && event.frame === 7)?.keyId)
  const state = document.clipDocument!, target = state.targets.find(target => projects[1].cspTrackSlots.some(slot => slot.slotId === target.slotId && slot.paperTrack === '長いフォルダー名'))!
  expect(state.nodes.find(node => node.id === target.folderId)?.name).toBe('長いフォルダー名')
  expect(state.sourceTimelines?.find(timeline => timeline.id === state.timelineIds?.[document.cuts[1].cutId])?.name).toBe('C002')
  await page.reload()
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles(saved)
  await expect(timing(7)).toHaveText('001')
  await expect(timing(13)).toHaveText('2')
  await activateControl(page, page.getByLabel('兼用カットを切り替える', { exact: true }))
  await page.getByLabel('兼用カット', { exact: true }).selectOption({ label: 'C001' })
  await page.keyboard.press('Escape')
  await expect(timing(-29)).toHaveCount(0)
  await expect(timing(25)).toHaveCount(0)
  await setDummyVisible(true)
  await expect(timing(-29)).toHaveText('001')
  await expect(timing(25)).toHaveText('2')
  await expect(timing(37)).toHaveText('2')
  await page.screenshot({ path: info.outputPath('clip-dummy-keys-restored.png') })
})
