import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, buildClipRegistrationPlan, cellRectForHit, standardA3SheetTemplate, timingHitForFrame } from '../../../packages/core/src/index'
import { decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')

test('explicit work modes retain timing, source-owned tree drops, OS destination choices and saved materials', async ({ page }, info) => {
  await page.goto('./?app=remap')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await expect(page.getByRole('button', { name: 'シート編集', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.clipLayerPanel')).toHaveCount(0)
  const topHeight = (await page.locator('.topBar').boundingBox())!.height
  expect(topHeight).toBeLessThan(50)
  const sheetWidth = (await page.locator('.sheetViewportFrame').boundingBox())!.width
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await expect(page.getByLabel('編集先の工程', { exact: true })).toHaveValue('layer_sakuga')
  expect((await page.locator('.topBar').boundingBox())!.height).toBe(topHeight)
  await expect(page.locator('.topBar .remapWorkModes')).toBeVisible()
  await activateControl(page, page.getByRole('button', { name: '演出を展開', exact: true }))
  const folder = page.locator('[data-clip-layer-id="slot:slot_enshutsu_A"]')
  await folder.scrollIntoViewIfNeeded()
  await activateControl(page, folder)
  await expect(page.getByLabel('編集先の工程', { exact: true })).toHaveValue('layer_sakuga')
  await page.locator('.clipLayerPanel input[type=file]').setInputFiles({ name: 'correction.png', mimeType: 'image/png', buffer: png })
  const correction = page.locator('.clipLayerRow').filter({ has: page.locator('.clipLayerName', { hasText: /^correction$/ }) })
  await correction.scrollIntoViewIfNeeded()
  const from = (await correction.boundingBox())!
  const rect = cellRectForHit(standardA3SheetTemplate, timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', 1)!)!
  const point = await page.locator('.sheetSvg').first().evaluate((element, r) => {
    const box = element.getBoundingClientRect()
    return { x: box.x + (r.x + r.w / 2) * box.width, y: box.y + (r.y + r.h / 2) * box.height }
  }, rect)
  await page.mouse.move(from.x + from.width * .7, from.y + from.height / 2)
  await page.mouse.down(); await page.mouse.move(point.x, point.y, { steps: 12 }); await page.mouse.up()
  const event = page.locator('[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="1"] .eventText')
  await expect(event).toHaveText('1')
  await expect(page.getByLabel('編集先の工程', { exact: true })).toHaveValue('layer_enshutsu')
  async function dropImage(name: string) {
    const transfer = await page.evaluateHandle(({ name, base64 }) => {
      const transfer = new DataTransfer()
      transfer.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], name, { type: 'image/png' }))
      return transfer
    }, { name, base64: png.toString('base64') })
    await page.locator('.sheetSvg').first().dispatchEvent('drop', { dataTransfer: transfer, clientX: point.x, clientY: point.y })
    await transfer.dispose()
    return page.getByRole('dialog', { name: '画像の登録先を選択', exact: true })
  }
  const cancelled = await dropImage('cancel.png')
  await expect(cancelled.getByLabel('画像を登録する工程').locator('option[value=layer_enshutsu]')).toContainText('登録済み')
  await expect(cancelled.getByLabel('画像を登録する工程').locator('option[value=layer_sakuga]')).toContainText('未登録')
  await page.keyboard.press('Escape')
  await expect(cancelled).toHaveCount(0)
  const dialog = await dropImage('base.png')
  await expect(dialog.getByLabel('画像を登録する工程')).toHaveValue('layer_enshutsu')
  await dialog.getByLabel('画像を登録する工程').selectOption('layer_sakuga')
  await page.screenshot({ path: info.outputPath('os-destination-choice.png') })
  await activateControl(page, dialog.getByRole('button', { name: 'この番号へ登録', exact: true }))
  await expect(event).toHaveText('1')
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  await expect(page.locator('.clipLayerPanel')).toHaveCount(0)
  await expect(event).toHaveText('1')
  expect((await page.locator('.sheetViewportFrame').boundingBox())!.width).toBe(sheetWidth)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event).toHaveText('1')
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await expect(page.locator('.clipLayerName', { hasText: /^base$/ })).toHaveCount(1)
  await page.screenshot({ path: info.outputPath('assembly-mode.png') })
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const download = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('work-modes.xsr')
  await (await download).saveAs(saved)
  const { document } = await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))
  const project = activeCutProjectFromDocument(document)
  expect(project.assets).toHaveLength(2)
  expect(project.logicalSheet.events).toHaveLength(1)
  expect(project.logicalSheet.processTimings).toBeUndefined()
  expect(project.bindings.map(binding => [binding.cspCellName, project.cspTrackSlots.find(slot => slot.slotId === binding.slotId)?.correctionLayerId]).sort()).toEqual([['base', 'layer_sakuga'], ['correction', 'layer_enshutsu']])
  expect(buildClipRegistrationPlan(document, 'cell').timelines[0].tracks.filter(track => track.frames.some(frame => frame.value)).map(track => track.frames)).toEqual([[{ frame: 0, value: 'correction' }], [{ frame: 0, value: 'base' }]])
  await page.reload()
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles(saved)
  await expect(event).toHaveText('1')
  await activateControl(page, page.getByRole('button', { name: 'CLIP組み立て', exact: true }))
  await expect(page.locator('.clipLayerName', { hasText: /^base$/ })).toHaveCount(1)
})
