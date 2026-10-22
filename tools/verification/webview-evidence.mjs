import fs from 'node:fs'
import path from 'node:path'
import { verifyExecutable } from './evidence.mjs'

/** A baseline diagnostic never certifies unbuilt working-tree application changes. */
export function webviewArtifact(root, identity, baselineCommit = null) {
  if (identity.platform !== 'win32') throw new Error('WebView2 verification requires Windows')
  if (baselineCommit !== null && !/^[a-f0-9]{40}$/.test(baselineCommit)) throw new Error('Use the full recorded baseline commit')
  const exePath = path.join(root, 'dev-local/xsheet-remap.exe')
  const buildState = JSON.parse(fs.readFileSync(path.join(root, 'dev-local/build-state.json'), 'utf8').replace(/^\uFEFF/, ''))
  const artifact = verifyExecutable({ exePath, bytes: fs.readFileSync(exePath), buildState,
    identity: baselineCommit ? { ...identity, commit: baselineCommit, workingTreeDirty: false } : identity })
  if (!artifact.buildSessionId) throw new Error('Missing EXE build session')
  return { artifact, scope: baselineCommit ? 'baseline-diagnostic' : 'current-candidate',
    testedSourceCommit: artifact.commit, harnessIdentity: identity }
}
