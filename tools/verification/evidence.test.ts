import path from 'node:path'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { describe, expect, it } from 'vitest'
import { hashSourceFiles, reusableEvidence, sha256, verifyExecutable } from './evidence.mjs'
import { browserProjects, selectChecks, withoutGeneratedVersion } from './plan.mjs'

describe('verification evidence and change selection', () => {
  it('identifies the same candidate before and after staging deletions, but rejects changed contents', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'xsheet-evidence-'))
    try {
      writeFileSync(path.join(root, 'kept.ts'), 'original')
      const beforeStaging = hashSourceFiles(root, ['deleted.ts', 'kept.ts'])
      expect(hashSourceFiles(root, ['kept.ts'])).toBe(beforeStaging)
      writeFileSync(path.join(root, 'kept.ts'), 'modified')
      expect(hashSourceFiles(root, ['kept.ts'])).not.toBe(beforeStaging)
      writeFileSync(path.join(root, 'deleted.ts'), 'restored')
      expect(hashSourceFiles(root, ['deleted.ts', 'kept.ts'])).not.toBe(hashSourceFiles(root, ['kept.ts']))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it('requires passed evidence for the exact source, environment, phase and artifact', () => {
    const identity = { commit: 'a', sourceSha256: 'b', node: 'v24', platform: 'win32' }
    const evidence = { schemaVersion: 1, status: 'passed', phase: 'browser', identity, artifactSha256: 'pwa' }
    expect(reusableEvidence(evidence, identity, 'browser', 'pwa')).toBe(true)
    for (const altered of [{ ...identity, commit: 'c' }, { ...identity, sourceSha256: 'changed' }, { ...identity, node: 'v26' }]) expect(reusableEvidence(evidence, altered, 'browser', 'pwa')).toBe(false)
    expect(reusableEvidence({ ...evidence, status: 'failed' }, identity, 'browser', 'pwa')).toBe(false)
    expect(reusableEvidence(evidence, identity, 'browser', 'different')).toBe(false)
  })
  it('keeps web edits off native compilation but includes native, dependency and release changes', () => {
    expect(selectChecks(['packages/ui/src/TemplateEditorApp.tsx'])).toMatchObject({ native: false, importer: false, browser: browserProjects, desktop: true })
    expect(selectChecks(['native/desktop-runtime/src/lib.rs']).native).toBe(true)
    expect(selectChecks(['package-lock.json'])).toMatchObject({ native: true, importer: true })
    expect(selectChecks([], { release: true })).toMatchObject({ native: true, importer: true })
  })
  it('ignores only generated workspace versions, retaining actual dependency changes', () => {
    const first = { version: '0.1.1', packages: { '': { version: '0.1.1' }, 'apps/web': { version: '0.1.1' }, 'node_modules/dep': { version: '2.0.0' } } }
    const next = structuredClone(first); next.version = '0.1.2'; next.packages['apps/web'].version = '0.1.2'
    expect(withoutGeneratedVersion('package-lock.json', JSON.stringify(first))).toBe(withoutGeneratedVersion('package-lock.json', JSON.stringify(next)))
    next.packages['node_modules/dep'].version = '3.0.0'
    expect(withoutGeneratedVersion('package-lock.json', JSON.stringify(first))).not.toBe(withoutGeneratedVersion('package-lock.json', JSON.stringify(next)))
    const cargo = '[package]\nname = "app"\nversion = "0.1.1"\n[dependencies]\nfoo = "1"'
    expect(withoutGeneratedVersion('apps/editor/src-tauri/Cargo.toml', cargo)).toBe(withoutGeneratedVersion('apps/editor/src-tauri/Cargo.toml', cargo.replace('0.1.1', '0.1.2')))
  })
  it('rejects stale, modified or unrecorded EXEs before starting input', () => {
    const exePath = path.resolve('dev-local/example.exe'), bytes = Buffer.from('EXE'), identity = { commit: 'head' }
    const app = { executable: 'example.exe', commit: 'head', workingTreeDirty: false, sha256: sha256(bytes) }
    const verify = (artifact: typeof app, data = bytes) => verifyExecutable({ exePath, bytes: data, identity, buildState: { applications: { editor: artifact } } })
    expect(verify(app).sha256).toBe(app.sha256)
    expect(() => verify({ ...app, commit: 'old' })).toThrow('current clean commit')
    expect(() => verify({ ...app, workingTreeDirty: true })).toThrow('current clean commit')
    expect(() => verify(app, Buffer.from('modified'))).toThrow('SHA-256')
    expect(() => verify({ ...app, executable: 'other.exe' })).toThrow('not recorded')
  })
})
