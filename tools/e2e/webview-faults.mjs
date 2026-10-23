import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { webviewScenarios } from '../verification/desktop-scenarios.mjs'
import { sha256, sourceIdentity } from '../verification/evidence.mjs'

const allIds = webviewScenarios.map(([id]) => id)
const args = process.argv.slice(2)
assert(args[0] === '--working-tree-diagnostic' && args.slice(1).every(id => allIds.includes(id)), 'Usage: webview-faults.mjs --working-tree-diagnostic [case-id ...]')
const ids = args.length > 1 ? args.slice(1) : allIds
assert.equal(new Set(ids).size, ids.length)
const root = process.cwd(), directory = path.join(root, 'reference-local/webview-interaction', `faults-${Date.now()}-${randomUUID()}`)
fs.mkdirSync(directory, { recursive: true })
const report = { schemaVersion: 1, identity: sourceIdentity(root), selection: ids, fullInventory: allIds, startedAt: new Date().toISOString(), status: 'failed', cases: [] }
for (const id of ids) {
  const run = path.join(directory, id), phase = ['corrector-entry', 'draft-recovery'].includes(id) ? 'corrector' : 'remap'
  const output = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'tools/e2e/webview-interaction.ps1', '-WorkingTreeDiagnostic', '-Fault', id, '-RunDirectory', run], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 220_000,
  })
  fs.writeFileSync(path.join(directory, `${id}.log`), (output.stdout ?? '') + (output.stderr ?? ''))
  const bytes = fs.readFileSync(path.join(run, phase, 'result.json'))
  const result = JSON.parse(bytes), os = JSON.parse(fs.readFileSync(path.join(run, phase, 'os-observation.json'), 'utf8').replace(/^\uFEFF/, ''))
  assert(!output.error && output.status !== 0, `Fault escaped detection: ${id}`)
  assert.equal(result.fault, id)
  assert.equal(result.cases.find(c => c.status === 'failed')?.id, id, `Failure happened before intended fault: ${id}`)
  assert.match(result.error, /expect\(|Timeout .*exceeded/, `Not an assertion failure: ${id}`)
  assert.equal(os.foregroundOwned, false); assert.equal(os.desktopReleased, true)
  assert.equal(os.inputDesktopBefore, os.inputDesktopAfter)
  report.cases.push({ id, status: 'detected', reportPath: path.relative(root, path.join(run, phase, 'result.json')).replaceAll('\\', '/'), sha256: sha256(bytes), error: result.error })
  fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
  console.log(`[fault-detection] ${id}: detected (${report.cases.length}/${ids.length})`)
}
assert.deepEqual(sourceIdentity(root), report.identity)
report.status = 'passed'
report.finishedAt = new Date().toISOString()
fs.writeFileSync(path.join(directory, 'result.json'), JSON.stringify(report, null, 2) + '\n')
console.log(`[fault-detection] evidence: ${directory}`)
