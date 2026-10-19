import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import init from 'canvaskit-wasm'
import { initializeCanvas, readPsd, type Layer } from 'ag-psd'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { addAnnotation, createKey, createProjectDocumentFromCutProject, createProjectFromTemplate, setEvent, standardA3SheetTemplate } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { readPsdComposite } from '../psd-composite'

test('PSD text stays editable by input and column, with the same image as PNG', async ({ page }, info) => {
  let project = createProjectFromTemplate(standardA3SheetTemplate)
  for (const role of ['action', 'cell'] as const) {
    for (const [track, frame, value] of [['A', 1, '12'], ['A', 13, 'A_001'], ['B', 1, '確認']] as const) {
      const created = createKey(project, track, value, 'manual', undefined, role)
      project = setEvent(created.project, track, frame, created.key.keyId, role)
    }
  }
  for (const [index, size] of [16, 24, 32, 48].entries()) {
    project = addAnnotation(project, { kind: 'text', annotationId: `vertical-${size}`, pageId: 'page_1',
      text: 'I1W A2\n「ー」、。', x: .04 + index * .2, y: .12, color: '#2040a0', fontSizePx: size, writingMode: 'vertical' })
  }
  project = addAnnotation(project, { kind: 'text', annotationId: 'horizontal', pageId: 'page_1',
    text: '日本語メモ\nABC 123', x: .05, y: .3, color: '#2040a0', fontSizePx: 32 })
  project.timedRangeCues = [{ cueId: 'voice', role: 'sound', laneId: 'sound_lane_1', frameStart: 3, frameEnd: 40,
    label: '声 A', text: '日本語の確認12「ー」。', source: 'manual' }]
  const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: standardA3SheetTemplate }))
  writeFileSync(info.outputPath('editable-text.xsr'), archive)
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'editable-text.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  for (const format of ['PNG', 'PSD']) {
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '書き出し ›', exact: true }))
    await activateControl(page, page.getByRole('button', { name: `タイムシート画像を${format}形式で書き出す`, exact: true }))
    const dialog = page.getByRole('dialog', { name: '画像書き出し', exact: true })
    if (format === 'PSD') {
      await expect(dialog.getByRole('link', { name: 'LINE Seed JP 公式ダウンロードページ' })).toHaveAttribute('href', 'https://seed.line.me/index_jp.html')
      await page.screenshot({ path: info.outputPath('psd-export-dialog.png') })
    }
    const pending = page.waitForEvent('download')
    await activateControl(page, dialog.getByRole('button', { name: '保存', exact: true }))
    await (await pending).saveAs(info.outputPath(`editable-text.${format.toLowerCase()}`))
    await expect(dialog).toHaveCount(0)
  }
  initializeCanvas(() => { throw new Error('Unexpected canvas') }, (width, height) => ({ width, height, colorSpace: 'srgb', data: new Uint8ClampedArray(width * height * 4) }))
  const bytes = readFileSync(info.outputPath('editable-text.psd'))
  const psd = readPsd(bytes, { useImageData: true })
  const input = psd.children!.find(layer => layer.name === 'ACTION/CELL入力')!
  for (const role of ['ACTION', 'CELL']) {
    const group = input.children!.find(layer => layer.name === role)!
    expect(group.children!.map(layer => layer.name)).toEqual(['A', 'B'])
    expect(group.children![0].children!.map(layer => layer.text!.text)).toEqual(['12', 'A_001'])
    expect(group.children![1].children![0].text!.text).toBe('確認')
  }
  const flatten = (layers: Layer[]): Layer[] => layers.flatMap(layer => layer.children ? flatten(layer.children) : [layer])
  const all = flatten(psd.children!), texts = all.filter(layer => layer.text)
  const memos = texts.filter(layer => layer.text!.text === 'I1W A2\n「ー」、。')
  expect(memos).toHaveLength(4)
  for (const memo of memos) {
    expect(memo.text!.orientation).toBe('vertical')
    expect(memo.text!.style).toMatchObject({ baselineDirection: 1, font: { name: 'LINESeedJP-Bold' } })
  }
  expect(texts.some(layer => layer.text!.text === '日本語メモ\nABC 123')).toBe(true)
  expect(texts.some(layer => layer.text!.text === '日本語の確認12「ー」。')).toBe(true)
  const composite = readPsdComposite(bytes)
  // Decode and recompose in Node: passing every full-page layer through the
  // browser protocol would duplicate hundreds of MB and can crash the harness.
  const require = createRequire(import.meta.url)
  const kit = await init({ wasmBinary: readFileSync(require.resolve('canvaskit-wasm/bin/canvaskit.wasm')) })
  const { width, height, planes } = composite
  const format = { width, height, alphaType: kit.AlphaType.Unpremul, colorType: kit.ColorType.RGBA_8888, colorSpace: kit.ColorSpace.SRGB }
  const png = kit.MakeImageFromEncoded(readFileSync(info.outputPath('editable-text.png')))!
  const reference = png.readPixels(0, 0, format) as Uint8Array
  png.delete()
  let compositeDifference = 0
  for (let p = 0; p < width * height; p++) for (let c = 0; c < 3; c++) compositeDifference = Math.max(compositeDifference, Math.abs(reference[p * 4 + c] - planes[c * width * height + p]))
  const surface = kit.MakeSurface(width, height)!, paint = new kit.Paint()
  for (const layer of all) {
    if (!layer.imageData) continue
    const { width: w, height: h, data } = layer.imageData
    const image = kit.MakeImage({ ...format, width: w, height: h }, data as Uint8Array, w * 4)!
    paint.setAlphaf(layer.opacity ?? 1)
    surface.getCanvas().drawImage(image, layer.left ?? 0, layer.top ?? 0, paint)
    image.delete()
  }
  const snapshot = surface.makeImageSnapshot(), actual = snapshot.readPixels(0, 0, format) as Uint8Array
  snapshot.delete(); surface.delete(); paint.delete()
  let layerDifference = 0, changedPixels = 0
  for (let p = 0; p < width * height; p++) {
    let difference = 0
    for (let c = 0; c < 3; c++) difference = Math.max(difference, Math.abs(reference[p * 4 + c] - actual[p * 4 + c]))
    layerDifference = Math.max(layerDifference, difference)
    if (difference > 2) changedPixels++
  }
  const comparison = { compositeDifference, layerDifference, changedPixels }
  writeFileSync(info.outputPath('comparison.json'), JSON.stringify(comparison, null, 2))
  expect(comparison.compositeDifference).toBe(0)
  expect(comparison.changedPixels, 'cached layers recompose to the app image within 8-bit alpha rounding').toBe(0)
})
