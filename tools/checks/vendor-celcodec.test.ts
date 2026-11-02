import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { checkPinnedCelcodec } from './vendor-celcodec.mjs'

const copies: string[] = []
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'celcodec-pin-'))
  copies.push(root)
  for (const name of ['package.json', 'packages/adapters/package.json', 'package-lock.json', 'vendor/celcodec-0.2.0.tgz', 'vendor/celcodec-0.8.0-ac2a1c3c0758.tgz']) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.copyFileSync(name, path.join(root, name))
  }
  return root
}
afterEach(() => { for (const root of copies.splice(0)) fs.rmSync(root, { recursive: true, force: true }) })
describe('standalone CLIP dependency', () => {
  it('checks audited package bytes, inventory, notices, and lockfile integrity', () => {
    expect(checkPinnedCelcodec(process.cwd())).toMatchObject({ version: '0.8.0', files: 218 })
  })
  it('rejects mutable sibling links, altered archives and stale integrity', () => {
    const root = fixture(), file = path.join(root, 'package-lock.json')
    const lock = JSON.parse(fs.readFileSync(file, 'utf8'))
    const installed = lock.packages['node_modules/celcodec']
    installed.link = true
    fs.writeFileSync(file, JSON.stringify(lock))
    expect(() => checkPinnedCelcodec(root)).toThrow(/lock must resolve/)
    delete installed.link
    installed.integrity = 'sha512-stale'
    fs.writeFileSync(file, JSON.stringify(lock))
    expect(() => checkPinnedCelcodec(root)).toThrow(/integrity/)
    fs.appendFileSync(path.join(root, 'vendor/celcodec-0.8.0-ac2a1c3c0758.tgz'), 'changed')
    expect(() => checkPinnedCelcodec(root)).toThrow(/audited bytes/)
  })
  it('rejects a production legacy dependency or a modified comparison package', () => {
    const root = fixture(), file = path.join(root, 'package.json'), manifest = JSON.parse(fs.readFileSync(file, 'utf8'))
    manifest.dependencies['celcodec-legacy'] = manifest.devDependencies['celcodec-legacy']
    fs.writeFileSync(file, JSON.stringify(manifest))
    expect(() => checkPinnedCelcodec(root)).toThrow(/test-only/)
    delete manifest.dependencies['celcodec-legacy']
    fs.writeFileSync(file, JSON.stringify(manifest))
    fs.appendFileSync(path.join(root, 'vendor/celcodec-0.2.0.tgz'), 'changed')
    expect(() => checkPinnedCelcodec(root)).toThrow(/comparison package/)
  })
})
