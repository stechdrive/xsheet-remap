import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import {
  activeCutProjectFromDocument, cameraInstructionIntervals, createProjectDocumentFromCutProject,
  createProjectFromTemplate, createTimedRangeCue, standardA3SheetTemplate,
} from '../../../packages/core/src/index'
import { decodeProjectFileBytes, encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { waitForPaperPaint } from '../paper-paint-contract'

async function open(page: Page, bytes: Uint8Array) {
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({
    name: 'camera-intervals.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes),
  })
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
}

async function edit(page: Page) {
  await activateControl(page, page.locator('.cameraCueLabelHit').first())
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: '撮影指示' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('CAMERA intervals preserve mixed drawings, one-frame tails, mouse boundary edits, Undo and saved Unicode', async ({ page }, info) => {
  const created = createTimedRangeCue(createProjectFromTemplate(standardA3SheetTemplate), {
    role: 'camera', laneId: 'camera_lane_1', frameStart: 1, frameEnd: 73, label: '「コーヒー。」', camera: { shape: 'overlap' },
  })
  await open(page, await encodeProjectArchive(createProjectDocumentFromCutProject(created.project, { sheetTemplate: standardA3SheetTemplate })))
  let dialog = await edit(page)
  await activateControl(page, dialog.getByRole('button', { name: '区間1の分割・尺変更', exact: true }))
  await expect(dialog.getByLabel('区間操作の値', { exact: true })).toBeInViewport()
  await dialog.getByLabel('区間操作の値', { exact: true }).fill('12')
  await expect(dialog.getByLabel('区間操作のプレビュー')).toHaveText('12・12・12・12・12・12・1 コマ （7区間・計73コマ）')
  await activateControl(page, dialog.getByRole('button', { name: '適用', exact: true }))
  await expect(dialog.locator('.cameraIntervalRow')).toHaveCount(7)
  await activateControl(page, dialog.getByRole('radio', { name: '区間1をフェードイン・ワイプイン', exact: true }))
  await dialog.getByLabel('CAMERA区間2の尺', { exact: true }).fill('8')
  await dialog.getByLabel('CAMERA境界ラベル2', { exact: true }).fill('中間')
  await expect(dialog.getByLabel('CAMERA区間2の尺', { exact: true })).toHaveValue('0+8')
  await expect(dialog.getByLabel('CAMERA区間3の尺', { exact: true })).toHaveValue('0+16')
  await expect(dialog.getByLabel('CAMERA区間7の尺', { exact: true })).toHaveValue('0+1')
  await dialog.getByLabel('全体の長さ 秒', { exact: true }).fill('0')
  await expect(dialog.getByLabel('全体の長さ 秒', { exact: true })).toHaveValue('03')
  const layout = await dialog.evaluate(element => {
    const body = element.querySelector('.cameraCueDialogBody')!
    const lefts = [...element.querySelectorAll('.cameraIntervalRow .cameraSegmentKindOptions')].map(item => Math.round(item.getBoundingClientRect().left))
    return { fitsWidth: body.scrollWidth <= body.clientWidth + 1, aligned: new Set(lefts).size === 1 }
  })
  expect(layout).toEqual({ fitsWidth: true, aligned: true })
  await page.screenshot({ path: info.outputPath('camera-interval-dialog.png') })
  await activateControl(page, dialog.getByRole('button', { name: '区間2の分割・尺変更', exact: true }))
  await expect(dialog.getByLabel('区間操作の値', { exact: true })).toBeInViewport()
  await activateControl(page, dialog.getByRole('button', { name: '更新', exact: true }))
  await expect(page.locator('.cameraCuePoint.intermediate').first()).toHaveAttribute('data-camera-point-frame', '13')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('.cameraCuePoint.intermediate')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(page.locator('.cameraCuePoint.intermediate')).toHaveCount(6)

  // Browser mouse input in all projects; touch projects remain browser emulation.
  const hit = page.locator('.cameraCuePoint.intermediate .cameraCuePointHit').first()
  await hit.scrollIntoViewIfNeeded()
  const box = (await hit.boundingBox())!
  const svg = (await page.locator('.sheetSvg').first().boundingBox())!
  const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_camera_grid')!
  const end = { x: svg.x + (region.rect.x + region.rect.w / region.grid!.columns.length / 2) * svg.width,
    y: svg.y + (region.rect.y + region.rect.h * (14.5 / region.grid!.rowCount)) * svg.height }
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x, end.y, { steps: 5 })
  await page.mouse.up()
  await expect(page.locator('.cameraCuePoint.intermediate').first()).toHaveAttribute('data-camera-point-frame', '15')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('.cameraCuePoint.intermediate').first()).toHaveAttribute('data-camera-point-frame', '13')
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(page.locator('.cameraCuePoint.intermediate').first()).toHaveAttribute('data-camera-point-frame', '15')

  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const pending = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('camera-intervals.xsr')
  await (await pending).saveAs(saved)
  const bytes = new Uint8Array(readFileSync(saved))
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(bytes)).document)
  expect(restored.timedRangeCues).toHaveLength(1)
  const cue = restored.timedRangeCues[0]!
  expect(cue.cueId).toBe(created.cue.cueId)
  expect(cue.label).toBe('「コーヒー。」')
  expect(cameraInstructionIntervals({ ...cue, camera: cue.camera! }).map(item => item.durationFrames)).toEqual([14, 6, 16, 12, 12, 12, 1])
  expect(cue.camera!.segments!.map(item => item.kind)).toEqual(['fade-in', ...Array(6).fill('overlap')])
  await open(page, bytes)
  dialog = await edit(page)
  await expect(dialog.getByLabel('CAMERA区間1の尺', { exact: true })).toHaveValue('0+14')
  await expect(dialog.getByLabel('CAMERA区間7の尺', { exact: true })).toHaveValue('0+1')
  await activateControl(page, dialog.getByRole('button', { name: 'キャンセル', exact: true }))
})
