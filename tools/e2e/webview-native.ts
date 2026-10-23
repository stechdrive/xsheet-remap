import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect, type Page } from '@playwright/test'
import { activeCutProjectFromDocument, createDefaultProject, createProjectDocumentFromCutProject } from '../../packages/core/src/index'
import { decodeProjectFileBytes, encodeProjectArchive } from '../../packages/adapters/src/projectArchive'
import { sourceIdentity, sha256 } from '../verification/evidence.mjs'
import { webviewArtifact } from '../verification/webview-evidence.mjs'
import { clipLayerNamed, enterClipAssembly } from './clip-workspace'
import { assertSupportedRuntime, runtimeIdentity } from '../checks/runtime.mjs'
import { prepareNativeClipDrop, verifyNativeClipDrop } from './webview-clip-drop'

const root = process.cwd(), [stage, run, baseline] = process.argv.slice(2)
assertSupportedRuntime(runtimeIdentity())
if (!['prepare', 'execute'].includes(stage) || !run || process.argv.length > 6) throw new Error('Usage: webview-native.ts prepare|execute <run-directory> [baseline-commit]')
const parent = path.resolve(root, 'reference-local/webview-native')
if (!path.resolve(run).startsWith(parent + path.sep) || fs.existsSync(run) && fs.lstatSync(run).isSymbolicLink()) throw new Error('Run must stay in reference-local/webview-native')
const write = (name: string, value: unknown) => fs.writeFileSync(path.join(run, name), JSON.stringify(value, null, 2) + '\n')
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
if (stage === 'prepare') {
  const provenance = webviewArtifact(root, sourceIdentity(root), baseline ?? null)
  fs.mkdirSync(run, { recursive: false })
  for (const dir of ['assets', 'temp', 'screenshots']) fs.mkdirSync(path.join(run, dir))
  fs.writeFileSync(path.join(run, 'assets', 'native-pixel.png'), imageBytes)
  const project = createDefaultProject(); project.cut.cut = 'WEBVIEW_NATIVE_BOUNDARY'
  fs.writeFileSync(path.join(run, 'document.xsr'), await encodeProjectArchive(createProjectDocumentFromCutProject(project)))
  await prepareNativeClipDrop(run)
  write('prepared.json', { schemaVersion: 1, scenarioVersion: 2, preparedAt: new Date().toISOString(), ...provenance })
  console.log(`[webview] prepared ${provenance.scope}: ${provenance.testedSourceCommit}`)
} else {
  const prepared = JSON.parse(fs.readFileSync(path.join(run, 'prepared.json'), 'utf8'))
  const report: Record<string, unknown> = { ...prepared, phase: 'webview-native', inputMode: 'cdp-and-tauri-event-injection',
    injectionBoundary: 'plugin:event|emit tauri://drag-drop; native OS receipt is NOT exercised',
    status: 'failed', startedAt: new Date().toISOString(), checks: [] }
  const checks = report.checks as string[], errors: string[] = []
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined, page: Page | undefined
  try {
    const current = webviewArtifact(root, sourceIdentity(root), prepared.scope === 'baseline-diagnostic' ? prepared.testedSourceCommit : null)
    assert.deepEqual(current, { artifact: prepared.artifact, scope: prepared.scope, testedSourceCommit: prepared.testedSourceCommit, harnessIdentity: prepared.harnessIdentity })
    const port = Number(process.env.XSHEET_WEBVIEW_TEST_PORT)
    assert(Number.isInteger(port) && port > 0)
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null))?.ok, { timeout: 20_000 }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    await expect.poll(() => context.pages().some(p => p.url().includes('app=remap')), { timeout: 20_000 }).toBe(true)
    page = context.pages().find(p => p.url().includes('app=remap'))!
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push(String(error)))
    let resettingFixture = false
    page.on('dialog', dialog => {
      // Importing a CLIP creates unsaved work. Only the explicit fixture reset
      // may accept its beforeunload confirmation; other dialogs still fail.
      if (resettingFixture && dialog.type() === 'beforeunload') {
        resettingFixture = false
        void dialog.accept()
      } else { errors.push(`Unexpected browser dialog: ${dialog.message()}`); void dialog.dismiss() }
    })
    async function reloadFixture() {
      resettingFixture = true
      try { await page!.reload() } finally { resettingFixture = false }
    }
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    report.runtime = { webview2: browser.version(), playwright: JSON.parse(fs.readFileSync('node_modules/playwright/package.json', 'utf8')).version,
      ...(await page.evaluate(() => ({ userAgent: navigator.userAgent, devicePixelRatio, url: location.href, viewport: { width: innerWidth, height: innerHeight } }))) }
    const nativeFile = path.join(run, 'assets/native-pixel.png'), projectFile = path.join(run, 'document.xsr')
    async function drop(paths: string[], position = { x: 100, y: 100 }) {
      await page!.evaluate(async ({ paths, position }) => {
        const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
        await bridge.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { type: 'drop', paths, position } })
      }, { paths, position })
    }
    await drop([projectFile])
    await expect(page.getByLabel('カット情報', { exact: true })).toContainText('WEBVIEW_NATIVE_BOUNDARY')
    checks.push('native XSR read through normal project-drop routing')
    await enterClipAssembly(page)
    const target = page.locator('[data-clip-layer-id="slot:slot_A"]')
    await target.scrollIntoViewIfNeeded()
    const position = await target.evaluate(element => {
      const r = element.getBoundingClientRect()
      return { x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio }
    })
    // A self-contained JS expression avoids tsx's module-local function-name helpers in the WebView.
    const boundary = await page.evaluate(`(async () => {
      const url = window.__TAURI_INTERNALS__.convertFileSrc(${JSON.stringify(nativeFile)}, 'asset')
      const read = async (cors) => {
        const image = new Image(); if (cors) image.crossOrigin = 'anonymous'; image.src = url; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0)
        return Array.from(ctx.getImageData(0, 0, 1, 1).data)
      }
      let withoutCors = 'unexpectedly readable'
      try { await read(false) } catch (error) { withoutCors = error instanceof Error ? error.name : String(error) }
      return { url, nativeOrigin: new URL(url).origin, pageOrigin: location.origin, withoutCors, pixels: await read(true) }
    })()`)
    assert.notEqual(boundary.nativeOrigin, boundary.pageOrigin)
    assert.equal(boundary.withoutCors, 'SecurityError'); assert.deepEqual(boundary.pixels, [255, 0, 0, 255])
    report.nativeImage = boundary
    checks.push('real native asset URL: CORS pixels readable; no-CORS control throws SecurityError')
    // Reproduce the historical missing-CORS bug in this isolated page, without editing product code.
    // Restore the descriptor before any positive operation. No errors are swallowed by the application test.
    await page.evaluate(`(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'crossOrigin')
      window.restoreCors = () => Object.defineProperty(HTMLImageElement.prototype, 'crossOrigin', descriptor)
      Object.defineProperty(HTMLImageElement.prototype, 'crossOrigin', { ...descriptor, set() {} })
    })()`)
    await drop([nativeFile], position)
    await expect(page.getByText(/Tainted canvases may not be exported|tainted by cross-origin data/)).toBeVisible()
    const imported = clipLayerNamed(page, 'native-pixel')
    await expect(imported).toHaveCount(0)
    await page.screenshot({ path: path.join(run, 'screenshots/cors-negative.png') })
    await page.evaluate(() => (window as unknown as { restoreCors: () => void }).restoreCors())
    checks.push('production import rejects omitted CORS with no registered layer (fault injection)')
    // Distinct physical position separates the corrective action from native duplicate suppression.
    await drop([nativeFile], { x: position.x + 2, y: position.y })
    await expect(imported).toHaveCount(1)
    await page.keyboard.press('Control+s')
    await expect.poll(async () => {
      const saved = await decodeProjectFileBytes(new Uint8Array(fs.readFileSync(projectFile)))
      return activeCutProjectFromDocument(saved.document).clipDocument?.nodes.filter(node => node.name === 'native-pixel').length
    }).toBe(1)
    const savedBytes = fs.readFileSync(projectFile), saved = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(savedBytes))).document)
    const dataUrl = saved.clipDocument!.nodes.find(node => node.name === 'native-pixel')!.imageDataUrl!
    assert(dataUrl.startsWith('data:image/png;base64,'))
    const embeddedPixels = await page.evaluate(async url => {
      const image = new Image(); image.src = url; await image.decode()
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      return Array.from(ctx.getImageData(0, 0, 1, 1).data)
    }, dataUrl)
    assert.deepEqual(embeddedPixels, boundary.pixels)
    report.savedProject = { sha256: sha256(savedBytes), embeddedPixels }
    checks.push('native import embeds exact pixels; Ctrl+S uses native file IPC and saves an XSR archive')
    await page.reload()
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await drop([projectFile])
    await expect(page.getByLabel('カット情報', { exact: true })).toContainText('WEBVIEW_NATIVE_BOUNDARY')
    await enterClipAssembly(page)
    await expect(imported).toHaveCount(1)
    await imported.scrollIntoViewIfNeeded()
    await expect(imported).toBeVisible()
    await page.screenshot({ path: path.join(run, 'screenshots/reopened.png') })
    checks.push('fresh document load restores the registered layer in the current CLIP tree')
    await verifyNativeClipDrop(page, run, drop, reloadFixture)
    checks.push('native CLIP paths open through document-drop routing; ACTION/CELL overflow uses its own grid edge')
    assert.deepEqual(errors, [])
    assert.deepEqual(sourceIdentity(root), prepared.harnessIdentity, 'Harness/source changed during the run')
    assert.equal(sha256(fs.readFileSync(prepared.artifact.executable)), prepared.artifact.sha256)
    report.status = 'passed'
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error)
    if (page) {
      await page.screenshot({ path: path.join(run, 'screenshots/failure.png') }).catch(() => {})
      write('failure-ui.json', { text: await page.locator('body').innerText().catch(() => ''), errors })
    }
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString(); report.pageErrors = errors
    report.screenshots = fs.readdirSync(path.join(run, 'screenshots')).map(file => ({
      path: `screenshots/${file}`, sha256: sha256(fs.readFileSync(path.join(run, 'screenshots', file))),
    }))
    write('result.json', report)
    await browser?.close()
    console.log(`[webview] ${report.status}: ${checks.length} checks; ${run}`)
  }
}
