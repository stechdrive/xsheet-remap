import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium, expect, type Locator, type Page } from '@playwright/test'
import { cellRectForHit, standardA3SheetTemplate, timingHitForFrame } from '@xsheet-remap/core'
import { waitForPaperPaint } from './paper-paint-contract'
import { verifyNativeFileDrop } from './win-real-dnd/native-file-drop-contract'
import { parseNativeDropOptions } from './win-real-dnd/options'
import { assertCurrentRemapSurface } from '../verification/desktop-evidence.mjs'

const args = parseNativeDropOptions(process.argv.slice(2))
for (const name of ['port', 'result', 'report', 'app-pid', 'python', 'screenshot-root', 'folder', 'multi-folder', 'allowed-root', 'scenario-id']) {
  if (!args[name]) throw new Error(`--${name} is required`)
}
if (args.mode !== 'remap' || !['registered-cell', 'explorer-import'].includes(args['test-case'] ?? '')) throw new Error('Current Remap acceptance requires an explicit supported scenario')
const exec = promisify(execFile)
const mouseScript = join(process.cwd(), 'tools/e2e/win-real-dnd/mouse_ops.py')
const checks: string[] = [], artifacts: string[] = [], operations: unknown[] = []
const diagnostics: Record<string, unknown> = {}
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`)
let page: Page | undefined, pointer: { x: number; y: number } | null = null
let passed = false, failure: string | undefined
let launchedUrl = ''

async function native(command: string, ...values: string[]) {
  const { stdout } = await exec(args.python!, [mouseScript, command, ...values], { windowsHide: true, timeout: 20_000 })
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}')
  if (!result.ok) throw new Error(`Native input failed: ${stdout}`)
  operations.push(result)
  return result
}
const driver = { evaluate: <T>(expression: string) => page!.evaluate<T>(expression) }
const paint = () => waitForPaperPaint(driver)
async function screenPoint(x: number, y: number) {
  const metrics = await native('window-client-metrics', '--app-pid', args['app-pid']!)
  const viewport = await page!.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  if (x < 0 || y < 0 || x >= viewport.width || y >= viewport.height) throw new Error('Native target is outside the viewport')
  return { x: Math.round(metrics.client.x + x * metrics.client.width / viewport.width),
    y: Math.round(metrics.client.y + y * metrics.client.height / viewport.height) }
}
async function center(locator: Locator) {
  await expect(locator).toBeVisible()
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  if (!box) throw new Error('Native target has no bounds')
  await expect.poll(() => locator.evaluate(el => {
    const box = el.getBoundingClientRect(), pointed = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    return pointed === el || Boolean(pointed && el.contains(pointed))
  })).toBe(true)
  return screenPoint(box.x + box.width / 2, box.y + box.height / 2)
}
async function click(locator: Locator) {
  const p = await center(locator)
  await native('click-screen', '--x', String(p.x), '--y', String(p.y), '--app-pid', args['app-pid']!)
}
async function key(keys: string) { await native('key-press', '--keys', keys, '--app-pid', args['app-pid']!, '--preserve-focus') }
async function down(p: { x: number; y: number }) {
  await native('mouse-down-screen', '--x', String(p.x), '--y', String(p.y), '--app-pid', args['app-pid']!)
  pointer = p
}
async function move(p: { x: number; y: number }) {
  pointer = p
  await native('mouse-move-screen', '--x', String(p.x), '--y', String(p.y), '--duration', '.5')
}
async function release() {
  if (!pointer) return
  const p = pointer; pointer = null
  await native('mouse-up-screen', '--x', String(p.x), '--y', String(p.y))
}
async function screenshot(name: string) {
  const file = join(args['screenshot-root']!, `${name}.png`)
  await page!.screenshot({ path: file }); artifacts.push(file)
}
async function surface(mode: 'sheet' | 'clip') {
  const value = await page!.evaluate(() => {
    const modes = Array.from(document.querySelectorAll('.remapWorkModes button'))
    const tree = document.querySelector('.clipLayerPanel')?.getBoundingClientRect()
    const sheet = document.querySelector('.sheetViewportFrame')?.getBoundingClientRect()
    return { url: location.href,
      sheetMode: modes.some(button => button.textContent === 'シート編集' && button.getAttribute('aria-pressed') === 'true'),
      clipMode: modes.some(button => button.textContent === 'CLIP組み立て' && button.getAttribute('aria-pressed') === 'true'),
      legacyAssetBrowser: Boolean(document.querySelector('.assetBrowser')), legacyCspTree: Boolean(document.querySelector('.cspLayerTree')),
      clipTreeVisible: Boolean(tree && tree.width > 0 && tree.height > 0),
      clipTreeOnRight: Boolean(tree && sheet && tree.left >= sheet.right - 1 && tree.right <= innerWidth) }
  })
  assertCurrentRemapSurface(value, mode, launchedUrl)
  diagnostics[`surface:${checks.length}:${mode}`] = value
}
async function workMode(mode: 'sheet' | 'clip') {
  await click(page!.getByRole('button', { name: mode === 'sheet' ? 'シート編集' : 'CLIP組み立て', exact: true }))
  await paint(); await surface(mode)
}
const row = (name: string) => page!.locator('.clipLayerRow').filter({ has: page!.locator('.clipLayerName', { hasText: new RegExp(`^${name}$`) }) })
const event = (frame: number) => page!.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"]`)
async function cell(frame: number) {
  const rect = cellRectForHit(standardA3SheetTemplate, timingHitForFrame(standardA3SheetTemplate, 'cell', 'A', frame)!)!
  const point = await page!.locator('.sheetSvg').first().evaluate((svg, r) => {
    const b = svg.getBoundingClientRect()
    return { x: b.x + (r.x + r.w / 2) * b.width, y: b.y + (r.y + r.h / 2) * b.height }
  }, rect)
  return screenPoint(point.x, point.y)
}
async function nativeDrop(paths: string[], target: Locator) {
  const point = await center(target)
  const result = await verifyNativeFileDrop(driver, paths, () => native(paths.length === 1 ? 'drag-explorer-item' : 'drag-explorer-items',
    ...paths.flatMap(path => ['--path', path]), '--allowed-root', args['allowed-root']!,
    '--to-x', String(point.x), '--to-y', String(point.y), '--app-pid', args['app-pid']!))
  diagnostics[`native-drop:${checks.length}`] = result
}
async function waitForLayers(names: string[]) {
  for (const name of names) {
    await expect(row(name)).toHaveCount(1)
    await expect(row(name)).toHaveAttribute('data-clip-layer-parent', 'slot:slot_A')
  }
}
async function fitSheet() {
  await click(page!.locator('.sheetZoomFloatingPalette .floatingHoverPaletteTrigger'))
  await click(page!.locator('.sheetZoomFloatingPalette .zoomFitButton'))
  await key('{ESC}'); await paint()
}
async function rangeDrag() {
  await workMode('sheet')
  await fitSheet()
  const p = await cell(3)
  await native('click-screen', '--x', String(p.x), '--y', String(p.y), '--app-pid', args['app-pid']!)
  await key('2{ENTER}')
  await expect(event(3).locator('.eventText')).toHaveText('2')
  // Read all four cells in one snapshot; absent events are legitimate empty cells.
  const state = () => page!.evaluate(() => [1, 3, 9, 11].map(frame => document.querySelector(`[data-timeline-event-role="cell"][data-timeline-event-track="A"][data-timeline-event-frame="${frame}"] .eventText`)?.textContent ?? null))
  const before = await state(), moved = [null, null, before[0], before[1]]
  expect(before).toEqual(['1', '2', null, null])
  for (const outcome of ['escape', 'outside', 'commit'] as const) {
    await key('{ESC}')
    await down(await cell(4)); await move(await cell(1)); await release()
    await expect(page!.locator('.statusBar span').first()).toContainText('CELL A 001-004')
    await down(await cell(3)); await move(await cell(11))
    const status = page!.locator('.timingDragStatus')
    await expect(status).toHaveAttribute('data-drag-validity', 'valid')
    await expect(status).toContainText('A 001–004 → A 009–012')
    await expect(page!.locator('.timingDragGhostCell')).toHaveCount(2)
    expect(await state()).toEqual(before)
    await screenshot(`current-range-${outcome}-preview`)
    if (outcome === 'escape') await key('{ESC}')
    if (outcome === 'outside') {
      await move(await screenPoint(3, 3))
      await expect(status).toHaveAttribute('data-drag-validity', 'invalid')
    }
    await release()
    await expect(page!.locator('.timingDragPreview, .timingDragStatus')).toHaveCount(0)
    await expect(page!.locator('body')).not.toHaveClass(/sheetInteractionActive/)
    expect(await state()).toEqual(outcome === 'commit' ? moved : before)
    checks.push(`current sheet native range ${outcome}: offset, deferred commit and pointer cleanup`)
  }
  await key('^z'); await expect.poll(state).toEqual(before)
  await key('^y'); await expect.poll(state).toEqual(moved)
  await screenshot('current-range-redo')
  await surface('sheet')
  checks.push('one native Undo and Redo restores the entire moved range in the normal sheet mode')
}

