import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { prepareOpenCvAsset } from '../../apps/web/opencv-runtime'
import { createEmvalCaller, createJsInvoker } from './static-bindings.mjs'

describe('static OpenCV bindings', () => {
  it('initializes and executes the real WASM with string code generation disabled', async () => {
    const file = prepareOpenCvAsset(path.resolve('apps/web'))
    const module = { exports: {} }
    const scope = vm.createContext({ module, require: createRequire(file), __dirname: path.dirname(file),
      process, Buffer, console, performance, TextDecoder, TextEncoder, URL, atob, btoa, setTimeout, clearTimeout, fetch },
    { codeGeneration: { strings: false, wasm: true } })
    vm.runInContext(readFileSync(file, 'utf8'), scope)
    const cv = await module.exports as typeof import('@techstark/opencv-js')
    const pts = cv.matFromArray(4, 1, cv.CV_32FC2, [0,0,20,0,20,20,0,20])
    const output = cv.matFromArray(4, 1, cv.CV_32FC2, [3,8,23,8,23,28,3,28])
    const mask = new cv.Mat()
    const h = cv.findHomography(pts, output, cv.RANSAC, 1, mask)
    try {
      expect(h.data64F[2]).toBeCloseTo(3, 6)
      expect(h.data64F[5]).toBeCloseTo(8, 6)
      expect(Array.from(mask.data)).toEqual([1,1,1,1])
    } finally {
      h.delete(); mask.delete(); output.delete(); pts.delete()
    }
  })

  it('retains method receivers, argument destructors and return conversion', () => {
    const disposed: number[] = [], owner = { value: 3 }
    const dispatch = createJsInvoker([{}, { destructorFunction: null }, { destructorFunction: true }], true, true)
    const method = dispatch('test', null, (_fn: number, self: number, n: number) => self+n, 1, null,
      (n: number) => n*2, (_: unknown, self: typeof owner) => self.value, (_: unknown, n: number) => n+1,
      (n: number) => disposed.push(n))
    expect(method.call(owner,4)).toBe(16)
    expect(disposed).toEqual([5])
    const caller = createEmvalCaller(1, [(p: number) => p / 8], () => ({ n: 5, add(v: number) { return this.n+v } }),
      () => 'add', (_: number, result: number) => result)
    expect(caller(12,0,0,16)).toBe(7)
  })
})
