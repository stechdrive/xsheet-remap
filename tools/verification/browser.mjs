import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { browserProjects } from './plan.mjs'
import { sha256 } from './evidence.mjs'

export function browserFilters(project, suite = 'all', pattern = null) {
  if (!['all', 'functional', 'isolated'].includes(suite)) throw new Error(`Unknown browser suite: ${suite}`)
  // RegExp arrays are OR in Playwright. Use a lookahead for the intersection.
  const grep = suite === 'isolated'
    ? new RegExp(`^(?=[\\s\\S]*@isolated)(?=[\\s\\S]*(?:${pattern ?? '.*'}))[\\s\\S]*$`)
    : new RegExp(pattern ?? '.*')
  const excluded = [!project.endsWith('-touch') && /@touch/, suite === 'functional' && /@isolated/].filter(Boolean)
  return { grep, grepInvert: excluded }
}

export function browserCases(report) {
  const cases = []
  function visit(suites, parents = []) {
    for (const suite of suites ?? []) {
      const titles = [...parents, suite.title]
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        cases.push({ id: JSON.stringify([test.projectName, spec.file.replaceAll('\\', '/'), ...titles, spec.title]),
          project: test.projectName, file: spec.file, title: spec.title, tags: spec.tags ?? [], test })
      }
      visit(suite.suites, titles)
    }
  }
  visit(report.suites)
  return cases
}

export function assertSameCases(expected, actual) {
  if (new Set(actual).size !== actual.length) throw new Error('Duplicate browser cases in execution plan/results')
  const missing = expected.filter(id => !actual.includes(id)), extra = actual.filter(id => !expected.includes(id))
  if (missing.length || extra.length || expected.length !== actual.length) throw new Error(`Browser inventory differs: missing ${missing.length}, extra ${extra.length}`)
}

export function validateBrowserResults(report, expected, workers) {
  const cases = browserCases(report)
  assertSameCases(expected, cases.map(item => item.id))
  if (report.errors?.length) throw new Error('Browser runner reported global errors')
  if (report.config?.workers !== workers || !(report.config?.metadata?.actualWorkers > 0) || report.config.metadata.actualWorkers > workers) throw new Error('Browser worker configuration differs from the execution plan')
  if (report.config.fullyParallel !== false || report.config.shard !== null || !report.config.forbidOnly
    || !report.config.projects?.length || report.config.projects.some(project => project.retries !== 0 || project.repeatEach !== 1)) {
    throw new Error('Browser execution must retain file order, forbid focused tests, and use no retries, repeats or shards')
  }
  const failed = cases.filter(({ test }) => test.expectedStatus !== 'passed' || test.status !== 'expected'
    || test.results.length !== 1 || test.results[0].status !== 'passed' || test.results[0].retry !== 0)
  if (failed.length) throw new Error(`${failed.length} browser cases failed, skipped or retried; keep diagnostics and investigate`)
  return { passed: cases.length, failed: 0, skipped: 0, retries: 0, durationMs: report.stats.duration }
}

export function prepareBrowser(root, options, runId) {
  if (process.env.XSHEET_PERF_BASELINE) throw new Error('Acceptance must keep performance assertions enabled; unset XSHEET_PERF_BASELINE')
  const ci = options.phase === 'browser-ci'
  const config = `tools/e2e/canvaskit/playwright${ci ? '.ci' : ''}.config.ts`
  const selection = { projects: ci ? ['chromium-smoke'] : options.project ? [options.project] : browserProjects,
    suite: ci ? 'all' : options.suite, grep: ci ? null : options.grep, files: ci ? [] : options.files }
  for (const file of selection.files) if (!fs.existsSync(path.join(root, 'tools/e2e/canvaskit', file))) throw new Error(`Unknown browser spec: ${file}`)
  const groups = ci ? [{ suite: 'all', workers: 1 }] : (selection.suite === 'all' ? ['functional', 'isolated'] : [selection.suite])
    .map(suite => ({ suite, workers: suite === 'isolated' ? 1 : options.workers }))
  function invocation(group) {
    const id = `${runId}-${ci ? 'smoke' : group.suite}`
    return { argv: ['node_modules/@playwright/test/cli.js', 'test', '--config', config, `--workers=${group.workers}`,
      ...(options.project && !ci ? [`--project=${options.project}`] : []),
      ...selection.files.map(file => `(^|[/\\\\])${file.replaceAll('.', '\\.')}$`)],
    env: { ...process.env, XSHEET_BROWSER_RUN_ID: id, XSHEET_BROWSER_SUITE: group.suite, XSHEET_BROWSER_GREP: selection.grep ?? '' },
    results: `reference-local/verification/browser-${id}.json`, diagnostics: `reference-local/canvaskit-browser/${id}` }
  }
  function list(group) {
    const { argv, env } = invocation(group)
    const result = spawnSync(process.execPath, [...argv, '--list', '--reporter=json', '--pass-with-no-tests'], { cwd: root, env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (result.error || result.status !== 0) throw new Error(`Cannot list browser cases: ${result.error ?? (result.stderr || result.stdout)}`)
    const report = JSON.parse(result.stdout)
    if (report.errors?.length) throw new Error(`Cannot list browser cases: ${JSON.stringify(report.errors)}`)
    return browserCases(report).map(item => item.id).sort()
  }
  const inventory = list({ suite: selection.suite, workers: 1 })
  if (!inventory.length) throw new Error('Browser selection matched no tests')
  for (const group of groups) {
    group.inventory = groups.length === 1 ? inventory : list(group)
    Object.assign(group, invocation(group))
  }
  assertSameCases(inventory, groups.flatMap(group => group.inventory))
  const execution = { schemaVersion: 1, ...selection, fullyParallel: false, retries: 0, repeatEach: 1,
    inventorySha256: sha256(JSON.stringify(inventory)),
    groups: groups.map(({ suite, workers, inventory }) => ({ suite, workers, count: inventory.length, inventorySha256: sha256(JSON.stringify(inventory)) })) }
  return { execution, inventory, groups: groups.filter(group => group.inventory.length) }
}
