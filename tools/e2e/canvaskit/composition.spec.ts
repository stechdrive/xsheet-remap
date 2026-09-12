import fs from 'node:fs/promises'
import { test, expect } from './fixtures'

test('composition event sequence retains the MEMO draft across pointer focus and re-entry', async ({ page }, info) => {
  await page.goto('./')
  await page.evaluate(await fs.readFile('tools/e2e/device-input-recorder.js', 'utf8'))
  await page.getByRole('button', { name: 'MEMOを編集', exact: true }).dblclick()
  const editor = page.getByRole('textbox', { name: 'MEMO', exact: true })
  // Deterministic event-order regression only. insertText/dispatchEvent is NOT a
  // real Japanese IME; real-device captures use the same recorder separately.
  await editor.dispatchEvent('compositionstart', { data: '' })
  await page.keyboard.insertText('日本語')
  await editor.dispatchEvent('compositionupdate', { data: '日本語' })
  await editor.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await expect(editor).toBeFocused()
  await editor.dispatchEvent('keydown', { key: 'Enter', ctrlKey: true, keyCode: 229 })
  await expect(editor).toBeFocused()
  await editor.press('ArrowLeft')
  await editor.dispatchEvent('compositionend', { data: '日本語' })
  await editor.click()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('日本語')
  await page.getByRole('button', { name: 'タイトルを編集', exact: true }).click()
  await page.getByRole('button', { name: 'MEMOを編集', exact: true }).dblclick()
  await expect(editor).toBeFocused()
  await expect(editor).toHaveValue('日本語')
  const evidence = await page.evaluate(() => Reflect.get(window, 'xsheetInputEvidence').snapshot())
  expect(evidence.compositionObserved).toBe(false)
  await info.attach('simulated-composition-sequence', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' })
})
