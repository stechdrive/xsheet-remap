import { readFileSync } from 'node:fs'
import { expect, test } from './fixtures'
import { activateControl } from './input'
import { createProjectFromTemplate, createKey, setEvent, setTimingSpecialEvent, setTimingReferenceAt, createProjectDocumentFromCutProject,
  digitalStandardSheetTemplate, standardA3SheetTemplate, activeCutProjectFromDocument } from '../../../packages/core/src/index'
import { encodeProjectArchive, decodeProjectFileBytes } from '../../../packages/adapters/src/projectArchive'

for (const template of [digitalStandardSheetTemplate, standardA3SheetTemplate]) test(`existing-entry circles and single-frame clipboard (${template.templateId})`, async ({ page }, info) => {
  let source = createProjectFromTemplate(template)
  for (const [frame, label] of [[1, '12'], [5, 'あ'], [9, '3']] as const) {
    const created = createKey(source, 'A', label, 'manual', undefined, 'action')
    source = setEvent(created.project, 'A', frame, created.key.keyId, 'action')
  }
  source = setTimingSpecialEvent(source, 'A', 3, 'inbetween', 'action')
  source = setTimingReferenceAt(source, 'A', 9, 'action', true)
  const archive = await encodeProjectArchive(createProjectDocumentFromCutProject(source, { sheetTemplate: template }))
  await page.goto('./')
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'entries.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(archive) })
  await activateControl(page, page.getByRole('button', { name: 'シート編集', exact: true }))
  const event = (frame: number) => page.locator(`[data-timeline-event-role="action"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"]`)
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  const box = await event(1).locator('.eventRect').evaluate(element => element.getBoundingClientRect().toJSON())
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  // Start on the empty end of the range. Starting on the entry can invoke its
  // long-press move when emulated mobile input takes >400 ms to deliver a move.
  await page.mouse.move(x, y + box.height * 9); await page.mouse.down()
  await page.mouse.move(x, y, { steps: 5 }); await page.mouse.up()
  await expect(page.locator('.statusBar span').first()).toContainText('ACTION A 001-010')
  await expect(event(1).locator('.eventText')).toHaveText('12')
  await page.mouse.click(x, y, { button: 'right' })
  const menuInput = info.project.name.endsWith('-touch') ? 'touch' : 'mouse'
  const trigger = page.getByRole('menuitem', { name: '囲み', exact: true })
  await activateControl(page, trigger, menuInput)
  const submenu = page.getByRole('menu', { name: '囲み', exact: true })
  const bounds = await submenu.boundingBox(), viewport = page.viewportSize()!
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: info.outputPath('enclosure-menu.png') })
  await activateControl(page, submenu.getByRole('menuitem', { name: '記入のあるコマに○を付加', exact: true }), menuInput)
  for (const frame of [1, 5]) await expect(event(frame).locator('ellipse.eventReferenceSymbol')).toHaveCount(1)
  await expect(event(9).locator('polygon.eventReferenceSymbol')).toHaveCount(1)
  await expect(page.locator('[data-reference-frame]')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event(1).locator('ellipse')).toHaveCount(0)
  await expect(event(5).locator('ellipse')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(event(1).locator('ellipse')).toHaveCount(1)
  // A plain click, without any drag, is a one-frame clipboard source.
  await page.mouse.click(x, y)
  await page.mouse.click(x, y, { button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'コピー', exact: true })).toBeEnabled()
  await page.keyboard.press('Escape')
  await page.mouse.click(x, y)
  await page.keyboard.press('Control+c')
  await page.mouse.click(x, y + box.height * 6)
  await page.keyboard.press('Control+v')
  await expect(event(7).locator('.eventText')).toHaveText('12')
  await expect(event(7).locator('ellipse.eventReferenceSymbol')).toHaveCount(1)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(event(7)).toHaveCount(0)
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
  const pending = page.waitForEvent('download')
  await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
  const saved = info.outputPath('entries.xsr'); await (await pending).saveAs(saved)
  const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))).document)
  expect(restored.logicalSheet.events).toEqual(source.logicalSheet.events)
  expect(restored.logicalSheet.keys).toEqual(source.logicalSheet.keys)
  expect(restored.logicalSheet.referenceMarks).toEqual([
    ...source.logicalSheet.referenceMarks!,
    { sheetRole: 'action', paperTrack: 'A', frame: 1, shape: 'circle' },
    { sheetRole: 'action', paperTrack: 'A', frame: 5, shape: 'circle' },
  ])
})
