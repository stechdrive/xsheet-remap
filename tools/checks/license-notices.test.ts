import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkLicenseCatalog, runtimeNpmPackages } from './license-notices.mjs'

const root = path.resolve(import.meta.dirname, '../..')
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'licenses/catalog.json'), 'utf8'))

describe('embedded license catalog', () => {
  it('matches the installed runtime notices, native locks and bundled assets', () => {
    expect(checkLicenseCatalog(root, catalog).components).toBe(catalog.components.length)
    const ids = catalog.components.map((item: { id: string }) => item.id)
    expect(ids).toContain('npm:celcodec@0.8.0')
    expect(ids).not.toContain('npm:celcodec-legacy@0.2.0')
  })
  it('rejects missing or modified license text, a stale dependency snapshot and missing source information', () => {
    const missingText = structuredClone(catalog)
    delete missingText.texts[missingText.components[0].textIds[0]]
    expect(() => checkLicenseCatalog(root, missingText)).toThrow(/license text/)
    const alteredText = structuredClone(catalog)
    alteredText.texts[alteredText.components[0].textIds[0]] += 'altered'
    expect(() => checkLicenseCatalog(root, alteredText)).toThrow(/license text/)
    const stale = structuredClone(catalog); stale.inputs.npm = 'old dependencies'
    expect(() => checkLicenseCatalog(root, stale)).toThrow(/stale/)
    const missingNative = structuredClone(catalog)
    missingNative.components = missingNative.components.filter((item: { id: string }) => item.id !== 'cargo:tauri-plugin@2.7.2')
    expect(() => checkLicenseCatalog(root, missingNative)).toThrow()
    const missingSource = structuredClone(catalog)
    missingSource.components.find((item: { id: string }) => item.id === 'asset:LAME MP3 encoder').links = []
    expect(() => checkLicenseCatalog(root, missingSource)).toThrow(/asset notice/)
  })
  it('traverses production workspace dependencies without including test-only packages', () => {
    const packages = Object.fromEntries(['', 'apps/web', 'packages/ui', 'packages/adapters', 'packages/core', 'packages/xdts'].map(key => [key, {}]))
    Object.assign(packages, {
      '': { dependencies: { runtime: '1' }, devDependencies: { oracle: '1' } },
      'node_modules/runtime': { version: '1', license: 'MIT', dependencies: { child: '1' } },
      'node_modules/child': { version: '1', license: 'BSD-3-Clause' },
      'node_modules/oracle': { version: '1', license: 'MIT' },
    })
    expect(runtimeNpmPackages({ packages }).map((item: { path: string }) => item.path)).toEqual(['node_modules/child', 'node_modules/runtime'])
  })
})
