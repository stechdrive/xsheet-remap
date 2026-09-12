// One plan for local preflight and CI. Emulations do not certify physical devices or OS IMEs.
export const browserProjects = ['chromium', 'webkit', 'chromium-touch', 'webkit-touch']
export const checks = {
  check: ['check:ae-template', 'lint', 'typecheck', 'test', 'check:architecture', 'check:build-contract', 'check:pages-contract', 'check:embedded-dependencies', 'check:repo-hygiene'],
  native: ['check:after-effects-native'],
  importer: ['test:csp-helper'],
  pages: ['build:pages', 'check:pages-artifact'],
}
export const testPurposes = {
  check: 'Static, type and unit checks; simulated DOM is not real browser layout or IME',
  node: 'Data, history, serialization, real CanvasKit pixels and artifact policies without DOM',
  dom: 'React state and simulated input lifecycles',
  browser: 'Same Pages artifact: rendering, editing, layout, service-worker update and offline reuse',
  native: 'Windows After Effects export and native boundary behavior',
  importer: 'CSP importer parsing, recovery and automation policy with mocked CSP',
  desktop: 'Built EXE with verified source and SHA-256; scenario-specific native or protocol input',
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
  if (/^apps\/(?:[^/]+\/src-tauri|csp-import-helper\/launcher)\/Cargo\.toml$/.test(file)) return source.replace(/(\[package\][\s\S]*?)^version\s*=.*$/m, '$1version = "<generated>"')
  if (/^apps\/(?:[^/]+\/src-tauri|csp-import-helper\/launcher)\/Cargo\.lock$/.test(file)) return source.replace(/(\[\[package\]\]\s+name = "xsheet-(?:remap|editor|template|corrector|importer)"\s+)version = "[^"]+"/g, '$1version = "<generated>"')
  if (/\/tauri\.conf\.json$/.test(file)) { const data = JSON.parse(source); delete data.version; return JSON.stringify(data) }
  if (file === 'VERSION' || file === 'packages/ui/src/appVersion.ts') return '<generated>'
  if (file === 'apps/csp-import-helper/src/csp_import_helper/__init__.py') return source.replace(/^__version__ = "[^"]+"$/m, '__version__ = "<generated>"')
  return source
}
export function selectChecks(files, { release = false } = {}) {
  const normalized = files.map(file => file.replaceAll('\\', '/'))
  const infrastructure = normalized.some(file => /^(?:package(?:-lock)?\.json|\.node-version|\.github\/|tools\/(?:checks|verification|release)\/)/.test(file))
  return {
    check: true, pages: true, browser: browserProjects,
    native: release || infrastructure || normalized.some(file => /^(?:native\/|apps\/[^/]+\/src-tauri\/.*\.(?:rs|toml|lock)$|tools\/(?:after-effects|desktop)\/)/.test(file)),
    importer: release || infrastructure || normalized.some(file => /^(?:apps|tools)\/csp-import-helper\//.test(file)),
    desktop: normalized.some(file => /^(?:packages\/(?:ui|core|adapters)\/|native\/|apps\/[^/]+\/src-tauri\/|tools\/e2e\/win-)/.test(file)),
  }
}
