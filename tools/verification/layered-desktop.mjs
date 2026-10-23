import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { sha256 } from './evidence.mjs'
import { webviewScenarios, explorerScenarios, extraWebviewScreenshots, scenarioApp } from './desktop-scenarios.mjs'

export const desktopPointerPath = 'reference-local/desktop-acceptance/computer-use/current.json'
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const timestamp = value => typeof value === 'string' ? Date.parse(value) : NaN
function within(root, relative) {
  assert(nonempty(relative) && !path.isAbsolute(relative), 'Evidence paths must be relative')
  const full = fs.realpathSync(path.resolve(root, relative))
  const outside = path.relative(fs.realpathSync(root), full)
  assert(outside !== '..' && !outside.startsWith(`..${path.sep}`) && !path.isAbsolute(outside), 'Evidence path leaves its directory')
  return full
}
function exactIds(items, ids, label) {
  assert(Array.isArray(items) && items.length === ids.length, `Incomplete ${label}`)
  assert.deepEqual(items.map(item => item.id).sort(), [...ids].sort(), `Missing or duplicate ${label}`)
}
function interval(start, end, minimum, maximum, label) {
  const a = timestamp(start), b = timestamp(end)
  assert(Number.isFinite(a) && Number.isFinite(b) && a >= minimum && a < b && b <= maximum, `Invalid ${label} observation times`)
  return [a, b]
}
function captureWithin(capturedAt, minimum, maximum, label) {
  // Windows file mtimes and JS Date can differ by one millisecond at their
  // sub-ms rounding boundary. This is timestamp precision, not a wait/retry.
  // Preserve the original times and reject any larger discrepancy.
  const value = timestamp(capturedAt)
  assert(Number.isFinite(value) && value >= minimum - 1 && value <= maximum + 1, `${label} outside case observation`)
}
export function evidenceFiles(directory, relatives) {
  return relatives.map(relative => {
    const file = within(directory, relative)
    return { path: relative, sha256: sha256(fs.readFileSync(file)), capturedAt: fs.statSync(file).mtime.toISOString() }
  })
}
function checkedFile(directory, item, image = false) {
  const bytes = fs.readFileSync(within(directory, item?.path))
  assert.equal(sha256(bytes), item.sha256, 'Evidence content/hash differs')
  if (image) assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Screenshot is not PNG')
  return bytes
}
function sameIdentity(reportIdentity, identity) {
  // TS runners have this explicit loader; all other runtime/source inputs must
  // match the ordinary npm verification process, including NODE_OPTIONS/npm.
  assert.deepEqual(reportIdentity, { ...identity, nodeExecArgv: ['--import', 'tsx'] }, 'Report source/runtime differs from current candidate')
}
function artifactMatches(actual, expected, root, diagnostic) {
  assert(actual, 'Missing EXE identity')
  for (const field of ['sha256', 'commit', 'version', 'buildSessionId', 'runtime']) assert.deepEqual(actual[field], expected[field], `EXE ${field} mismatch`)
  assert.equal(path.resolve(actual.executable).toLowerCase(), path.resolve(root, expected.executable).toLowerCase(), 'Wrong EXE path')
  if (!diagnostic) assert.equal(actual.workingTreeDirty, false, 'Dirty EXE cannot certify acceptance')
}
function readReport(root, reference, identity, artifacts, kind, now, diagnostic) {
  const bytes = checkedFile(root, reference)
  const report = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''))
  assert.equal(report.schemaVersion, 1); assert.equal(report.scenarioVersion, 1)
  assert.equal(report.status, 'passed', `${kind} report failed`)
  assert.equal(report.scope, diagnostic ? 'working-tree-diagnostic' : 'current-candidate', 'Diagnostic/baseline evidence cannot certify acceptance')
  assert.equal(report.testedSourceCommit, identity.commit, 'Wrong tested source')
  sameIdentity(report.harnessIdentity, identity)
  const times = interval(report.startedAt, report.finishedAt, timestamp(report.preparedAt), now, kind)
  const directory = path.dirname(within(root, reference.path))
  assert(Array.isArray(report.files) && report.files.length > 0, 'Evidence file inventory is missing')
  assert.equal(new Set(report.files.map(file => file.path)).size, report.files.length, 'Duplicate evidence files')
  for (const file of report.files) checkedFile(directory, file, file.path.endsWith('.png'))
  const requireFile = relative => {
    const found = report.files.find(item => item.path === relative)
    assert(found, `Required evidence file missing: ${relative}`)
    return found
  }
  const expectations = kind === 'webview' ? webviewScenarios : explorerScenarios
  exactIds(report.cases, expectations.map(([id]) => id), `${kind} cases`)
  const playwright = readJson(path.join(root, 'node_modules/playwright/package.json')).version
  for (const item of report.cases) {
    assert.equal(item.status, 'passed', `Unverified case: ${item.id}`)
    assert.equal(item.expected, expectations.find(([id]) => id === item.id)[1], 'Scenario expectation changed')
    assert.equal(item.artifact, scenarioApp(item.id), 'Wrong case EXE')
    const bounds = interval(item.startedAt, item.finishedAt, ...times, item.id)
    const screenshot = requireFile(`screenshots/${item.id}${kind === 'webview' ? '' : '-result'}.png`)
    captureWithin(screenshot.capturedAt, ...bounds, `Screenshot ${item.id}`)
  }
  if (kind === 'webview') {
    assert.equal(report.fault, null, 'Fault diagnostics cannot certify acceptance')
    assert.equal(report.inputMode, 'cdp-and-native-ipc'); assert.equal(report.osDropReceipt, false)
    for (const app of ['remap', 'corrector']) artifactMatches(report.artifacts?.[app], artifacts[app], root, diagnostic)
    exactIds(report.phases?.map(phase => ({ id: phase.phase })), ['corrector', 'remap'], 'WebView phases')
    assert.deepEqual(report.phases.flatMap(phase => phase.cases), report.cases, 'Phase/case records disagree')
    const versions = []
    for (const phase of report.phases) {
      assert.equal(phase.status, 'passed'); assert.equal(phase.fault, null)
      assert.equal(phase.profileVerified, true); assert.deepEqual(phase.pageErrors, [])
      assert.equal(phase.runtime?.playwright, playwright); assert(nonempty(phase.runtime?.webview2), 'Missing WebView2 version')
      versions.push(phase.runtime.webview2)
      const raw = readJson(within(directory, requireFile(`${phase.phase}/result.json`).path))
      assert.deepEqual({ ...raw, osObservation: phase.osObservation }, phase, 'Phase record differs')
      requireFile(`${phase.phase}/trace.zip`)
      const os = readJson(within(directory, requireFile(`${phase.phase}/os-observation.json`).path))
      assert.deepEqual(os, phase.osObservation); assert.equal(os.error, null)
      assert.equal(os.inputMode, 'cdp'); assert.equal(os.foregroundOwned, false); assert.equal(os.desktopReleased, true)
      assert(os.samples > 0 && nonempty(os.desktop) && os.desktop !== os.inputDesktopBefore, 'Unverified isolated desktop')
      assert.equal(os.inputDesktopBefore, os.inputDesktopAfter); assert.equal(os.driverExitCode, 0)
      interval(os.startedAt, os.finishedAt, ...times, `${phase.phase} desktop`)
      const phaseTimes = interval(phase.startedAt, phase.finishedAt, ...times, phase.phase)
      for (const item of phase.cases) {
        assert.equal(item.artifact, phase.phase); assert.equal(item.inputMode, 'cdp')
        interval(item.startedAt, item.finishedAt, ...phaseTimes, item.id)
      }
      if (phase.phase === 'corrector') {
        assert.equal(os.childRestarts?.length, 1, 'Missing owned child restart')
        assert.equal(os.childRestarts[0].parentStillRunning, true, 'Corrector did not survive child restart')
        requireFile('corrector/child-before-restart-trace.zip'); requireFile('corrector/child-1-trace.zip')
      }
    }
    assert.equal(new Set(versions).size, 1, 'WebView runtime changed between phases')
    for (const name of extraWebviewScreenshots) requireFile(`screenshots/${name}.png`)
  } else {
    artifactMatches(report.artifact, artifacts.remap, root, diagnostic)
    assert.equal(report.inputMode, 'os-input'); assert.equal(report.osDropReceipt, true)
    assert.equal(report.profileVerified, true); assert.deepEqual(report.pageErrors, [])
    assert.equal(report.runtime?.playwright, playwright); assert(nonempty(report.runtime?.webview2), 'Missing WebView2 version')
    assert.equal(report.inputTool?.name, 'Win32.SendInput + ShellFolderView/UIAutomation')
    assert.equal(report.inputTool?.version, sha256(fs.readFileSync(path.join(root, 'tools/e2e/explorer-input.cs'))), 'Native input helper version differs')
    const os = readJson(within(directory, requireFile('os-observation.json').path))
    assert.equal(os.error, null); assert.equal(os.interactive, true); assert.equal(os.inputMode, 'os-input')
    assert.equal(os.windowsClosed, true); assert.equal(os.ownedProcessesExited, true); assert.equal(os.driverExitCode, 0)
    assert.equal(os.inputDesktopBefore, os.inputDesktopAfter); interval(os.startedAt, os.finishedAt, ...times, 'Explorer desktop')
    requireFile('trace.zip')
    for (const item of report.cases) {
      assert.equal(item.inputMode, 'os-input')
      const input = readJson(within(directory, requireFile(`${item.id}-input.json`).path))
      assert.deepEqual(input, item.input, 'Native input records disagree')
      assert.equal(input.status, 'sent'); assert.equal(input.attempts, 1)
      assert.equal(input.actor, 'automation', 'Human/assisted input cannot certify automated acceptance')
      assert.equal(input.method, 'Win32.SendInput', 'Protocol input cannot certify OS receipt')
      assert.equal(input.selection, 'ShellFolderView.SelectItem'); assert.equal(input.toolVersion, report.inputTool.version)
      interval(input.startedAt, input.finishedAt, timestamp(item.startedAt), timestamp(item.finishedAt), 'native input')
      const selection = requireFile(`screenshots/${item.id}-selection.png`)
      captureWithin(selection.capturedAt, timestamp(item.startedAt), timestamp(item.finishedAt), `Selection screenshot ${item.id}`)
      assert.equal(item.observedDrops?.length, 1, 'Expected exactly one OS drop')
      const expectedNames = item.id === 'folder-drop' ? ['A1', 'A2', 'A3'] : ['B1', 'B2']
      assert.deepEqual([...item.importedNames].sort(), expectedNames, 'Partial/extra image import')
      assert.deepEqual(item.excludedNames, ['Unselected'])
      assert.equal(item.pixels?.length, expectedNames.length)
      assert(item.pixels.every(pixel => pixel.width === 1 && pixel.height === 1 && JSON.stringify(pixel.rgba) === '[255,0,0,255]'), 'Image pixel mismatch')
      const paths = item.id === 'folder-drop' ? ['folder-source/CU_CUT'] : ['multiple-source/B1.png', 'multiple-source/B2.png']
      const normalize = values => values.map(value => path.resolve(value).toLowerCase()).sort()
      const expectedPaths = normalize(paths.map(value => path.join(directory, value)))
      assert.deepEqual(normalize(input.selectedPaths), expectedPaths, 'Wrong Explorer selection')
      assert.deepEqual(normalize(item.observedDrops[0].paths), expectedPaths, 'Native received paths differ from selected paths')
      const saved = requireFile(`${item.id}.xsr`)
      assert.equal(saved.sha256, item.savedProject.sha256, 'Saved document evidence differs')
    }
  }
  return { kind, directory: path.relative(root, directory).replaceAll('\\', '/'), checks: report.cases.length,
    inputMode: report.inputMode, observations: report.cases.map(({ id, artifact, startedAt, finishedAt }) => ({ id, artifact, startedAt, finishedAt })),
    startedAt: report.startedAt, finishedAt: report.finishedAt }
}
export function validateLayeredReports(root, references, identity, artifacts, now = Date.now(), diagnostic = false) {
  assert(nonempty(identity.npm), 'Run through the standard Node installation and bundled npm')
  if (!diagnostic) assert.equal(identity.workingTreeDirty, false, 'Acceptance requires the current clean commit')
  assert.equal(artifacts.remap.buildSessionId, artifacts.corrector.buildSessionId, 'Mixed EXE build sessions')
  for (const artifact of Object.values(artifacts)) assert.equal(sha256(fs.readFileSync(path.resolve(root, artifact.executable))), artifact.sha256, 'Current EXE SHA-256 differs')
  return ['webview', 'explorer'].map(kind => readReport(root, references[kind], identity, artifacts, kind, now, diagnostic))
}
export function prepareLayeredAcceptance(root, identity, artifacts) {
  const directory = `reference-local/desktop-acceptance/layered/${Date.now()}-${randomUUID()}`
  const recordPath = `${directory}/record.json`
  const record = { schemaVersion: 3, scenarioVersion: 1, status: 'pending', inputMode: 'layered', preparedAt: new Date().toISOString(),
    identity, artifacts, required: { webview: webviewScenarios.map(([id]) => id), explorer: explorerScenarios.map(([id]) => id) }, reports: null }
  fs.mkdirSync(path.join(root, directory), { recursive: true })
  for (const name of ['prepared.json', 'record.json']) fs.writeFileSync(path.join(root, directory, name), JSON.stringify(record, null, 2) + '\n', { flag: 'wx' })
  fs.mkdirSync(path.dirname(path.join(root, desktopPointerPath)), { recursive: true })
  fs.writeFileSync(path.join(root, desktopPointerPath), JSON.stringify({ recordPath }, null, 2) + '\n')
  return recordPath
}
export function validateLayeredAcceptance(root, recordPath, identity, artifacts, now = Date.now()) {
  const full = within(root, recordPath), bytes = fs.readFileSync(full), record = readJson(full)
  assert.equal(record.schemaVersion, 3); assert.equal(record.scenarioVersion, 1); assert.equal(record.inputMode, 'layered')
  assert.equal(record.status, 'passed', 'Layered acceptance is incomplete')
  assert.deepEqual(record.required, { webview: webviewScenarios.map(([id]) => id), explorer: explorerScenarios.map(([id]) => id) }, 'Layered scenario inventory changed')
  assert.deepEqual(record.identity, identity, 'Layered source/runtime differs'); assert.deepEqual(record.artifacts, artifacts, 'Layered EXEs differ')
  const scenarios = validateLayeredReports(root, record.reports, identity, artifacts, now)
  return { recordPath, recordSha256: sha256(bytes), artifacts, scenarios, automationComplete: true,
    actors: { automation: 13, human: 0, assisted: 0, unknown: 0 },
    startedAt: scenarios.map(s => s.startedAt).sort()[0], finishedAt: scenarios.map(s => s.finishedAt).sort().at(-1) }
}
export function collectLayeredAcceptance(root, recordPath, identity, artifacts, webviewPath, explorerPath) {
  const full = within(root, recordPath), record = readJson(full)
  assert.equal(record.schemaVersion, 3); assert.equal(record.status, 'pending', 'Prepare a new acceptance record for each candidate')
  assert.deepEqual(record.identity, identity, 'Prepared source/runtime differs'); assert.deepEqual(record.artifacts, artifacts, 'Prepared EXEs differ')
  const reports = Object.fromEntries([['webview', webviewPath], ['explorer', explorerPath]].map(([kind, relative]) => [kind, { path: relative, sha256: sha256(fs.readFileSync(within(root, relative))) }]))
  validateLayeredReports(root, reports, identity, artifacts)
  fs.writeFileSync(full, JSON.stringify({ ...record, reports, status: 'passed', collectedAt: new Date().toISOString() }, null, 2) + '\n')
  return validateLayeredAcceptance(root, recordPath, identity, artifacts)
}
