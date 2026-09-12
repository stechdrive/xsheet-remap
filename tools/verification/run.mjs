import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { browserProjects, checks, selectChecks, testPurposes, withoutGeneratedVersion } from './plan.mjs'
import { reusableEvidence, sha256, sourceIdentity } from './evidence.mjs'

const args = process.argv.slice(2)
const phase = args[0] ?? 'local'
const option = name => args.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const root = process.cwd()
const output = path.join(root, 'reference-local/verification')
fs.mkdirSync(output, { recursive: true })
function command(file, argv, env = process.env) {
  const result = spawnSync(file, argv, { cwd: root, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(file)} ${argv.join(' ')} failed (${result.status})`)
}
function npm(script) {
  const cli = process.env.npm_execpath
  if (!cli) throw new Error('Run verification through npm run verify:...')
  command(process.execPath, [cli, 'run', script])
}
function runtimeIdentity(phase) {
  const toolVersion = (tool, argv, env = process.env) => {
    const result = spawnSync(tool, argv, { env, encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`Cannot identify ${tool}: ${result.error ?? result.stderr}`)
    return result.stdout.trim()
  }
  if (phase === 'native') return { rust: toolVersion('rustc', ['--version']), cargo: toolVersion('cargo', ['--version']) }
  if (phase === 'importer') return { python: toolVersion(process.env.XSHEET_TEST_PYTHON || 'python', ['-c', 'import sys,PIL; print(sys.version); print(PIL.__version__)'], { ...process.env, PYTHONPATH: process.env.XSHEET_TEST_DEPENDENCIES || '' }) }
  return {}
}
if (phase === 'plan') {
  const base = option('base')
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
  const plan = selectChecks(files, { release: args.includes('--release') })
  console.log(JSON.stringify({ ...plan, testPurposes }, null, 2))
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `native=${plan.native}\nimporter=${plan.importer}\nbrowsers=${JSON.stringify(plan.browser)}\n`)
} else {
  const phases = phase === 'local' ? ['check', 'native', 'importer', 'pages', 'browser'] : [phase]
  for (const selected of phases) {
    if (!(selected in checks) && selected !== 'browser') throw new Error(`Unknown verification phase: ${selected}`)
    const project = option('project')
    if (project && !browserProjects.includes(project)) throw new Error(`Unknown browser project: ${project}`)
    const name = selected === 'browser' && project ? `browser-${project}` : selected
    const reportPath = path.join(output, `${name}.json`)
    const identity = { ...sourceIdentity(root), ...runtimeIdentity(selected) }
    const manifestPath = path.join(root, 'apps/web/dist-pages/pages-artifact.json')
    const artifactSha256 = ['browser', 'pages'].includes(selected) && fs.existsSync(manifestPath) ? sha256(fs.readFileSync(manifestPath)) : null
    const previous = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : null
    if (artifactSha256 && (selected === 'browser' || args.includes('--reuse') && reusableEvidence(previous, identity, name, artifactSha256))) npm('check:pages-artifact')
    if (args.includes('--reuse') && reusableEvidence(previous, identity, name, artifactSha256)) {
      console.log(`[verification] ${name}: reusing matching passed evidence (${previous.finishedAt})`)
      continue
    }
    const record = { schemaVersion: 1, phase: name, identity, artifactSha256, status: 'running', startedAt: new Date().toISOString(), purpose: testPurposes[selected] ?? testPurposes.browser }
    const start = performance.now()
    fs.writeFileSync(reportPath, JSON.stringify(record, null, 2))
    try {
      if (selected === 'browser') {
        if (!artifactSha256) throw new Error('Build the Pages candidate with npm run verify:pages first')
        const runId = `${Date.now()}-${process.pid}`
        record.results = `reference-local/verification/browser-${runId}.json`
        record.diagnostics = `reference-local/canvaskit-browser/${runId}`
        command(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tools/e2e/canvaskit/playwright.config.ts', ...(project ? [`--project=${project}`] : [])], { ...process.env, XSHEET_BROWSER_RUN_ID: runId })
        npm('check:pages-artifact')
      } else for (const script of checks[selected]) npm(script)
      if (sourceIdentity(root).sourceSha256 !== identity.sourceSha256) throw new Error('Source changed during verification; evidence cannot be accepted')
      record.status = 'passed'
      if (selected === 'pages') record.artifactSha256 = sha256(fs.readFileSync(manifestPath))
    } catch (error) {
      record.status = 'failed'; record.error = String(error); throw error
    } finally {
      record.finishedAt = new Date().toISOString(); record.durationMs = Math.round(performance.now() - start)
      fs.writeFileSync(reportPath, JSON.stringify(record, null, 2) + '\n')
    }
  }
}
