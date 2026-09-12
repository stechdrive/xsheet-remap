import { expect, test, type Page } from './fixtures'
import { writeFile } from 'node:fs/promises'
import { standardA3SheetTemplate, timingHitForFrame, cellRectForHit } from '../../../packages/core/src/index'
import { waitForPaperPaint } from '../paper-paint-contract'

async function active(page: Page, selector: string) {
  await expect(page.locator(selector).first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
  await waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
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
  await page.goto('./')
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
  await page.mouse.move(5, 5)
  await active(page, '.sheetSvg')
  const directPixels = await page.screenshot()
  await page.locator('.sheetSvg').first().evaluate(svg => { svg.dataset.paperModelMode = 'svg' })
  await active(page, '.sheetSvg')
  expect((await page.screenshot()).equals(directPixels), 'timing text and holds match the SVG compatibility capture').toBe(true)
  await page.locator('.sheetSvg').first().evaluate(svg => { delete svg.dataset.paperModelMode })
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
  await expect(page.locator('.hoverCellSvg')).toBeVisible()
  expect(await page.locator('.hoverCellSvg').getAttribute('data-canvaskit-state')).toBeNull()
  await page.mouse.move(5, 5)
  await expect(page.locator('.hoverCellRect')).toHaveCount(0)
  await page.keyboard.press('Control+z')
  await expect(page.locator('[data-timeline-event-track="A"][data-timeline-event-frame="10"]')).toHaveCount(0)
  await active(page, '.sheetSvg')
  const before = await page.locator('.sheetSvg').first().getAttribute('data-canvaskit-scene-builds')
  await page.mouse.move(600, 600)
  if (info.project.name === 'webkit-touch') await page.locator('.sheetViewport').evaluate(element => element.scrollBy(0, 200))
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

test('large image corrections reuse decoded bytes and the worker, then release resources', async ({ page }) => {
  await page.goto('./')
  await active(page, '.sheetSvg')
  const workers: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  const source = page.locator('.sheetSvg').first()
  const original = '0.5 0 0 0 0 0 0.5 0 0 0 0 0 0.5 0 0 0 0 0 1 0'
  await source.evaluate((svg, matrix) => {
    const bitmap = document.createElement('canvas'); bitmap.width = 1024; bitmap.height = 512
    const context = bitmap.getContext('2d')!; context.fillStyle = '#ff8040'; context.fillRect(0, 0, bitmap.width, bitmap.height)
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g'); group.id = 'filter-worker-probe'
    group.innerHTML = `<defs><filter id="filter-worker-color"><feColorMatrix type="matrix" values="${matrix}" /></filter></defs><image x="0.15" y="0.2" width="0.2" height="0.1" filter="url(#filter-worker-color)" />`
    group.querySelector('image')!.setAttribute('href', bitmap.toDataURL())
    svg.append(group)
  }, original)
  await active(page, '.sheetSvg')
  await expect.poll(() => workers.length).toBe(1)
  expect(workers[0]).toContain('canvasKitImageFilter.worker-')
  const sourceBytes = Number(await source.getAttribute('data-canvaskit-source-bytes'))
  expect(sourceBytes).toBeGreaterThan(1024 * 512 * 4)
  expect(Number(await source.getAttribute('data-canvaskit-image-bytes'))).toBe(1024 * 512 * 4)
  const before = await page.screenshot()
  await source.locator('#filter-worker-color feColorMatrix').evaluate(element => element.setAttribute('values', '1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'))
  await active(page, '.sheetSvg')
  expect((await page.screenshot()).equals(before)).toBe(false)
  expect(Number(await source.getAttribute('data-canvaskit-source-bytes'))).toBe(sourceBytes)
  await source.locator('#filter-worker-color feColorMatrix').evaluate((element, matrix) => element.setAttribute('values', matrix), original)
  await active(page, '.sheetSvg')
  expect((await page.screenshot()).equals(before)).toBe(true)
  expect(workers).toHaveLength(1)
  await source.locator('#filter-worker-probe').evaluate(element => element.remove())
  await active(page, '.sheetSvg')
  expect(Number(await source.getAttribute('data-canvaskit-source-bytes'))).toBe(0)
  expect(Number(await source.getAttribute('data-canvaskit-image-bytes'))).toBe(0)
})

test('cell navigation updates its overlay without rebuilding paper and matches a complete redraw', async ({ page }, info) => {
  await page.goto('./')
  await active(page, '.sheetSvg')
  const p = await cell(page, 1)
  await page.mouse.click(p.x, p.y)
  await page.mouse.move(5, 5)
  await active(page, '.sheetSvg')
  const source = page.locator('.sheetSvg').first()
  const samples = []
  await source.evaluate(svg => {
    const records: unknown[] = []
    Reflect.set(window, '__paperInvalidationTrace', records)
    const observer = new MutationObserver(changes => records.push(...changes.filter(change => !change.attributeName?.startsWith('data-canvaskit')).map(change => ({
      type: change.type, target: (change.target as Element).tagName, class: (change.target as Element).getAttribute?.('class'), attribute: change.attributeName,
      value: change.attributeName ? (change.target as Element).getAttribute(change.attributeName) : undefined,
    }))))
    observer.observe(svg, { attributes: true, subtree: true, childList: true, characterData: true })
    observer.observe(document.head, { subtree: true, childList: true, characterData: true })
    observer.observe(document.body, { attributes: true })
  })
  const metrics = () => source.evaluate(svg => ({
    sceneBuilds: Number(svg.dataset.canvaskitSceneBuilds),
    capturedNodes: Number(svg.dataset.canvaskitCapturedNodes), reusedPictures: Number(svg.dataset.canvaskitReusedPictures),
    captureMs: Number(svg.dataset.canvaskitCaptureMs), recordMs: Number(svg.dataset.canvaskitRecordMs),
  }))
  for (let step = 0; step < 6; step++) {
    const previous = await metrics()
    await page.keyboard.press('ArrowDown')
    await active(page, '.sheetSvg')
    const incremental = await metrics()
    const before = await page.screenshot()
    await source.evaluate((svg, value) => svg.setAttribute('data-e2e-force-rebuild', String(value)), step)
    await active(page, '.sheetSvg')
    const complete = await metrics()
    if (incremental.sceneBuilds !== previous.sceneBuilds) await info.attach('paper-invalidation-trace', {
      body: JSON.stringify(await page.evaluate(() => Reflect.get(window, '__paperInvalidationTrace'))), contentType: 'application/json',
    })
    expect(incremental.sceneBuilds, 'selection moves without rebuilding the base paper').toBe(previous.sceneBuilds)
    expect(complete.sceneBuilds).toBeGreaterThan(incremental.sceneBuilds)
    expect((await page.screenshot()).equals(before), 'cached and complete paint produce identical pixels').toBe(true)
    samples.push({ incremental, complete })
  }
  const path = info.outputPath('navigation-performance.json')
  await writeFile(path, JSON.stringify(samples, null, 2))
  await info.attach('navigation-performance.json', { path, contentType: 'application/json' })
})

test('cached groups follow inherited paint, transforms, text and shared clip edits', async ({ page }) => {
  await page.goto('./')
  await active(page, '.sheetSvg')
  const source = page.locator('.sheetSvg').first()
  await source.evaluate(svg => {
    const fragment = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="cache-test-clip"><rect x="0.2" y="0.1" width="0.4" height="0.2" /></clipPath></defs>
      <g id="cache-test-layer" fill="#067630" clip-path="url(#cache-test-clip)">
        <rect x="0.2" y="0.1" width="0.4" height="0.2" />
        <text x="0.25" y="0.15" font-size="0.02">A1</text>
      </g></svg>`, 'image/svg+xml').documentElement
    svg.append(...Array.from(fragment.children))
  })
  await active(page, '.sheetSvg')
  for (const change of ['paint', 'transform', 'clip', 'text']) {
    await source.evaluate((svg, change) => {
      const layer = svg.querySelector('#cache-test-layer')!
      if (change === 'paint') { layer.setAttribute('fill', '#d72825'); layer.setAttribute('opacity', '0.55') }
      if (change === 'transform') layer.setAttribute('transform', 'translate(0.03 0.02)')
      if (change === 'clip') svg.querySelector('#cache-test-clip rect')!.setAttribute('width', '0.18')
      if (change === 'text') layer.querySelector('text')!.textContent = '作画 B2'
    }, change)
    await active(page, '.sheetSvg')
    const cached = await page.screenshot()
    await source.evaluate((svg, value) => svg.setAttribute('data-e2e-force-rebuild', value), change)
    await active(page, '.sheetSvg')
    expect((await page.screenshot()).equals(cached), `${change} invalidates the affected cached paint`).toBe(true)
  }
})

test('touch taps select and edit cells in an emulated touch viewport', { tag: '@touch' }, async ({ page }) => {
  await page.goto('./')
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
  await page.goto('./')
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
  await page.route(/canvaskit[^/]*\.wasm(?:\?|$)/, route => route.abort())
  await page.goto('./')
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
  await page.goto('./?app=template-editor')
  await page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
  await active(page, '.templateStaticPreviewSvg')
  const builds = await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')
  const viewport = await page.locator('.templateEditorViewport').boundingBox()
  await page.mouse.move(viewport!.x + 120, viewport!.y + 120)
  if (info.project.name === 'webkit-touch') await page.locator('.templateEditorViewport').evaluate(element => element.scrollBy(0, 450))
  else await page.mouse.wheel(0, 450)
  await page.waitForTimeout(150)
  expect(await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')).toBe(builds)
  if (info.project.name === 'webkit-touch') await page.locator('.templateEditorViewport').dispatchEvent('wheel', { ctrlKey: true, deltaY: -150, clientX: viewport!.x + 120, clientY: viewport!.y + 120 })
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
