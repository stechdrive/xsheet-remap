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
  await expect(ghost(2).locator('.eventText')).toHaveText('2')
  await expect(ghost(2).locator('circle.eventReferenceSymbol')).toHaveCount(1)
  await expect(ghost(4).locator('polygon.eventReferenceSymbol')).toHaveCount(1)
  await expect(event('cell', 2)).toHaveCount(0)
  await activateControl(page, preview.getByText('採番についての確認事項', { exact: true }))
  await expect(preview.getByText(/A：-1、0、1、8、9、10、200、201コマの絵/)).toBeVisible()
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
  await expect(ghost(2).locator('.eventText')).toHaveText('2')
  await page.screenshot({ path: info.outputPath('transfer-preview.png') })
  await activateControl(page, preview.getByRole('button', { name: 'OK', exact: true }))
  await expect(preview).toHaveCount(0)
  await expect(ghost(2)).toHaveCount(0)
  await expect(event('cell', 2).locator('.eventText')).toHaveText('2')
  expect(await event('cell', 2).locator('.eventRect').evaluate(element => ({
    x: element.getAttribute('x'), y: element.getAttribute('y'), width: element.getAttribute('width'), height: element.getAttribute('height'),
  }))).toEqual(ghostRect)
  await expect(event('cell', 2).locator('circle.eventReferenceSymbol')).toHaveCount(1)
  await expect(event('cell', 4).locator('polygon.eventReferenceSymbol')).toHaveCount(1)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event('cell', 2)).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(event('cell', 2).locator('.eventText')).toHaveText('2')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const pending = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('transferred.xsr')
  await (await pending).saveAs(saved)
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))).document)
  const output = restored.logicalSheet.events.filter(event => event.sheetRole === 'cell').sort((a, b) => a.frame - b.frame)
  expect(output.map(event => restored.logicalSheet.keys.find(key => key.keyId === event.keyId)!.displayLabel)).toEqual('1 8 9 10 2 3 4 5 6 7 11 12 13 2 14 15 1'.split(' '))
  expect(output.map(event => event.frame)).toEqual(input.map((_, index) => frameAt(index)))
  expect(restored.logicalSheet.events.filter(event => event.sheetRole === 'action')).toEqual(source.logicalSheet.events)
  expect(restored.bindings).toEqual(source.bindings)
  expect(restored.logicalSheet.referenceMarks?.filter(mark => mark.sheetRole === 'cell')).toEqual(source.logicalSheet.referenceMarks?.map(mark => ({ ...mark, sheetRole: 'cell' })))
})

test('ACTION transfer keeps lip-sync numbers and reverses reusable inbetweens from an opening pose', async ({ page }, info) => {
  const template = digitalStandardSheetTemplate
  let source = createProjectFromTemplate(template)
  source.logicalSheet.durationFrames = 24
  for (const [track, values] of [['A', '3 2 3 1 2'], ['B', '2 ○ 1 ○ 2']]) {
    for (const [index, value] of values.split(' ').entries()) {
      if (value === '○') source = setTimingSpecialEvent(source, track, index + 1, 'inbetween', 'action')
      else {
        const created = createKey(source, track, value, 'manual', undefined, 'action')
        source = setEvent(created.project, track, index + 1, created.key.keyId, 'action')
      }
    }
  }
  const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(source, { sheetTemplate: template }))
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'lip-sync.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  const first = page.locator('[data-timeline-event-role="action"][data-timeline-event-track="A"][data-timeline-event-frame="1"]')
  const box = await first.locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await activateControl(page, page.getByRole('menuitem', { name: 'ACTION→CELLに自動採番して転記…', exact: true }))
  const preview = page.getByRole('region', { name: 'ACTION→CELLの転記プレビュー', exact: true })
  for (const [track, expected] of [['A', ['3', '2', '3', '1', '2']], ['B', ['3', '2', '1', '2', '3']]] as const) {
    await expect(page.locator(`[data-transfer-track="${track}"] .eventText`)).toHaveText([...expected])
  }
  await expect(preview.locator('details')).toHaveCount(0)
  await page.screenshot({ path: info.outputPath('lip-sync-preview.png') })
  await activateControl(page, preview.getByRole('button', { name: 'OK', exact: true }))
  await expect(page.locator('[data-timeline-event-role="cell"][data-timeline-event-track="A"] .eventText')).toHaveText(['3', '2', '3', '1', '2'])
  await expect(page.locator('[data-timeline-event-role="cell"][data-timeline-event-track="B"] .eventText')).toHaveText(['3', '2', '1', '2', '3'])
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('[data-timeline-event-role="cell"]')).toHaveCount(0)
  await expect(first.locator('.eventText')).toHaveText('3')
})
