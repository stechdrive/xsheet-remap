import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assessDesktopCapabilities, desktopCheckRequirements, prepareComputerUseAcceptance, readComputerUseAcceptance, summarizeDesktopActors, validateComputerUseAcceptance } from './computer-use-desktop.mjs'
import { sha256 } from './evidence.mjs'
import { parseOptions } from './options.mjs'
import { selectChecks } from './plan.mjs'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
const identity = { commit: 'current', sourceSha256: 'current-source', workingTreeDirty: false,
  platform: 'win32', arch: 'x64', node: 'v26.12.1', npm: '11.20.0', nodeOptions: '', nodeExecArgv: [] }
// Synthetic policy fixture, never an operational capability claim or GUI observation.
const profile = { tool: 'policy-test-fixture', version: '1', capabilities: { pointer: true, keyboard: true,
  crossWindowFileDrop: true, observeHeldPointer: true, restartProcess: true } }

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xsheet-computer-use-')); roots.push(root)
  fs.mkdirSync(path.join(root, 'dev-local'))
  const applications = Object.fromEntries(['remap', 'corrector'].map(key => {
    const executable = `xsheet-${key}.exe`, bytes = Buffer.from(key)
    fs.writeFileSync(path.join(root, 'dev-local', executable), bytes)
    return [key, { executable, sha256: sha256(bytes), commit: identity.commit, workingTreeDirty: false,
      version: '0.1.830', buildSessionId: 'same-build', runtime: { node: identity.node, npm: identity.npm } }]
  }))
  const statePath = path.join(root, 'dev-local/build-state.json')
  fs.writeFileSync(statePath, JSON.stringify({ applications }))
  const recordPath = prepareComputerUseAcceptance(root, identity, profile)
  const full = path.join(root, recordPath)
  const record = JSON.parse(fs.readFileSync(full, 'utf8'))
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')
  fs.writeFileSync(path.join(path.dirname(full), 'screenshots', 'observed.png'), png)
  const start = Date.parse(record.preparedAt) + 1000
  Object.assign(record, { status: 'passed', operator: 'Codex via @oai/sky', startedAt: new Date(start).toISOString(), finishedAt: new Date(start + 3000).toISOString() })
  for (const scenario of record.scenarios) for (const check of scenario.checks) {
    Object.assign(check, { status: 'passed', steps: ['sky.click/drag/press_key; observed the refreshed target window'], observed: 'The expected visible result was observed.',
      executor: { actor: 'automation', tool: profile.tool, version: profile.version }, methods: desktopCheckRequirements[check.id].methods,
      startedAt: new Date(start).toISOString(), finishedAt: new Date(start + 3000).toISOString(),
      screenshots: [{ path: 'screenshots/observed.png', sha256: sha256(png), screenshotId: 'sky-observation-1', capturedAt: new Date(start + 1000).toISOString() }] })
  }
  const save = () => fs.writeFileSync(full, JSON.stringify(record))
  const validate = () => validateComputerUseAcceptance(root, recordPath, identity, start + 5000)
  return { root, record, recordPath, applications, statePath, save, validate, now: start + 5000 }
}

