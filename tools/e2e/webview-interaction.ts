import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect, type Page, type BrowserContext } from '@playwright/test'
import { createDefaultProject, createProjectDocumentFromCutProject, standardA3SheetTemplate, timingHitForFrame, cellRectForHit } from '../../packages/core/src/index'
import { encodeProjectArchive } from '../../packages/adapters/src/projectArchive'
import { sourceIdentity, sha256 } from '../verification/evidence.mjs'
import { webviewArtifact } from '../verification/webview-evidence.mjs'
import { webviewScenarios, scenarioApp } from '../verification/desktop-scenarios.mjs'
import { evidenceFiles } from '../verification/layered-desktop.mjs'
import { assertSupportedRuntime, runtimeIdentity } from '../checks/runtime.mjs'
import { waitForPaperPaint } from './paper-paint-contract'
import { clipLayerNamed, enterClipAssembly } from './clip-workspace'

const root = process.cwd(), [stage, run, argument] = process.argv.slice(2)
assertSupportedRuntime(runtimeIdentity())
const parent = path.resolve(root, 'reference-local/webview-interaction')
assert(run && path.resolve(run).startsWith(parent + path.sep), 'Evidence must remain in webview-interaction')
assert(!fs.existsSync(run) || !fs.lstatSync(run).isSymbolicLink())
const expectations = Object.fromEntries(webviewScenarios)
const fault = process.env.XSHEET_INTERACTION_FAULT || null
assert(!fault || Object.hasOwn(expectations, fault), 'Unknown fault scenario')
const write = (file: string, value: unknown) => fs.writeFileSync(path.join(run, file), JSON.stringify(value, null, 2) + '\n')
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(run, file), 'utf8').replace(/^\uFEFF/, ''))
const paint = (page: Page) => waitForPaperPaint({ evaluate: <T>(source: string) => page.evaluate<T>(source) })
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')

