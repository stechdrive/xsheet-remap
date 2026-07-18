import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const TARGETS = new Set(['editor', 'remap', 'template', 'corrector', 'all'])
const EXECUTABLES = {
  editor: 'xsheet-editor.exe',
  remap: 'xsheet-remap.exe',
  template: 'xsheet-template.exe',
  corrector: 'xsheet-corrector.exe',
}

export function parseDesktopBuildArgs(argv) {
  const values = new Map()
  let dryRun = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--dry-run') {
      dryRun = true
      continue
    }
    const equalsIndex = argument.indexOf('=')
    const key = equalsIndex >= 0 ? argument.slice(0, equalsIndex) : argument
    if (key !== '--mode' && key !== '--target') {
      throw new Error(`unknown desktop build argument: ${argument}`)
    }
    const value = equalsIndex >= 0 ? argument.slice(equalsIndex + 1) : argv[index += 1]
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`)
    values.set(key.slice(2), value)
  }

  const mode = values.get('mode')
  if (mode !== 'development' && mode !== 'release') {
    throw new Error('--mode must be development or release')
  }
  const targetValue = values.get('target')
  if (!targetValue) {
    throw new Error('development builds require an explicit --target; never widen an ambiguous request to all applications')
  }
  const targets = [...new Set(targetValue.split(',').map(value => value.trim().toLowerCase()).filter(Boolean))]
  const invalidTargets = targets.filter(target => !TARGETS.has(target))
  if (invalidTargets.length > 0) {
    throw new Error(`unknown desktop build target(s): ${invalidTargets.join(', ')}`)
  }
  if (targets.includes('all') && targets.length > 1) {
    throw new Error("target 'all' cannot be combined with individual targets")
  }
  if (mode === 'release' && (targets.length !== 1 || targets[0] !== 'all')) {
    throw new Error("release desktop builds require --target all")
  }

  const expandedTargets = targets.includes('all') ? Object.keys(EXECUTABLES) : targets
  return {
    mode,
    targets,
    dryRun,
    executables: expandedTargets.map(target => EXECUTABLES[target]),
    outputRoots: mode === 'development' ? ['dev-local'] : ['dev-local', 'release-local'],
  }
}

export function formatDesktopBuildPlan(plan) {
  return [
    `[desktop-build] intent=${plan.mode}`,
    `[desktop-build] targets=${plan.targets.join(',')}`,
    `[desktop-build] executables=${plan.executables.join(',')}`,
    `[desktop-build] outputs=${plan.outputRoots.join(',')}`,
  ].join('\n')
}

function main() {
  let plan
  try {
    plan = parseDesktopBuildArgs(process.argv.slice(2))
  } catch (error) {
    console.error(`[desktop-build] ${error.message}`)
    process.exitCode = 2
    return
  }

  console.log(formatDesktopBuildPlan(plan))
  if (plan.dryRun) return

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
  const scriptPath = path.join(repoRoot, 'tools', 'desktop', 'win-desktop-build.ps1')
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh'
  const result = spawnSync(shell, [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', scriptPath,
    '-Mode', plan.mode,
    '-Target', plan.targets.join(','),
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
  })
  if (result.error) {
    console.error(`[desktop-build] failed to start build: ${result.error.message}`)
    process.exitCode = 1
    return
  }
  process.exitCode = result.status ?? 1
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
