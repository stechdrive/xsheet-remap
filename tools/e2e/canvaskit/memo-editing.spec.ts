import { expect, test } from '@playwright/test'
import { waitForPaperPaint } from '../paper-paint-contract'

for (const renderer of ['canvaskit', 'svg'] as const) {
  test(`MEMO keeps its draft and caret through mouse editing (${renderer})`, async ({ page }, info) => {
    if (renderer === 'svg') await page.route('**/canvaskit.wasm', route => route.abort())
    await page.goto('/')
    if (renderer === 'canvaskit') {
      // Give initial GPU/font setup its own wait, as in the other paper tests.
      await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
      await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
    } else {
      await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'fallback')
    }

    const trigger = page.getByRole('button', { name: 'MEMOを編集', exact: true })
    await trigger.dblclick()
    const editor = page.getByRole('textbox', { name: 'MEMO', exact: true })
    await expect(editor).toBeFocused()
    const draft = '日本語の入力を保持します\nクリック後も編集できます'
    await page.keyboard.insertText(draft)
    await expect(editor).toHaveValue(draft)

    // Use a real pointer at the textarea, so a click-through CSS regression cannot
    // be hidden by fill()/focus() or synthetic React events.
    const bounds = (await editor.boundingBox())!
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2
    await page.mouse.click(x, y)
    await expect(editor).toBeFocused({ timeout: 2_000 })
    await page.keyboard.press('End')
    const before = await editor.evaluate(element => ({
      caret: (element as HTMLTextAreaElement).selectionStart,
      scroll: element.closest('.sheetViewport')!.scrollTop,
    }))
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => editor.evaluate(element => (element as HTMLTextAreaElement).selectionStart)).toBe(before.caret - 1)
    await page.keyboard.press('ArrowDown')
    await expect(editor).toBeFocused()
    expect(await page.locator('.sheetViewport').evaluate(element => element.scrollTop)).toBe(before.scroll)

    await page.mouse.dblclick(x, y)
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue(draft)
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('。追記')
    const committed = `${draft}。追記`
    await expect(editor).toHaveValue(committed)
    await page.screenshot({ path: info.outputPath('memo-mouse-editing.png') })

    await page.getByRole('button', { name: 'タイトルを編集', exact: true }).click()
    await expect(editor).toHaveCount(0)
    await trigger.dblclick()
    await expect(editor).toBeFocused()
    await expect(editor).toHaveValue(committed)

    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.insertText('取り消す変更')
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await trigger.dblclick()
    await expect(editor).toHaveValue(committed)
    await page.keyboard.press('ControlOrMeta+Enter')
    await expect(editor).toHaveCount(0)
  })
}
