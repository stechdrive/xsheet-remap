import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { waitForPaperPaint } from '../paper-paint-contract'

const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
async function openTemplate(page: Page, input: 'mouse' | 'touch' = 'mouse') {
  await page.goto('./?app=template-editor')
  await activateControl(page, page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }), input)
  await paint(page)
  await activateControl(page, page.locator('.templateZoomFloatingPalette button').first(), input)
  await activateControl(page, page.getByRole('button', { name: '全体表示', exact: true }), input)
  if (input === 'mouse') await page.mouse.move(3, 3)
  await paint(page)
}

test('continuous template zoom keeps its GPU context and finishes with sharp, painted content', async ({ page }) => {
  // Keep input cadence independent of the runner's rendering speed. Real rAF
  // intervals can exceed the idle threshold on software-rendered WebKit.
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await openTemplate(page)
  await page.clock.pauseAt(new Date('2026-01-01T01:00:00Z'))
  const source = page.locator('.templateStaticPreviewSvg')
  const zoomSurface = page.locator('.templateEditorZoomSurface')
  const initialStyle = await zoomSurface.getAttribute('style')
  const before = await source.evaluate(svg => ({ contexts: svg.getAttribute('data-canvaskit-contexts'), builds: svg.getAttribute('data-canvaskit-scene-builds') }))
  const canvas = await source.evaluateHandle(svg => svg.nextElementSibling)
  try {
    for (let step = 0; step < 24; step++) {
      await page.locator('.templateEditorViewport').evaluate((viewport, deltaY) => {
        const b = viewport.getBoundingClientRect()
        viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
          deltaY, clientX: b.left + 150, clientY: b.top + 100 }))
      }, step < 12 ? -100 : 100)
      await page.clock.runFor(32)
      if (step === 0) expect(await zoomSurface.getAttribute('style')).not.toBe(initialStyle)
      expect(await page.locator('.templateEditorViewport').getAttribute('data-paper-transform-preview')).toBe('true')
      expect(await source.getAttribute('data-canvaskit-contexts')).toBe(before.contexts)
    }
  } finally {
    await page.clock.resume()
  }
  await expect(page.locator('.templateEditorViewport')).not.toHaveAttribute('data-paper-transform-preview', 'true')
  await paint(page)
  expect(await source.getAttribute('data-canvaskit-contexts')).toBe(before.contexts)
  expect(await source.getAttribute('data-canvaskit-scene-builds')).toBe(before.builds)
  expect(await source.evaluate((svg, previous) => svg.nextElementSibling === previous, canvas)).toBe(true)
  expect(await page.locator('.templateInteractionSvg + canvas, .templateHandleSvg + canvas').count()).toBe(0)
  await canvas.dispose()
})

test('separated template zoom inputs finish sharp painting between steps', async ({ page }) => {
  await openTemplate(page)
  const source = page.locator('.templateStaticPreviewSvg')
  const surface = page.locator('.templateEditorZoomSurface')
  const viewport = page.locator('.templateEditorViewport')
  const before = await source.evaluate(svg => ({ contexts: Number(svg.getAttribute('data-canvaskit-contexts')), builds: svg.getAttribute('data-canvaskit-scene-builds') }))
  for (const deltaY of [-100, -100, 100, 100]) {
    const previousStyle = await surface.getAttribute('style')
    await viewport.evaluate((element, delta) => {
      const b = element.getBoundingClientRect()
      element.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true,
        deltaY: delta, clientX: b.left + 150, clientY: b.top + 100 }))
    }, deltaY)
    await expect.poll(() => surface.getAttribute('style')).not.toBe(previousStyle)
    await expect(viewport).not.toHaveAttribute('data-paper-transform-preview', 'true')
    await paint(page)
    await expect(source).toHaveAttribute('data-canvaskit-state', 'active')
  }
  expect(Number(await source.getAttribute('data-canvaskit-contexts'))).toBeGreaterThan(before.contexts)
  expect(await source.getAttribute('data-canvaskit-scene-builds')).toBe(before.builds)
})

