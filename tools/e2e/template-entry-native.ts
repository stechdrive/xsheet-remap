import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect, type Locator, type Page } from '@playwright/test'

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((items, value, index, all) => {
  if (index % 2 === 0) items.push([value.replace(/^--/, ''), all[index + 1] ?? ''])
  return items
}, []))
for (const name of ['port', 'result', 'app-pid', 'python', 'screenshot-root', 'remap-exe']) if (!args[name]) throw new Error(`--${name} is required`)
const correctorPid = Number(args['app-pid'])
if (!Number.isInteger(correctorPid) || correctorPid <= 0) throw new Error('Invalid Corrector process')
const exec = promisify(execFile)
const mouseScript = fileURLToPath(new URL('./win-real-dnd/mouse_ops.py', import.meta.url))
const checks: string[] = [], artifacts: string[] = [], operations: unknown[] = []
const createdPids = new Set<number>()
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${args.port}`)
let activePid = correctorPid
let activePage: Page

async function native(command: string, ...values: string[]) {
  const { stdout } = await exec(args.python!, [mouseScript, command, ...values], { windowsHide: true, timeout: 20_000 })
  const result = JSON.parse(stdout.trim().split(/\r?\n/).at(-1) || '{}')
  if (!result.ok) throw new Error(`Native input failed: ${stdout}`)
  operations.push(result)
  return result
}
async function click(locator: Locator) {
  await expect(locator).toBeVisible()
  const box = await locator.boundingBox()
  if (!box) throw new Error('Missing native input target')
  const metrics = await native('window-client-metrics', '--app-pid', String(activePid))
  const viewport = await activePage.evaluate(() => ({ width: innerWidth, height: innerHeight }))
  const x = box.x + box.width / 2, y = box.y + box.height / 2
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) throw new Error('Native target is outside viewport')
  await native('click-screen', '--x', String(Math.round(metrics.client.x + x * metrics.client.width / viewport.width)),
    '--y', String(Math.round(metrics.client.y + y * metrics.client.height / viewport.height)), '--app-pid', String(activePid))
}
async function findPage(kind: string) {
  let found: Page | undefined
  await expect.poll(() => {
    found = browser.contexts().flatMap(context => context.pages()).find(page => !page.isClosed() && new URL(page.url()).searchParams.get('app') === kind)
    return !!found
  }, { timeout: 15_000 }).toBe(true)
  return found!
}
async function findChild() {
  let pid = 0
  await expect.poll(async () => {
    const command = `Get-CimInstance Win32_Process -Filter "ParentProcessId = ${correctorPid} AND Name = 'xsheet-remap.exe'" | Select-Object -ExpandProperty ProcessId`
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true })
    const pids = stdout.trim().split(/\s+/).map(Number).filter(value => Number.isInteger(value) && value > 0)
    if (pids.length === 1) pid = pids[0]!
    return pid
  }, { timeout: 15_000 }).toBeGreaterThan(0)
  createdPids.add(pid)
  return pid
}
async function terminateCreated(pid: number) {
  if (!createdPids.has(pid)) throw new Error('Refusing to terminate an unrelated process')
  await exec('taskkill.exe', ['/PID', String(pid), '/F'], { windowsHide: true })
  createdPids.delete(pid)
}
async function screenshot(name: string) {
  const file = join(args['screenshot-root']!, name + '.png')
  await activePage.screenshot({ path: file }); artifacts.push(file)
}
let passed = false, failure: string | undefined
try {
  activePage = await findPage('sheet-corrector')
  const corrector = activePage
  await native('desktop-preflight', '--app-pid', String(activePid))
  const selected = await corrector.locator('.sheetCorrectorTemplateSelect select').inputValue()
  await click(corrector.getByRole('button', { name: 'テンプレートを作成・編集', exact: true }))
  activePid = await findChild()
  activePage = await findPage('template-editor')
  await expect(activePage).toHaveTitle('xsheet-remap - Template')
  await click(activePage.getByRole('button', { name: '標準用紙を調整（おすすめ）' }))
  await click(activePage.getByRole('complementary', { name: 'テンプレート構成' }).getByRole('button', { name: '用紙と見た目', exact: true }))
  await click(activePage.getByLabel('名前', { exact: true }))
  await native('key-press', '--keys', '^aRecovered{SPACE}template', '--app-pid', String(activePid), '--preserve-focus')
  await expect(activePage.getByLabel('名前', { exact: true })).toHaveValue('Recovered template')
  await expect.poll(() => activePage.evaluate(() => new Promise<string | null>(resolve => {
    const request = indexedDB.open('xsheet-template-draft-recovery', 1)
    request.onsuccess = () => {
      const db = request.result
      const read = db.transaction('drafts').objectStore('drafts').get('current')
      read.onsuccess = () => { db.close(); resolve(read.result?.template?.name ?? null) }
    }
  }))).toBe('Recovered template')
  await screenshot('corrector-opened-template')
  checks.push('Corrector native button launches adjacent Remap in template-only mode; native typing persists the draft')
  const firstEditor = activePage
  await terminateCreated(activePid)
  await expect.poll(() => firstEditor.isClosed()).toBe(true)
  activePage = corrector; activePid = correctorPid
  await click(corrector.getByRole('button', { name: 'テンプレートを作成・編集', exact: true }))
  activePid = await findChild(); activePage = await findPage('template-editor')
  await click(activePage.getByRole('button', { name: '下書きを復元', exact: true }))
  await click(activePage.getByRole('complementary', { name: 'テンプレート構成' }).getByRole('button', { name: '用紙と見た目', exact: true }))
  await expect(activePage.getByLabel('名前', { exact: true })).toHaveValue('Recovered template')
  await expect(corrector.locator('.sheetCorrectorTemplateSelect select')).toHaveValue(selected)
  await expect(activePage.getByRole('button', { name: 'プロジェクトへ反映' })).toHaveCount(0)
  await screenshot('restored-template')
  checks.push('After terminating only the test-owned editor, reopening restores its draft without changing Corrector selection')
  const secondEditor = activePage
  await terminateCreated(activePid)
  await expect.poll(() => secondEditor.isClosed()).toBe(true)

  const remap = spawn(args['remap-exe']!, [], { cwd: join(args['screenshot-root']!, '..'), windowsHide: false, stdio: 'ignore' })
  if (!remap.pid) throw new Error('Remap did not start')
  createdPids.add(remap.pid); activePid = remap.pid
  activePage = await findPage('remap')
  await click(activePage.locator('summary[aria-label="画面切替"]'))
  await click(activePage.getByRole('button', { name: 'テンプレートを作成・編集…', exact: true }))
  activePage = await findPage('template-editor')
  await expect(activePage.getByRole('heading', { name: 'テンプレート作成を始める' })).toBeVisible()
  await screenshot('remap-template-entry')
  checks.push('Remap native menu opens its template-only window while the sheet window remains open')
  passed = true
} catch (error) {
  failure = String(error)
  if (activePage!) await screenshot('template-entry-failure').catch(() => undefined)
  console.error(error)
} finally {
  for (const pid of createdPids) await terminateCreated(pid).catch(() => undefined)
  await writeFile(args.result!, JSON.stringify({ passed, checks, artifacts, operations, error: failure }, null, 2))
  await browser.close()
}
console.log(`[template-entry-native] ${passed ? 'passed' : 'failed'} ${checks.length} checks`)
if (!passed) process.exitCode = 1