describe('Computer Use desktop acceptance', () => {
  it('creates a pending checklist without certifying or driving the GUI', () => {
    const { root, recordPath, record } = fixture()
    const prepared = JSON.parse(fs.readFileSync(path.join(root, recordPath), 'utf8'))
    expect(prepared.status).toBe('pending')
    expect(prepared.scenarios.map((s: { id: string }) => s.id)).toEqual(['template-entry', 'template-authoring', 'explorer-import', 'real-dnd'])
    expect(() => readComputerUseAcceptance(root, identity)).toThrow('incomplete')
    expect(prepared.scenarios.flatMap((s: { checks: unknown[] }) => s.checks)).toHaveLength(13)
    expect(record.artifacts.remap.sha256).toBe(sha256(Buffer.from('remap')))
  })
  it('validates complete observations for the exact artifacts and preserves their original observation time', () => {
    const { root, recordPath, record, save, validate } = fixture(); save()
    expect(validate()).toMatchObject({ recordPath, finishedAt: record.finishedAt, scenarios: expect.arrayContaining([
      expect.objectContaining({ scenario: 'real-dnd', inputMode: 'os-input', checks: 4, directory: path.dirname(recordPath) }),
    ]) })
    expect(fs.existsSync(path.join(root, path.dirname(recordPath), 'prepared.json'))).toBe(true)
  })
  it.each(['pending', 'failed', 'blocked', 'skipped'])('rejects %s checks even when the overall result says passed', status => {
    const f = fixture(); f.record.scenarios[3].checks[1].status = status; f.save()
    expect(f.validate).toThrow('Unverified')
  })
  it('rejects missing and duplicated scenarios/checks, including cancellation', () => {
    const f = fixture(), original = structuredClone(f.record.scenarios)
    f.record.scenarios.pop(); f.save(); expect(f.validate).toThrow('scenarios')
    f.record.scenarios = structuredClone(original); f.record.scenarios[3] = f.record.scenarios[2]; f.save(); expect(f.validate).toThrow('scenarios')
    f.record.scenarios = structuredClone(original); f.record.scenarios[3].checks.splice(1, 1); f.save(); expect(f.validate).toThrow('checks')
    f.record.scenarios = structuredClone(original); f.record.scenarios[3].checks[1] = f.record.scenarios[3].checks[0]; f.save(); expect(f.validate).toThrow('checks')
  })
  it('rejects legacy/protocol input claims and unrecorded observations', () => {
    const f = fixture()
    f.record.inputMode = 'browser-protocol'; f.save(); expect(f.validate).toThrow('Per-check native input evidence is required')
    f.record.inputMode = 'os-input'; f.record.scenarios[0].checks[0].observed = ''; f.save(); expect(f.validate).toThrow('Unverified')
    f.record.scenarios[0].checks[0].observed = 'observed'; f.record.scenarios[0].checks[0].steps = []; f.save(); expect(f.validate).toThrow('Unverified')
  })
  it('rejects a different source, runtime, dirty worktree, or replaced executable', () => {
    const f = fixture(); f.save()
    for (const altered of [{ ...identity, sourceSha256: 'other' }, { ...identity, npm: '11.20.1' }, { ...identity, workingTreeDirty: true }]) {
      expect(() => validateComputerUseAcceptance(f.root, f.recordPath, altered, f.now)).toThrow('source and runtime')
    }
    fs.writeFileSync(path.join(f.root, 'dev-local/xsheet-remap.exe'), 'changed bytes')
    expect(f.validate).toThrow('SHA-256')
  })
  it('rejects new build sessions even if the resulting executable bytes are identical', () => {
    const f = fixture(); f.save()
    for (const artifact of Object.values(f.applications)) artifact.buildSessionId = 'another-build'
    fs.writeFileSync(f.statePath, JSON.stringify({ applications: f.applications }))
    expect(f.validate).toThrow('build sessions')
  })
  it('refuses preparation for dirty, stale, mixed or non-Windows candidates', () => {
    const f = fixture()
    expect(() => prepareComputerUseAcceptance(f.root, { ...identity, workingTreeDirty: true })).toThrow('clean commit')
    expect(() => prepareComputerUseAcceptance(f.root, { ...identity, commit: 'different' })).toThrow('clean commit')
    expect(() => prepareComputerUseAcceptance(f.root, { ...identity, platform: 'linux' })).toThrow('Windows')
    f.applications.corrector.buildSessionId = 'different'
    fs.writeFileSync(f.statePath, JSON.stringify({ applications: f.applications }))
    expect(() => prepareComputerUseAcceptance(f.root, identity)).toThrow('same session')
  })
  it('rejects missing, modified or out-of-directory screenshot evidence', () => {
    const f = fixture(), check = f.record.scenarios[0].checks[0], screenshot = structuredClone(check.screenshots[0])
    check.screenshots = []; f.save(); expect(f.validate).toThrow('Screenshot evidence is missing')
    check.screenshots = [{ ...screenshot, sha256: 'changed' }]; f.save(); expect(f.validate).toThrow('content/hash')
    check.screenshots = [{ ...screenshot, path: '../../../../dev-local/xsheet-remap.exe' }]; f.save(); expect(f.validate).toThrow('leaves its directory')
    check.screenshots = [{ ...screenshot, screenshotId: '' }]; f.save(); expect(f.validate).toThrow('screenshot ID')
    check.screenshots = [{ ...screenshot, capturedAt: new Date(f.now + 1).toISOString() }]; f.save(); expect(f.validate).toThrow('outside the recorded observation')
  })
  it('rejects fabricated future or backwards observation times', () => {
    const f = fixture()
    f.record.finishedAt = new Date(f.now + 1).toISOString(); f.save(); expect(f.validate).toThrow('observation times')
    f.record.finishedAt = f.record.preparedAt; f.save(); expect(f.validate).toThrow('observation times')
  })
  it('does not allow filters or reuse to bypass full Computer Use acceptance', () => {
    expect(parseOptions(['desktop', '--evidence=reference-local/run/record.json']).evidence).toBe('reference-local/run/record.json')
    for (const option of ['--reuse', '--project=chromium', '--grep=one', '--suite=functional']) expect(() => parseOptions(['desktop', option])).toThrow('Unsupported')
    expect(selectChecks(['tools/verification/computer-use-desktop.mjs']).desktop).toBe(false)
  })
  it.each(['human', 'assisted', undefined])('does not turn %s input into automated acceptance through an overall label', actor => {
    const f = fixture(); f.record.scenarios[2].checks[0].executor.actor = actor; f.save()
    expect(f.validate).toThrow('not automated acceptance')
    expect(summarizeDesktopActors(f.record).automation).toBe(12)
  })
  it('rejects a per-check protocol substitute, missing assertion, stale scenario or wrong EXE', () => {
    const f = fixture(), check = f.record.scenarios[2].checks[0], original = structuredClone(check)
    for (const [property, value, message] of [
      ['inputMode', 'browser-protocol', 'Native input methods'], ['methods', ['pointer', 'keyboard'], 'Native input methods'],
      ['expected', undefined, 'Scenario contract'], ['scenarioVersion', 1, 'Scenario contract'], ['artifact', 'corrector', 'Wrong EXE'],
      ['startedAt', null, 'check observation times'],
    ] as const) {
      Object.assign(check, structuredClone(original), { [property]: value }); f.save(); expect(f.validate).toThrow(message)
    }
  })
  it('blocks only unsupported cases before GUI launch and refuses a forged passed result', () => {
    const limited = { ...profile, capabilities: { ...profile.capabilities, crossWindowFileDrop: false, observeHeldPointer: false } }
    const assessment = assessDesktopCapabilities(limited)
    expect(Object.entries(assessment).filter(([, value]) => value.status === 'blocked').map(([id]) => id)).toEqual(['folder-drop', 'multiple-file-drop', 'range-history'])
    expect(assessDesktopCapabilities(null)['corrector-entry'].status).toBe('blocked')
    const f = fixture(); f.record.profile = limited; f.save(); expect(f.validate).toThrow('Required input capability unavailable')
  })
  it('keeps legacy observations historical and requires an identified version of the input tool', () => {
    const f = fixture(); f.record.schemaVersion = 1; f.save(); expect(f.validate).toThrow('historical observations')
    f.record.schemaVersion = 2; f.record.scenarios[0].checks[0].executor.version = ''; f.save(); expect(f.validate).toThrow('executor/version')
  })
})
