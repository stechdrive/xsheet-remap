import { describe, expect, it } from 'vitest'
import { inspectAuditDatabase, inspectRustAudit } from './rust-audit.mjs'

const exception = { id: 'RUSTSEC-2024-0429', kind: 'unsound', package: 'glib', version: '0.18.5',
  absentFromTarget: true, reviewBy: '2027-01-19', reason: 'GTK is outside the shipped Windows graph' }
const policy = { target: 'x86_64-pc-windows-msvc', exceptions: [exception] }
const warning = { advisory: { id: exception.id }, package: { name: 'glib', version: '0.18.5' } }
const commit = 'a'.repeat(40)
const report = () => ({ database: { 'last-commit': commit, 'advisory-count': 1338 },
  settings: { ignore: [], severity: null, target_arch: [], target_os: [], informational_warnings: ['unmaintained', 'unsound', 'notice'] },
  vulnerabilities: { found: false, count: 0, list: [] as typeof warning[] }, warnings: { unsound: [warning] } })
const inspect = (value: unknown, rules = policy, active = new Set<string>()) => inspectRustAudit(value, rules, active, '2026-10-19')

describe('Rust advisory gate', () => {
  it('binds offline reports with omitted metadata to the fetched database revision', () => {
    const snapshot = report().database
    expect(() => inspectAuditDatabase(snapshot, snapshot, commit)).not.toThrow()
    expect(() => inspectAuditDatabase({ ...snapshot, 'last-commit': null }, snapshot, commit)).not.toThrow()
    for (const database of [{}, { ...snapshot, 'advisory-count': 1339 }, { ...snapshot, 'last-commit': 'b'.repeat(40) }]) {
      expect(() => inspectAuditDatabase(database, snapshot, commit)).toThrow(/database identity/)
    }
    expect(() => inspectAuditDatabase(snapshot, snapshot, 'b'.repeat(40))).toThrow(/database identity/)
    expect(() => inspectAuditDatabase(snapshot, undefined, commit)).toThrow(/database identity/)
  })
  it('reports reviewed platform warnings without hiding them', () => {
    expect(inspect(report())).toMatchObject({ errors: [], reviewed: [{ id: exception.id, absentFromTarget: true }] })
  })
  it('rejects a platform exception when the dependency enters the shipped graph', () => {
    expect(inspect(report(), policy, new Set(['glib@0.18.5'])).errors).toEqual([expect.stringContaining('no longer applies')])
  })
  it('rejects unknown advisories and changed package versions or warning categories', () => {
    const changed = report()
    changed.warnings.unsound = [{ ...warning, advisory: { id: 'RUSTSEC-2099-0001' } }]
    expect(inspect(changed).errors).toHaveLength(1)
    changed.warnings.unsound = [{ ...warning, package: { ...warning.package, version: '0.18.6' } }]
    expect(inspect(changed).errors).toHaveLength(1)
    expect(inspect({ ...report(), warnings: { unmaintained: [warning] } }).errors).toHaveLength(1)
  })
  it('never applies warning exceptions to a vulnerability, even with the same advisory ID', () => {
    const value = report()
    value.vulnerabilities = { found: true, count: 1, list: [warning] }
    expect(inspect(value).errors).toEqual([expect.stringContaining('Vulnerability')])
  })
  it('rejects expired, undocumented and duplicate exceptions', () => {
    for (const exceptions of [[{ ...exception, reviewBy: '2026-10-18' }], [{ ...exception, reason: '' }], [exception, exception]]) {
      expect(inspect(report(), { ...policy, exceptions }).errors).toContainEqual(expect.stringContaining('exception'))
    }
  })
  it('fails closed on missing, inconsistent or malformed scanner results', () => {
    for (const value of [null, {}, { ...report(), database: {} }, { ...report(), vulnerabilities: { found: false, count: 1, list: [] } },
      { ...report(), warnings: { unsound: null } }]) expect(() => inspect(value)).toThrow()
  })
  it('rejects scanner settings which would hide findings before policy review', () => {
    for (const settings of [{ ignore: [exception.id] }, { severity: 'high' }, { target_os: ['windows'] }, { informational_warnings: ['unmaintained'] }]) {
      expect(() => inspect({ ...report(), settings: { ...report().settings, ...settings } })).toThrow(/without ignores/)
    }
  })
})
