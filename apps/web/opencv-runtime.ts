import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const digest = (text: string) => createHash('sha256').update(text).digest('hex')

function replaceBinding(source: string, start: string, end: string, expected: string, body: string): string {
  const from = source.indexOf(start), to = source.indexOf(end, from)
  if (from < 0 || to <= from || digest(source.slice(from, to)) !== expected) {
    throw new Error('OpenCV.js binding ABI changed. Verify its static dispatch before building.')
  }
  return source.slice(0, from) + body + source.slice(to)
}

// The distributed Emscripten build constructs two JS dispatchers with new Function.
// Replace only those verified adapters; preserve the package's WASM, license and all image algorithms.
export function prepareOpenCvAsset(webRoot: string): string {
  const require = createRequire(path.join(webRoot, 'package.json'))
  const raw = readFileSync(require.resolve('@techstark/opencv-js/dist/opencv.js'), 'utf8')
  const dispatch = readFileSync(path.join(webRoot, '../../tools/opencv/static-bindings.mjs'), 'utf8').replace(/^export function /gm, 'function ')
  const methods = replaceBinding(raw, 'function createJsInvoker(', 'function craftInvokerFunction(',
    '4bda1c0ed954da6583b982b6b1af48991ca33ff11e11e2b6ce6c0636bdc5cf80', dispatch + '\n')
  const asset = replaceBinding(methods, 'var captures={toValue:Emval.toValue}', 'var functionName=`methodCaller',
    'b7d0b4a66723ec2e8a956bf2328d5aae66d588dffe8f84e9cc390b888c39aee8',
    'var invokerFunction=createEmvalCaller(kind,argFromPtr,Emval.toValue,getStringOrSymbol,retType.isVoid?null:(d,r)=>emval_returnValue(toReturnWire,d,r));')
  const hash = digest(asset)
  const dir = path.resolve(webRoot, '../../.cache/opencv', hash)
  const file = path.join(dir, 'opencv.js')
  if (existsSync(file) && digest(readFileSync(file, 'utf8')) === hash) return file
  mkdirSync(dir, { recursive: true })
  const temp = path.join(dir, randomUUID() + '.tmp')
  try {
    writeFileSync(temp, asset, { flag: 'wx' })
    renameSync(temp, file)
  } finally {
    rmSync(temp, { force: true })
  }
  return file
}
