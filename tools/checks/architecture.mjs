import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { inspectSourceBoundaries } from './architecture-policy.mjs'

const ignore = new Set(['node_modules', 'dist', 'dist-pages', 'dist-ts', 'target', 'gen', '.tmp'])
async function inspect(directory) {
  const errors = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory() && !ignore.has(entry.name)) errors.push(...await inspect(file))
    else if (entry.isFile() && /\.(?:[cm]?[jt]sx?)$/.test(file)) {
      errors.push(...inspectSourceBoundaries(file, await readFile(file, 'utf8')).map(error => `${file}: ${error}`))
    }
  }
  return errors
}
const errors = (await Promise.all(['apps', 'packages', 'tools'].map(inspect))).flat()
if (errors.length) throw new Error(errors.join('\n'))
console.log('[architecture] imports and global event ownership verified')
