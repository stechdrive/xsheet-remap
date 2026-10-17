import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { sha256 } from './evidence.mjs'

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