try {
  page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://tauri.localhost/'))
  if (!page) throw new Error('Normal Remap WebView not found')
  launchedUrl = page.url()
  diagnostics.appEntry = { launchedUrl, setup: 'unchanged normal entry; no legacy fixture or navigation' }
  await expect(page.getByRole('button', { name: 'シート編集', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await paint(); await surface('sheet')
  await native('desktop-preflight', '--app-pid', args['app-pid']!)
  await page.evaluate(() => { (window as Window & { __xsheetDropDiagnostics: unknown[] }).__xsheetDropDiagnostics = [] })
  checks.push('normal Remap entry starts in sheet mode without legacy assets or CSP panes')
  await screenshot('current-sheet-start')
  await workMode('clip')
  const folder = page.locator('[data-clip-layer-id="slot:slot_A"]')
  await click(folder.locator('.clipLayerName'))
  if (await folder.locator('..').getAttribute('aria-expanded') !== 'true') await click(folder.locator('.clipLayerDisclosure'))
  await fitSheet()
  await screenshot('current-clip-before')
  if (args['test-case'] === 'explorer-import') {
    await nativeDrop([args.folder!], folder.locator('.clipLayerName'))
    await waitForLayers(['A1', 'A1_e', 'A2', 'sheet_001'])
    checks.push('one real Explorer folder drop imports all four images into animation folder A in the right CLIP tree')
    await nativeDrop([join(args['multi-folder']!, 'Multi_A1.png'), join(args['multi-folder']!, 'Multi_A2.png')], folder.locator('.clipLayerName'))
    await waitForLayers(['Multi_A1', 'Multi_A2'])
    checks.push('one real Explorer multi-file drop delivers exactly both selected paths and registers both CLIP layers')
    await click(row('A1').getByRole('button', { name: 'A1をクイックルック', exact: true }))
    const preview = page.getByRole('dialog', { name: 'A1のプレビュー', exact: true })
    await expect(preview.locator('img')).toBeVisible()
    await expect.poll(() => preview.locator('img').evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true)
    await screenshot('current-explorer-quick-look')
    await key('{ESC}'); await expect(preview).toHaveCount(0)
    await surface('clip'); await screenshot('current-explorer-imported')
    checks.push('the imported native image decodes in Quick Look and Escape returns to the current CLIP tree')
  } else {
    await nativeDrop([join(args.folder!, 'A1.png')], folder.locator('.clipLayerName'))
    await waitForLayers(['A1'])
    checks.push('creates the drag source through an actual Explorer drop into the current CLIP tree')
    const source = row('A1').locator('.clipLayerThumbnail')
    await down(await center(source)); await move(await cell(1))
    await expect(page.locator('.pointerDragGhost')).toContainText('A1')
    await expect(page.locator('.sheetDropTargetCue')).toHaveAttribute('data-drop-validity', 'valid')
    await expect(event(1)).toHaveCount(0)
    await screenshot('current-clip-drag-preview')
    await release()
    await expect(page.locator('.pointerDragGhost')).toHaveCount(0)
    await expect(event(1).locator('.eventText')).toHaveText('1')
    await expect(page.locator('.sheetViewport')).toBeFocused()
    await key('^z'); await expect(event(1)).toHaveCount(0)
    await key('^y'); await expect(event(1).locator('.eventText')).toHaveText('1')
    await waitForLayers(['A1'])
    checks.push('native right-tree layer drag assigns CELL A 001 and immediate Undo/Redo preserves the imported layer')
    await rangeDrag()
    await workMode('clip'); await waitForLayers(['A1']); await screenshot('current-clip-after-history')
    checks.push('switching back to CLIP assembly preserves the source layer after sheet range edits')
  }
  passed = true
} catch (error) {
  failure = String(error)
  if (page) await screenshot('failure').catch(() => undefined)
  console.error(error)
} finally {
  await release().catch(() => undefined)
  const result = { passed, scenario: args['scenario-id'], testCase: args['test-case'], inputMode: 'native-mouse-keyboard-explorer-with-protocol-observation',
    checks, diagnostics, operations, artifacts, error: failure, failureKind: failure ? 'current-remap-acceptance' : null }
  await writeFile(args.report!, JSON.stringify(result, null, 2) + '\n')
  await writeFile(args.result!, JSON.stringify(result, null, 2) + '\n')
  await browser.close()
}
console.log(`[current-remap-native] ${passed ? 'passed' : 'failed'} ${checks.length} checks using ${operations.length} native operations`)
if (!passed) process.exitCode = 1