if (stage === 'prepare') {
  assert(!fs.existsSync(run), 'Never overwrite a previous verification run')
  const identity = sourceIdentity(root)
  const diagnostic = process.env.XSHEET_WORKING_TREE_DIAGNOSTIC === '1'
  const remap = webviewArtifact(root, identity, argument || null, 'remap', diagnostic)
  const corrector = webviewArtifact(root, identity, argument || null, 'corrector', diagnostic)
  assert.equal(remap.artifact.buildSessionId, corrector.artifact.buildSessionId, 'Both EXEs must share a build session')
  fs.mkdirSync(run, { recursive: true })
  fs.mkdirSync(path.join(run, 'screenshots'))
  fs.writeFileSync(path.join(run, '001.png'), png)
  const project = createDefaultProject(); project.cut.cut = 'INTERACTION_BOUNDARY'
  fs.writeFileSync(path.join(run, 'document.xsr'), await encodeProjectArchive(createProjectDocumentFromCutProject(project)))
  write('prepared.json', { schemaVersion: 1, scenarioVersion: 1, preparedAt: new Date().toISOString(), fault,
    scope: remap.scope, testedSourceCommit: remap.testedSourceCommit, harnessIdentity: identity,
    artifacts: { remap: remap.artifact, corrector: corrector.artifact } })
} else if (stage === 'finish') {
  const prepared = read('prepared.json')
  assert.equal(prepared.fault, null, 'Fault diagnostics cannot certify acceptance')
  const phases = ['corrector', 'remap'].map(app => ({ ...read(`${app}/result.json`), osObservation: read(`${app}/os-observation.json`) }))
  for (const phase of phases) {
    assert.equal(phase.status, 'passed')
    assert.equal(phase.osObservation.error, null)
    assert.equal(phase.osObservation.foregroundOwned, false)
    assert.equal(phase.osObservation.desktopReleased, true)
    assert.equal(phase.osObservation.inputDesktopBefore, phase.osObservation.inputDesktopAfter)
  }
  const cases = phases.flatMap(p => p.cases)
  assert.deepEqual(cases.map(c => c.id).sort(), Object.keys(expectations).sort())
  assert(cases.every(c => c.status === 'passed'))
  assert.deepEqual(sourceIdentity(root), prepared.harnessIdentity, 'Harness changed during verification')
  for (const artifact of Object.values(prepared.artifacts) as { executable: string; sha256: string }[]) assert.equal(sha256(fs.readFileSync(artifact.executable)), artifact.sha256)
  const files = evidenceFiles(run, [
    ...fs.readdirSync(path.join(run, 'screenshots')).map(file => `screenshots/${file}`),
    ...['corrector', 'remap'].flatMap(app => fs.readdirSync(path.join(run, app)).filter(file => /(?:result|os-observation)\.json$|trace\.zip$/.test(file)).map(file => `${app}/${file}`)),
  ])
  write('result.json', { ...prepared, status: 'passed', inputMode: 'cdp-and-native-ipc', osDropReceipt: false, cases, phases,
    startedAt: phases[0].osObservation.startedAt, finishedAt: new Date().toISOString(), files })
  console.log('[interaction] 11 functional observations passed; Explorer OS receipt remains separate')
} else if (stage === 'execute') {
  assert(argument === 'corrector' || argument === 'remap')
  const phase = argument, prepared = read('prepared.json'), port = Number(process.env.XSHEET_WEBVIEW_TEST_PORT)
  const cases: { id: string; expected: string; status: string; startedAt: string; finishedAt?: string; screenshot?: string; sha256?: string }[] = []
  const errors: string[] = [], report: Record<string, unknown> = { phase, fault, status: 'failed', startedAt: new Date().toISOString(), cases }
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined, currentPage: Page | undefined
  const childBrowsers: Awaited<ReturnType<typeof chromium.connectOverCDP>>[] = []
  try {
    await expect.poll(async () => (await fetch(`http://127.0.0.1:${port}/json/version`).catch(() => null))?.ok, { timeout: 20_000 }).toBe(true)
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
    const context = browser.contexts()[0]
    // Install before the application's capture listeners on fixture reloads.
    // A late document listener cannot disable a window capture shortcut.
    await context.addInitScript({ content: "window.addEventListener('keydown', event => { if (window.__xsheetFaultBlockKey) { event.preventDefault(); event.stopImmediatePropagation(); } }, true)" })
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true })
    const browserSession = await browser.newBrowserCDPSession()
    const commandLine = await browserSession.send('Browser.getBrowserCommandLine')
    assert(commandLine.arguments.some(a => a.toLowerCase().includes(path.join(run, phase, 'profile').toLowerCase())), 'WebView must use its isolated profile')
    report.runtime = { webview2: browser.version(), playwright: JSON.parse(fs.readFileSync('node_modules/playwright/package.json', 'utf8')).version }
    report.profileVerified = true
    context.on('page', page => observe(page))
    for (const page of context.pages()) observe(page)
    function observe(page: Page) {
      page.setDefaultTimeout(8000)
      page.on('pageerror', error => errors.push(String(error)))
    }
    const main = await findPage(context, phase === 'corrector' ? 'app=sheet-corrector' : 'app=remap')
    currentPage = main
    async function record(id: string, page: Page, action: () => Promise<void>) {
      if (fault && id !== fault && !['corrector-entry', 'remap-entry'].includes(id)) return
      currentPage = page
      const item = { id, expected: expectations[id], artifact: scenarioApp(id), inputMode: 'cdp', status: 'failed', startedAt: new Date().toISOString() }
      cases.push(item)
      await action()
      const screenshot = `screenshots/${id}.png`
      await page.screenshot({ path: path.join(run, screenshot) })
      Object.assign(item, { status: 'passed', finishedAt: new Date().toISOString(), screenshot, sha256: sha256(fs.readFileSync(path.join(run, screenshot))) })
      console.log(`[interaction] ${id} passed`)
    }
    async function blockInput(page: Page, id: string, event: string) {
      if (fault !== id) return
      if (event === 'keydown') await page.evaluate('window.__xsheetFaultBlockKey = true')
      else await page.evaluate(event => document.addEventListener(event, e => { e.preventDefault(); e.stopImmediatePropagation() }, { capture: true }), event)
    }
    async function openEditor(page: Page, id: string) {
      if (phase === 'remap') await page.locator('summary[aria-label="画面切替"]').click()
      await blockInput(page, id, 'click')
      await page.getByRole('button', { name: /テンプレートを作成・編集/ }).click()
      if (phase === 'corrector') {
        const activePort = path.join(run, phase, 'profile/template-editor/EBWebView/DevToolsActivePort')
        await expect.poll(async () => {
          if (!fs.existsSync(activePort)) return false
          const childPort = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0])
          return (await fetch(`http://127.0.0.1:${childPort}/json/list`).then(r => r.json()).catch(() => [])).some((target: { url: string }) => target.url.includes('app=template-editor'))
        }, { timeout: 20_000 }).toBe(true)
        const childPort = Number(fs.readFileSync(activePort, 'utf8').split('\n')[0])
        const childBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${childPort}`)
        childBrowsers.push(childBrowser)
        const childContext = childBrowser.contexts()[0]
        await childContext.tracing.start({ screenshots: true, snapshots: true, sources: true })
        const childPage = await findPage(childContext, 'app=template-editor')
        observe(childPage)
        const session = await childBrowser.newBrowserCDPSession()
        const command = await session.send('Browser.getBrowserCommandLine')
        assert(command.arguments.some(arg => arg.toLowerCase().includes(path.join(run, phase, 'profile/template-editor').toLowerCase())))
        return childPage
      }
      return findPage(context, 'app=template-editor')
    }
    let editor: Page | undefined
    if (phase === 'corrector') {
      const selection = main.locator('select').first()
      await expect(selection).toBeVisible()
      const before = await selection.inputValue()
      await record('corrector-entry', main, async () => {
        editor = await openEditor(main, 'corrector-entry')
        await editor.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
        await editor.getByRole('complementary', { name: 'テンプレート構成' }).getByRole('button', { name: '用紙と見た目', exact: true }).click()
        await editor.getByLabel('名前', { exact: true }).fill('Native recovery draft')
        await expect.poll(() => recoveredName(editor!)).toBe('Native recovery draft')
        await expect(selection).toHaveValue(before)
        await editor.screenshot({ path: path.join(run, 'screenshots/corrector-editor.png') })
      })
      await record('draft-recovery', main, async () => {
        if (fault === 'draft-recovery') await clearDraft(editor!)
        await childBrowsers[0].contexts()[0].tracing.stop({ path: path.join(run, phase, 'child-before-restart-trace.zip') })
        write('corrector/stop-template.json', { action: 'terminate-owned-template-child', at: new Date().toISOString() })
        await expect.poll(() => fs.existsSync(path.join(run, 'corrector/stopped-template.json'))).toBe(true)
        assert.equal(read('corrector/stopped-template.json').parentStillRunning, true)
        await expect.poll(() => editor!.isClosed()).toBe(true)
        editor = await openEditor(main, 'draft-recovery')
        await editor.getByRole('button', { name: '下書きを復元', exact: true }).click()
        await editor.getByRole('complementary', { name: 'テンプレート構成' }).getByRole('button', { name: '用紙と見た目', exact: true }).click()
        await expect(editor.getByLabel('名前', { exact: true })).toHaveValue('Native recovery draft')
        await expect(selection).toHaveValue(before)
        await editor.screenshot({ path: path.join(run, 'screenshots/recovered-editor.png') })
      })
    } else {
      await expect(main.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
      await record('remap-entry', main, async () => {
        editor = await openEditor(main, 'remap-entry')
        await expect(editor.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeVisible()
        await expect(main.locator('.sheetSvg').first()).toBeVisible()
        assert.notEqual(editor, main); assert.equal(main.isClosed(), false)
      })
      async function resetTemplate() {
        await clearDraft(editor!)
        const accept = (dialog: import('@playwright/test').Dialog) => {
          assert.equal(dialog.type(), 'beforeunload'); void dialog.accept()
        }
        editor!.on('dialog', accept)
        try { await editor!.reload() } finally { editor!.off('dialog', accept) }
        await editor!.getByRole('button', { name: '標準用紙を調整（おすすめ）' }).click()
        await paint(editor!)
        await editor!.locator('.templateZoomFloatingPalette button').first().click()
        await editor!.getByRole('button', { name: '全体表示', exact: true }).click()
        await editor!.mouse.move(3, 3); await paint(editor!)
      }
      for (const id of ['timeline-drag-history', 'memo-drag-history', 'numeric-drag-history']) await record(id, editor!, async () => {
        await resetTemplate()
        const p = editor!, readout = p.locator('.templateEditorRectReadout')
        if (id === 'memo-drag-history') await p.getByRole('button', { name: 'MEMO', exact: true }).click()
        const initial = await readout.innerText()
        const field = p.getByRole('spinbutton', { name: '6秒タイムライン表 X mm' })
        if (id === 'numeric-drag-history') { await field.fill('7'); await paint(p) }
        const beforeDrag = await readout.innerText()
        if (id === 'numeric-drag-history') expect(beforeDrag).not.toBe(initial)
        const rect = (await p.locator('.templateHandleSvg').boundingBox())!
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
        await p.mouse.move(x, y)
        await expect(p.locator('.templateEditAffordances')).toBeVisible()
        await blockInput(p, id, id === 'numeric-drag-history' ? 'keydown' : 'pointerdown')
        await p.mouse.down(); await p.mouse.move(x - 4, y + 5, { steps: 5 })
        await paint(p)
        await expect(p.locator('.templateRegionSnapshotSvg')).toHaveAttribute('data-canvaskit-ready', 'true')
        await p.screenshot({ path: path.join(run, `screenshots/${id}-held.png`) })
        await p.mouse.up(); await paint(p)
        const moved = await readout.innerText(); expect(moved).not.toBe(beforeDrag)
        if (id === 'numeric-drag-history') {
          await expect(field).toBeFocused()
          await p.keyboard.press('Control+z'); await expect(readout).toHaveText(beforeDrag)
          await p.keyboard.press('Control+z'); await expect(readout).toHaveText(initial)
          await expect(p.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled()
        } else {
          await p.getByRole('button', { name: '元に戻す', exact: true }).click()
          await expect(readout).toHaveText(initial)
          await expect(p.getByRole('button', { name: '元に戻す', exact: true })).toBeDisabled()
          await p.getByRole('button', { name: 'やり直し', exact: true }).click()
          await expect(readout).toHaveText(moved)
        }
        await p.mouse.move(3, 3); await expect(p.locator('.templateEditAffordances')).toBeHidden()
      })
      // Production native import is fixture setup. It is deliberately not Explorer acceptance.
      await nativeDrop(main, [path.join(run, 'document.xsr')])
      await expect(main.getByLabel('カット情報', { exact: true })).toContainText('INTERACTION_BOUNDARY')
      await enterClipAssembly(main)
      const target = main.locator('[data-clip-layer-id="slot:slot_A"]')
      await target.scrollIntoViewIfNeeded()
      const position = await target.evaluate(el => { const r = el.getBoundingClientRect(); return { x: (r.x + r.width / 2) * devicePixelRatio, y: (r.y + r.height / 2) * devicePixelRatio } })
      await nativeDrop(main, [path.join(run, '001.png')], position)
      const layer = clipLayerNamed(main, '001')
      await expect(layer).toHaveCount(1)
      await record('quick-look', main, async () => {
        await main.getByRole('button', { name: '001をクイックルック', exact: true }).click()
        const preview = main.getByRole('dialog', { name: '001のプレビュー', exact: true })
        if (fault === 'quick-look') await preview.locator('img').evaluate(el => { el.style.display = 'none' })
        await expect(preview.locator('img')).toBeVisible()
        expect(await preview.locator('img').evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(1)
        await main.screenshot({ path: path.join(run, 'screenshots/quick-look-open.png') })
        await main.keyboard.press('Escape'); await expect(preview).toHaveCount(0); await expect(layer).toBeVisible()
      })
      await record('layer-assignment-history', main, async () => {
        await layer.scrollIntoViewIfNeeded()
        const from = (await layer.boundingBox())!, to = await cell(main, 'A', 1)
        await blockInput(main, 'layer-assignment-history', 'pointerdown')
        await main.mouse.move(from.x + from.width * .65, from.y + from.height / 2)
        await main.mouse.down(); await main.mouse.move(to.x, to.y, { steps: 8 }); await main.mouse.up()
        await expect(event(main, 'A', 1).locator('.eventText')).toHaveText('1')
        await main.keyboard.press('Control+z'); await expect(event(main, 'A', 1)).toHaveCount(0); await expect(layer).toHaveCount(1)
        await main.keyboard.press('Control+y'); await expect(event(main, 'A', 1).locator('.eventText')).toHaveText('1'); await expect(layer).toHaveCount(1)
      })
      await record('mode-return', main, async () => {
        const sourceId = await layer.getAttribute('data-clip-layer-id')
        await main.getByRole('button', { name: 'シート編集', exact: true }).click()
        await expect(main.locator('.clipLayerPanel')).toHaveCount(0)
        await blockInput(main, 'mode-return', 'click')
        await enterClipAssembly(main); await expect(layer).toHaveAttribute('data-clip-layer-id', sourceId!)
      })
      await main.getByRole('button', { name: 'シート編集', exact: true }).click()
      for (const id of ['range-outside', 'range-history']) await record(id, main, async () => {
        const acceptReset = (dialog: import('@playwright/test').Dialog) => { assert.equal(dialog.type(), 'beforeunload'); void dialog.accept() }
        main.on('dialog', acceptReset)
        try { await main.reload() } finally { main.off('dialog', acceptReset) }
        await expect(main.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
        await nativeDrop(main, [path.join(run, 'document.xsr')])
        await expect(main.getByLabel('カット情報', { exact: true })).toContainText('INTERACTION_BOUNDARY')
        // Distinct labels expose partial-range moves and accidental coalescing.
        for (const [frame, label] of [[1, '1'], [5, '2'], [9, '3']] as const) {
          const p = await cell(main, 'A', frame)
          await main.mouse.click(p.x, p.y); await main.keyboard.press(label); await main.keyboard.press('Enter')
          await expect(event(main, 'A', frame).locator('.eventText')).toHaveText(label)
        }
        for (const [frame, label] of [[1, '1'], [5, '2'], [9, '3']] as const) await expect(event(main, 'A', frame).locator('.eventText')).toHaveText(label)
        const start = await cell(main, 'A', 12), end = await cell(main, 'A', 1)
        await main.mouse.move(start.x, start.y); await main.mouse.down(); await main.mouse.move(end.x, end.y, { steps: 5 }); await main.mouse.up()
        await expect(main.locator('.statusBar span').first()).toContainText('CELL A 001-012')
        const from = await cell(main, 'A', 5), to = await cell(main, 'B', 17)
        const before = await events(main)
        await main.mouse.move(from.x, from.y); await main.mouse.down(); await main.mouse.move(to.x, to.y, { steps: 5 })
        await expect(main.locator('.timingDragGhostCell')).toHaveCount(3)
        expect(await events(main)).toEqual(before)
        await main.screenshot({ path: path.join(run, `screenshots/${id}-held.png`) })
        if (id === 'range-outside') {
          await main.mouse.move(3, 3); await expect(main.locator('.timingDragStatus')).toHaveAttribute('data-drag-validity', 'invalid')
          await main.mouse.up(); await expect(main.locator('.timingDragPreview')).toHaveCount(0)
          if (fault === id) { const p = await cell(main, 'A', 1); await main.mouse.click(p.x, p.y); await main.keyboard.press('8'); await main.keyboard.press('Enter') }
          expect(await events(main)).toEqual(before)
          // Undo must undo the preceding input, not a spurious no-op drag transaction.
          await main.keyboard.press('Control+z'); await expect(event(main, 'A', 9)).toHaveCount(0)
          await main.keyboard.press('Control+y'); expect(await events(main)).toEqual(before)
        } else {
          await main.mouse.up(); await expect(main.locator('.timingDragPreview')).toHaveCount(0)
          for (const [frame, label] of [[13, '1'], [17, '2'], [21, '3']] as const) await expect(event(main, 'B', frame).locator('.eventText')).toHaveText(label)
          for (const frame of [1, 5, 9]) await expect(event(main, 'A', frame)).toHaveCount(0)
          const moved = await events(main)
          await blockInput(main, id, 'keydown')
          await main.keyboard.press('Control+z'); expect(await events(main)).toEqual(before)
          await main.keyboard.press('Control+y'); expect(await events(main)).toEqual(moved)
        }
      })
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(sourceIdentity(root), prepared.harnessIdentity)
    report.status = 'passed'
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error)
    report.targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json()).catch(() => [])
    if (currentPage && !currentPage.isClosed()) {
      await currentPage.screenshot({ path: path.join(run, `screenshots/${phase}-failure.png`) }).catch(() => {})
      write(`${phase}/failure-ui.json`, { body: await currentPage.locator('body').innerText().catch(() => ''), errors })
    }
    process.exitCode = 1
  } finally {
    report.finishedAt = new Date().toISOString(); report.pageErrors = errors
    write(`${phase}/result.json`, report)
    await browser?.contexts()[0].tracing.stop({ path: path.join(run, phase, 'trace.zip') }).catch(() => {})
    for (const [index, child] of childBrowsers.entries()) {
      await child.contexts()[0]?.tracing.stop({ path: path.join(run, phase, `child-${index}-trace.zip`) }).catch(() => {})
      await child.close().catch(() => {})
    }
    await browser?.close()
  }
} else throw new Error('Usage: webview-interaction.ts prepare|execute|finish <run> [baseline|phase]')

async function findPage(context: BrowserContext, query: string): Promise<Page> {
  await expect.poll(() => context.pages().filter(p => p.url().includes(query) && !p.isClosed()).length, { timeout: 15_000 }).toBe(1)
  return context.pages().find(p => p.url().includes(query) && !p.isClosed())!
}
async function recoveredName(page: Page): Promise<string | null> {
  return page.evaluate(`new Promise((resolve,reject) => {
    const request=indexedDB.open('xsheet-template-draft-recovery',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{ const db=request.result;
      if(!db.objectStoreNames.contains('drafts')) { db.close(); resolve(null); return; }
      const read=db.transaction('drafts').objectStore('drafts').get('current');
      read.onsuccess=()=>{db.close();resolve(read.result?.template?.name ?? null)};
      read.onerror=()=>{db.close();reject(read.error)};
    };
  })`)
}
async function clearDraft(page: Page) {
  await page.evaluate(`new Promise((resolve,reject)=>{
    const request=indexedDB.open('xsheet-template-draft-recovery',1);
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{const db=request.result;
      if(!db.objectStoreNames.contains('drafts')){db.close();resolve(null);return}
      const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').clear();
      tx.oncomplete=()=>{db.close();resolve(null)};tx.onerror=()=>{db.close();reject(tx.error)};
    };
  })`)
}
async function nativeDrop(page: Page, paths: string[], position = { x: 100, y: 100 }) {
  await page.evaluate(async ({ paths, position }) => {
    const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (command: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
    await bridge.invoke('plugin:event|emit', { event: 'tauri://drag-drop', payload: { type: 'drop', paths, position } })
  }, { paths, position })
}
async function cell(page: Page, track: string, frame: number) {
  const r = cellRectForHit(standardA3SheetTemplate, timingHitForFrame(standardA3SheetTemplate, 'cell', track, frame)!)!
  return page.locator('.sheetSvg').first().evaluate((svg, r) => { const b = svg.getBoundingClientRect(); return { x: b.left + (r.x + r.w / 2) * b.width, y: b.top + (r.y + r.h / 2) * b.height } }, r)
}
function event(page: Page, track: string, frame: number) {
  return page.locator(`[data-timeline-event-role="cell"][data-timeline-event-track="${track}"][data-timeline-event-frame="${frame}"]`)
}
async function events(page: Page) {
  return page.locator('[data-timeline-event-role="cell"]').evaluateAll(elements => elements.map(el => ({
    track: el.getAttribute('data-timeline-event-track'), frame: el.getAttribute('data-timeline-event-frame'), text: el.querySelector('.eventText')?.textContent,
  })))
}
