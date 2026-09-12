import { test, expect, type Page } from './fixtures'
import { activateControl } from './input'
import { createProjectFromTemplate, createProjectDocumentFromCutProject, digitalStandardSheetTemplate,
  standardA3SheetTemplate, updateLogicalSheetSettings, validateProject } from '../../../packages/core/src/index'
import { encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { uiText } from '../../../packages/ui/src/i18n'
import { waitForPaperPaint } from '../paper-paint-contract'

const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })

async function panOutsideMemo(page: Page, chromium: boolean) {
  const start = await page.locator('.sheetViewport').evaluate(viewport => {
    const box = viewport.getBoundingClientRect()
    for (const fx of [.85, .55, .25]) for (const fy of [.75, .5, .25]) {
      const x = box.left + viewport.clientWidth * fx, y = box.top + viewport.clientHeight * fy
      const target = document.elementFromPoint(x, y)
      if (target?.closest('.sheetViewport') === viewport && !target.closest('[data-timeline-memo-id], button, input, textarea')) {
        const deltaY = viewport.scrollTop >= 80 ? 70 : -70
        return { x, y, deltaY, scrollTop: viewport.scrollTop }
      }
    }
    throw new Error('No unobscured viewport point outside the memo')
  })
  if (chromium) {
    const session = await page.context().newCDPSession(page)
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x, y: start.y, id: 1 }] })
    for (let step = 1; step <= 5; step++) await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: start.x, y: start.y + start.deltaY * step / 5, id: 1 }],
    })
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await session.detach()
  } else {
    // WebKit has no Playwright touch-drag transport. Exercise the same DOM
    // propagation path explicitly, and report this as simulated PointerEvents.
    await page.evaluate(start => {
      const viewport = document.querySelector('.sheetViewport')!
      const target = document.elementFromPoint(start.x, start.y)!
      const event = { bubbles: true, cancelable: true, pointerType: 'touch', pointerId: 901, isPrimary: true, button: 0, buttons: 1, clientX: start.x, clientY: start.y }
      target.dispatchEvent(new PointerEvent('pointerdown', event))
      viewport.dispatchEvent(new PointerEvent('pointermove', { ...event, clientY: start.y + start.deltaY }))
      viewport.dispatchEvent(new PointerEvent('pointerup', { ...event, buttons: 0, clientY: start.y + start.deltaY }))
    }, start)
  }
  await expect.poll(() => page.locator('.sheetViewport').evaluate(viewport => viewport.scrollTop)).toBeCloseTo(start.scrollTop - start.deltaY, 0)
  return start
}

for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
  test(`PAN memo remains writable after touch navigation (${template.templateId})`, async ({ page }, info) => {
    let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 288 })
    project = { ...project, sheetView: { ...project.sheetView, viewMode: 'continuous' }, timedRangeCues: [{
      cueId: 'pan_1', role: 'camera', laneId: 'camera_lane_1', frameStart: 24, frameEnd: 54,
      label: 'PAN', text: '', source: 'manual', camera: { shape: 'range' },
    }] }
    expect(validateProject(project)).toEqual([])
    const bytes = await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))
    await page.goto('./')
    await paint(page)
    await activateControl(page, page.getByLabel(uiText.nav.menu, { exact: true }))
    await page.locator('.appNavMenu input[accept*=".xsr"]').setInputFiles({ name: 'pan-memo.xsr', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) })
    const cue = page.locator('[data-camera-cue-id="pan_1"] .cameraCueLabelHit').first()
    await expect(cue).toHaveCount(1)
    await paint(page)
    await cue.evaluate(cue => {
      const viewport = cue.closest('.sheetViewport')!
      const box = cue.getBoundingClientRect(), clip = viewport.getBoundingClientRect()
      viewport.scrollTop += box.top - clip.bottom + 65
    })
    await activateControl(page, cue)
    await activateControl(page, page.getByRole('button', { name: 'メモツールを開く', exact: true }))
    await activateControl(page, page.getByRole('button', { name: uiText.sheet.penTool, exact: true }))
    const surface = page.locator('.timelineMemoDrawSurface').first()
    await expect(surface).toHaveCount(1)
    await paint(page)
    const memoId = await surface.evaluate(surface => surface.closest('[data-timeline-memo-id]')!.getAttribute('data-timeline-memo-id'))
    const geometry = await surface.evaluate(surface => {
      const viewport = surface.closest('.sheetViewport')!
      const box = surface.getBoundingClientRect(), clip = viewport.getBoundingClientRect()
      return { memo: box.toJSON(), viewport: clip.toJSON(), scrollTop: viewport.scrollTop }
    })
    expect(geometry.memo.top).toBeGreaterThanOrEqual(geometry.viewport.top)
    expect(geometry.memo.top).toBeLessThan(geometry.viewport.bottom - 24)
    expect(geometry.memo.left).toBeGreaterThanOrEqual(geometry.viewport.left - 1)
    expect(geometry.memo.left).toBeLessThan(geometry.viewport.right - 24)

    const navigation = await panOutsideMemo(page, info.project.name.startsWith('chromium'))
    await paint(page)
    await expect(surface).toHaveCount(1)
    expect(await surface.evaluate(surface => surface.closest('[data-timeline-memo-id]')!.getAttribute('data-timeline-memo-id'))).toBe(memoId)
    await expect(page.locator('.annotationFloatingPalette')).toHaveAttribute('data-annotation-tool', 'pen')

    expect(await page.locator('.sheetViewport').evaluate(viewport => viewport.scrollTop)).toBeCloseTo(navigation.scrollTop - navigation.deltaY, 0)
    const bounds = (await surface.boundingBox())!
    const clip = (await page.locator('.sheetViewport').boundingBox())!
    const x = Math.max(bounds.x + 12, Math.min(bounds.x + bounds.width / 2, clip.x + clip.width - 35))
    const y = Math.max(clip.y + 35, bounds.y + 12, Math.min(bounds.y + 35, clip.y + clip.height - 35))
    const hitIsMemo = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.timelineMemoSegment.selected'), { x, y })
    expect(hitIsMemo, 'the writing origin must be visible and unobscured').toBe(true)
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x + 18, y + 12, { steps: 5 })
    await page.mouse.up()
    await expect(page.locator('.timelineMemoStroke')).toHaveCount(1)
    await paint(page)
    const drawn = await page.screenshot()
    await page.locator('.sheetSvg').first().evaluate(svg => svg.setAttribute('data-e2e-rebuild', 'memo-navigation'))
    await paint(page)
    expect((await page.screenshot()).equals(drawn), 'memo pixels survive complete reconstruction after navigation').toBe(true)
    await info.attach('memo-navigation-input', { body: JSON.stringify({ template: template.templateId, memoId, geometry, navigation,
      touchInput: info.project.name.startsWith('chromium') ? 'Chromium CDP touch events' : 'WebKit DOM PointerEvent simulation', drawingInput: 'Playwright mouse', physicalDevice: false }), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('memo-after-touch-scroll.png') })
    await page.keyboard.press('Escape')
    await expect(page.locator('.timelineMemoSegment.selected')).toHaveCount(0)
    await expect(page.locator('.timelineMemoStroke')).toHaveCount(1)
  })
}
