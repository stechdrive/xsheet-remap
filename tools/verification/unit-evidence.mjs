import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { reusableEvidence, sha256 } from './evidence.mjs'

export const importerTestFilters = ['packages/core/src/clip-export.test.ts', 'packages/core/src/clip-import.test.ts',
  'packages/core/src/clip-document.test.ts', 'packages/core/src/process-timing.test.ts', 'packages/adapters/src/clip']

export function importerTestFiles(root) {
  return [...new Set(execFileSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0').filter(file => /\.test\.tsx?$/.test(file) && importerTestFilters.some(filter => file === filter || file.startsWith(`${filter}/`))
      && existsSync(path.join(root, file))))].sort()
}

// Coverage is derived from the immutable full-check record, never from a stale
// test count or a focused test run. Missing evidence falls back to test:clip.
export function importerCoverage(root, identity, files = importerTestFiles(root)) {
  try {
    const latest = JSON.parse(readFileSync(path.join(root, 'reference-local/verification/check.json'), 'utf8'))
    if (!/^reference-local\/verification\/run-[a-zA-Z0-9_-]+\.json$/.test(latest.recordPath ?? '')) return null
    const bytes = readFileSync(path.join(root, latest.recordPath))
    const record = JSON.parse(bytes)
    if (!reusableEvidence(record, identity, 'check') || !reusableUnitEvidence(root, record) || !files.length) return null
    const report = JSON.parse(readFileSync(path.join(root, record.unitResults.path), 'utf8'))
    const results = report.testResults.map(result => ({ ...result, file: path.relative(record.sourceRoot ?? root, result.name).replaceAll('\\', '/') }))
    const matched = files.map(file => results.filter(result => result.file === file))
    if (matched.some(matches => matches.length !== 1 || !matches[0].assertionResults?.length)) return null
    return { recordPath: latest.recordPath, recordSha256: sha256(bytes), unitResults: record.unitResults,
      files, tests: matched.reduce((count, matches) => count + matches[0].assertionResults.length, 0) }
  } catch { return null }
}

export function unitReportPath(phase, runId) {
  if (!['check', 'importer', 'direct'].includes(phase) || !/^[a-zA-Z0-9_-]+$/.test(runId ?? '')) throw new Error('Invalid unit evidence identity')
  return `reference-local/verification/unit-${phase}-${runId}.json`
}

export function unitReportForEnvironment(env = process.env, root = process.cwd()) {
  const phase = env.XSHEET_UNIT_PHASE, runId = env.XSHEET_UNIT_RUN_ID
  if ((phase === undefined) !== (runId === undefined)) throw new Error('Unit evidence phase and run id must be provided together')
  const file = unitReportPath(phase ?? 'direct', runId ?? `${Date.now()}-${process.pid}-${randomUUID()}`)
  if (existsSync(path.join(root, file))) throw new Error(`Refusing to overwrite unit evidence: ${file}`)
  return file
}

export function readUnitEvidence(root, file) {
  if (!/^reference-local\/verification\/unit-(?:check|importer|direct)-[a-zA-Z0-9_-]+\.json$/.test(file ?? '')) throw new Error('Invalid unit evidence path')
  const bytes = readFileSync(path.join(root, file)), report = JSON.parse(bytes)
  const cases = report.testResults?.flatMap(result => result.assertionResults ?? []) ?? []
  if (!report.success || !Number.isSafeInteger(report.numTotalTests) || report.numTotalTests < 1
    || report.numPassedTests !== report.numTotalTests || report.numFailedTests !== 0
    || report.numPendingTests !== 0 || (report.numTodoTests ?? 0) !== 0
    || cases.length !== report.numTotalTests || cases.some(test => test.status !== 'passed')) throw new Error('Unit evidence is incomplete or contains failed/skipped tests')
  return { path: file, sha256: sha256(bytes), tests: report.numTotalTests, files: report.testResults.length }
}

export function reusableUnitEvidence(root, record) {
  try {
    if (!['check', 'importer'].includes(record?.phase)
      || !record.unitResults?.path?.startsWith(`reference-local/verification/unit-${record.phase}-`)) return false
    return JSON.stringify(readUnitEvidence(root, record.unitResults.path)) === JSON.stringify(record.unitResults)
  } catch { return false }
}
