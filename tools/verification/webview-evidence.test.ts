import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { sha256 } from './evidence.mjs'
import { webviewArtifact } from './webview-evidence.mjs'

const roots: string[] = [], commit = 'a'.repeat(40)
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
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
