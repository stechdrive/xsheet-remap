import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export function hashSourceFiles(root, files) {
  const hash = createHash('sha256')
  for (const file of [...new Set(files)].sort()) {
    const target = path.join(root, file)
    // Git lists unstaged deletions but omits staged deletions. Both describe the
    // same candidate; index preparation must not invalidate its test evidence.
    if (!existsSync(target)) continue
    hash.update(file); hash.update('\0'); hash.update(readFileSync(target)); hash.update('\0')
  }
  return hash.digest('hex')
}
export function sourceIdentity(root = process.cwd()) {
  const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const files = [...new Set(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard']).split('\0').filter(Boolean))].sort()
  return { commit: git(['rev-parse', 'HEAD']), workingTreeDirty: !!git(['status', '--porcelain', '--untracked-files=normal']), sourceSha256: hashSourceFiles(root, files), node: process.version, platform: process.platform, arch: process.arch }
}
export function reusableEvidence(record, identity, phase, artifactSha256 = null) {
  return record?.schemaVersion === 1 && record.status === 'passed' && record.phase === phase
    && record.artifactSha256 === artifactSha256
    && Object.keys(identity).every(key => record.identity?.[key] === identity[key])
}
export function verifyExecutable({ exePath, bytes, buildState, identity }) {
  const normalized = value => path.resolve(value).toLowerCase()
  const artifact = Object.values(buildState?.applications ?? {}).find(item => normalized(path.join(path.dirname(exePath), item.executable)) === normalized(exePath))
  if (!artifact) throw new Error('EXE is not recorded in the adjacent build-state.json; rebuild the requested target')
  const actualSha256 = sha256(bytes)
  if (artifact.sha256 !== actualSha256) throw new Error('EXE SHA-256 differs from its build record')
  if (artifact.commit !== identity.commit || artifact.workingTreeDirty || identity.workingTreeDirty) throw new Error('EXE was not built from the current clean commit; rebuild the requested target')
  return { ...artifact, executable: exePath, sha256: actualSha256, verifiedCommit: identity.commit }
}
