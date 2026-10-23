import fs from 'node:fs'
import path from 'node:path'
import { verifyExecutable, desktopSourceSha256 } from './evidence.mjs'

/** A diagnostic never certifies a clean release candidate.
 * @param {string | null} baselineCommit
 */
export function webviewArtifact(root, identity, baselineCommit = null, app = 'remap', workingTreeDiagnostic = false) {
  if (identity.platform !== 'win32') throw new Error('WebView2 verification requires Windows')
  if (baselineCommit !== null && !/^[a-f0-9]{40}$/.test(baselineCommit)) throw new Error('Use the full recorded baseline commit')
  if (!['remap', 'corrector'].includes(app)) throw new Error('Unknown WebView application')
  const exePath = path.join(root, `dev-local/xsheet-${app}.exe`)
  const buildState = JSON.parse(fs.readFileSync(path.join(root, 'dev-local/build-state.json'), 'utf8').replace(/^\uFEFF/, ''))
  if (workingTreeDiagnostic) {
    if (baselineCommit) throw new Error('Working-tree and baseline diagnostics cannot be combined')
    const record = buildState.applications?.[app]
    if (!record?.buildSessionId || !record.sourceSha256 || record.sourceSha256 !== desktopSourceSha256(root) || record.commit !== identity.commit) throw new Error('Diagnostic EXE does not match the current application source bytes')
    const artifact = verifyExecutable({ exePath, bytes: fs.readFileSync(exePath), buildState: { applications: { [app]: { ...record, workingTreeDirty: false } } }, identity: { ...identity, workingTreeDirty: false } })
    return { artifact: { ...artifact, workingTreeDirty: record.workingTreeDirty }, scope: 'working-tree-diagnostic', testedSourceCommit: record.commit, harnessIdentity: identity }
  }
  const artifact = verifyExecutable({ exePath, bytes: fs.readFileSync(exePath), buildState,
    identity: baselineCommit ? { ...identity, commit: baselineCommit, workingTreeDirty: false } : identity })
  if (!artifact.buildSessionId) throw new Error('Missing EXE build session')
  return { artifact, scope: baselineCommit ? 'baseline-diagnostic' : 'current-candidate',
    testedSourceCommit: artifact.commit, harnessIdentity: identity }
}
