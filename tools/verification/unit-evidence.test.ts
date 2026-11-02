import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { importerCoverage, importerTestFiles, importerTestFilters, readUnitEvidence, reusableUnitEvidence, unitReportForEnvironment, unitReportPath } from './unit-evidence.mjs'

it('keeps full, importer and focused reports distinct and refuses overwrites', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unit-evidence-'))
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'unit-evidence-')) throw new Error('Unexpected temporary path')
  try {
    mkdirSync(path.join(root, 'reference-local/verification'), { recursive: true })
    const reports = ['check', 'importer'].map(phase => unitReportForEnvironment({ XSHEET_UNIT_PHASE: phase, XSHEET_UNIT_RUN_ID: 'run-1' }, root))
    expect(new Set([...reports, unitReportForEnvironment({}, root), unitReportForEnvironment({}, root)]).size).toBe(4)
    const passed = (tests: number) => JSON.stringify({ success: true, numTotalTests: tests, numPassedTests: tests,
      numFailedTests: 0, numPendingTests: 0, testResults: [{ assertionResults: Array.from({ length: tests }, (_, index) => ({ title: String(index), status: 'passed' })) }] })
    writeFileSync(path.join(root, reports[0]), passed(1643))
    const full = readFileSync(path.join(root, reports[0]), 'utf8')
    writeFileSync(path.join(root, reports[1]), passed(42))
    expect(readFileSync(path.join(root, reports[0]), 'utf8')).toBe(full)
    expect(() => unitReportForEnvironment({ XSHEET_UNIT_PHASE: 'check', XSHEET_UNIT_RUN_ID: 'run-1' }, root)).toThrow('overwrite')
    const record = { phase: 'check', unitResults: readUnitEvidence(root, reports[0]) }
    expect(reusableUnitEvidence(root, record)).toBe(true)
    expect(reusableUnitEvidence(root, { ...record, phase: 'importer' })).toBe(false)
    expect(reusableUnitEvidence(root, { phase: 'check' })).toBe(false)
    writeFileSync(path.join(root, reports[0]), passed(42))
    expect(reusableUnitEvidence(root, record)).toBe(false)
    writeFileSync(path.join(root, reports[0]), JSON.stringify({ ...JSON.parse(passed(42)), numPendingTests: 1 }))
    expect(() => readUnitEvidence(root, reports[0])).toThrow('incomplete')
    writeFileSync(path.join(root, reports[0]), JSON.stringify({ ...JSON.parse(passed(42)), testResults: [] }))
    expect(() => readUnitEvidence(root, reports[0])).toThrow('incomplete')
    rmSync(path.join(root, reports[0]))
    expect(reusableUnitEvidence(root, record)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects malformed evidence identities instead of silently changing destinations', () => {
  expect(() => unitReportPath('check', '../escape')).toThrow()
  expect(() => unitReportPath('unknown', 'run')).toThrow()
  expect(() => unitReportForEnvironment({ XSHEET_UNIT_PHASE: 'check' })).toThrow('together')
  expect(() => unitReportForEnvironment({ XSHEET_UNIT_RUN_ID: 'run' })).toThrow('together')
  expect(() => readUnitEvidence('.', '../report.json')).toThrow('path')
})

it('includes core and adapter tests in the shared CLIP coverage inventory', () => {
  const files = importerTestFiles(process.cwd())
  expect(files.length).toBeGreaterThan(4)
  for (const file of importerTestFilters.slice(0, 4)) expect(files).toContain(file)
  expect(files.some(file => file.startsWith('packages/adapters/src/clip/'))).toBe(true)
})

it('accepts complete matching coverage and rejects stale, focused, partial or altered evidence', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'unit-coverage-'))
  if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep + 'unit-coverage-')) throw new Error('Unexpected temporary path')
  try {
    mkdirSync(path.join(root, 'reference-local/verification'), { recursive: true })
    const file = unitReportPath('check', 'full')
    const recordPath = 'reference-local/verification/run-full.json'
    const files = ['packages/core/src/clip-import.test.ts', 'packages/adapters/src/clip/pixels.test.ts']
    const identity = { commit: 'current', sourceSha256: 'source', node: 'runtime' }
    // A clean clone can reuse evidence whose absolute test names belong to the
    // original checkout; the source/runtime identity must still match exactly.
    const sourceRoot = path.join(root, 'original-checkout')
    const report = { success: true, numTotalTests: 2, numPassedTests: 2, numFailedTests: 0, numPendingTests: 0,
      testResults: files.map(name => ({ name: path.join(sourceRoot, name), assertionResults: [{ title: name, status: 'passed' }] })) }
    const writeReport = (data: unknown) => writeFileSync(path.join(root, file), JSON.stringify(data))
    writeReport(report)
    const record = { schemaVersion: 1, phase: 'check', status: 'passed', identity, artifactSha256: null, execution: null,
      sourceRoot, recordPath, unitResults: readUnitEvidence(root, file) }
    const writeRecord = (data: unknown) => {
      writeFileSync(path.join(root, 'reference-local/verification/check.json'), JSON.stringify(data))
      writeFileSync(path.join(root, recordPath), JSON.stringify(data))
    }
    writeRecord(record)
    expect(importerCoverage(root, identity, files)).toMatchObject({ recordPath, files, tests: 2 })
    for (const field of Object.keys(identity)) {
      expect(importerCoverage(root, { ...identity, [field]: 'changed' }, files)).toBeNull()
    }
    expect(importerCoverage(root, identity, [...files, 'packages/core/src/new.test.ts'])).toBeNull()
    expect(importerCoverage(root, identity, [])).toBeNull()
    for (const change of [{ status: 'failed' }, { phase: 'direct' }, { unitResults: { ...record.unitResults, path: unitReportPath('direct', 'focused') } }]) {
      writeRecord({ ...record, ...change })
      expect(importerCoverage(root, identity, files)).toBeNull()
    }
    writeRecord(record)
    for (const data of [
      { ...report, numTotalTests: 1, numPassedTests: 1, testResults: report.testResults.slice(1) },
      { ...report, testResults: [report.testResults[0], report.testResults[0]] },
    ]) {
      writeReport(data)
      writeRecord({ ...record, unitResults: readUnitEvidence(root, file) })
      expect(importerCoverage(root, identity, files)).toBeNull()
    }
    writeReport(report)
    writeRecord(record)
    for (const change of [
      { ...report, numPendingTests: 1 },
      { ...report, testResults: report.testResults.slice(1) },
      { ...report, testResults: [report.testResults[0], report.testResults[0]] },
      { ...report, testResults: report.testResults.map(result => ({ ...result, assertionResults: [{ title: 'changed', status: 'skipped' }] })) },
    ]) {
      writeReport(change)
      expect(importerCoverage(root, identity, files)).toBeNull()
    }
    writeReport(report)
    rmSync(path.join(root, recordPath))
    expect(importerCoverage(root, identity, files)).toBeNull()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
