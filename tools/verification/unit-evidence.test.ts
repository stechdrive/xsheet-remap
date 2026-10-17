import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { readUnitEvidence, reusableUnitEvidence, unitReportForEnvironment, unitReportPath } from './unit-evidence.mjs'

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
