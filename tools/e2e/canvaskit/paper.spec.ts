import { expect, test, type Page } from '@playwright/test'
import { standardA3SheetTemplate, timingHitForFrame, cellRectForHit } from '../../../packages/core/src/index'

async function active(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
}
async function cell(page: Page, frame: number, track = 'A') {
  const hit = timingHitForFrame(standardA3SheetTemplate, 'cell', track, frame)!
  const rect = cellRectForHit(standardA3SheetTemplate, hit)!
  return page.locator('.sheetSvg').first().evaluate((svg, r) => {
    const b = svg.getBoundingClientRect()
    return { x: b.left + (r.x + r.w / 2) * b.width, y: b.top + (r.y + r.h / 2) * b.height }
  }, rect)
}

async function contributesPixels(page: Page, selector: string) {
  await page.mouse.move(5, 5)
  const before = (await page.screenshot()).toString('base64')
  const source = page.locator('.sheetSvg').first()
  const builds = Number(await source.getAttribute('data-canvaskit-scene-builds'))
  const style = await page.addStyleTag({ content: `${selector} { visibility: hidden !important; }` })
  await expect.poll(async () => Number(await source.getAttribute('data-canvaskit-scene-builds'))).toBeGreaterThan(builds)
  const after = (await page.screenshot()).toString('base64')
  await style.evaluate(element => element.remove())
  const changed = await page.evaluate(async ({ before, after }) => {
    async function pixels(base64: string) {
      const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height
      const context = canvas.getContext('2d')!; context.drawImage(image, 0, 0)
      return context.getImageData(0, 0, canvas.width, canvas.height).data
    }
    const [a, b] = await Promise.all([pixels(before), pixels(after)])
    let count = 0
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) count++
    return { count, pixels: a.length / 4 }
  }, { before, after })
  expect(changed.count, `${selector} contributes visible GPU pixels`).toBeGreaterThan(5)
  expect(changed.count, 'masking a line does not remove the paper').toBeLessThan(changed.pixels * 0.1)
  await expect.poll(async () => Number(await source.getAttribute('data-canvaskit-scene-builds'))).toBeGreaterThan(builds + 1)
}

test('sheet selection, timing, hover, undo and redraw survive GPU painting', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.text().includes('[paper-renderer]')) errors.push(message.text()) })
  await page.goto('/')
  await active(page, '.sheetSvg')
  const p = await cell(page, 1)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('1'); await page.keyboard.press('Enter')
  await expect(page.locator('[data-timeline-event-track="A"][data-timeline-event-frame="1"] .eventText')).toHaveText('1')
  const next = await cell(page, 10)
  await page.mouse.click(next.x, next.y)
  await page.keyboard.press('2'); await page.keyboard.press('Enter')
  await expect(page.locator('.timingContinuationStraight').first()).toBeAttached()
  await active(page, '.sheetSvg')
  await contributesPixels(page, '.timingContinuationStraight')
  const blank = await cell(page, 10, 'B')
  await page.mouse.click(blank.x, blank.y)
  await page.keyboard.press('7'); await page.keyboard.press('Enter')
  await expect(page.locator('.timingContinuationWave').first()).toBeAttached()
  await contributesPixels(page, '.timingContinuationWave')
  await page.keyboard.press('Control+z')
  for (let frame = 2; frame <= 8; frame++) {
    const point = await cell(page, frame)
    await page.mouse.move(point.x, point.y)
  }
  await expect(page.locator('.hoverCellRect')).toHaveCount(1)
  await active(page, '.hoverCellSvg')
  await page.mouse.move(5, 5)
  await expect(page.locator('.hoverCellRect')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-timeline-event-track="A"][data-timeline-event-frame="10"]')).toHaveCount(0)
  const before = await page.locator('.sheetSvg').first().getAttribute('data-canvaskit-scene-builds')
  await page.mouse.move(600, 600)
  if (info.project.name === 'ipad') await page.locator('.sheetViewport').evaluate(element => element.scrollBy(0, 200))
  else await page.mouse.wheel(0, 200)
  await page.waitForTimeout(120)
  await active(page, '.sheetSvg')
  expect(await page.locator('.sheetSvg').first().getAttribute('data-canvaskit-scene-builds')).toBe(before)
  const budget = await page.locator('.canvasKitPaperCanvas').evaluateAll(elements => elements.map(element => {
    const canvas = element as HTMLCanvasElement
    return canvas.width * canvas.height
  }))
  expect(Math.max(...budget)).toBeLessThan(6_010_000)
  const screenshot = await page.screenshot({ path: info.outputPath('sheet.png') })
  const paperFraction = await page.evaluate(async base64 => {
    const source = document.querySelector('.sheetSvg')!.getBoundingClientRect()
    const viewport = document.querySelector('.sheetViewport')!.getBoundingClientRect()
    const image = new Image(); image.src = `data:image/png;base64,${base64}`; await image.decode()
    const bitmap = document.createElement('canvas'); bitmap.width = image.width; bitmap.height = image.height
    const context = bitmap.getContext('2d')!; context.drawImage(image, 0, 0)
    const scale = image.width / innerWidth
    const x = Math.ceil(Math.max(source.left, viewport.left, 0) + 10)
    const y = Math.ceil(Math.max(source.top, viewport.top, 0) + 10)
    const width = Math.floor(Math.min(source.right, viewport.right, innerWidth) - x - 10)
    const height = Math.floor(Math.min(source.bottom, viewport.bottom, innerHeight) - y - 10)
    const pixels = context.getImageData(x * scale, y * scale, width * scale, height * scale).data
    let white = 0
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 235 && pixels[i + 1] > 235 && pixels[i + 2] > 230) white++
    return white * 4 / pixels.length
  }, screenshot.toString('base64'))
  expect(paperFraction, 'the paper remains painted after scrolling and idle composition').toBeGreaterThan(0.3)
  expect(errors).toEqual([])
})

