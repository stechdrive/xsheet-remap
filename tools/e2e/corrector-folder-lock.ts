import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect, type Browser, type Page } from '@playwright/test'
import { sourceIdentity, sha256 } from '../verification/evidence.mjs'
import { webviewArtifact } from '../verification/webview-evidence.mjs'

const root = process.cwd(), [stage, run] = process.argv.slice(2)
const parent = path.join(root, 'reference-local/corrector-folder-lock')
assert(run && path.resolve(run).startsWith(parent + path.sep), 'Keep evidence in corrector-folder-lock')
const write = (file: string, value: unknown) => fs.writeFileSync(path.join(run, file), JSON.stringify(value, null, 2) + '\n')
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(run, file), 'utf8').replace(/^\uFEFF/, ''))
const input = path.join(run, '入力 folder'), source = path.join(input, '入力 sheet.jpg')

if (stage === 'prepare') {
  assert(!fs.existsSync(run), 'Never overwrite diagnostic evidence')
  const identity = sourceIdentity(root)
  const artifact = webviewArtifact(root, identity, null, 'corrector', process.env.XSHEET_WORKING_TREE_DIAGNOSTIC === '1')
  fs.mkdirSync(input, { recursive: true })
  write('prepared.json', { ...artifact, harnessIdentity: identity, input, source, preparedAt: new Date().toISOString() })
} else if (stage === 'execute') {
  const prepared = read('prepared.json')
  const report: Record<string, unknown> = { ...prepared, status: 'failed', inputMode: 'process launch argument; no Explorer input', checks: [] }
  const checks = report.checks as string[], errors: string[] = []
  let browser: Browser | undefined, page: Page | undefined
  try {
    const sourceHash = sha256(fs.readFileSync(source))
    const endpoint = `http://127.0.0.1:${process.env.XSHEET_WEBVIEW_TEST_PORT}`
    await expect.poll(async () => fetch(`${endpoint}/json/version`).then(response => response.ok).catch(() => false), { timeout: 30_000 }).toBe(true)
    browser = await chromium.connectOverCDP(endpoint)
    const context = browser.contexts()[0]
    await expect.poll(() => context.pages().some(item => item.url().includes('app=sheet-corrector')), { timeout: 20_000 }).toBe(true)
    page = context.pages().find(item => item.url().includes('app=sheet-corrector'))!
    page.on('pageerror', error => errors.push(error.message))
    const launchPaths = await page.evaluate<string[]>(`window.__TAURI_INTERNALS__.invoke('sheet_corrector_launch_paths')`)
    assert.deepEqual(launchPaths.map(value => path.normalize(value)), [input])
    checks.push('relative folder launch argument resolves against original working directory')
    const psd = path.join(input, '入力 sheet.psd')
    await expect.poll(() => fs.existsSync(psd), { timeout: 90_000 }).toBe(true)
    await expect(page.locator('body')).toContainText('処理が完了しました。PSD出力 1件', { timeout: 20_000 })
    const psdBytes = fs.readFileSync(psd)
    assert.equal(psdBytes.subarray(0, 4).toString(), '8BPS')
    assert(psdBytes.readUInt32BE(14) > 0 && psdBytes.readUInt32BE(18) > 0, 'PSD has nonempty dimensions')
    checks.push('normal launch queue completes correction and writes PSD beside the input')
    // Exercise the other native output command without changing its default directory.
    const png = await page.evaluate<string>(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 3;
      canvas.getContext('2d').fillRect(0, 0, 2, 3);
      return window.__TAURI_INTERNALS__.invoke('export_sheet_corrector_png', {
        sourcePath: ${JSON.stringify(source)}, pngDataUrl: canvas.toDataURL('image/png')
      });
    })()`)
    assert.equal(path.dirname(png), input)
    checks.push('PNG default output also remains beside the input')
    const hashes = Object.fromEntries([source, psd, png].map(file => [path.basename(file), sha256(fs.readFileSync(file))]))
    assert.equal(hashes[path.basename(source)], sourceHash)
    // No browser/application shutdown or queue reset before these operations.
    const renamed = path.join(run, 'renamed folder')
    fs.renameSync(input, renamed)
    const destination = path.join(run, 'destination')
    fs.mkdirSync(destination)
    const moved = path.join(destination, 'moved folder')
    fs.renameSync(renamed, moved)
    for (const [name, hash] of Object.entries(hashes)) {
      const current = path.join(moved, name), renamedFile = path.join(moved, `renamed-${name}`)
      fs.renameSync(current, renamedFile)
      assert.equal(sha256(fs.readFileSync(renamedFile)), hash)
    }
    checks.push('folder rename, folder move and input/output file renames succeed while Corrector stays open; bytes unchanged')
    await expect(page.locator('body')).toContainText('処理が完了しました。PSD出力 1件')
    await page.screenshot({ path: path.join(run, 'completed-after-move.png') })
    assert.deepEqual(errors, [])
    assert.deepEqual(sourceIdentity(root), prepared.harnessIdentity, 'Source changed during diagnostic')
    assert.equal(sha256(fs.readFileSync(prepared.artifact.executable)), prepared.artifact.sha256)
    Object.assign(report, { status: 'passed', files: hashes, finalDirectory: moved })
  } catch (error) {
    report.error = error instanceof Error ? error.stack : String(error)
    if (page) {
      report.ui = await page.locator('body').innerText().catch(() => '')
      await page.screenshot({ path: path.join(run, 'failure.png') }).catch(() => {})
    }
    process.exitCode = 1
  } finally {
    Object.assign(report, { pageErrors: errors, finishedAt: new Date().toISOString() })
    write('result.json', report)
    await browser?.close()
    console.log(`[corrector-folder-lock] ${report.status}: ${run}`)
  }
} else {
  throw new Error('Expected prepare or execute')
}
