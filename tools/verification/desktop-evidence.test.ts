import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertCurrentRemapSurface, readDesktopScenarioEvidence, validateDesktopScenarioEvidence } from './desktop-evidence.mjs'
import { selectChecks } from './plan.mjs'

const url = 'http://tauri.localhost/index.html?app=remap'
const sheet = { url, sheetMode: true, clipMode: false, legacyAssetBrowser: false, legacyCspTree: false, clipTreeVisible: false, clipTreeOnRight: false }
const clip = { ...sheet, sheetMode: false, clipMode: true, clipTreeVisible: true, clipTreeOnRight: true }
function fixture(scenario = 'real-dnd') {
  const testCase = scenario === 'real-dnd' ? 'registered-cell' : 'explorer-import'
  const manifest = { appMode: 'remap', uiSurface: 'current-remap-workspace', scenario: `current-remap-${testCase}`, exeSha256: 'test-exe-hash',
    inputMode: scenario === 'real-dnd' ? 'native-mouse-keyboard-clip-layer-and-range-drag' : 'native-mouse-explorer-file-drop' }
  const result = { passed: true, scenario: manifest.scenario, checks: ['current UI', 'native gestures'],
    diagnostics: { appEntry: { launchedUrl: url }, 'surface:0:sheet': { ...sheet }, 'surface:1:clip': { ...clip } },
    operations: ['click-screen', 'drag-explorer-item', 'drag-explorer-items', 'mouse-down-screen', 'mouse-up-screen', 'key-press'].map(command => ({ command })) }
  return { manifest, result }
}

describe('current desktop acceptance evidence', () => {
  it.each(['real-dnd', 'explorer-import'])('accepts %s only through both current modes and native input', scenario => {
    const { manifest, result } = fixture(scenario)
    expect(() => validateDesktopScenarioEvidence(scenario, manifest, result)).not.toThrow()
  })
  it('rejects a passed legacy scenario even when its EXE and input were genuine', () => {
    const { manifest, result } = fixture()
    for (const changed of [{ appMode: 'editor' }, { uiSurface: 'legacy-workspace-diagnostic' }, { scenario: 'registered-cell-real-dnd' }, { inputMode: 'browser-protocol-and-dom' }]) {
      expect(() => validateDesktopScenarioEvidence('real-dnd', { ...manifest, ...changed }, result)).toThrow('cannot certify')
    }
  })
  it('rejects normal-URL fixtures that restore either old pane', () => {
    for (const changed of [{ legacyAssetBrowser: true }, { legacyCspTree: true }, { legacyAssetBrowser: undefined }]) {
      expect(() => assertCurrentRemapSurface({ ...sheet, ...changed }, 'sheet', url)).toThrow('Legacy')
    }
  })
  it('rejects entry rewrites, wrong modes and a missing or misplaced right tree', () => {
    expect(() => assertCurrentRemapSurface({ ...sheet, url: url.replace('remap', 'editor') }, 'sheet', url)).toThrow('normal Remap entry')
    expect(() => assertCurrentRemapSurface({ ...sheet, url: `${url}&fixture=old` }, 'sheet', url)).toThrow('normal Remap entry')
    expect(() => assertCurrentRemapSurface(clip, 'sheet', url)).toThrow('work mode')
    for (const changed of [{ clipTreeVisible: false }, { clipTreeOnRight: false }]) {
      expect(() => assertCurrentRemapSurface({ ...clip, ...changed }, 'clip', url)).toThrow('visibility or placement')
    }
    expect(() => assertCurrentRemapSurface({ ...sheet, clipTreeVisible: true }, 'sheet', url)).toThrow('visibility or placement')
  })
  it('requires recorded sheet/CLIP modes, native operations and an actually passed result', () => {
    const { manifest, result } = fixture()
    expect(() => validateDesktopScenarioEvidence('real-dnd', manifest, { ...result, diagnostics: {} })).toThrow('both current work modes')
    expect(() => validateDesktopScenarioEvidence('real-dnd', manifest, { ...result, operations: [] })).toThrow('native input operations')
    expect(() => validateDesktopScenarioEvidence('real-dnd', manifest, { ...result, passed: false })).toThrow('did not pass')
  })
  it.each(['template-entry', 'template-authoring'])('retains real input requirements for %s', scenario => {
    const inputMode = scenario === 'template-entry' ? 'native-mouse-keyboard-with-process-recovery' : 'native-mouse-keyboard'
    expect(() => validateDesktopScenarioEvidence(scenario, { scenario, inputMode }, { passed: true })).not.toThrow()
    expect(() => validateDesktopScenarioEvidence(scenario, { scenario, inputMode: 'browser-protocol-and-dom' }, { passed: true })).toThrow('native input')
  })
  it('reads the fresh runner output and rejects stale ambiguity or a failed runner summary', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'xsheet-desktop-evidence-'))
    try {
      const directory = 'scenario', run = path.join(root, directory, 'one')
      mkdirSync(run, { recursive: true })
      const { manifest, result } = fixture()
      const write = (name: string, value: unknown) => writeFileSync(path.join(run, `${name}.json`), `\uFEFF${JSON.stringify(value)}`)
      write('manifest', manifest); write('result', result); write('summary', { passed: true })
      expect(readDesktopScenarioEvidence(root, directory, 'real-dnd')).toMatchObject({ uiSurface: 'current-remap-workspace', checks: 2, exeSha256: 'test-exe-hash' })
      write('summary', { passed: false })
      expect(() => readDesktopScenarioEvidence(root, directory, 'real-dnd')).toThrow('runner failed')
      mkdirSync(path.join(root, directory, 'two'))
      expect(() => readDesktopScenarioEvidence(root, directory, 'real-dnd')).toThrow('exactly one fresh')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('selects desktop acceptance when its current UI scenario or evidence policy changes', () => {
    for (const file of ['tools/e2e/remap-workspace-native.ts', 'tools/verification/desktop-evidence.mjs']) {
      expect(selectChecks([file]).desktop).toBe(true)
    }
  })
})