test('hover-only handles keep a live drag, one-step undo, redo and resize cancellation', async ({ page }, info) => {
  await openTemplate(page)
  const controls = page.locator('.templateEditAffordances')
  await expect(controls).toBeHidden()
  const initial = await page.locator('.templateEditorRectReadout').innerText()
  const rect = (await page.locator('.templateHandleSvg').boundingBox())!
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await expect(controls).toBeVisible()
  const move = (await page.getByRole('button', { name: '選択要素を移動' }).boundingBox())!
  const x = move.x + move.width / 2, y = move.y + move.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x - 3, y + 4)
  await paint(page)
  const preview = page.locator('.templateRegionSnapshotSvg')
  await expect(preview).toHaveAttribute('data-canvaskit-ready', 'true')
  const paths = await preview.locator('path').evaluateAll(elements => elements.map(el => el.getAttribute('d')))
  const builds = await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')
  await page.mouse.move(x - 4, y + 5)
  await paint(page)
  expect(await preview.locator('path').evaluateAll(elements => elements.map(el => el.getAttribute('d')))).toEqual(paths)
  expect(await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')).toBe(builds)
  await page.screenshot({ path: info.outputPath('live-template-drag.png') })
  await page.mouse.up()
  await paint(page)
  const moved = await page.locator('.templateEditorRectReadout').innerText()
  expect(moved).not.toBe(initial)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('.templateEditorRectReadout')).toHaveText(initial)
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled()
  await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
  await expect(page.locator('.templateEditorRectReadout')).toHaveText(moved)
  const current = (await page.locator('.templateHandleSvg').boundingBox())!
  await page.mouse.move(current.x + current.width / 2, current.y + current.height / 2)
  const edge = (await page.locator('.templateHandleKnob.vertical').last().boundingBox())!
  await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2); await page.mouse.down()
  await page.mouse.move(edge.x - 5, edge.y + edge.height / 2)
  await paint(page)
  await expect(page.locator('.templateRegionSnapshotSvg .gridOverlay')).not.toHaveCount(0)
  expect(await page.locator('.templateEditorRectReadout').innerText()).not.toBe(moved)
  await page.keyboard.press('Escape'); await page.mouse.up()
  await expect(page.locator('.templateEditorRectReadout')).toHaveText(moved)
  await expect(page.locator('.templateRegionSnapshotSvg')).toHaveCount(0)
  await page.mouse.move(3, 3)
  await expect(controls).toBeHidden()
})

test('a focus-preserving canvas drag has its own undo step after numeric entry', async ({ page }) => {
  await openTemplate(page)
  const readout = page.locator('.templateEditorRectReadout')
  const initial = await readout.innerText()
  const field = page.getByRole('spinbutton', { name: '6秒タイムライン表 X mm' })
  await field.fill('7')
  await paint(page)
  const afterNumber = await readout.innerText()
  expect(afterNumber).not.toBe(initial)
  const rect = (await page.locator('.templateHandleSvg').boundingBox())!
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x - 4, y + 4); await page.mouse.up()
  await expect(field).toBeFocused()
  expect(await readout.innerText()).not.toBe(afterNumber)
  await page.keyboard.press('Control+z')
  await expect(readout).toHaveText(afterNumber)
  await page.keyboard.press('Control+z')
  await expect(readout).toHaveText(initial)
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled()
})

test('ordinary regions use the same mouse movement and undo as the timeline', async ({ page }) => {
  await openTemplate(page)
  await page.getByRole('button', { name: 'MEMO', exact: true }).click()
  const rect = (await page.locator('.templateHandleSvg').boundingBox())!
  const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  await page.mouse.move(point.x, point.y)
  await expect(page.getByRole('button', { name: '選択要素を移動' })).toBeVisible()
  const initial = await page.locator('.templateEditorRectReadout').innerText()
  await page.mouse.move(point.x, point.y)
  await page.mouse.down(); await page.mouse.move(point.x + 4, point.y + 4); await page.mouse.up()
  await paint(page)
  expect(await page.locator('.templateEditorRectReadout').innerText()).not.toBe(initial)
  await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
  await expect(page.locator('.templateEditorRectReadout')).toHaveText(initial)
})

test('touch selection reveals ordinary region controls without a mouse hover', { tag: '@touch' }, async ({ page }) => {
  await openTemplate(page, 'touch')
  await activateControl(page, page.getByRole('button', { name: 'MEMO', exact: true }), 'touch')
  const rect = (await page.locator('.templateHandleSvg').boundingBox())!
  await page.touchscreen.tap(rect.x + rect.width / 2, rect.y + rect.height / 2)
  await expect(page.getByRole('button', { name: '選択要素を移動' })).toBeVisible()
})
