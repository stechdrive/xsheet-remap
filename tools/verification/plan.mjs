// Share check definitions, but keep full interaction acceptance local.
// CI verifies deterministic checks and a small smoke suite on the deployed bytes.
export const browserProjects = ['chromium', 'webkit', 'chromium-touch', 'webkit-touch']
export const ciBrowserTestFiles = ['startup.spec.ts', 'pwa.spec.ts']
export const checks = {
  check: ['check:ae-template', 'lint', 'typecheck', 'test', 'check:architecture', 'check:build-contract', 'check:pages-contract', 'check:embedded-dependencies', 'check:repo-hygiene'],
  native: ['check:after-effects-native', 'check:corrector-native'],
  importer: ['test:clip'],
  pages: ['build:pages', 'check:pages-artifact'],
  desktop: [], // Native-input checklist; run.mjs verifies its evidence.
}
export const testPurposes = {
  check: 'Static, type and unit checks; simulated DOM is not real browser layout or IME',
  node: 'Data, history, serialization, real CanvasKit pixels and artifact policies without DOM',
  dom: 'React state and simulated input lifecycles',
  browser: 'Same Pages artifact: rendering, editing, layout, service-worker update and offline reuse',
  'browser-ci': 'Pages entry points, runtime loading and service-worker lifecycle in Chromium; no gesture or GPU performance acceptance',
  native: 'Windows After Effects export and native boundary behavior',
  importer: 'Direct CLIP container, pixel placement and timeline generation',
  webview: 'npm run verify:webview: exact EXE native image/IPC/save/reload via CDP, with isolated profile and foreground monitoring. Injected events do not certify OS receipt. Explicit baseline diagnostics do not certify working-tree changes.',
  desktop: 'Validate per-case automated OS input observations of the exact current EXEs. Manual/assisted/protocol input cannot be relabelled as automation. This command does not operate the GUI.',
  device: 'Manual device evidence: trusted composition/touch events and operator-observed result',
}
export function withoutGeneratedVersion(file, source) {
  if (/(?:^|\/)package(?:-lock)?\.json$/.test(file)) {
    const data = JSON.parse(source)
    delete data.version
    for (const [key, value] of Object.entries(data.packages ?? {})) {
      if (key === '' || /^(?:apps|packages|tools)\//.test(key)) delete value.version
    }
    return JSON.stringify(data)
  }
  if (/^apps\/[^/]+\/src-tauri\/Cargo\.toml$/.test(file)) return source.replace(/(\[package\][\s\S]*?)^version\s*=.*$/m, '$1version = "<generated>"')
  if (/^apps\/[^/]+\/src-tauri\/Cargo\.lock$/.test(file)) return source.replace(/(\[\[package\]\]\s+name = "xsheet-(?:remap|editor|corrector)"\s+)version = "[^"]+"/g, '$1version = "<generated>"')
  if (/\/tauri\.conf\.json$/.test(file)) { const data = JSON.parse(source); delete data.version; return JSON.stringify(data) }
  if (file === 'VERSION' || file === 'packages/ui/src/appVersion.ts') return '<generated>'
  return source
}
export function verificationScriptsOnly(beforeSource, afterSource) {
  if (!beforeSource || !afterSource) return false
  const before = JSON.parse(beforeSource), after = JSON.parse(afterSource)
  const oldScripts = before.scripts ?? {}, newScripts = after.scripts ?? {}
  const changed = [...new Set([...Object.keys(oldScripts), ...Object.keys(newScripts)])].filter(name => oldScripts[name] !== newScripts[name])
  delete before.scripts; delete after.scripts; delete before.version; delete after.version
  return JSON.stringify(before) === JSON.stringify(after) && changed.length > 0
    && changed.every(name => /^(?:(?:test|check|verify|e2e)(?::|$)|desktop:(?:prepare|capabilities)$)/.test(name))
}

export function selectChecks(files, { release = false, packageChanges = {} } = {}) {
  const normalized = [...new Set(files.map(file => file.replaceAll('\\', '/')))].sort()
  const selected = { check: release, pages: release, native: release, importer: release, webview: release, desktop: release }
  const reasons = [], targets = new Set(release ? ['remap', 'corrector'] : []), browserFiles = new Set()
  let allBrowserFiles = release
  function require(file, category, phases, apps = [], specs = []) {
    for (const phase of phases) selected[phase] = true
    for (const app of apps) targets.add(app)
    for (const spec of specs) browserFiles.add(spec)
    if (phases.includes('pages') && !specs.length) allBrowserFiles = true
    reasons.push({ file, category, phases })
  }
  if (release) reasons.push({ file: null, category: 'release', phases: Object.keys(selected) })
  for (const file of normalized) {
    if (/\.(?:md|txt)$/.test(file) || /^(?:LICENSE|AGENTS\.md)$/.test(file)) {
      reasons.push({ file, category: 'documentation', phases: ['hygiene'] }); continue
    }
    if (/^(?:VERSION|BUILD_NUMBER)$/.test(file) || file === 'packages/ui/src/appVersion.ts') continue
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(file) || /^(?:vitest\.config\.ts|eslint\.config\.|tools\/(?:verification|checks)\/)/.test(file)) {
      require(file, 'verification', ['check']); continue
    }
    if (/(?:^|\/)package(?:-lock)?\.json$/.test(file) || /^(?:\.node-version|\.npmrc|rust-toolchain\.toml)$/.test(file)) {
      const change = packageChanges[file]
      if (file.endsWith('package.json') && change && verificationScriptsOnly(change.before, change.after)) {
        require(file, 'verification-scripts', ['check']); continue
      }
      require(file, 'dependencies', Object.keys(selected), ['remap', 'corrector']); continue
    }
    if (/^(?:native\/|apps\/[^/]+\/src-tauri\/|tools\/(?:desktop|after-effects)\/)/.test(file)) {
      const app = file.startsWith('apps/sheet-corrector/') ? ['corrector'] : /^apps\/(?:desktop|editor)\//.test(file) ? ['remap'] : ['remap', 'corrector']
      require(file, 'desktop-host', ['check', 'native', 'webview', 'desktop'], app); continue
    }
    if (/^packages\/(?:adapters|core)\/src\/clip|^tools\/clip\//.test(file)) {
      require(file, 'clip-format', ['check', 'importer', 'pages', 'webview'], ['remap']); continue
    }
    if (/^packages\/ui\/src\//.test(file)) {
      const inputBoundary = /(?:native|internalDrag|PointerDrag|app-foundation|app-shell-controller|ClipLayerPanel|clipLayerDrop|app-sheet-canvas-controller)/i.test(file)
      const nativeBoundary = inputBoundary || /(?:clipImageImport|sheetImages|persistence|ProjectFile|projectFile|TemplateEditorApp|sheet-corrector-app)/i.test(file)
      const specs = /(?:clip|nativeFile|internalDrag)/i.test(file) ? ['clip-drag-feedback.spec.ts', 'clip-process.spec.ts']
        : /(?:template)/i.test(file) ? ['template-authoring.spec.ts']
          : /(?:timing|PointerDrag|app-sheet-canvas-controller)/i.test(file) ? ['timing-drag.spec.ts'] : []
      require(file, inputBoundary ? 'input-boundary' : nativeBoundary ? 'desktop-ui' : 'ui',
        ['check', 'pages', ...(nativeBoundary ? ['webview'] : []), ...(inputBoundary ? ['desktop'] : [])],
        nativeBoundary ? file.includes('sheet-corrector') ? ['corrector'] : ['remap'] : [], specs)
      continue
    }
    if (/^packages\/(?:core|xdts)\//.test(file)) { require(file, 'data', ['check', 'pages']); continue }
    if (/^packages\/adapters\//.test(file)) {
      require(file, 'adapter', ['check', 'pages', 'webview', 'desktop'], ['remap', 'corrector']); continue
    }
    if (/^(?:tools\/e2e\/|tools\/smoke\/)/.test(file)) { require(file, 'test-runner', ['check']); continue }
    if (/^(?:apps\/web\/|tools\/pages\/)/.test(file)) { require(file, 'web-build', ['check', 'pages', 'webview'], ['remap', 'corrector']); continue }
    // Unknown paths deliberately keep the broad candidate plan.
    require(file, 'unclassified', Object.keys(selected), ['remap', 'corrector'])
  }
  return { ...selected, browser: selected.pages ? browserProjects : [], ciBrowser: selected.pages ? ciBrowserTestFiles : [],
    browserSelection: { files: allBrowserFiles ? [] : [...browserFiles].sort(), full: allBrowserFiles },
    desktopTargets: [...targets].sort(), reasons }
}
