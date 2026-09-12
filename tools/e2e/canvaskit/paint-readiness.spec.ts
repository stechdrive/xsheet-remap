import { expect, test } from './fixtures'
import { waitForPaperPaint } from '../paper-paint-contract'

test('submitted paper paint can settle without further animation callbacks', async ({ page }) => {
  await page.goto('./')
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })

  // Keep real renderer state, but reproduce missing animation notifications while
  // the wait contract samples it. Only the test's observation window is affected.
  const states = await waitForPaperPaint({
    evaluate: <T>(expression: string) => page.evaluate<T>(`(async () => {
      const request = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
      window.requestAnimationFrame = () => 0;
      window.cancelAnimationFrame = () => {};
      try { return await (${expression}); }
      finally { window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel; }
    })()`),
  }, true, 2_000)

  expect(states).toEqual(expect.arrayContaining([
    expect.objectContaining({ source: 'sheetSvg', state: 'active', ready: 'true' }),
  ]))
})
