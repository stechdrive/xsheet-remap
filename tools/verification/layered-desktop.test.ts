import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { sha256 } from './evidence.mjs'
import { desktopArtifacts, computerUseScenarios, readComputerUseAcceptance } from './computer-use-desktop.mjs'
import { webviewScenarios, explorerScenarios, extraWebviewScreenshots, scenarioApp } from './desktop-scenarios.mjs'
import { collectLayeredAcceptance, prepareLayeredAcceptance, validateLayeredAcceptance, validateLayeredReports } from './layered-desktop.mjs'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))
const identity = { commit: 'candidate', workingTreeDirty: false, sourceSha256: 'all-source', platform: 'win32', arch: 'x64',
  node: 'v26.12.1', npm: '11.20.0', nodeOptions: '', nodeExecArgv: [] }
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')

// Synthetic evidence fixtures test rejection policy. These are never GUI runs.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xsheet-layered-')); roots.push(root)
  const write = (relative: string, value: unknown) => {
    const file = path.join(root, relative); fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, Buffer.isBuffer(value) ? value : typeof value === 'string' ? value : JSON.stringify(value))
  }
  const applications = Object.fromEntries(['remap', 'corrector'].map(app => {
    const executable = `xsheet-${app}.exe`, bytes = Buffer.from(app); write(`dev-local/${executable}`, bytes)
    return [app, { executable, sha256: sha256(bytes), commit: identity.commit, workingTreeDirty: false,
      version: '0.1.837', buildSessionId: 'coherent', runtime: { node: identity.node, npm: identity.npm } }]
  }))
  write('dev-local/build-state.json', { applications }); write('node_modules/playwright/package.json', { version: 'test-version' })
  write('tools/e2e/explorer-input.cs', 'input helper fixture')
  const artifacts = desktopArtifacts(root, identity)
  const rawArtifacts = Object.fromEntries(Object.entries(artifacts).map(([key, artifact]) => [key, { ...artifact, executable: path.join(root, artifact.executable), workingTreeDirty: false }]))
  const start = Date.now() - 10000, time = (n: number) => new Date(start + n).toISOString()
  const runtime = { playwright: 'test-version', webview2: '155.0.test' }
  const reportBase = { schemaVersion: 1, scenarioVersion: 1, scope: 'current-candidate', status: 'passed',
    preparedAt: time(0), startedAt: time(100), finishedAt: time(9000), testedSourceCommit: identity.commit,
    harnessIdentity: { ...identity, nodeExecArgv: ['--import', 'tsx'] } }
  const observation = { startedAt: time(100), finishedAt: time(8000), error: null, inputDesktopBefore: 'Default', inputDesktopAfter: 'Default', driverExitCode: 0 }
  const phases = ['corrector', 'remap'].map(phase => ({ phase, fault: null, status: 'passed', profileVerified: true, pageErrors: [], runtime,
    startedAt: time(200), finishedAt: time(7500),
    cases: webviewScenarios.filter(([id]) => scenarioApp(id) === phase).map(([id, expected]) => ({ id, expected, artifact: phase, inputMode: 'cdp', status: 'passed', startedAt: time(500), finishedAt: time(7000) })),
    osObservation: { ...observation, desktop: `isolated-${phase}`, inputMode: 'cdp', foregroundOwned: false, desktopReleased: true, samples: 100,
      childRestarts: phase === 'corrector' ? [{ parentStillRunning: true }] : [] } }))
  const webview = { ...reportBase, fault: null, inputMode: 'cdp-and-native-ipc', osDropReceipt: false, artifacts: rawArtifacts, phases, cases: phases.flatMap(p => p.cases), files: [] as { path: string; sha256: string; capturedAt: string }[] }
  const inputTool = { name: 'Win32.SendInput + ShellFolderView/UIAutomation', version: sha256(Buffer.from('input helper fixture')) }
  const explorer = { ...reportBase, inputMode: 'os-input', osDropReceipt: true, artifact: rawArtifacts.remap, profileVerified: true, pageErrors: [], runtime, inputTool,
    cases: explorerScenarios.map(([id, expected]) => {
      const paths = (id === 'folder-drop' ? ['folder-source/CU_CUT'] : ['multiple-source/B1.png', 'multiple-source/B2.png']).map(file => path.join(root, 'explorer', file))
      const names = id === 'folder-drop' ? ['A1', 'A2', 'A3'] : ['B1', 'B2']
      return { id, expected, artifact: 'remap', inputMode: 'os-input', status: 'passed', startedAt: time(500), finishedAt: time(7000),
        input: { status: 'sent', attempts: 1, actor: 'automation', method: 'Win32.SendInput', selection: 'ShellFolderView.SelectItem', toolVersion: inputTool.version,
          startedAt: time(1000), finishedAt: time(2000), selectedPaths: paths },
        observedDrops: [{ paths: [...paths] }], importedNames: names, excludedNames: ['Unselected'],
        pixels: names.map(() => ({ width: 1, height: 1, rgba: [255, 0, 0, 255] })), savedProject: { path: `${id}.xsr`, sha256: sha256(Buffer.from('saved fixture')) } }
    }), files: [] as { path: string; sha256: string; capturedAt: string }[] }
  function add(kind: 'webview' | 'explorer', file: string, value: unknown) {
    write(`${kind}/${file}`, value)
    const report = kind === 'webview' ? webview : explorer
    const entry = { path: file, sha256: sha256(fs.readFileSync(path.join(root, kind, file))), capturedAt: time(3000) }
    const old = report.files.findIndex(f => f.path === file)
    if (old < 0) report.files.push(entry); else report.files[old] = entry
  }
  for (const phase of phases) {
    const { osObservation, ...raw } = phase
    add('webview', `${phase.phase}/result.json`, raw); add('webview', `${phase.phase}/os-observation.json`, osObservation)
    add('webview', `${phase.phase}/trace.zip`, 'trace fixture')
  }
  for (const name of ['child-before-restart-trace', 'child-1-trace']) add('webview', `corrector/${name}.zip`, 'trace fixture')
  for (const id of [...webviewScenarios.map(([id]) => id), ...extraWebviewScreenshots]) add('webview', `screenshots/${id}.png`, png)
  add('explorer', 'os-observation.json', { ...observation, inputMode: 'os-input', interactive: true, windowsClosed: true, ownedProcessesExited: true })
  add('explorer', 'trace.zip', 'trace fixture')
  for (const item of explorer.cases) {
    add('explorer', `${item.id}-input.json`, item.input); add('explorer', `${item.id}.xsr`, 'saved fixture')
    for (const suffix of ['selection', 'result']) add('explorer', `screenshots/${item.id}-${suffix}.png`, png)
  }
  const references = { webview: { path: 'webview/result.json', sha256: '' }, explorer: { path: 'explorer/result.json', sha256: '' } }
  const save = () => {
    for (const [kind, report] of Object.entries({ webview, explorer })) {
      write(`${kind}/result.json`, report)
      references[kind as keyof typeof references].sha256 = sha256(fs.readFileSync(path.join(root, kind, 'result.json')))
    }
  }
  save()
  return { root, write, add, save, webview, explorer, artifacts, references, applications,
    validate: () => validateLayeredReports(root, references, identity, artifacts) }
}

