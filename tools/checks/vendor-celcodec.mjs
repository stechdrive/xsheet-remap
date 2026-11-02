import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { gunzipSync } from 'node:zlib'

const filename = 'celcodec-0.2.0.tgz'
const sha256 = '7b658887da5e7d610f271c163cffa1ce61ec4a01dd65c575e3ae1ceca77764e0'

export function checkPinnedCelcodec(root) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'packages/adapters/package.json'), 'utf8'))
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
  const spec = `file:../../vendor/${filename}`
  if (manifest.dependencies.celcodec !== spec || lock.packages['packages/adapters']?.dependencies?.celcodec !== spec) {
    throw new Error('celcodec must use the repository-pinned archive, not a sibling checkout')
  }
  const codecs = Object.entries(lock.packages).filter(([name]) => name.endsWith('/node_modules/celcodec') || name === 'node_modules/celcodec')
  if (codecs.length !== 1) throw new Error('celcodec must have exactly one locked package')
  const installed = codecs[0][1]
  if (installed?.version !== '0.2.0' || installed.link || installed.resolved !== `file:vendor/${filename}`) throw new Error('celcodec lock must resolve the pinned archive')
  const bytes = fs.readFileSync(path.join(root, 'vendor', filename))
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('celcodec archive differs from the audited bytes')
  if (installed.integrity !== `sha512-${crypto.createHash('sha512').update(bytes).digest('base64')}`) throw new Error('celcodec lock integrity mismatch')
  const tar = gunzipSync(bytes), names = []
  for (let offset = 0; offset + 512 <= tar.length && tar[offset];) {
    const name = tar.subarray(offset, offset + 100).toString().replace(/\0.*$/s, '')
    const size = parseInt(tar.subarray(offset + 124, offset + 136).toString().replace(/\0.*$/s, '').trim(), 8) || 0
    if (!/^package\/(?:dist\/[\w/.-]+\.(?:js|d\.ts)|package\.json|README\.md|LICENSE|THIRD_PARTY_NOTICES\.md|assets\/(?:blank\.clip|README\.md))$/.test(name)) throw new Error(`Unexpected celcodec package file: ${name}`)
    names.push(name)
    offset += 512 + Math.ceil(size / 512) * 512
  }
  for (const name of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'assets/README.md', 'assets/blank.clip', 'dist/write/index.js', 'dist/read/index.js']) {
    if (!names.includes(`package/${name}`)) throw new Error(`celcodec package is missing ${name}`)
  }
  return { version: '0.2.0', sha256, files: names.length }
}
