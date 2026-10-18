import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import initSqlJs from 'sql.js'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, createDefaultProject, createOrSetEvent, createProjectDocumentFromCutProject, registerAsset, setEvent, setTimingSpecialEvent, updateActiveCutProjectInDocument, upsertBinding } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { ClipContainer } from '../../../packages/adapters/src/clip/container'
import { writeClip } from '../../../packages/adapters/src/clip/writer'
import { readLayerPixels } from '../../../packages/adapters/src/clip/layers'
import { png } from '../../../packages/adapters/src/clip/raster'

const require = createRequire(import.meta.url)
const canvas = { width: 32, height: 24, dpi: 150, basisWidth: 24, basisHeight: 16, offsetX: 2, offsetY: -1 }
const pixels = { width: 35, height: 27, channels: 4 as const, data: Uint8Array.from({ length: 35 * 27 * 4 }, (_, i) => i % 4 === 3 ? 255 : i % 251) }
async function openClip(page: Page) {
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'CLIPを作成…', exact: true }))
}
async function sourceProject() {
  const created = createOrSetEvent({ ...createDefaultProject(), cut: { cut: 'C001' } }, 'A', 1, 'action')
  const image = png(pixels)
  const registered = registerAsset(created.project, { name: 'A1.png', objectUrl: `data:image/png;base64,${Buffer.from(image).toString('base64')}` })
  let bound = upsertBinding(registered.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: '1', materialState: 'assigned', assetId: registered.asset.assetId })
  bound = setTimingSpecialEvent(bound, 'A', 3, 'inbetween', 'action')
  bound = setTimingSpecialEvent(bound, 'A', 5, 'reverse', 'action')
  let document = addBlankSharedCutToProjectDocument(createProjectDocumentFromCutProject(bound), bound, { cut: { cut: 'C002' } })
  document = updateActiveCutProjectInDocument(document, setEvent(activeCutProjectFromDocument(document), 'A', 7, created.key.keyId, 'action'))
  return Buffer.from(await encodeProjectArchive(document, { includeAssetPreviews: true }))
}

for (const mode of ['empty', 'crop', 'expand'] as const) test(`CLIP worker saves shared timelines with ${mode} images through the export dialog`, async ({ page }, info) => {
  const SQL = await initSqlJs({ wasmBinary: new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))).buffer })
  // The legacy binding exporter remains available in Editor. Remap migrates
  // this archive into a CLIP document with its own import/export dialog.
  await page.goto('./?app=editor')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'shared.xsr', mimeType: 'application/octet-stream', buffer: await sourceProject() })
  await expect(page.locator('[data-timeline-event-role="action"][data-timeline-event-track="A"][data-timeline-event-frame="7"] .eventText')).toHaveText('1')
  await openClip(page)
  const dialog = page.getByRole('dialog', { name: 'CLIPを作成', exact: true })
  await expect(dialog.getByRole('checkbox', { name: /^C00/ })).toHaveCount(2)
  if (mode === 'empty') {
    await dialog.getByLabel('画像も登録する').uncheck()
    for (const [label, value] of [['作画サイズ（用紙サイズ） 幅（px）',32], ['作画サイズ（用紙サイズ） 高さ（px）',24], ['基準サイズ（撮影フレーム） 幅（px）',24], ['基準サイズ（撮影フレーム） 高さ（px）',16]] as const) await dialog.getByLabel(label, { exact: true }).fill(String(value))
  } else {
    const template = await writeClip(SQL, new Uint8Array(readFileSync('packages/adapters/src/clip/blank.clip')), {
      canvas, fit: 'crop', images: {}, plan: { projectId: 'company', folders: [], timelines: [{ id: 'original', name: 'Original', fps: 24, duration: 24, tracks: [] }] },
    })
    const savedTemplate = new ClipContainer(SQL, template.bytes)
    try {
      savedTemplate.db.run('CREATE TRIGGER ExternalDeleteOfTrackActionMixerOnTrack DELETE ON Track BEGIN INSERT INTO RemovedExternal(ExternalID) VALUES(OLD.TrackActionMixer); END')
      template.bytes = savedTemplate.bytes()
    } finally { savedTemplate.close() }
    await activateControl(page, dialog.getByRole('button', { name: 'テンプレートCLIPを使用' }))
    await dialog.locator('input[type=file]').setInputFiles({ name: 'template.clip', mimeType: 'application/octet-stream', buffer: Buffer.from(template.bytes) })
    await expect(dialog.getByText(/template.clip — 32 × 24px/)).toBeVisible()
    await dialog.getByLabel('キャンバスサイズを自動拡張').setChecked(mode === 'expand')
    await expect(dialog.getByText(mode === 'crop' ? /切り捨て：左1・右2・上1・下2px/ : /出力サイズ：32 × 24 → 35 × 27px/)).toBeVisible()
  }
  const box = await dialog.locator('.clipExportDialog').boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath(`clip-${mode}-settings.png`) })
  const download = page.waitForEvent('download')
  await activateControl(page, dialog.getByRole('button', { name: 'CLIPを作成して保存…' }))
  const file = await download
  const saved = info.outputPath(`output-${mode}.clip`)
  await file.saveAs(saved)
  await expect(dialog).toHaveCount(0)
  const output = new ClipContainer(SQL, new Uint8Array(readFileSync(saved)))
  try {
    expect(output.rows('TimeLine').map(row => row.TimeLineName)).toEqual(mode === 'empty' ? ['C001', 'C002'] : ['Original', 'C001', 'C002'])
    const cel = output.rows('Layer').filter(row => row.LayerType === 1)
    expect(cel).toHaveLength(1)
    const labels = output.rows('TimeLineLabel')
    expect(labels.map(row => [row.LabelFrame, row.LabelType, row.LabelName])).toEqual([[2, 1, ''], [4, 2, '']])
    const labelTrack = output.row('Track', labels[0].TrackId)
    expect(output.row('TimeLine', labelTrack.ItemId).TimeLineName).toBe('C001')
    expect(labelTrack.TrackLabelFirstIndex).toBe(labels[0].MainId)
    const decoded = readLayerPixels(output, cel[0])
    const width = mode === 'expand' ? 35 : 32, height = mode === 'expand' ? 27 : 24
    expect([decoded.width, decoded.height]).toEqual([width, height])
    if (mode === 'empty') expect(decoded.data.every(value => value === 0)).toBe(true)
    else for (let y = 0; y < height; y++) {
      const offset = mode === 'crop' ? 1 : 0
      expect(decoded.data.slice(y * width * 4, (y + 1) * width * 4)).toEqual(pixels.data.slice(((y + offset) * 35 + offset) * 4, ((y + offset) * 35 + offset + width) * 4))
    }
  } finally { output.close() }
})
