import { readFileSync } from 'node:fs'
import { test, expect } from './fixtures'
import { activateControl } from './input'
import { createProjectFromTemplate, createKey, setEvent, setTimingSpecialEvent, setTimingReferenceAt, createProjectDocumentFromCutProject,
  digitalStandardSheetTemplate, activeCutProjectFromDocument } from '../../../packages/core/src/index'
import { encodeProjectArchive, decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'

test('ACTION transfer previews hidden dummy frames and saves independent enclosed CELL identities', async ({ page }, info) => {
  const template = digitalStandardSheetTemplate
  let source = createProjectFromTemplate(template)
  source.logicalSheet.durationFrames = 200
  source.logicalSheet.workRange = { preRollFrames: 3, postRollFrames: 3, showPreRoll: false, showPostRoll: false }
  const input = '1 ○ ○ ○ 2 ○ あ い ○ 3 ● ● ● 2 ○ ○ 1'.split(' ')
  const frameAt = (index: number) => index >= 14 ? index + 186 : index - 2
  for (const [index, value] of input.entries()) {
    const frame = frameAt(index)
    if (value === '○' || value === '●') source = setTimingSpecialEvent(source, 'A', frame, value === '○' ? 'inbetween' : 'reverse', 'action')
    else {
      const created = createKey(source, 'A', value, 'manual', undefined, 'action')
      source = setEvent(created.project, 'A', frame, created.key.keyId, 'action')
      source = setTimingReferenceAt(source, 'A', frame, 'action', value === 'あ' || value === 'い' ? 'triangle' : 'circle')
    }
  }
  const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(source, { sheetTemplate: template }))
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'action-transfer.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  const event = (role: string, frame: number) => page.locator(`[data-timeline-event-role="${role}"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"]`)
  await expect(event('action', 2)).toHaveCount(1)
  await expect(event('action', -2)).toHaveCount(0)
  const box = await event('action', 2).locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await activateControl(page, page.getByRole('menuitem', { name: 'ACTION→CELLに自動採番して転記…', exact: true }))
  const preview = page.getByRole('region', { name: 'ACTION→CELLの転記プレビュー', exact: true })
  await expect(preview).toBeVisible()
  const ghost = (frame: number) => page.locator(`[data-transfer-track="A"][data-transfer-frame="${frame}"]`)
  await expect(ghost(2).locator('.eventText')).toHaveText('5')
  await expect(ghost(2).locator('circle.eventReferenceSymbol')).toHaveCount(1)
  await expect(ghost(4).locator('polygon.eventReferenceSymbol')).toHaveCount(1)
  await expect(event('cell', 2)).toHaveCount(0)
  const ghostRect = await ghost(2).locator('.actionCellTransferGhostFill').evaluate(element => ({
    x: element.getAttribute('x'), y: element.getAttribute('y'), width: element.getAttribute('width'), height: element.getAttribute('height'),
  }))
  await page.keyboard.press('9')
  await expect(event('action', 2).locator('.eventText')).toHaveText('2')
  const viewport = page.locator('.sheetViewport')
  await viewport.evaluate(element => { element.scrollTop = element.scrollHeight })
  await expect(ghost(200).locator('.eventText')).toHaveText('14')
  await expect(ghost(201)).toHaveCount(0)
  await expect(preview).toBeVisible()
  await viewport.evaluate(element => { element.scrollTop = 0 })
  await expect(ghost(2).locator('.eventText')).toHaveText('5')
  await page.screenshot({ path: info.outputPath('transfer-preview.png') })
  await activateControl(page, preview.getByRole('button', { name: 'OK', exact: true }))
  await expect(preview).toHaveCount(0)
  await expect(ghost(2)).toHaveCount(0)
  await expect(event('cell', 2).locator('.eventText')).toHaveText('5')
  expect(await event('cell', 2).locator('.eventRect').evaluate(element => ({
    x: element.getAttribute('x'), y: element.getAttribute('y'), width: element.getAttribute('width'), height: element.getAttribute('height'),
  }))).toEqual(ghostRect)
  await expect(event('cell', 2).locator('circle.eventReferenceSymbol')).toHaveCount(1)
  await expect(event('cell', 4).locator('polygon.eventReferenceSymbol')).toHaveCount(1)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event('cell', 2)).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(event('cell', 2).locator('.eventText')).toHaveText('5')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const pending = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('transferred.xsr')
  await (await pending).saveAs(saved)
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))).document)
  const output = restored.logicalSheet.events.filter(event => event.sheetRole === 'cell').sort((a, b) => a.frame - b.frame)
  expect(output.map(event => restored.logicalSheet.keys.find(key => key.keyId === event.keyId)!.displayLabel)).toEqual('1 2 3 4 5 6 7 8 9 10 11 12 13 5 14 15 1'.split(' '))
  expect(output.map(event => event.frame)).toEqual(input.map((_, index) => frameAt(index)))
  expect(restored.logicalSheet.events.filter(event => event.sheetRole === 'action')).toEqual(source.logicalSheet.events)
  expect(restored.bindings).toEqual(source.bindings)
  expect(restored.logicalSheet.referenceMarks?.filter(mark => mark.sheetRole === 'cell')).toEqual(source.logicalSheet.referenceMarks?.map(mark => ({ ...mark, sheetRole: 'cell' })))
})
