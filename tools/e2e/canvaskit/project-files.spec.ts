import { readFile } from 'node:fs/promises'
import { createDefaultProject, createProjectDocumentFromCutProject } from '../../../packages/core/src/index'
import { decodeProjectFileBytes, encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { expect, test } from './fixtures'
import { activateControl } from './input'

test('XSR drop and file shortcuts share document loading and save the current content', async ({ page }, info) => {
  const project = createDefaultProject()
  project.cut.cut = 'FILE_OPERATIONS'
  const bytes = await encodeProjectArchive(createProjectDocumentFromCutProject(project))
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await page.evaluate(data => {
    const transfer = new DataTransfer()
    transfer.items.add(new File([new Uint8Array(data)], 'dropped.xsr'))
    document.querySelector('.sheetSvg')!.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }))
  }, [...bytes])
  await expect(page.getByLabel('カット情報', { exact: true })).toContainText('FILE_OPERATIONS')

  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  const openButton = page.getByRole('button', { name: 'プロジェクトを開く…', exact: true })
  await expect(openButton).toHaveCount(1)
  await openButton.setInputFiles({ name: 'menu.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })

  for (const [shortcut, name] of [['Control+s', 'saved'], ['Control+Shift+s', 'saved-as']] as const) {
    const pending = page.waitForEvent('download')
    await page.keyboard.press(shortcut)
    const download = await pending
    expect(download.suggestedFilename()).toMatch(/\.xsr$/)
    const path = info.outputPath(`${name}.xsr`)
    await download.saveAs(path)
    const decoded = await decodeProjectFileBytes(new Uint8Array(await readFile(path)))
    expect(decoded.document.cuts[0].metadata.cut).toBe('FILE_OPERATIONS')
  }

  await page.keyboard.press('Control+n')
  await expect(page.getByLabel('カット情報', { exact: true })).not.toContainText('FILE_OPERATIONS')
  const choosing = page.waitForEvent('filechooser')
  await page.keyboard.press('Control+o')
  await (await choosing).setFiles({ name: 'reopened.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
  await expect(page.getByLabel('カット情報', { exact: true })).toContainText('FILE_OPERATIONS')
})
