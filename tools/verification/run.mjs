import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { checks, selectChecks, testPurposes, withoutGeneratedVersion } from './plan.mjs'
import { reusableEvidence, sha256, sourceIdentity } from './evidence.mjs'
import { defaultBrowserWorkers, parseOptions } from './options.mjs'
import { prepareBrowser, validateBrowserResults } from './browser.mjs'
import { readUnitEvidence, reusableUnitEvidence, unitReportPath } from './unit-evidence.mjs'
import { readDesktopScenarioEvidence } from './desktop-evidence.mjs'

const options = parseOptions(process.argv.slice(2))
const { phase } = options
const root = process.cwd()
const output = path.join(root, 'reference-local/verification')
fs.mkdirSync(output, { recursive: true })
function command(file, argv, env = process.env) {
  const result = spawnSync(file, argv, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(file)} ${argv.join(' ')} failed (${result.status})`)
}
function npm(script, argv = [], env = process.env) {
  const cli = process.env.npm_execpath
  if (!cli) throw new Error('Run verification through npm run verify:...')
  command(process.execPath, [cli, 'run', script, ...argv], env)
}
function runtimeIdentity(phase) {
  const toolVersion = (tool, argv, env = process.env) => {
    const result = spawnSync(tool, argv, { env, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`Cannot identify ${tool}: ${result.error ?? result.stderr}`)
    return result.stdout.trim()
  }
  if (phase === 'native') return { rust: toolVersion('rustc', ['--version']), cargo: toolVersion('cargo', ['--version']) }
  if (phase === 'browser' || phase === 'browser-ci') return {
    playwright: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/playwright/package.json'), 'utf8')).version,
    browserRevisions: sha256(fs.readFileSync(path.join(root, 'node_modules/playwright-core/browsers.json'))),
    browserPath: process.env.PLAYWRIGHT_BROWSERS_PATH ?? (process.platform === 'win32' && fs.existsSync(path.join(root, '.cache/playwright')) ? path.join(root, '.cache/playwright') : 'default'),
  }
  return {}
}
if (phase === 'plan') {
  const base = options.base
  const result = base && !/^0+$/.test(base) ? spawnSync('git', ['diff', '--name-only', base], { encoding: 'utf8' }) : null
  if (result && result.status !== 0) throw new Error(result.stderr)
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' })
  if (untracked.status !== 0) throw new Error(untracked.stderr)
  const files = result ? [...new Set((result.stdout + untracked.stdout).trim().split(/\r?\n/))].filter(file => {
    if (!file) return false
    const previous = spawnSync('git', ['show', `${base}:${file}`], { encoding: 'utf8' })
    if (previous.status !== 0 || !fs.existsSync(file)) return true
    return withoutGeneratedVersion(file, previous.stdout) !== withoutGeneratedVersion(file, fs.readFileSync(file, 'utf8'))
  }) : ['tools/verification/plan.mjs']
  const plan = selectChecks(files, { release: options.release })
  console.log(JSON.stringify({ ...plan, testPurposes }, null, 2))
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `native=${plan.native}\nimporter=${plan.importer}\nbrowsers=${JSON.stringify(plan.browser)}\n`)
} else {
  const phases = phase === 'local' ? ['check', 'native', 'importer', 'pages', 'browser'] : [phase]
  for (const selected of phases) {
    const browserPhase = selected === 'browser' || selected === 'browser-ci'
    if (!(selected in checks) && !browserPhase) throw new Error(`Unknown verification phase: ${selected}`)
    if (selected === 'desktop' && process.platform !== 'win32') throw new Error('Desktop acceptance requires the interactive Windows host')
    const runId = `${Date.now()}-${process.pid}`
    const browser = browserPhase ? prepareBrowser(root, { ...options, phase: selected }, runId) : null
    const execution = browser?.execution ?? null
    if (options.list) {
      console.log(JSON.stringify({ execution, inventory: browser.inventory }, null, 2))
      continue
    }
    const defaultBrowser = !options.project && options.suite === 'all' && !options.grep && !options.files.length && options.workers === defaultBrowserWorkers
    const name = selected === 'browser' && !defaultBrowser ? `browser-${sha256(JSON.stringify(execution)).slice(0, 16)}` : selected
    const reportPath = path.join(output, `${name}.json`)
    const identity = { ...sourceIdentity(root), ...runtimeIdentity(selected) }
    const manifestPath = path.join(root, 'apps/web/dist-pages/pages-artifact.json')
    const artifactSha256 = (browserPhase || selected === 'pages') && fs.existsSync(manifestPath) ? sha256(fs.readFileSync(manifestPath)) : null
    const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null
    const canReuse = reusableEvidence(previous, identity, name, artifactSha256, execution)
      && (!['check', 'importer'].includes(selected) || reusableUnitEvidence(root, previous))
    if (artifactSha256 && (browserPhase || options.reuse && canReuse)) npm('check:pages-artifact')
    // Native input acceptance always reruns against the current EXEs. Source
    // equality alone cannot certify executables produced by a later build.
    if (selected !== 'desktop' && options.reuse && canReuse) {
      console.log(`[verification] ${name}: reusing matching passed evidence (${previous.finishedAt})`)
      continue
    }
    const record = { schemaVersion: 1, phase: name, identity, artifactSha256, execution, status: 'running', startedAt: new Date().toISOString(), purpose: testPurposes[selected] ?? testPurposes.browser,
      recordPath: `reference-local/verification/run-${runId}.json` }
    const start = performance.now()
    fs.writeFileSync(reportPath, JSON.stringify(record, null, 2))
    try {
      if (browserPhase) {
        if (!artifactSha256) throw new Error('Build the Pages candidate with npm run verify:pages first')
        record.inventory = browser.inventory
        record.groups = []
        // Timing/resource-sensitive cases never overlap the functional workers.
        for (const group of browser.groups) {
          const result = { suite: group.suite, workers: group.workers, count: group.inventory.length, results: group.results, diagnostics: group.diagnostics }
          record.groups.push(result)
          fs.writeFileSync(reportPath, JSON.stringify(record, null, 2))
          console.log(`[verification] ${group.suite}: ${group.inventory.length} cases, ${group.workers} worker(s)`)
          const startGroup = performance.now()
          try {
            command(process.execPath, group.argv, group.env)
            Object.assign(result, validateBrowserResults(JSON.parse(fs.readFileSync(path.join(root, group.results), 'utf8')), group.inventory, group.workers))
          } finally { result.wallMs = Math.round(performance.now() - startGroup) }
        }
        npm('check:pages-artifact')
        if (sha256(fs.readFileSync(manifestPath)) !== artifactSha256) throw new Error('Pages candidate changed during browser verification')
      } else if (selected === 'desktop') {
        record.diagnostics = `reference-local/desktop-acceptance/${Date.now()}-${process.pid}`
        record.scenarios = []
        for (const script of checks.desktop) {
          const scenario = script.split(':').at(-1)
          npm(script, ['--', '-ArtifactRoot', `${record.diagnostics}/${scenario}`])
          record.scenarios.push(readDesktopScenarioEvidence(root, `${record.diagnostics}/${scenario}`, scenario))
        }
      } else for (const script of checks[selected]) {
        if (script === 'test' || script === 'test:clip') {
          const file = unitReportPath(selected, runId)
          record.unitResults = { path: file }
          fs.writeFileSync(reportPath, JSON.stringify(record, null, 2))
          npm(script, [], { ...process.env, XSHEET_UNIT_PHASE: selected, XSHEET_UNIT_RUN_ID: runId })
          record.unitResults = readUnitEvidence(root, file)
        } else npm(script)
      }
      if (sourceIdentity(root).sourceSha256 !== identity.sourceSha256) throw new Error('Source changed during verification; evidence cannot be accepted')
      record.status = 'passed'
      if (selected === 'pages') record.artifactSha256 = sha256(fs.readFileSync(manifestPath))
    } catch (error) {
      record.status = 'failed'; record.error = String(error); throw error
    } finally {
      record.finishedAt = new Date().toISOString(); record.durationMs = Math.round(performance.now() - start)
      fs.writeFileSync(reportPath, JSON.stringify(record, null, 2) + '\n')
      fs.writeFileSync(path.join(root, record.recordPath), JSON.stringify(record, null, 2) + '\n')
      console.log(`[verification] ${record.status}: ${record.recordPath}`)
    }
  }
}
