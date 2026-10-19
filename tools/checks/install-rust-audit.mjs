import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { rustAuditBinary } from './rust-audit.mjs'

const root = process.cwd()
const { cargoAuditVersion } = JSON.parse(fs.readFileSync('tools/checks/rust-audit-policy.json', 'utf8'))
const current = spawnSync(rustAuditBinary(root), ['--version'], { encoding: 'utf8' })
if (current.status === 0 && current.stdout.trim() === `cargo-audit ${cargoAuditVersion}`) {
  console.log(`[rust-audit] cargo-audit ${cargoAuditVersion} already installed`)
} else {
  const install = spawnSync('cargo', ['install', 'cargo-audit', '--version', cargoAuditVersion, '--locked',
    '--root', path.join(root, '.cache/cargo-audit')], { stdio: 'inherit',
    env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? path.join(root, '.cache/cargo-target') } })
  if (install.status !== 0) throw new Error(`cargo-audit installation failed: ${install.error ?? install.status}`)
}