test('touch taps select and edit cells in a tablet viewport', async ({ page }, info) => {
  test.skip(!info.project.use.hasTouch, 'touch projects only')
  await page.goto('/')
  await active(page, '.sheetSvg')
  const p = await cell(page, 1)
  await page.touchscreen.tap(p.x, p.y)
  await expect(page.locator('.selectedCellRect')).toHaveCount(1)
  await page.getByRole('button', { name: 'タイミング 6', exact: true }).tap()
  await page.getByRole('button', { name: '入力を確定して次へ', exact: true }).tap()
  await expect(page.locator('[data-timeline-event-track="A"][data-timeline-event-frame="1"] .eventText')).toHaveText('6')
  await active(page, '.sheetSvg')
})

test('GPU context restoration and suspended surfaces preserve the editable document', async ({ page }) => {
  await page.goto('/')
  await active(page, '.sheetSvg')
  const source = page.locator('.sheetSvg').first()
  const canvas = page.locator('.sheetSvg + .canvasKitPaperCanvas').first()
  const restoration = await canvas.evaluate(canvas => {
    const element = canvas as HTMLCanvasElement
    const gl = element.getContext('webgl2') ?? element.getContext('webgl')
    const extension = gl?.getExtension('WEBGL_lose_context')
    if (!extension) return false
    extension.loseContext()
    setTimeout(() => extension.restoreContext(), 350)
    return true
  })
  expect(restoration).toBe(true)
  await expect(source).toHaveAttribute('data-canvaskit-state', 'context-lost')
  await active(page, '.sheetSvg')
  await source.evaluate(element => { element.style.display = 'none' })
  await expect(source).toHaveAttribute('data-canvaskit-state', 'suspended')
  await expect(canvas).toHaveAttribute('width', '1')
  await source.evaluate(element => { element.style.removeProperty('display') })
  await active(page, '.sheetSvg')
  const p = await cell(page, 1)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('3'); await page.keyboard.press('Enter')
  await expect(page.locator('[data-timeline-event-track="A"][data-timeline-event-frame="1"] .eventText')).toHaveText('3')
})

test('an unavailable WASM runtime retains rendering and keyboard editing', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(/canvaskit\.wasm(?:\?|$)/, route => route.request().resourceType() === 'script' ? route.continue() : route.abort())
  await page.goto('/')
  const source = page.locator('.sheetSvg').first()
  await expect(source).toHaveAttribute('data-canvaskit-state', 'fallback', { timeout: 40_000 })
  await expect(source).not.toHaveAttribute('data-canvaskit-ready', 'true')
  const p = await cell(page, 1)
  await page.mouse.click(p.x, p.y)
  await page.keyboard.press('4'); await page.keyboard.press('Enter')
  await expect(page.locator('[data-timeline-event-track="A"][data-timeline-event-frame="1"] .eventText')).toHaveText('4')
  expect(errors).toEqual([])
})

test('template zoom and scroll reuse static drawing; edits update it', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.text().includes('[paper-renderer]')) errors.push(message.text()) })
  await page.goto('/?app=template-editor')
  await page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
  await active(page, '.templateStaticPreviewSvg')
  const builds = await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')
  const viewport = await page.locator('.templateEditorViewport').boundingBox()
  await page.mouse.move(viewport!.x + 120, viewport!.y + 120)
  if (info.project.name === 'ipad') await page.locator('.templateEditorViewport').evaluate(element => element.scrollBy(0, 450))
  else await page.mouse.wheel(0, 450)
  await page.waitForTimeout(150)
  expect(await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')).toBe(builds)
  if (info.project.name === 'ipad') await page.locator('.templateEditorViewport').dispatchEvent('wheel', { ctrlKey: true, deltaY: -150, clientX: viewport!.x + 120, clientY: viewport!.y + 120 })
  else { await page.keyboard.down('Control'); await page.mouse.wheel(0, -150); await page.keyboard.up('Control') }
  await page.waitForTimeout(150)
  await active(page, '.templateStaticPreviewSvg')
  expect(await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')).toBe(builds)
  await page.getByRole('button', { name: 'ACTION幅を広くする' }).click()
  await expect.poll(async () => Number(await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds'))).toBeGreaterThan(Number(builds))
  await active(page, '.templateStaticPreviewSvg')
  await page.screenshot({ path: info.outputPath('template.png') })
  expect(errors).toEqual([])
})
