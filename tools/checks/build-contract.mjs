import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDesktopBuildArgs } from '../desktop/run-build.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const scripts = packageJson.scripts ?? {}

const expectedScripts = {
  'build:dev': 'node tools/desktop/run-build.mjs --mode development',
  'build:release:desktop': 'node tools/desktop/run-build.mjs --mode release --target all',
  'build:release:all': 'npm run build:release:desktop && npm run build:csp-helper && npm run package:local',
}
for (const [name, command] of Object.entries(expectedScripts)) {
  if (scripts[name] !== command) throw new Error(`build contract mismatch for ${name}: expected "${command}"`)
}

const retiredScripts = [
  'build:dev:editor',
  'build:dev:remap',
  'build:dev:template',
  'build:dev:corrector',
  'build:dev:all',
  'build:desktop',
  'build:desktop:portable',
  'build:all-local',
]
for (const name of retiredScripts) {
  if (Object.hasOwn(scripts, name)) throw new Error(`retired ambiguous build command is still exposed: ${name}`)
}

const developmentPlan = parseDesktopBuildArgs(['--mode', 'development', '--target', 'editor'])
if (developmentPlan.executables.join(',') !== 'xsheet-editor.exe') {
  throw new Error('editor development build must resolve to exactly xsheet-editor.exe')
}
if (developmentPlan.outputRoots.join(',') !== 'dev-local') {
  throw new Error('development builds must only update dev-local')
}
const releasePlan = parseDesktopBuildArgs(['--mode', 'release', '--target', 'all'])
if (releasePlan.executables.length !== 4 || releasePlan.outputRoots.join(',') !== 'dev-local,release-local') {
  throw new Error('desktop release builds must update the coherent four-app dev-local and release-local set')
}

let missingTargetRejected = false
try {
  parseDesktopBuildArgs(['--mode', 'development'])
} catch {
  missingTargetRejected = true
}
if (!missingTargetRejected) throw new Error('development builds must reject a missing target')

const desktopScript = path.join(repoRoot, 'tools', 'desktop', 'win-desktop-build.ps1')
const retiredDesktopScript = path.join(repoRoot, 'tools', 'desktop', 'win-desktop-release.ps1')
if (!fs.existsSync(desktopScript)) throw new Error('managed desktop build implementation is missing')
if (fs.existsSync(retiredDesktopScript)) throw new Error('retired win-desktop-release.ps1 still exists')

const inventoryScript = path.join(repoRoot, 'tools', 'release', 'release-inventory.ps1')
if (!fs.existsSync(inventoryScript)) throw new Error('release inventory implementation is missing')

const localPackageScript = fs.readFileSync(path.join(repoRoot, 'tools', 'release', 'local-package.ps1'), 'utf8')
for (const requiredCall of ['Assert-ReleaseRootInventory', 'Assert-ReleaseZipInventory']) {
  if (!localPackageScript.includes(requiredCall)) {
    throw new Error(`local release packaging must enforce ${requiredCall}`)
  }
}

const githubReleaseScript = fs.readFileSync(path.join(repoRoot, 'tools', 'release', 'github-latest-release.ps1'), 'utf8')
for (const requiredCall of ['Assert-ReleaseZipChecksum', 'Assert-ReleaseZipInventory']) {
  if (!githubReleaseScript.includes(requiredCall)) {
    throw new Error(`GitHub release update must enforce ${requiredCall}`)
  }
}

console.log('[build-contract] passed')
