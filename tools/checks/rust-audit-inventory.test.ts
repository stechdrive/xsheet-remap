import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { currentCargoLockfiles } from './rust-audit.mjs'

it('audits existing crates after unstaged retirement without hiding a missing required lockfile', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xsheet-audit-inventory-'))
  try {
    fs.mkdirSync(path.join(root, 'current'))
    fs.writeFileSync(path.join(root, 'current/Cargo.toml'), '[package]')
    fs.writeFileSync(path.join(root, 'current/Cargo.lock'), '# lock')
    const tracked = ['retired/Cargo.lock', 'current/Cargo.lock']
    expect(currentCargoLockfiles(root, tracked)).toEqual(['current/Cargo.lock'])
    fs.unlinkSync(path.join(root, 'current/Cargo.lock'))
    expect(() => currentCargoLockfiles(root, tracked)).toThrow('missing for an existing manifest')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
