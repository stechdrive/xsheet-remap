import { expect, test } from './fixtures'
import { activateControl } from './input'

test('default process colors, A targets and added column order survive Undo and Redo', async ({ page }, info) => {
  await page.goto('./?app=remap')
  await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  const processes = [
    ['layer_sakuga', '作画', 'rgba(0, 0, 0, 0)'],
    ['layer_enshutsu', '演出', 'rgb(251, 236, 230)'],
    ['layer_kantoku', '監督', 'rgb(220, 228, 241)'],
    ['layer_sakkan', '作監', 'rgb(252, 249, 207)'],
    ['layer_sousakkan', '総作監', 'rgb(234, 246, 213)'],
    ['layer_other', 'その他修正', 'rgb(255, 221, 170)'],
  ]
  const processSelect = page.getByLabel('登録先工程', { exact: true })
  await expect(processSelect.locator('option')).toHaveText(processes.map(process => process[1]))
  const group = (id: string) => page.locator(`[data-clip-layer-id="process:${id}"]`).locator('..')
  const names = (id: string) => group(id).locator(':scope > [role=group] > .clipLayerItem > .clipLayerRow .clipLayerName')
  for (const [id, name, color] of processes) {
    await processSelect.selectOption(id)
    await expect(page.getByLabel('登録先セル列', { exact: true })).toHaveValue('A')
    await expect(page.locator('.clipTargetPath')).toHaveText(`登録先：LO / ${name} / A`)
    await expect(group(id).locator(':scope > .clipLayerRow .clipLayerEye')).toHaveCSS('background-color', color)
    if (id !== 'layer_sakuga') await activateControl(page, page.getByRole('button', { name: `${name}を展開`, exact: true }))
    await expect(names(id)).toHaveText('IHGFEDCBA'.split(''))
    await activateControl(page, page.getByRole('button', { name: `${name}を折りたたむ`, exact: true }))
  }
  await activateControl(page, page.getByText('登録先・シート表示を設定', { exact: true }))
  await activateControl(page, page.getByRole('button', { name: 'セル列＋', exact: true }))
  for (const [id, name] of processes) {
    await activateControl(page, page.getByRole('button', { name: `${name}を展開`, exact: true }))
    await expect(names(id)).toHaveText('JIHGFEDCBA'.split(''))
    const j = await names(id).first().boundingBox(), i = await names(id).nth(1).boundingBox()
    expect(j!.y + j!.height).toBeLessThan(i!.y)
    await activateControl(page, page.getByRole('button', { name: `${name}を折りたたむ`, exact: true }))
  }
  await activateControl(page, page.getByRole('button', { name: '作画を展開', exact: true }))
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(names('layer_sakuga')).toHaveText('IHGFEDCBA'.split(''))
  await expect(page.getByLabel('登録先セル列', { exact: true }).locator('option', { hasText: /^J$/ })).toHaveCount(0)
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(names('layer_sakuga')).toHaveText('JIHGFEDCBA'.split(''))
  await processSelect.selectOption('layer_sakuga')
  await activateControl(page, page.getByText('登録先・シート表示を設定', { exact: true }))
  await group('layer_other').scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('default-process-colors-and-j.png') })
})
