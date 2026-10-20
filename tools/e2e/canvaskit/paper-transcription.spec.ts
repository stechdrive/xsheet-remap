import { readFileSync } from 'node:fs'
import { unzipSync, strFromU8 } from 'fflate'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { paperTranscriptionUnreadResult, type PaperTranscriptionRequest } from '../../../packages/core/src/index'

async function openDialog(page: Page) {
  await activateControl(page, page.getByLabel('画面切替', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: '紙シートのAI読み取り…', exact: true }))
  const dialog = page.getByRole('dialog', { name: '紙シートのAI読み取り', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}
async function savedRequest(page: Page): Promise<PaperTranscriptionRequest> {
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find(key => key.startsWith('xsheet-paper-transcription-v1:'))!
    return JSON.parse(localStorage.getItem(key)!).request
  })
}

test('paper AI import validates the reply, stays inside its modal, applies literal labels and undoes atomically', async ({ page }, info) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { Reflect.set(window, 'copiedPaperPrompt', text) } } }))
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  const dialog = await openDialog(page)
  await dialog.getByRole('spinbutton', { name: '終了コマ' }).fill('6')
  await activateControl(page, dialog.getByRole('button', { name: 'プロンプトをコピー' }))
  await expect(dialog.getByRole('status')).toContainText('コピーしました')
  const request = await savedRequest(page)
  const prompt = await page.evaluate(() => Reflect.get(window, 'copiedPaperPrompt')) as string
  expect(prompt).toContain(request.requestId)
  expect(request.targets.map(target => target.role)).toEqual(['action', 'cell'])
  const download = page.waitForEvent('download')
  await activateControl(page, dialog.getByRole('button', { name: 'テキストファイルを保存…' }))
  expect(readFileSync((await (await download).path())!, 'utf8')).toBe(prompt)
  await activateControl(page, dialog.getByRole('tab', { name: '結果を取り込む' }))
  const result = paperTranscriptionUnreadResult(request)
  const input = dialog.getByRole('textbox', { name: 'AIから返ってきたJSON' })
  await input.fill(JSON.stringify(result))
  await activateControl(page, dialog.getByRole('button', { name: '内容を確認する' }))
  await expect(dialog.getByRole('alert')).toContainText('未読')
  await expect(dialog.getByRole('button', { name: '確認した内容を反映' })).toBeDisabled()
  for (const target of result.targets) target.runs = [
    { from: 1, to: 1, kind: 'cell', value: '001', raw: '001' },
    { from: 2, to: 6, kind: 'empty', raw: '' },
  ]
  await input.fill(JSON.stringify(result))
  await activateControl(page, dialog.getByRole('button', { name: '内容を確認する' }))
  await expect(dialog.getByRole('alert')).toHaveCount(0)
  await activateControl(page, dialog.getByRole('checkbox', { name: '原画像と対象範囲を確認しました' }), info.project.name.endsWith('touch') ? 'touch' : 'mouse')
  await expect(dialog.getByRole('button', { name: '確認した内容を反映' })).toBeEnabled()
  const box = await dialog.locator('.paperAiDialog').boundingBox()
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await page.screenshot({ path: info.outputPath('paper-ai-review.png') })
  await activateControl(page, dialog.getByRole('button', { name: '確認した内容を反映' }))
  await expect(dialog.getByRole('status')).toContainText('反映しました')
  // Browser-native text undo may change the textarea; it must never undo the sheet behind the modal.
  await input.focus()
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-timeline-event-frame="1"] .eventText')).toHaveCount(2)
  await activateControl(page, dialog.getByRole('button', { name: '閉じる', exact: true }).first())
  for (const role of ['action', 'cell']) await expect(page.locator(`[data-timeline-event-role="${role}"][data-timeline-event-frame="1"] .eventText`)).toHaveText('001')
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('[data-timeline-event-frame="1"]')).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(page.locator('[data-timeline-event-frame="1"] .eventText')).toHaveCount(2)
})

test('paper AI image export includes a complete scan and overlapping context without changing the registered image', async ({ page }, info) => {
  await page.goto('./')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  const scan = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1600
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 1200, 1600)
    ctx.strokeStyle = '#999'
    for (let y = 456; y < 1555; y += 15.24) { ctx.beginPath(); ctx.moveTo(20, y); ctx.lineTo(1180, y); ctx.stroke() }
    ctx.fillStyle = '#111'; ctx.font = '28px sans-serif'; ctx.fillText('001', 285, 480)
    return canvas.toDataURL('image/png').split(',')[1]!
  })
  await activateControl(page, page.getByLabel('紙シート', { exact: true }))
  await page.locator('.paperSheetRailMenuBody input[type=file]').setInputFiles({ name: 'paper.png', mimeType: 'image/png', buffer: Buffer.from(scan, 'base64') })
  await expect(page.locator('.sheetImage')).toHaveCount(1)
  const originalImage = await page.locator('.sheetImage').evaluate(element => element.outerHTML)
  await page.keyboard.press('Escape')
  const dialog = await openDialog(page)
  await dialog.getByRole('checkbox', { name: 'ACTION', exact: true }).uncheck()
  await dialog.getByRole('spinbutton', { name: '終了コマ' }).fill('72')
  const download = page.waitForEvent('download')
  await activateControl(page, dialog.getByRole('button', { name: '登録済み画像とプロンプトをまとめて保存…' }))
  const archive = unzipSync(readFileSync((await (await download).path())!))
  expect(Object.keys(archive)).toEqual(['解析プロンプト.txt', '画像の渡し方.txt', 'page-001-全体.png', 'page-001-t001-1-48.png', 'page-001-t001-49-72.png'])
  expect(strFromU8(archive['解析プロンプト.txt']!)).toContain((await savedRequest(page)).requestId)
  const result = paperTranscriptionUnreadResult(await savedRequest(page))
  await activateControl(page, dialog.getByRole('tab', { name: '結果を取り込む' }))
  await dialog.getByRole('textbox', { name: 'AIから返ってきたJSON' }).fill(JSON.stringify(result))
  await activateControl(page, dialog.getByRole('button', { name: '内容を確認する' }))
  await expect(dialog.getByLabel('紙シートと選択範囲')).toBeVisible()
  const ink = await page.evaluate(async ({ full, crop }) => {
    async function load(base64: string) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, image.width, image.height).data
      let dark = 0, scanInk = 0
      for (let i = 0; i < data.length; i += 4) if (data[i]! < 100 && data[i + 1]! < 100 && data[i + 2]! < 100) {
        dark++
        if ((i / 4) % image.width >= 92 && Math.floor(i / 4 / image.width) >= 48) scanInk++
      }
      return { dark, scanInk, width: image.width, height: image.height }
    }
    return { full: await load(full), crop: await load(crop) }
  }, { full: Buffer.from(archive['page-001-全体.png']!).toString('base64'), crop: Buffer.from(archive['page-001-t001-1-48.png']!).toString('base64') })
  expect(ink.full.dark).toBeGreaterThan(100)
  expect(ink.crop.dark).toBeGreaterThan(100)
  expect(ink.crop.scanInk, 'handwritten pixels remain inside the crop, apart from the added margin guides').toBeGreaterThan(100)
  expect(ink.crop.width).toBeLessThan(ink.full.width)
  expect(await page.locator('.sheetImage').evaluate(element => element.outerHTML)).toBe(originalImage)
  await page.screenshot({ path: info.outputPath('paper-ai-scan-review.png') })
})
