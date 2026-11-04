import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Zip, ZipPassThrough, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(currentDirectory, '../..')
const inventoryScript = path.join(currentDirectory, 'release-inventory-check.ps1')
const windowsPowerShell = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const fileNames = ['README.txt', 'xsheet-corrector.exe', 'xsheet-remap.exe']
const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
function runScript(script: string, args: string[] = []) {
  return spawnSync(windowsPowerShell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8' })
}
function runInventory(options: { releaseRoot?: string; zipPath?: string; verificationPath?: string; expectedVersion?: string; expectedCommit?: string; buildStatePath?: string; readmePath?: string }) {
  return runScript(inventoryScript, Object.entries(options).flatMap(([key, value]) => [`-${key}`, value]))
}
function output(result: ReturnType<typeof runScript>) { return `${result.stdout}\n${result.stderr}` }
function createZip(root: string, zipPath: string, names = fileNames) {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, bytes) => { if (error) throw error; chunks.push(bytes) })
  for (const name of names) {
    const entry = new ZipPassThrough(name)
    archive.add(entry)
    entry.push(readFileSync(path.join(root, path.basename(name))), true)
  }
  archive.end()
  writeFileSync(zipPath, Buffer.concat(chunks))
}
function fixture(directory: string, commit = 'a'.repeat(40)) {
  const version = '0.1.1', buildSessionId = 'same-build-session'
  for (const name of fileNames) writeFileSync(path.join(directory, name), name)
  const applications = Object.fromEntries(['remap', 'corrector'].map(app => {
    const executable = `xsheet-${app}.exe`
    return [app, { executable, version, commit, buildSessionId, workingTreeDirty: false, sha256: sha256(executable) }]
  }))
  const buildStatePath = path.join(directory, 'build-state.json')
  writeFileSync(buildStatePath, JSON.stringify({ mode: 'coherent', applications }))
  const zipPath = path.join(directory, 'xsheet-remap.zip')
  const verificationPath = path.join(directory, 'package-verification.json')
  function saveVerification() {
    writeFileSync(verificationPath, JSON.stringify({ schemaVersion: 1, version, commit, buildSessionId,
      archive: { name: 'xsheet-remap.zip', sha256: sha256(readFileSync(zipPath)) },
      files: fileNames.map(name => ({ path: name, sha256: sha256(readFileSync(path.join(directory, name))) })),
    }))
  }
  createZip(directory, zipPath); saveVerification()
  return { options: { zipPath, verificationPath, expectedVersion: version, expectedCommit: commit, buildStatePath, readmePath: path.join(directory, 'README.txt') }, applications, saveVerification }
}

