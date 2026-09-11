import { expect, test } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { waitForPaperPaint } from '../paper-paint-contract'

test('scrolling retains painted content without reallocating the GPU target', async ({ page }, info) => {
  await page.goto('/')
  const paint = () => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  await paint()
  const before = await page.locator('.sheetSvg').first().getAttribute('data-canvaskit-scene-builds')
  const result = await page.evaluate(async () => {
    const viewport = document.querySelector('.sheetViewport')!
    const source = document.querySelector('.sheetSvg')!
    const frames: number[] = [], canvases = new Set<Element>(), draws: number[] = []
    let previous = performance.now()
    for (let step = 0; step < 40; step++) {
      viewport.scrollTop = step < 20 ? step * 16 : (39 - step) * 16
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const now = performance.now(); frames.push(now - previous); previous = now
      const canvas = source.nextElementSibling!
      canvases.add(canvas)
      draws.push(Number((canvas as HTMLElement).dataset.canvasKitDraws ?? 0))
    }
    return { canvasCount: canvases.size, draws, frameIntervalsMs: frames }
  })
  await paint()
  const artifact = info.outputPath('scroll-performance.json')
  await writeFile(artifact, JSON.stringify(result, null, 2))
  await info.attach('scroll-performance.json', { path: artifact, contentType: 'application/json' })
  if (!process.env.XSHEET_PERF_BASELINE) {
    expect(result.canvasCount).toBe(1)
    expect(Math.max(...result.draws) - Math.min(...result.draws)).toBeLessThan(8)
    expect(await page.locator('.sheetSvg').first().getAttribute('data-canvaskit-scene-builds')).toBe(before)
  }
})

test('direct paper models match the SVG compatibility path and materialize for print', async ({ page }, info) => {
  await page.goto('/')
  const paint = () => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  await paint()
  const source = page.locator('.sheetSvg').first()
  await expect(source.locator('[data-paper-direct-model="active"]')).not.toHaveCount(0)
  expect(await source.locator('.gridOverlay[role="img"]').first().getAttribute('aria-label')).toMatch(/\d/)
  const directCount = await source.locator('*').count()
  const direct = await page.screenshot()
  await source.evaluate(svg => { (svg as SVGSVGElement).dataset.paperModelMode = 'svg' })
  await paint()
  await expect(source.locator('[data-paper-direct-model="active"]')).toHaveCount(0)
  const compatibilityCount = await source.locator('*').count()
  expect(compatibilityCount).toBeGreaterThan(directCount * 2)
  await writeFile(info.outputPath('paper-model-performance.json'), JSON.stringify({ directCount, compatibilityCount }, null, 2))
  expect((await page.screenshot()).equals(direct), 'direct model and SVG capture have identical pixels').toBe(true)
  await source.evaluate(svg => { delete (svg as SVGSVGElement).dataset.paperModelMode })
  await paint()
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')))
  await expect(source.locator('[data-paper-direct-model="active"]')).toHaveCount(0)
  expect(await source.locator('*').count()).toBe(compatibilityCount)
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await paint()
  await expect(source.locator('[data-paper-direct-model="active"]')).not.toHaveCount(0)
})

test('long scrolls, reverse scrolls and zoom previews keep complete, editable pixels', async ({ page }) => {
  await page.goto('/')
  const paint = () => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  await paint()
  const source = page.locator('.sheetSvg').first()
  for (const fraction of [0.7, 1, 0.4, 0]) {
    await page.locator('.sheetViewport').evaluate((element, fraction) => { element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction }, fraction)
    await paint()
    const retained = await page.screenshot()
    await source.evaluate((svg, fraction) => svg.setAttribute('data-e2e-rebuild', String(fraction)), fraction)
    await paint()
    expect((await page.screenshot()).equals(retained), 'scrolling and rebuilding paint identical pixels').toBe(true)
  }
  const preview = await source.evaluate(async svg => {
    const host = svg.closest<HTMLElement>('.sheetPageSurface')!
    const canvas = svg.nextElementSibling as HTMLCanvasElement
    const draws = Number(canvas.dataset.canvasKitDraws)
    for (let step = 1; step <= 12; step++) {
      host.dataset.touchPinchPreview = 'true'
      host.style.transformOrigin = '0 0'
      host.style.transform = `scale(${1 + step / 20})`
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    }
    return { sameCanvas: svg.nextElementSibling === canvas, draws: Number(canvas.dataset.canvasKitDraws) - draws }
  })
  await paint()
  expect(preview.sameCanvas).toBe(true)
  expect(preview.draws).toBe(0)
  // While zooming, editing uses the retained raster scale and still paints new content.
  await source.evaluate(svg => svg.insertAdjacentHTML('beforeend', '<rect id="zoom-edit" x="0.15" y="0.15" width="0.1" height="0.1" fill="#ec1327" />'))
  await paint()
  const redBounds = async () => page.evaluate(async base64 => {
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
    const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    let left = image.width, top = image.height, right = 0, bottom = 0, count = 0
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4
      if (data[offset] > 228 && data[offset + 1] < 40 && data[offset + 2] < 55) {
        left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); count++
      }
    }
    return { left, top, right, bottom, count }
  }, (await page.screenshot()).toString('base64'))
  const during = await redBounds()
  expect(during.count).toBeGreaterThan(100)
  await source.evaluate(svg => { delete svg.closest<HTMLElement>('.sheetPageSurface')!.dataset.touchPinchPreview; svg.setAttribute('data-e2e-rebuild', 'commit-preview') })
  await paint()
  const committed = await redBounds()
  for (const edge of ['left', 'top', 'right', 'bottom'] as const) expect(Math.abs(committed[edge] - during[edge])).toBeLessThanOrEqual(3)
  await source.evaluate(svg => {
    const host = svg.closest<HTMLElement>('.sheetPageSurface')!
    host.style.removeProperty('transform'); host.style.removeProperty('transform-origin')
    svg.querySelector('#zoom-edit')!.remove()
  })
  await paint()
  await expect(source).toHaveAttribute('data-canvaskit-ready', 'true')
})

test('template model updates preserve layout, inherited styles and hidden labels', async ({ page }, info) => {
  await page.goto('/?app=template-editor')
  await page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
  const paint = () => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
  await paint()
  await page.getByRole('button', { name: 'ACTION幅を広くする' }).click()
  await page.mouse.move(5, 5)
  await paint()
  const source = page.locator('.templateStaticPreviewSvg')
  const viewport = page.locator('.templateEditorViewport')
  for (const css of ['/* original styles */', '.gridOverlay { opacity: .6 } .gridOverlay text, .templateChrome text { font-style: italic; letter-spacing: 1px }',
    '.gridRowGuideLabel, .templateColumnText { visibility: hidden }']) {
    const style = await page.addStyleTag({ content: css })
    await paint()
    const direct = await viewport.screenshot()
    await source.evaluate(svg => { (svg as SVGSVGElement).dataset.paperModelMode = 'svg' })
    await paint()
    const compatibility = await viewport.screenshot()
    if (!compatibility.equals(direct)) {
      await writeFile(info.outputPath('template-direct.png'), direct)
      await writeFile(info.outputPath('template-compatibility.png'), compatibility)
    }
    expect(compatibility.equals(direct), `edited template direct and SVG paths match: ${css}`).toBe(true)
    await source.evaluate(svg => { delete (svg as SVGSVGElement).dataset.paperModelMode })
    await style.evaluate(element => element.remove())
    await paint()
  }
})
