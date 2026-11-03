import { readFileSync } from 'node:fs'
import { expect, test, type Page } from './fixtures'
import { activateControl } from './input'
import { activeCutProjectFromDocument, cellRectForHit, createKey, createProjectDocumentFromCutProject, createProjectFromTemplate,
  digitalStandardSheetTemplate, setEvent, standardA3SheetTemplate, timingHitForFrame, updateLogicalSheetSettings } from '../../../packages/core/src/index'
import { decodeProjectFileBytes, encodeProjectArchive } from '../../../packages/adapters/src/projectArchive'
import { createSheetRenderModelContext } from '../../../packages/ui/src/sheetRenderModel'
import { waitForPaperPaint } from '../paper-paint-contract'
import { readPng } from '../raster'

const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(expression: string) => page.evaluate<T>(expression) })
for (const template of [standardA3SheetTemplate, digitalStandardSheetTemplate]) {
  test(`selected text sizes, mixed values, cue parts, Undo and persistence (${template.templateId})`, async ({ page }, info) => {
    let project = updateLogicalSheetSettings(createProjectFromTemplate(template), { durationFrames: 48 })
    for (const [track, frame, size] of [['A', 1, 18], ['A', 4, 32], ['B', 2, 24], ['A', 10, 18]] as const) {
      const created = createKey(project, track, '1', 'manual', '1', 'cell')
      project = setEvent(created.project, track, frame, created.key.keyId, 'cell', { fontSizePx: size })
    }
    project.timedRangeCues = [
      { cueId: 'voice', role: 'sound', laneId: 'sound_lane_1', frameStart: 5, frameEnd: 12, label: 'A', text: '声', source: 'manual' },
      { cueId: 'pan', role: 'camera', laneId: 'camera_lane_1', frameStart: 5, frameEnd: 14, label: 'PAN', text: '', source: 'manual', camera: { shape: 'range', startLabel: 'A', endLabel: 'B' } },
    ]
    await page.goto('./')
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await page.getByRole('button', { name: 'プロジェクトを開く…', exact: true }).setInputFiles({ name: 'sizes.xsr', mimeType: 'application/octet-stream',
      buffer: Buffer.from(await encodeProjectArchive(createProjectDocumentFromCutProject(project, { sheetTemplate: template }))) })
    const svg = page.locator('.sheetSvg').first()
    await expect(svg).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await paint(page)
    const context = createSheetRenderModelContext(project, template)
    const hit = timingHitForFrame(template, 'cell', 'A', 1, 48)!
    const rect = cellRectForHit(template, hit, 48, 1, context)!
    const point = await svg.evaluate((element, r) => { const b = element.getBoundingClientRect(); return { x: b.x + (r.x + r.w / 2) * b.width, y: b.y + (r.y + r.h / 2) * b.height } }, rect)
    await page.mouse.click(point.x, point.y)
    for (let step = 0; step < 3; step++) await page.keyboard.press('Shift+ArrowDown')
    await page.keyboard.press('Shift+ArrowRight')
    await activateControl(page, page.getByLabel('入力文字設定', { exact: true }))
    const size = page.getByRole('spinbutton', { name: '入力文字', exact: true })
    await expect(size).toHaveAttribute('placeholder', '混在')
    await expect(page.locator('.sheetTextSizeTarget')).toHaveText('CELL 3件')
    // The portal can reposition between protocol calls. Compare all controls
    // in one layout snapshot so movement of the whole menu is not a row error.
    const geometry = await size.evaluate(input => {
      const row = input.closest('.sheetTextSizeRow')!
      return { input: input.getBoundingClientRect().toJSON(), buttons: ['選択文字を小さく', '選択文字を大きく'].map(name => {
        const button = row.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)
        if (!button) throw new Error(`Missing text-size control: ${name}`)
        return { name, ...button.getBoundingClientRect().toJSON() }
      }) }
    })
    await info.attach('text-size-control-geometry', { contentType: 'application/json', body: JSON.stringify(geometry) })
    for (const button of geometry.buttons) {
      expect(Math.abs(button.y + button.height / 2 - geometry.input.y - geometry.input.height / 2), 'size controls share one row').toBeLessThan(2)
      expect(button.width).toBeLessThan(40)
    }
    await size.fill('28'); await size.press('Enter')
    const event = (track: string, frame: number) => page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="${track}"][data-timeline-event-frame="${frame}"] .eventText`).first()
    for (const [track, frame] of [['A', 1], ['A', 4], ['B', 2]] as const) await expect(event(track, frame)).toHaveAttribute('font-size', '28')
    await expect(event('A', 10)).toHaveAttribute('font-size', '18')
    await activateControl(page, page.getByLabel('入力文字設定', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: '元に戻す', exact: true }))
    await expect(event('A', 1)).toHaveAttribute('font-size', '18')
    await expect(event('A', 4)).toHaveAttribute('font-size', '32')
    await expect(event('B', 2)).toHaveAttribute('font-size', '24')
    await activateControl(page, page.getByRole('button', { name: 'やり直し', exact: true }))
    await expect(event('A', 1)).toHaveAttribute('font-size', '28')
    for (const [role, id, main, secondary, label] of [['sound', 'voice', 24, 14, '本文'], ['camera', 'pan', 32, 12, '開始・終了ラベル']] as const) {
      await activateControl(page, page.locator(role === 'sound' ? `[data-sound-cue-id="${id}"] .soundCueBody` : `.cameraCueLabel[data-camera-cue-id="${id}"] .cameraCueLabelHit`))
      await activateControl(page, page.getByLabel('入力文字設定', { exact: true }))
      await size.fill(String(main)); await size.press('Enter')
      await activateControl(page, page.locator('.sheetTextSizeSettings summary'))
      const part = page.getByRole('spinbutton', { name: `${label}の文字サイズ`, exact: true })
      await part.fill(String(secondary)); await part.press('Enter')
      await expect(size).toHaveValue(String(main))
      await expect(part).toHaveValue(String(secondary))
      const geometry = await page.locator('.timingTextRailMenu.actionMenuContent').evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }))
      expect(geometry.content).toBeLessThanOrEqual(geometry.width)
      await page.screenshot({ path: info.outputPath(`${role}-text-settings.png`) })
      await activateControl(page, page.getByLabel('入力文字設定', { exact: true }))
    }
    await paint(page)
    // Compare the paper, including its timing/cue text, rather than unrelated
    // toolbar icons whose page-compositor antialiasing can change when the SVG
    // fallback adds DOM. Keep the paper's one-channel-level limit unchanged.
    const viewport = page.locator('.sheetViewport')
    const direct = await readPng(await viewport.screenshot({ path: info.outputPath('sizes-gpu.png') }))
    await svg.evaluate(element => { element.dataset.paperModelMode = 'svg' })
    await paint(page)
    const compatibility = await readPng(await viewport.screenshot({ path: info.outputPath('sizes-svg.png') }))
    await info.attach('svg-text-metrics', { contentType: 'application/json', body: JSON.stringify(await svg.locator('.templateFormLabel').evaluateAll(elements => elements.map(element => ({
      text: element.textContent, requested: element.getAttribute('font-size'), actual: getComputedStyle(element).fontSize,
      weight: getComputedStyle(element).fontWeight, requestedWeight: element.getAttribute('font-weight'), baseline: getComputedStyle(element).dominantBaseline,
      letterSpacing: getComputedStyle(element).letterSpacing, x: element.getAttribute('x'), y: element.getAttribute('y'),
      transform: element.getAttribute('transform'), scale: (element as SVGGraphicsElement).getScreenCTM()?.a,
    })))) })
    expect([compatibility.width, compatibility.height]).toEqual([direct.width, direct.height])
    let difference = 0
    for (let i = 0; i < direct.data.length; i++) difference = Math.max(difference, Math.abs(direct.data[i] - compatibility.data[i]))
    expect(difference, 'resized timing and cue pixels match SVG within one antialiasing level').toBeLessThanOrEqual(1)
    await svg.evaluate(element => { delete element.dataset.paperModelMode })
    await activateControl(page, page.getByLabel('画面切替', { exact: true }))
    await activateControl(page, page.getByRole('button', { name: 'プロジェクト ›', exact: true }))
    const download = page.waitForEvent('download')
    await activateControl(page, page.getByRole('button', { name: '名前を付けて保存…', exact: true }))
    const saved = info.outputPath('sizes.xsr')
    await (await download).saveAs(saved)
    const restored = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(readFileSync(saved)))).document)
    expect(restored.logicalSheet.events.filter(event => event.fontSizeMode === 'fixed').map(event => event.fontSizePx)).toEqual([28, 28, 28])
    expect(restored.timedRangeCues).toEqual([
      expect.objectContaining({ cueId: 'voice', fontSizePx: 24, secondaryFontSizePx: 14, frameStart: 5, frameEnd: 12, fontSizeMode: 'fixed' }),
      expect.objectContaining({ cueId: 'pan', fontSizePx: 32, secondaryFontSizePx: 12, frameStart: 5, frameEnd: 14, fontSizeMode: 'fixed' }),
    ])
  })
}
