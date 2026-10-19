import fs from 'node:fs'
import path from 'node:path'

/** Acceptance must observe the shipped entry, not navigate to a legacy UI. */
export function assertCurrentRemapSurface(surface, mode, launchedUrl) {
  if (surface.url !== launchedUrl || new URL(surface.url).searchParams.get('app') !== 'remap') {
    throw new Error('Desktop acceptance left the normal Remap entry')
  }
  if (surface.legacyAssetBrowser !== false || surface.legacyCspTree !== false) {
    throw new Error('Legacy asset browser or CSP tree cannot certify the current Remap UI')
  }
  if (surface.sheetMode !== (mode === 'sheet') || surface.clipMode !== (mode === 'clip')) {
    throw new Error(`Current Remap work mode differs from ${mode}`)
  }
  if (mode === 'clip' ? surface.clipTreeVisible !== true || surface.clipTreeOnRight !== true : surface.clipTreeVisible !== false) {
    throw new Error('Current Remap layer workspace has unexpected visibility or placement')
  }
}

export function validateDesktopScenarioEvidence(scenario, manifest, result) {
  if (result.passed !== true) throw new Error(`Desktop scenario did not pass: ${scenario}`)
  if (scenario === 'template-entry' || scenario === 'template-authoring') {
    const expected = scenario === 'template-entry' ? 'native-mouse-keyboard-with-process-recovery' : 'native-mouse-keyboard'
    if (manifest.scenario !== scenario || manifest.inputMode !== expected) throw new Error('Template acceptance requires its native input scenario')
    return
  }
  const testCase = scenario === 'real-dnd' ? 'registered-cell' : scenario === 'explorer-import' ? scenario : null
  if (!testCase) throw new Error(`Unknown desktop acceptance scenario: ${scenario}`)
  const expectedScenario = `current-remap-${testCase}`
  const expectedInput = scenario === 'real-dnd' ? 'native-mouse-keyboard-clip-layer-and-range-drag' : 'native-mouse-explorer-file-drop'
  if (manifest.appMode !== 'remap' || manifest.uiSurface !== 'current-remap-workspace'
    || manifest.scenario !== expectedScenario || result.scenario !== expectedScenario || manifest.inputMode !== expectedInput) {
    throw new Error('Legacy or protocol-only desktop evidence cannot certify the current Remap workspace')
  }
  const entry = result.diagnostics?.appEntry
  const surfaces = Object.entries(result.diagnostics ?? {}).filter(([key]) => key.startsWith('surface:')).map(([, value]) => value)
  if (!entry?.launchedUrl || !surfaces.some(surface => surface.sheetMode) || !surfaces.some(surface => surface.clipMode)) {
    throw new Error('Desktop acceptance must record both current work modes')
  }
  for (const surface of surfaces) assertCurrentRemapSurface(surface, surface.clipMode ? 'clip' : 'sheet', entry.launchedUrl)
  const commands = new Set((result.operations ?? []).map(operation => operation.command))
  const required = scenario === 'real-dnd'
    ? ['click-screen', 'drag-explorer-item', 'mouse-down-screen', 'mouse-up-screen', 'key-press']
    : ['click-screen', 'drag-explorer-item', 'drag-explorer-items', 'key-press']
  if (required.some(command => !commands.has(command))) throw new Error('Required native input operations are missing')
}

export function readDesktopScenarioEvidence(root, directory, scenario) {
  const base = path.join(root, directory)
  const runs = fs.readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory())
  if (runs.length !== 1) throw new Error(`Expected exactly one fresh desktop run for ${scenario}`)
  const run = path.join(base, runs[0].name)
  const read = name => JSON.parse(fs.readFileSync(path.join(run, name), 'utf8').replace(/^\uFEFF/, ''))
  const manifest = read('manifest.json'), result = read('result.json'), summary = read('summary.json')
  if (summary.passed !== true) throw new Error(`Desktop runner failed: ${scenario}`)
  validateDesktopScenarioEvidence(scenario, manifest, result)
  return { scenario, uiSurface: manifest.uiSurface ?? 'current-template-editor', inputMode: manifest.inputMode,
    exeSha256: manifest.exeSha256, checks: result.checks?.length ?? 0, directory: path.relative(root, run) }
}
