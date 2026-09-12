import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const inventoryScript = path.join(currentDirectory, 'release-inventory-check.ps1')
const windowsPowerShell = path.join(
  process.env.SystemRoot ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
)

function runInventory(options: { releaseRoot?: string; zipPath?: string; checksumPath?: string; expectedRoots: string[]; expectedVersion?: string; expectedCommit?: string; buildStatePath?: string }) {
  const args = [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    inventoryScript,
    '-ExpectedRootsBase64',
    Buffer.from(options.expectedRoots.join('\n'), 'utf8').toString('base64'),
  ]
  if (options.releaseRoot) args.push('-ReleaseRoot', options.releaseRoot)
  if (options.zipPath) args.push('-ZipPath', options.zipPath)
  if (options.checksumPath) args.push('-ChecksumPath', options.checksumPath)
  if (options.expectedVersion) args.push('-ExpectedVersion', options.expectedVersion)
  if (options.expectedCommit) args.push('-ExpectedCommit', options.expectedCommit)
  if (options.buildStatePath) args.push('-BuildStatePath', options.buildStatePath)
  return spawnSync(windowsPowerShell, args, { encoding: 'utf8' })
}

function createZip(stageRoot: string, zipPath: string, entryNames: string[]) {
  const result = spawnSync('tar.exe', ['-a', '-cf', zipPath, '-C', stageRoot, ...entryNames], { encoding: 'utf8' })
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
}

function compactPowerShellOutput(result: ReturnType<typeof runInventory>) {
  return `${result.stdout}\n${result.stderr}`.replace(/\s+/g, '')
}

describe.skipIf(process.platform !== 'win32')('release inventory', () => {
  it('rejects a valid ZIP from another version, commit or desktop build before publication', () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'xsheet-release-identity-'))
    try {
      const expectedVersion = '0.1.1', expectedCommit = 'a'.repeat(40)
      const zipPath = path.join(testRoot, 'xsheet-remap.zip')
      const buildStatePath = path.join(testRoot, 'build-state.json')
      const applications = Object.fromEntries(['editor', 'remap', 'template', 'corrector'].map(app => {
        const executable = `xsheet-${app}.exe`
        writeFileSync(path.join(testRoot, executable), executable)
        return [app, { executable, version: expectedVersion, commit: expectedCommit, workingTreeDirty: false,
          sha256: createHash('sha256').update(executable).digest('hex') }]
      }))
      writeFileSync(buildStatePath, JSON.stringify({ mode: 'coherent', applications }))
      writeFileSync(path.join(testRoot, 'RELEASE.json'), JSON.stringify({ version: expectedVersion, commit: expectedCommit }))
      const expectedRoots = ['RELEASE.json', ...Object.values(applications).map(app => app.executable)]
      createZip(testRoot, zipPath, expectedRoots)
      const options = { zipPath, expectedRoots, expectedVersion, expectedCommit, buildStatePath }
      const valid = runInventory(options)
      expect(valid.status, `${valid.stdout}\n${valid.stderr}`).toBe(0)
      for (const alteration of [{ expectedVersion: '0.1.2' }, { expectedCommit: 'b'.repeat(40) }]) {
        const stale = runInventory({ ...options, ...alteration })
        expect(stale.status).not.toBe(0)
        expect(compactPowerShellOutput(stale)).toContain('doesnotmatchthecurrentversionandcommit')
      }
      writeFileSync(path.join(testRoot, 'xsheet-editor.exe'), 'another build of the same source')
      createZip(testRoot, zipPath, expectedRoots)
      const swapped = runInventory(options)
      expect(swapped.status).not.toBe(0)
      expect(compactPowerShellOutput(swapped)).toContain('differsfromtheverifieddesktopbuild')
    } finally { rmSync(testRoot, { recursive: true, force: true }) }
  }, 20_000)

  it('rejects an unexpected file left in the release root', () => {
    const releaseRoot = mkdtempSync(path.join(tmpdir(), 'xsheet-release-root-'))
    try {
      const expectedRoots = ['README.txt', 'xsheet-editor.exe']
      for (const fileName of expectedRoots) writeFileSync(path.join(releaseRoot, fileName), fileName)

      const cleanResult = runInventory({ releaseRoot, expectedRoots })
      expect(cleanResult.status, `${cleanResult.stdout}\n${cleanResult.stderr}`).toBe(0)

      writeFileSync(path.join(releaseRoot, 'xdts-multi-timetable-csp-test.xdts'), 'test fixture')
      const contaminatedResult = runInventory({ releaseRoot, expectedRoots })
      expect(contaminatedResult.status).not.toBe(0)
      expect(compactPowerShellOutput(contaminatedResult)).toContain(
        'unexpected=[xdts-multi-timetable-csp-test.xdts]',
      )
    } finally {
      rmSync(releaseRoot, { recursive: true, force: true })
    }
  })

  it('accepts an exact flat ZIP and rejects an unexpected file at its root', () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'xsheet-release-zip-'))
    const zipPath = path.join(testRoot, 'xsheet-remap.zip')
    const checksumPath = path.join(testRoot, 'xsheet-remap.zip.sha256')
    const contaminatedZipPath = path.join(testRoot, 'xsheet-remap-contaminated.zip')
    const expectedRoots = ['README.txt', 'xsheet-editor.exe']
    try {
      for (const fileName of expectedRoots) writeFileSync(path.join(testRoot, fileName), fileName)
      createZip(testRoot, zipPath, expectedRoots)
      const zipHash = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
      writeFileSync(checksumPath, `${zipHash}  xsheet-remap.zip\n`)

      const cleanResult = runInventory({ zipPath, checksumPath, expectedRoots })
      expect(cleanResult.status, `${cleanResult.stdout}\n${cleanResult.stderr}`).toBe(0)

      writeFileSync(path.join(testRoot, 'rogue-test.xdts'), 'test fixture')
      createZip(testRoot, contaminatedZipPath, [...expectedRoots, 'rogue-test.xdts'])
      const contaminatedResult = runInventory({ zipPath: contaminatedZipPath, expectedRoots })
      expect(contaminatedResult.status).not.toBe(0)
      expect(compactPowerShellOutput(contaminatedResult)).toContain(
        'unexpected=[rogue-test.xdts]',
      )
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })

  it('rejects the former xsheet-remap wrapper folder layout', () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), 'xsheet-release-wrapper-'))
    const packageName = 'xsheet-remap'
    const packageRoot = path.join(testRoot, packageName)
    const zipPath = path.join(testRoot, 'xsheet-remap.zip')
    const expectedRoots = ['README.txt', 'xsheet-editor.exe']
    try {
      mkdirSync(packageRoot)
      for (const fileName of expectedRoots) writeFileSync(path.join(packageRoot, fileName), fileName)
      createZip(testRoot, zipPath, [packageName])

      const result = runInventory({ zipPath, expectedRoots })
      expect(result.status).not.toBe(0)
      expect(compactPowerShellOutput(result)).toContain('unexpected=[xsheet-remap]')
    } finally {
      rmSync(testRoot, { recursive: true, force: true })
    }
  })
})