describe('Layered EXE acceptance', () => {
  it('preserves all 13 functional observations and separates eleven protocol cases from two OS drops', () => {
    expect([...webviewScenarios, ...explorerScenarios].map(([id]) => id).sort()).toEqual(computerUseScenarios.flatMap(s => s.checks).map(([id]) => id).sort())
    const f = fixture(); expect(f.validate().map(s => s.checks)).toEqual([11, 2])
    const recordPath = prepareLayeredAcceptance(f.root, identity, f.artifacts)
    expect(() => readComputerUseAcceptance(f.root, identity)).toThrow('incomplete')
    const result = collectLayeredAcceptance(f.root, recordPath, identity, f.artifacts, f.references.webview.path, f.references.explorer.path)
    expect(result.automationComplete).toBe(true)
    expect(readComputerUseAcceptance(f.root, identity).recordSha256).toBe(result.recordSha256)
    expect(() => collectLayeredAcceptance(f.root, recordPath, identity, f.artifacts, f.references.webview.path, f.references.explorer.path)).toThrow('new acceptance record')
  })
  it('rejects missing/duplicate cases and a failed phase despite an overall pass label', () => {
    const f = fixture(), original = structuredClone(f.webview.cases)
    f.webview.cases.pop(); f.save(); expect(f.validate).toThrow('Incomplete')
    f.webview.cases = structuredClone(original); f.webview.cases[0] = f.webview.cases[1]; f.save(); expect(f.validate).toThrow('duplicate')
    f.webview.cases = original; f.webview.phases[0].status = 'failed'; f.save(); expect(f.validate).toThrow()
  })
  it.each(['baseline-diagnostic', 'working-tree-diagnostic'])('rejects %s at the publication gate', scope => {
    const f = fixture(); f.webview.scope = scope; f.save(); expect(f.validate).toThrow('cannot certify acceptance')
  })
  it('rejects changed source, npm, loader options and unobserved expectations', () => {
    const f = fixture(), original = structuredClone(f.webview.harnessIdentity)
    for (const update of [{ sourceSha256: 'other' }, { npm: '11.7.0' }, { nodeOptions: '--some-other-mode' }, { nodeExecArgv: [] }]) {
      f.webview.harnessIdentity = { ...original, ...update }; f.save(); expect(f.validate).toThrow('source/runtime')
    }
    f.webview.harnessIdentity = original; f.webview.cases[0].expected = 'weaker'; f.save(); expect(f.validate).toThrow('Scenario expectation')
  })
  it('rejects mismatched EXE bytes, build sessions and runtime versions', () => {
    const f = fixture(); f.webview.artifacts.remap.buildSessionId = 'old'; f.save(); expect(f.validate).toThrow('buildSessionId')
    f.webview.artifacts.remap.buildSessionId = 'coherent'; f.webview.phases[0].runtime.playwright = 'old'; f.save(); expect(f.validate).toThrow()
    f.write('dev-local/xsheet-remap.exe', 'different'); expect(f.validate).toThrow('SHA-256')
  })
  it('rejects altered/missing captures, held-preview evidence, paths escaping their directory and invalid times', () => {
    const f = fixture(), original = structuredClone(f.webview.files)
    f.webview.files = original.filter(file => !file.path.includes('range-history-held')); f.save(); expect(f.validate).toThrow('Required evidence')
    f.webview.files = structuredClone(original); f.webview.files[0].path = '../dev-local/xsheet-remap.exe'; f.save(); expect(f.validate).toThrow('leaves its directory')
    f.webview.files = structuredClone(original); f.webview.cases[0].finishedAt = f.webview.cases[0].startedAt; f.save(); expect(f.validate).toThrow('observation times')
    f.write('webview/screenshots/range-history.png', png.subarray(1)); expect(f.validate).toThrow('content/hash')
  })
  it('accepts only the observed one-millisecond filesystem/JS clock rounding boundary', () => {
    const f = fixture(), item = f.webview.cases[0]
    const capture = f.webview.files.find(file => file.path === `screenshots/${item.id}.png`)!
    capture.capturedAt = new Date(Date.parse(item.finishedAt) + 1).toISOString(); f.save()
    expect(f.validate().map(s => s.checks)).toEqual([11, 2])
    capture.capturedAt = new Date(Date.parse(item.finishedAt) + 2).toISOString(); f.save()
    expect(f.validate).toThrow('outside case observation')
  })
  it('also rejects a stale selection capture outside the one-millisecond boundary', () => {
    const f = fixture(), item = f.explorer.cases[0]
    const capture = f.explorer.files.find(file => file.path === `screenshots/${item.id}-selection.png`)!
    capture.capturedAt = new Date(Date.parse(item.startedAt) - 2).toISOString(); f.save()
    expect(f.validate).toThrow('outside case observation')
  })
  it('rejects foreground activation, a switched desktop and missing cleanup', () => {
    const f = fixture(), phase = f.webview.phases[0], original = { ...phase.osObservation }
    for (const update of [{ foregroundOwned: true }, { inputDesktopAfter: 'other' }, { desktopReleased: false }, { samples: 0 }]) {
      phase.osObservation = { ...original, ...update }; f.add('webview', `${phase.phase}/os-observation.json`, phase.osObservation); f.save(); expect(f.validate).toThrow()
    }
  })
  it.each(['human', 'assisted'])('rejects %s Explorer input and protocol substitution', actor => {
    const f = fixture(), item = f.explorer.cases[0]
    item.input.actor = actor; f.add('explorer', `${item.id}-input.json`, item.input); f.save(); expect(f.validate).toThrow('Human/assisted')
    item.input.actor = 'automation'; item.input.method = 'CDP.dispatchMouseEvent'; f.add('explorer', `${item.id}-input.json`, item.input); f.save(); expect(f.validate).toThrow('Protocol input')
  })
  it('rejects duplicate OS drops, mismatched selections and extra/partial imported images', () => {
    const f = fixture(), item = f.explorer.cases[1], original = structuredClone(item)
    item.input.attempts = 2; f.add('explorer', `${item.id}-input.json`, item.input); f.save(); expect(f.validate).toThrow()
    Object.assign(item, structuredClone(original)); item.observedDrops[0].paths.pop(); f.add('explorer', `${item.id}-input.json`, item.input); f.save(); expect(f.validate).toThrow('received paths')
    Object.assign(item, structuredClone(original)); item.importedNames.push('Unselected'); f.save(); expect(f.validate).toThrow('extra image')
  })
  it('revalidates raw report hashes and refuses an incomplete outer record or changed candidate', () => {
    const f = fixture(), recordPath = prepareLayeredAcceptance(f.root, identity, f.artifacts)
    collectLayeredAcceptance(f.root, recordPath, identity, f.artifacts, f.references.webview.path, f.references.explorer.path)
    f.write(f.references.explorer.path, '{}')
    expect(() => validateLayeredAcceptance(f.root, recordPath, identity, f.artifacts)).toThrow('content/hash')
    expect(() => validateLayeredAcceptance(f.root, recordPath, { ...identity, workingTreeDirty: true }, f.artifacts)).toThrow('source/runtime')
  })
})
