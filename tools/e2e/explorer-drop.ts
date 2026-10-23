import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect, type Page } from '@playwright/test'
import { activeCutProjectFromDocument, createDefaultProject, createProjectDocumentFromCutProject } from '../../packages/core/src/index'
import { decodeProjectFileBytes, encodeProjectArchive } from '../../packages/adapters/src/projectArchive'
import { sha256, sourceIdentity } from '../verification/evidence.mjs'
import { webviewArtifact } from '../verification/webview-evidence.mjs'
import { explorerScenarios } from '../verification/desktop-scenarios.mjs'
import { evidenceFiles } from '../verification/layered-desktop.mjs'
import { assertSupportedRuntime, runtimeIdentity } from '../checks/runtime.mjs'
import { clipLayerNamed, enterClipAssembly } from './clip-workspace'

const root = process.cwd(), [stage, run] = process.argv.slice(2)
assertSupportedRuntime(runtimeIdentity())
const parent = path.resolve(root, 'reference-local/explorer-drop')
assert(run && path.resolve(run).startsWith(parent + path.sep), 'Evidence must stay inside explorer-drop')
assert(!fs.existsSync(run) || !fs.lstatSync(run).isSymbolicLink())
const write = (name: string, value: unknown) => {
  const file = path.join(run, name)
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2) + '\n')
  fs.renameSync(`${file}.tmp`, file)
}
const read = (name: string) => JSON.parse(fs.readFileSync(path.join(run, name), 'utf8').replace(/^\uFEFF/, ''))
const specifications = [
  { id: 'folder-drop', folder: 'folder-source', selection: ['CU_CUT'], images: ['A1', 'A2', 'A3'] },
  { id: 'multiple-file-drop', folder: 'multiple-source', selection: ['B1.png', 'B2.png'], images: ['B1', 'B2'] },
]
const expected = Object.fromEntries(explorerScenarios)
if (stage === 'prepare') {
  assert(!fs.existsSync(run), 'Do not overwrite previous evidence')
  const provenance = webviewArtifact(root, sourceIdentity(root), null, 'remap', process.env.XSHEET_WORKING_TREE_DIAGNOSTIC === '1')
  fs.mkdirSync(path.join(run, 'screenshots'), { recursive: true })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  for (const relative of ['folder-source/CU_CUT/A1.png', 'folder-source/CU_CUT/A2.png', 'folder-source/CU_CUT/nested/A3.png', 'multiple-source/B1.png', 'multiple-source/B2.png', 'multiple-source/Unselected.png']) {
    const file = path.join(run, relative); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, png)
  }
  for (const spec of specifications) {
    const project = createDefaultProject(); project.cut.cut = spec.id
    fs.writeFileSync(path.join(run, `${spec.id}.xsr`), await encodeProjectArchive(createProjectDocumentFromCutProject(project)))
  }
  write('prepared.json', { schemaVersion: 1, scenarioVersion: 1, preparedAt: new Date().toISOString(), ...provenance, specifications,
    inputTool: { name: 'Win32.SendInput + ShellFolderView/UIAutomation', version: sha256(fs.readFileSync('tools/e2e/explorer-input.cs')) } })
} else if (stage === 'finish') {
  const report = read('result.json'), os = read('os-observation.json')
  assert.equal(report.status, 'passed'); assert.equal(os.error, null)
  assert.equal(os.windowsClosed, true); assert.equal(os.ownedProcessesExited, true)
  assert.equal(os.inputDesktopBefore, os.inputDesktopAfter)
  assert.deepEqual(sourceIdentity(root), report.harnessIdentity)
  const files = evidenceFiles(run, [...fs.readdirSync(path.join(run, 'screenshots')).map(file => `screenshots/${file}`),
    ...specifications.flatMap(spec => [`${spec.id}-input.json`, `${spec.id}-geometry.json`, `${spec.id}.xsr`]), 'trace.zip', 'os-observation.json'])
  write('result.json', { ...report, startedAt: os.startedAt, finishedAt: new Date().toISOString(), files })
} else if (stage === 'execute') {
  const prepared = read('prepared.json'), errors: string[] = [], cases: Record<string, unknown>[] = []
  const report: Record<string, unknown> = { ...prepared, status: 'failed', inputMode: 'os-input', osDropReceipt: false,
    selectionMode: 'ShellFolderView.SelectItem', pointerMode: 'Win32.SendInput', assertionMode: 'WebView2 CDP + saved XSR bytes',
    startedAt: new Date().toISOString(), cases }
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined, page: Page | undefined
  try {
    const port = Number(process.env.XSHEET_WEBVIEW_TEST_PORT)
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null))?.ok, { timeout: 20_000 }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    await expect.poll(() => context.pages().filter(p => p.url().includes('app=remap')).length).toBe(1)
    page = context.pages().find(p => p.url().includes('app=remap'))!
    page.setDefaultTimeout(10_000)
    page.on('pageerror', error => errors.push(String(error)))
    const session = await browser.newBrowserCDPSession()
    const command = await session.send('Browser.getBrowserCommandLine')
    assert(command.arguments.some(arg => arg.toLowerCase().includes(path.join(run, 'profile').toLowerCase())))
    report.profileVerified = true
    report.runtime = { webview2: browser.version(), playwright: JSON.parse(fs.readFileSync('node_modules/playwright/package.json', 'utf8')).version }
    for (const spec of specifications) {
      const item: Record<string, unknown> = { id: spec.id, artifact: 'remap', inputMode: 'os-input', expected: expected[spec.id], status: 'failed', startedAt: new Date().toISOString() }
      cases.push(item)
      if (spec !== specifications[0]) await page.reload()
      await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
      const projectFile = path.join(run, `${spec.id}.xsr`)
      // This single injected project-open event is fixture setup only. No image
      // paths are injected: both acceptance operations below use Explorer/OS input.
      await page.evaluate(async file => {
        const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
        await bridge.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { type: 'drop', paths: [file], position: { x: 100, y: 100 } } })
      }, projectFile)
      await expect(page.getByLabel('カット情報', { exact: true })).toContainText(spec.id)
      await enterClipAssembly(page)
      await page.evaluate(`(async () => {
        window.__xsheetObservedDrops=[];
        const bridge=window.__TAURI_INTERNALS__;
        await bridge.invoke('plugin:event|listen',{event:'tauri://drag-drop',target:{kind:'Any'},handler:bridge.transformCallback(event=>window.__xsheetObservedDrops.push(event.payload))});
      })()`)
      write(`${spec.id}-open.json`, { folder: path.join(run, spec.folder), selection: spec.selection })
      await expect.poll(() => fs.existsSync(path.join(run, `${spec.id}-ready.json`)), { timeout: 20_000 }).toBe(true)
      const ready = read(`${spec.id}-ready.json`)
      await expect.poll(async () => {
        const size = await page!.evaluate(() => [innerWidth * devicePixelRatio, innerHeight * devicePixelRatio])
        return Math.max(Math.abs(size[0] - ready.clientBounds[2]), Math.abs(size[1] - ready.clientBounds[3]))
      }).toBeLessThanOrEqual(3)
      const target = page.locator('[data-clip-layer-id="slot:slot_A"]')
      await target.scrollIntoViewIfNeeded()
      const position = await target.evaluate(element => {
        const r = element.getBoundingClientRect()
        return { x: (r.x + r.width * .6) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio,
          viewport: { width: innerWidth * devicePixelRatio, height: innerHeight * devicePixelRatio } }
      })
      write(`${spec.id}-drop.json`, { position })
      await expect.poll(() => fs.existsSync(path.join(run, `${spec.id}-input.json`)), { timeout: 15_000 }).toBe(true)
      const input = read(`${spec.id}-input.json`)
      assert.equal(input.status, 'sent'); assert.equal(input.attempts, 1)
      await expect.poll(() => page!.evaluate('window.__xsheetObservedDrops.length')).toBe(1)
      const drops: { paths: string[] }[] = await page.evaluate('window.__xsheetObservedDrops')
      const normalize = (paths: string[]) => paths.map(p => path.resolve(p).toLowerCase()).sort()
      assert.deepEqual(normalize(drops[0].paths), normalize(spec.selection.map(name => path.join(run, spec.folder, name))))
      for (const name of spec.images) await expect(clipLayerNamed(page, name)).toHaveCount(1)
      await expect(clipLayerNamed(page, 'Unselected')).toHaveCount(0)
      // Ctrl+S goes through the real app shortcut and native file write. Decode
      // the resulting archive independently to detect partial/extra imports.
      const before = sha256(fs.readFileSync(projectFile))
      await page.keyboard.press('Control+s')
      await expect.poll(() => sha256(fs.readFileSync(projectFile))).not.toBe(before)
      const bytes = fs.readFileSync(projectFile)
      const saved = activeCutProjectFromDocument((await decodeProjectFileBytes(new Uint8Array(bytes))).document)
      const images = saved.clipDocument!.nodes.filter(node => node.imageDataUrl)
      assert.deepEqual(images.map(node => node.name).sort(), [...spec.images].sort())
      const pixels = await page.evaluate(async urls => Promise.all(urls.map(async url => {
        const image = new Image(); image.src = url; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
        const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
        return { width: image.naturalWidth, height: image.naturalHeight, rgba: Array.from(ctx.getImageData(0, 0, 1, 1).data) }
      })), images.map(node => node.imageDataUrl!))
      assert(pixels.every(pixel => pixel.width === 1 && pixel.height === 1 && JSON.stringify(pixel.rgba) === '[255,0,0,255]'))
      await page.screenshot({ path: path.join(run, `screenshots/${spec.id}-result.png`) })
      Object.assign(item, { status: 'passed', finishedAt: new Date().toISOString(), input, observedDrops: drops,
        importedNames: images.map(node => node.name), excludedNames: ['Unselected'], pixels, savedProject: { path: `${spec.id}.xsr`, sha256: sha256(bytes) } })
      write(`${spec.id}-complete.json`, { status: 'passed' })
      console.log(`[explorer] ${spec.id} passed with one OS drop`)
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(sourceIdentity(root), prepared.harnessIdentity)
    assert.equal(sha256(fs.readFileSync(prepared.artifact.executable)), prepared.artifact.sha256)
    report.status = 'passed'; report.osDropReceipt = true
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1
    if (page) {
      await page.screenshot({ path: path.join(run, 'screenshots/failure.png') }).catch(() => {})
      write('failure-ui.json', { body: await page.locator('body').innerText().catch(() => ''), drops: await page.evaluate('window.__xsheetObservedDrops').catch(() => []), errors })
    }
  } finally {
    await browser?.contexts()[0].tracing.stop({ path: path.join(run, 'trace.zip') }).catch(() => {})
    report.finishedAt = new Date().toISOString(); report.pageErrors = errors
    report.screenshots = fs.readdirSync(path.join(run, 'screenshots')).map(file => ({ path: `screenshots/${file}`, sha256: sha256(fs.readFileSync(path.join(run, 'screenshots', file))) }))
    write('result.json', report)
    await browser?.close()
  }
} else throw new Error('Usage: explorer-drop.ts prepare|execute|finish <run>')
