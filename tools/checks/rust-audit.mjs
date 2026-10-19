import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { sha256 } from '../verification/evidence.mjs'

export function inspectRustAudit(report, policy, activePackages, today = new Date().toISOString().slice(0, 10)) {
  if (!Number.isInteger(report?.database?.['advisory-count']) || report.database['advisory-count'] <= 0
    || !Array.isArray(report?.vulnerabilities?.list)
    || !report.warnings || typeof report.warnings !== 'object' || Array.isArray(report.warnings)
    || report.vulnerabilities.count !== report.vulnerabilities.list.length
    || report.vulnerabilities.found !== (report.vulnerabilities.count > 0)) {
    throw new Error('Invalid or incomplete cargo-audit report')
  }
  if (!report.settings || report.settings.ignore?.length !== 0 || report.settings.severity !== null
    || report.settings.target_arch?.length !== 0 || report.settings.target_os?.length !== 0
    || !['unmaintained', 'unsound', 'notice'].every(kind => report.settings.informational_warnings?.includes(kind))) {
    throw new Error('cargo-audit must report all advisories without ignores, severity or platform filters')
  }
  const errors = report.vulnerabilities.list.map(item => `Vulnerability ${item.advisory?.id}: ${item.package?.name} ${item.package?.version}`)
  const reviewed = []
  const ids = new Set()
  for (const exception of policy.exceptions) {
    if (!exception.reason?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(exception.reviewBy)
      || exception.reviewBy < today || ids.has(exception.id)) {
      errors.push(`Invalid, duplicate or expired exception: ${exception.id}`)
    }
    ids.add(exception.id)
  }
  for (const [kind, warnings] of Object.entries(report.warnings)) {
    if (!Array.isArray(warnings)) throw new Error(`Invalid cargo-audit warnings: ${kind}`)
    for (const warning of warnings) {
      const id = warning.advisory?.id
      const exception = policy.exceptions.find(item => item.id === id && item.kind === kind
        && item.package === warning.package?.name && item.version === warning.package?.version)
      if (!exception) {
        errors.push(`Unreviewed ${kind}: ${id ?? warning.package?.name}`)
      } else if (exception.absentFromTarget && activePackages.has(`${exception.package}@${exception.version}`)) {
        errors.push(`${id} is active on ${policy.target}; the platform exception no longer applies`)
      } else {
        reviewed.push({ id, kind, package: exception.package, version: exception.version,
          absentFromTarget: Boolean(exception.absentFromTarget), reviewBy: exception.reviewBy, reason: exception.reason })
      }
    }
  }
  return { errors, reviewed }
}

export function inspectAuditDatabase(database, snapshot, actualCommit) {
  if (!/^[a-f0-9]{40}$/.test(actualCommit) || snapshot?.['last-commit'] !== actualCommit
    || !Number.isInteger(database?.['advisory-count']) || database['advisory-count'] <= 0
    || database['advisory-count'] !== snapshot['advisory-count']
    || (database['last-commit'] !== null && database['last-commit'] !== actualCommit)) {
    throw new Error('RustSec database identity is missing or changed during the audit')
  }
}

export function rustAuditBinary(root) {
  return path.join(root, '.cache', 'cargo-audit', 'bin', process.platform === 'win32' ? 'cargo-audit.exe' : 'cargo-audit')
}

