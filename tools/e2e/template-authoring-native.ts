import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, type Locator, type Page } from '@playwright/test'
import { waitForPaperPaint } from './paper-paint-contract'

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((items, value, index, all) => {
  if (index % 2 === 0) items.push([value.replace(/^--/, ''), all[index + 1] ?? ''])
  return items
}, []))
for (const key of ['port', 'result', 'app-pid', 'python', 'screenshot-root']) if (!args[key]) throw new Error(`--${key} is required`)
const execFileAsync = promisify(execFile)
const mouseScript = fileURLToPath(new URL('./win-real-dnd/mouse_ops.py', import.meta.url))
const checks: string[] = [], artifacts: string[] = []
const operations: unknown[] = []
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`)
let page: Page | undefined
let pointer: { x: number; y: number } | null = null
let failed = false

async function native(command: string, ...values: string[]) {
  const { stdout } = await execFileAsync(args.python!, [mouseScript, command, ...values], { windowsHide: true, timeout: 20_000 })
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}')
  if (!result.ok) throw new Error(`Native operation failed: ${stdout}`)
  operations.push(result)
  return result
}
async function screenPoint(x: number, y: number) {
  const metrics = await native('window-client-metrics', '--app-pid', args['app-pid']!)
  const viewport = await page!.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) throw new Error('Input target is outside the WebView viewport')
  return { x: Math.round(metrics.client.x + x * metrics.client.width / viewport.width),
    y: Math.round(metrics.client.y + y * metrics.client.height / viewport.height) }
}
async function center(locator: Locator) {
  await locator.scrollIntoViewIfNeeded()
  const b = await locator.boundingBox()
  if (!b) throw new Error('Native input target has no visible bounds')
  return screenPoint(b.x + b.width / 2, b.y + b.height / 2)
}
async function click(locator: Locator) {
  const p = await center(locator)
  await native('click-screen', '--x', String(p.x), '--y', String(p.y), '--app-pid', args['app-pid']!)
}
async function move(p: { x: number; y: number }) {
  await native('mouse-move-screen', '--x', String(p.x), '--y', String(p.y), '--duration', '.2')
}
async function key(keys: string) { await native('key-press', '--keys', keys, '--app-pid', args['app-pid']!, '--preserve-focus') }
const paint = () => waitForPaperPaint({ evaluate: <T>(expression: string) => page!.evaluate<T>(expression) })
const readout = () => page!.locator('.templateEditorRectReadout').innerText()
async function screenshot(name: string) {
  const path = join(args['screenshot-root']!, name + '.png')
  await page!.screenshot({ path }); artifacts.push(path)
}
async function beginMove(dx: number, dy: number) {
  const handle = page!.locator('.templateHandleSvg')
  await move(await center(handle))
  const from = await center(page!.getByRole('button', { name: '選択要素を移動' }))
  await native('mouse-down-screen', '--x', String(from.x), '--y', String(from.y), '--app-pid', args['app-pid']!)
  pointer = { x: from.x + dx, y: from.y + dy }
  await move(pointer)
  await paint()
  await expect(page!.locator('.templateRegionSnapshotSvg')).toHaveAttribute('data-canvaskit-ready', 'true')
}
async function release() {
  if (!pointer) return
  const p = pointer; pointer = null
  await native('mouse-up-screen', '--x', String(p.x), '--y', String(p.y))
}

try {
  page = browser.contexts()[0]!.pages().find(p => !p.url().includes('devtools'))
  if (!page) throw new Error('No template WebView was found')
  await native('desktop-preflight', '--app-pid', args['app-pid']!)
  await click(page.getByRole('button', { name: '標準用紙を調整（おすすめ）' }))
  await paint()
  await click(page.locator('.templateZoomFloatingPalette button').first())
  await click(page.getByRole('button', { name: '全体表示', exact: true }))
  await paint()
  const initial = await readout()
  await beginMove(-4, 5)
  const first = await page.locator('.templateRegionSnapshotSvg path').evaluateAll(nodes => nodes.map(n => n.getAttribute('d')))
  const builds = await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')
  pointer = { x: pointer!.x - 2, y: pointer!.y + 2 }
  await move(pointer); await paint()
  expect(await page.locator('.templateRegionSnapshotSvg path').evaluateAll(nodes => nodes.map(n => n.getAttribute('d')))).toEqual(first)
  expect(await page.locator('.templateStaticPreviewSvg').getAttribute('data-canvaskit-scene-builds')).toBe(builds)
  await screenshot('timeline-live-drag')
  await release(); await paint()
  const moved = await readout()
  expect(moved).not.toBe(initial)
  await key('^z'); expect(await readout()).toBe(initial)
  await expect(page.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled()
  await key('^y'); expect(await readout()).toBe(moved)
  checks.push('real mouse timeline drag shows live content without rebuilding static paths; native undo/redo restores one complete gesture')

  await move(await center(page.locator('.templateHandleSvg')))
  const edge = await center(page.locator('.templateHandleKnob.vertical').last())
  await native('mouse-down-screen', '--x', String(edge.x), '--y', String(edge.y), '--app-pid', args['app-pid']!)
  pointer = { x: edge.x - 8, y: edge.y }; await move(pointer); await paint()
  expect(await readout()).not.toBe(moved)
  await screenshot('timeline-live-resize')
  await key('{ESC}'); await release()
  expect(await readout()).toBe(moved)
  checks.push('real mouse resize previews grid geometry; Escape rolls it back without changing the document')

  await click(page.getByRole('button', { name: 'MEMO', exact: true }))
  const memo = await readout()
  await beginMove(5, 5); await screenshot('memo-live-drag'); await release(); await paint()
  expect(await readout()).not.toBe(memo)
  await key('^z'); expect(await readout()).toBe(memo)
  await move(await screenPoint(4, 4))
  await expect(page.locator('.templateEditAffordances')).toBeHidden()
  checks.push('ordinary MEMO region uses the same real mouse movement and undo; handles disappear outside the canvas')

  await click(page.getByRole('button', { name: '6秒タイムライン表', exact: true }))
  const beforeNumber = await readout()
  const numberField = page.getByRole('spinbutton', { name: '6秒タイムライン表 X mm' })
  await click(numberField); await key('^a7'); await paint()
  const afterNumber = await readout()
  expect(afterNumber).not.toBe(beforeNumber)
  await beginMove(-4, 5); await release(); await paint()
  await expect(numberField).toBeFocused()
  expect(await readout()).not.toBe(afterNumber)
  await key('^z'); expect(await readout()).toBe(afterNumber)
  await key('^z'); expect(await readout()).toBe(beforeNumber)
  checks.push('native numeric entry and the following focus-preserving canvas drag undo independently')
  await move(await screenPoint(4, 4))
  await screenshot('template-final')
  await writeFile(args.result!, JSON.stringify({ passed: true, checks, artifacts, operations }, null, 2))
  console.log(`[template-native] passed ${checks.length} checks using ${operations.length} native operations`)
} catch (error) {
  failed = true
  await release().catch(() => undefined)
  if (page) await screenshot('template-failure').catch(() => undefined)
  await writeFile(args.result!, JSON.stringify({ passed: false, checks, artifacts, operations, error: String(error) }, null, 2))
  console.error(error)
} finally { await browser.close() }
if (failed) process.exitCode = 1
