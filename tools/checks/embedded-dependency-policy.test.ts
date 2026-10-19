import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkEmbeddedDependencies } from './embedded-dependency-policy.mjs'

let root: string
function lock(packages: Record<string, { version: string }> = { 'node_modules/js-yaml': { version: '4.3.2' } }) {
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }))
}
function asset(file: string, contents = '') {
  const target = path.join(root, file)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, contents)
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'xsheet-dependencies-')); lock() })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('removed OCR and embedded runtime policy', () => {
  it('accepts the remaining audio inference runtime without OCR', () => {
    asset('build/vad/models/silero_vad.onnx')
    asset('build/assets/ort.wasm')
    expect(checkEmbeddedDependencies(root, 'build')).toEqual({ status: 'ocr-removed', externalVersion: '4.3.2' })
  })
  it('rejects an OCR package even when it is only a transitive dependency', () => {
    lock({ 'node_modules/js-yaml': { version: '4.3.2' }, 'node_modules/nested/node_modules/@paddleocr/paddleocr-js': { version: '0.4.2' } })
    expect(() => checkEmbeddedDependencies(root)).toThrow(/OCR dependency/)
  })
  it('rejects leftover models and emitted workers without a fixed-model exception', () => {
    asset('apps/web/public/ocr/models/model.tar')
    expect(() => checkEmbeddedDependencies(root)).toThrow(/OCR model/)
    fs.unlinkSync(path.join(root, 'apps/web/public/ocr/models/model.tar'))
    asset('build/assets/worker.js', 'const engine = "PaddleOCR";')
    expect(() => checkEmbeddedDependencies(root, 'build')).toThrow(/OCR runtime content/)
  })
  it('rejects runtime directories and missing artifact inventories', () => {
    expect(() => checkEmbeddedDependencies(root, 'build')).toThrow(/Artifact is missing/)
    asset('build/ocr/ort/runtime.wasm')
    expect(() => checkEmbeddedDependencies(root, 'build')).toThrow(/OCR asset/)
  })
  it('rejects js-yaml releases before the latest 4.x security fix', () => {
    for (const version of ['3.15.2', '4.1.1', '4.3.1', 'unknown']) {
      lock({ 'node_modules/js-yaml': { version } })
      expect(() => checkEmbeddedDependencies(root)).toThrow(/4.3.2/)
    }
  })
})
