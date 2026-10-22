import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { browserProjects, selectChecks, verificationScriptsOnly } from './plan.mjs'

describe('change-dependent verification plan', () => {
  it('keeps documentation and test-only edits out of native and GUI work', () => {
    expect(selectChecks(['README.md'])).toMatchObject({ check: false, pages: false, browser: [], desktop: false,
      reasons: [{ file: 'README.md', category: 'documentation', phases: ['hygiene'] }] })
    for (const file of ['packages/ui/src/App.clip-layers.test.tsx', 'tools/verification/run.mjs', 'tools/e2e/canvaskit/clip-layers.spec.ts']) {
      expect(selectChecks([file])).toMatchObject({ check: true, pages: false, native: false, importer: false, webview: false, desktop: false })
    }
  })
  it('selects the native input boundary and existing browser cases with a reason', () => {
    const plan = selectChecks(['packages\\ui\\src\\nativeFileDragPreview.ts'])
    expect(plan).toMatchObject({ check: true, pages: true, webview: true, desktop: true, desktopTargets: ['remap'], browser: browserProjects,
      reasons: [{ file: 'packages/ui/src/nativeFileDragPreview.ts', category: 'input-boundary' }] })
    expect(plan.browserSelection.files.length).toBeGreaterThan(0)
    for (const file of plan.browserSelection.files) expect(fs.existsSync(path.resolve('tools/e2e/canvaskit', file))).toBe(true)
  })
  it('keeps dependency changes, unknown paths and releases broad, including both EXEs', () => {
    for (const plan of [selectChecks(['package-lock.json']), selectChecks(['new-build-system/config']), selectChecks(['VERSION_BASE']), selectChecks([], { release: true })]) {
      expect(plan).toMatchObject({ native: true, importer: true, webview: true, desktop: true, desktopTargets: ['corrector', 'remap'], browserSelection: { full: true } })
    }
  })
  it('retains app scope and broadens combined changes without duplicate reasons', () => {
    expect(selectChecks(['apps/sheet-corrector/src-tauri/src/lib.rs']).desktopTargets).toEqual(['corrector'])
    const plan = selectChecks(['packages/ui/src/clipLayerDrop.ts', 'packages/core/src/history.ts', 'packages/ui/src/clipLayerDrop.ts'])
    expect(plan.browserSelection).toEqual({ full: true, files: [] })
    expect(plan.reasons).toHaveLength(2)
    expect(selectChecks(['VERSION', 'packages/ui/src/appVersion.ts']).desktop).toBe(false)
  })
  it('does not turn adding a test command into a dependency or EXE rebuild, but detects dependency/build changes', () => {
    const before = JSON.stringify({ version: '1', scripts: { check: 'check' }, dependencies: { example: '1' } })
    const after = JSON.stringify({ version: '2', scripts: { check: 'check', 'verify:webview': 'run-test' }, dependencies: { example: '1' } })
    expect(verificationScriptsOnly(before, after)).toBe(true)
    const options = { packageChanges: { 'package.json': { before, after } } }
    expect(selectChecks(['package.json'], options)).toMatchObject({ check: true, native: false, importer: false, webview: false, desktop: false })
    expect(selectChecks(['package.json'], { ...options, release: true })).toMatchObject({ native: true, importer: true, desktop: true })
    for (const changed of [after.replace('"example":"1"', '"example":"2"'), after.replace('verify:webview', 'build'), after.replace('"dependencies":', '"engines":')]) {
      expect(verificationScriptsOnly(before, changed)).toBe(false)
      expect(selectChecks(['package.json'], { packageChanges: { 'package.json': { before, after: changed } } }).native).toBe(true)
    }
  })
})