describe.skipIf(process.platform !== 'win32')('three-file release package', () => {
  it('accepts exactly the two EXEs and README, and rejects removed files or a missing EXE', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'xsheet-inventory-'))
    try {
      const { options } = fixture(root)
      expect(runInventory({ zipPath: options.zipPath }).status).toBe(0)
      for (const extra of ['xsheet-template.exe', 'RELEASE.json', 'CHECKSUMS.sha256', 'THIRD_PARTY_NOTICES.md', 'LICENSE.txt', 'package-verification.json', 'sample.xdts']) {
        writeFileSync(path.join(root, extra), extra)
        createZip(root, options.zipPath, [...fileNames, extra])
        const result = runInventory({ zipPath: options.zipPath })
        expect(result.status, extra).not.toBe(0)
        expect(output(result).replace(/\s+/g, '')).toContain(`unexpected=[${extra}]`)
      }
      createZip(root, options.zipPath, ['README.txt', 'xsheet-remap.exe'])
      expect(runInventory({ zipPath: options.zipPath }).status).not.toBe(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('rejects nested paths, duplicate entries and filename case collisions', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'xsheet-paths-'))
    try {
      const { options } = fixture(root)
      writeFileSync(path.join(root, 'readme.txt'), 'case collision')
      for (const names of [fileNames.map(name => `xsheet-remap/${name}`), [...fileNames, 'README.txt'], [...fileNames, 'readme.txt'], [...fileNames, 'README.txt/README.txt'], [...fileNames, '../README.txt']]) {
        createZip(root, options.zipPath, names)
        const result = runInventory({ zipPath: options.zipPath })
        expect(result.status, names.join(',')).not.toBe(0)
        expect(output(result)).toContain('unsafe paths')
      }
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('validates the archive, both build identities and the current guide using metadata outside the ZIP', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'xsheet-identity-'))
    try {
      const { options, applications, saveVerification } = fixture(root)
      const valid = runInventory(options)
      expect(valid.status, output(valid)).toBe(0)
      for (const alteration of [{ expectedVersion: '0.1.2' }, { expectedCommit: 'b'.repeat(40) }]) {
        expect(runInventory({ ...options, ...alteration }).status).not.toBe(0)
      }
      for (const alteration of [{ buildSessionId: 'another-session' }, { workingTreeDirty: true }, { sha256: '0'.repeat(64) }]) {
        writeFileSync(options.buildStatePath, JSON.stringify({ mode: 'coherent', applications: { ...applications, corrector: { ...applications.corrector, ...alteration } } }))
        expect(runInventory(options).status).not.toBe(0)
      }
      writeFileSync(options.buildStatePath, JSON.stringify({ mode: 'coherent', applications }))
      writeFileSync(options.readmePath, 'current guide differs from old package')
      expect(runInventory(options).status).not.toBe(0)
      writeFileSync(options.readmePath, 'README.txt')
      writeFileSync(path.join(root, 'xsheet-corrector.exe'), 'swapped executable')
      createZip(root, options.zipPath)
      expect(output(runInventory(options))).toContain('checksum mismatch')
      saveVerification()
      expect(output(runInventory(options))).toContain('differs from current build')
      rmSync(options.verificationPath)
      expect(runInventory(options).status).not.toBe(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)

  it('rejects unexpected files in the unpacked payload', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'xsheet-payload-'))
    try {
      for (const name of fileNames) writeFileSync(path.join(root, name), name)
      expect(runInventory({ releaseRoot: root }).status).toBe(0)
      writeFileSync(path.join(root, 'production.xdts'), 'private fixture')
      expect(runInventory({ releaseRoot: root }).status).not.toBe(0)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('packages through the real script, keeps verification outside, removes retired outputs and fails on unknown leftovers', () => {
    // A temporary source tree inside this checkout inherits its read-only Git identity.
    // Synthetic bytes exercise packaging; they are never launched or published as EXEs.
    const scratch = path.join(repoRoot, '.tmp/release-tests'); mkdirSync(scratch, { recursive: true })
    const root = mkdtempSync(path.join(scratch, 'package-'))
    try {
      for (const dir of ['tools/release', 'release-assets', 'dev-local', '.cache/cargo-target/release', 'release-local']) mkdirSync(path.join(root, dir), { recursive: true })
      for (const name of ['local-package.ps1', 'release-inventory.ps1']) copyFileSync(path.join(currentDirectory, name), path.join(root, 'tools/release', name))
      const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim()
      const { applications } = fixture(root, commit)
      writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '0.1.1' }))
      writeFileSync(path.join(root, 'dev-local/build-state.json'), JSON.stringify({ mode: 'coherent', applications }))
      copyFileSync(path.join(root, 'README.txt'), path.join(root, 'release-assets/README.txt'))
      for (const app of Object.values(applications)) copyFileSync(path.join(root, app.executable), path.join(root, '.cache/cargo-target/release', app.executable))
      for (const retired of ['RELEASE.json', 'CHECKSUMS.sha256', 'THIRD_PARTY_NOTICES.md', 'xsheet-remap.zip.sha256', 'xsheet-template.exe']) writeFileSync(path.join(root, 'release-local', retired), retired)
      const script = path.join(root, 'tools/release/local-package.ps1')
      const packaged = runScript(script, ['-SkipLeakCheck'])
      expect(packaged.status, output(packaged)).toBe(0)
      const zipPath = path.join(root, 'release-local/xsheet-remap.zip')
      expect(Object.keys(unzipSync(readFileSync(zipPath))).sort()).toEqual(fileNames)
      expect(existsSync(path.join(root, 'release-local/xsheet-remap.zip.sha256'))).toBe(false)
      const verified = runInventory({ zipPath, verificationPath: path.join(root, 'release-local/package-verification.json'), expectedVersion: '0.1.1', expectedCommit: commit,
        buildStatePath: path.join(root, 'dev-local/build-state.json'), readmePath: path.join(root, 'release-assets/README.txt') })
      expect(verified.status, output(verified)).toBe(0)
      writeFileSync(path.join(root, 'release-local/private.xdts'), 'must not be removed or packaged')
      expect(runScript(script, ['-SkipLeakCheck']).status).not.toBe(0)
      expect(existsSync(path.join(root, 'release-local/private.xdts'))).toBe(true)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30_000)
})
