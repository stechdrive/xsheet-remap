import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as evidence from './evidence.mjs'
import { sha256 } from './evidence.mjs'
import { webviewArtifact } from './webview-evidence.mjs'

const roots: string[] = [], commit = 'a'.repeat(40)
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'webview-artifact-')); roots.push(root)
  fs.mkdirSync(path.join(root, 'dev-local'))
  const artifact = { executable: 'xsheet-remap.exe', commit, workingTreeDirty: false, sha256: sha256(Buffer.from('exe')), buildSessionId: 'session' }
  fs.writeFileSync(path.join(root, 'dev-local/xsheet-remap.exe'), 'exe')
  fs.writeFileSync(path.join(root, 'dev-local/build-state.json'), JSON.stringify({ applications: { remap: artifact } }))
  const identity = { commit, workingTreeDirty: false, platform: 'win32', sourceSha256: 'harness', node: 'v26.12.1' }
  return { root, identity }
}
it('keeps unbuilt working-tree changes out of candidate acceptance while explicitly recording a baseline diagnostic', () => {
  const { root, identity } = fixture()
  expect(webviewArtifact(root, identity).scope).toBe('current-candidate')
  const dirty = { ...identity, workingTreeDirty: true }
  expect(() => webviewArtifact(root, dirty)).toThrow('clean commit')
  expect(webviewArtifact(root, dirty, commit)).toMatchObject({ scope: 'baseline-diagnostic', testedSourceCommit: commit, harnessIdentity: dirty })
  expect(() => webviewArtifact(root, dirty, 'HEAD')).toThrow('full recorded baseline commit')
  expect(() => webviewArtifact(root, dirty, 'b'.repeat(40))).toThrow('clean commit')
})
it('never relaxes executable byte checks, even in baseline mode', () => {
  const { root, identity } = fixture()
  fs.writeFileSync(path.join(root, 'dev-local/xsheet-remap.exe'), 'replaced')
  expect(() => webviewArtifact(root, identity, commit)).toThrow('SHA-256')
  expect(() => webviewArtifact(root, { ...identity, platform: 'linux' }, commit)).toThrow('Windows')
})

it('requires recorded application bytes for an explicitly non-release working-tree diagnostic', () => {
  const { root, identity } = fixture(), dirty = { ...identity, workingTreeDirty: true }
  vi.spyOn(evidence, 'desktopSourceSha256').mockReturnValue('source-bytes')
  const statePath = path.join(root, 'dev-local/build-state.json')
  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  expect(() => webviewArtifact(root, dirty, null, 'remap', true)).toThrow('source bytes')
  Object.assign(state.applications.remap, { workingTreeDirty: true, sourceSha256: 'source-bytes' })
  fs.writeFileSync(statePath, JSON.stringify(state))
  expect(webviewArtifact(root, dirty, null, 'remap', true)).toMatchObject({ scope: 'working-tree-diagnostic', artifact: { workingTreeDirty: true } })
  expect(() => webviewArtifact(root, dirty)).toThrow('clean commit')
  expect(() => webviewArtifact(root, dirty, commit, 'remap', true)).toThrow('cannot be combined')
  vi.mocked(evidence.desktopSourceSha256).mockReturnValue('changed-application')
  expect(() => webviewArtifact(root, dirty, null, 'remap', true)).toThrow('source bytes')
  vi.mocked(evidence.desktopSourceSha256).mockReturnValue('source-bytes')
  fs.writeFileSync(path.join(root, 'dev-local/xsheet-remap.exe'), 'tampered')
  expect(() => webviewArtifact(root, dirty, null, 'remap', true)).toThrow('SHA-256')
})

it('fingerprints unknown and application inputs while allowing independent test-harness evolution', () => {
  const { root } = fixture()
  const files = ['app.rs', 'tools/e2e/runner.ts', 'new-build-option.json']
  fs.mkdirSync(path.join(root, 'tools/e2e'), { recursive: true })
  for (const file of files) fs.writeFileSync(path.join(root, file), 'original')
  const before = evidence.desktopSourceSha256(root, files)
  fs.writeFileSync(path.join(root, files[1]), 'new test assertions')
  expect(evidence.desktopSourceSha256(root, files)).toBe(before)
  fs.writeFileSync(path.join(root, files[2]), 'different build option')
  expect(evidence.desktopSourceSha256(root, files)).not.toBe(before)
})