export function runRustAudit(root = process.cwd()) {
  const policy = JSON.parse(fs.readFileSync(path.join(root, 'tools/checks/rust-audit-policy.json'), 'utf8'))
  const binary = rustAuditBinary(root)
  const version = spawnSync(binary, ['--version'], { encoding: 'utf8', cwd: root })
  if (version.status !== 0 || version.stdout.trim() !== `cargo-audit ${policy.cargoAuditVersion}`) {
    throw new Error(`Run npm run setup:rust-audit to install cargo-audit ${policy.cargoAuditVersion}`)
  }
  const inventory = spawnSync('git', ['ls-files', '-z', '--', '**/Cargo.lock'], { cwd: root, encoding: 'utf8' })
  if (inventory.status !== 0) throw new Error(`Cannot enumerate Cargo lockfiles: ${inventory.stderr}`)
  const lockfiles = inventory.stdout.split('\0').filter(Boolean).sort()
  if (!lockfiles.length) throw new Error('No tracked Cargo lockfiles found')
  const output = path.join(root, 'reference-local', 'dependency-audit', `${Date.now()}-${process.pid}`)
  fs.mkdirSync(output, { recursive: true })
  const results = []
  const databasePath = path.join(root, '.cache/rustsec-advisory-db')
  let databaseSnapshot
  for (const [index, lockfile] of lockfiles.entries()) {
    const result = spawnSync(binary, ['audit', '--json', '--file', lockfile,
      '--db', databasePath, ...(index ? ['--no-fetch'] : [])],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    fs.writeFileSync(path.join(output, `${index}-audit.json`), result.stdout ?? '')
    fs.writeFileSync(path.join(output, `${index}-audit.stderr.txt`), result.stderr ?? '')
    if (result.error || ![0, 1].includes(result.status)) throw new Error(`cargo-audit failed for ${lockfile}: ${result.error ?? result.stderr}`)
    const report = JSON.parse(result.stdout)
    const databaseHead = spawnSync('git', ['-C', databasePath, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
    if (databaseHead.status !== 0) throw new Error(`Cannot read RustSec database revision: ${databaseHead.stderr}`)
    databaseSnapshot ??= report.database
    // --no-fetch deliberately omits commit metadata. Keep the raw report and
    // independently verify that every lockfile used the first fetched revision.
    inspectAuditDatabase(report.database, databaseSnapshot, databaseHead.stdout.trim())
    // Cargo.lock includes all platforms. Check the actual shipped target before
    // applying any narrowly scoped GTK exception, never suppress the advisory.
    const tree = spawnSync('cargo', ['tree', '--locked', '--manifest-path', lockfile.replace(/Cargo.lock$/, 'Cargo.toml'),
      '--target', policy.target, '--prefix', 'none', '--format', '{p}'],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    fs.writeFileSync(path.join(output, `${index}-target-tree.txt`), (tree.stdout ?? '') + (tree.stderr ?? ''))
    if (tree.status !== 0) throw new Error(`Cannot inspect target graph for ${lockfile}: ${tree.error ?? tree.stderr}`)
    const activePackages = new Set(tree.stdout.split(/\r?\n/).flatMap(line => {
      const match = /^(\S+) v([^\s]+)/.exec(line)
      return match ? [`${match[1]}@${match[2]}`] : []
    }))
    if (!activePackages.size) throw new Error(`Empty target dependency graph: ${lockfile}`)
    const inspected = inspectRustAudit(report, policy, activePackages)
    if (result.status !== 0 && !inspected.errors.length) inspected.errors.push(`cargo-audit exited with ${result.status}`)
    results.push({ lockfile, sha256: sha256(fs.readFileSync(path.join(root, lockfile))), database: databaseSnapshot, ...inspected })
    console.log(`[rust-audit] ${lockfile}: ${report.vulnerabilities.count} vulnerabilities, ${inspected.reviewed.length} reviewed warnings`)
    for (const warning of inspected.reviewed) console.log(`  ${warning.id}: ${warning.package} ${warning.version} (${warning.absentFromTarget ? 'not in Windows target' : 'unmaintained'}; review by ${warning.reviewBy})`)
  }
  const errors = results.flatMap(result => result.errors.map(error => `${result.lockfile}: ${error}`))
  fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify({ tool: version.stdout.trim(), toolSha256: sha256(fs.readFileSync(binary)),
    policySha256: sha256(fs.readFileSync(path.join(root, 'tools/checks/rust-audit-policy.json'))), target: policy.target,
    status: errors.length ? 'failed' : 'passed', results }, null, 2) + '\n')
  if (errors.length) throw new Error(errors.join('\n'))
  console.log(`[rust-audit] passed; evidence: ${path.relative(root, output)}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runRustAudit()
