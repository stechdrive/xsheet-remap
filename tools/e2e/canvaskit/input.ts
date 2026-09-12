import { expect, type Locator, type Page } from '@playwright/test'

/** Observe actionability with wall-clock polling; a stationary WebKit page need not deliver rAF. */
export async function activateControl(page: Page, locator: Locator, input: 'mouse' | 'touch' = 'mouse') {
  await expect(locator).toHaveCount(1)
  // Match normal locator actions: first expose an offscreen control, including
  // controls clipped by a nested navigator. Input itself is still native pointer input.
  await locator.evaluate(element => element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' }))
  let previous = '', consecutive = 0
  let point = { x: 0, y: 0 }
  await expect.poll(async () => {
    const state = await locator.evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element)
      const x = box.left + box.width / 2, y = box.top + box.height / 2
      const hit = document.elementFromPoint(x, y)
      return {
        x, y, width: box.width, height: box.height,
        ready: box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
          && !element.matches(':disabled') && !element.closest('[aria-disabled="true"], [inert]')
          && !!hit && (hit === element || element.contains(hit)),
      }
    })
    const signature = JSON.stringify(state)
    consecutive = state.ready && signature === previous ? consecutive + 1 : 0
    previous = signature; point = state
    return consecutive
  }, { timeout: 8_000, intervals: [50, 100, 100], message: `${locator}: control must be enabled, unobscured and stationary before actual pointer input` }).toBeGreaterThanOrEqual(2)
    .catch(error => { throw new Error(`Control readiness failed; last observed state: ${previous}`, { cause: error }) })
  if (input === 'touch') await page.touchscreen.tap(point.x, point.y)
  else await page.mouse.click(point.x, point.y)
}
