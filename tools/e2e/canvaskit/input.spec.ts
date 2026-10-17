import { test, expect } from './fixtures'
import { activateControl } from './input'

test('stationary input waits for enabled and unobscured geometry without animation frames', async ({ page }) => {
  await page.setContent('<button disabled style="position:absolute;left:20px;top:20px">Undo</button><div id="cover" style="position:absolute;inset:0"></div>')
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0
    const button = document.querySelector('button')!
    button.addEventListener('click', event => button.textContent = event.isTrusted ? 'Undone' : 'Synthetic')
  })
  const pending = activateControl(page, page.getByRole('button'))
  // These timers exercise readiness changes, not timing assumptions about app rendering.
  await page.evaluate(() => {
    setTimeout(() => { document.querySelector('button')!.disabled = false }, 250)
    setTimeout(() => { document.querySelector('#cover')!.remove() }, 450)
  })
  await pending
  await expect(page.getByRole('button')).toHaveText('Undone')
})

test('input exposes a control clipped by a nested scrolling navigator', async ({ page }) => {
  await page.setContent('<nav style="height:100px;overflow:auto"><div style="height:500px"></div><button>MEMO</button></nav>')
  await page.evaluate(() => document.querySelector('button')!.addEventListener('click', event => { if (event.isTrusted) document.querySelector('button')!.textContent = 'Selected' }))
  await activateControl(page, page.getByRole('button'))
  await expect(page.getByRole('button')).toHaveText('Selected')
  expect(await page.locator('nav').evaluate(nav => nav.scrollTop)).toBeGreaterThan(0)
})

test('input waits for moving geometry and inert ancestors before clicking the final position', async ({ page }) => {
  await page.setContent('<main inert><button style="position:absolute;top:20px;left:20px">Move</button></main>')
  await page.evaluate(() => {
    window.requestAnimationFrame = () => 0
    const button = document.querySelector('button')!
    let steps = 0
    const timer = setInterval(() => {
      button.style.left = `${20 + ++steps * 10}px`
      if (steps === 2) document.querySelector('main')!.inert = false
      if (steps === 16) { clearInterval(timer); button.dataset.stopped = 'true' }
    }, 20)
    button.addEventListener('click', event => {
      button.textContent = event.isTrusted && button.dataset.stopped === 'true' ? 'Final position' : 'Clicked too soon'
    })
  })
  await activateControl(page, page.getByRole('button'))
  await expect(page.getByRole('button')).toHaveText('Final position')
  await expect(page.getByRole('button')).toHaveCSS('left', '180px')
})
