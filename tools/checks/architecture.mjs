import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const ignoredDirectories = new Set(['node_modules', 'dist', 'dist-ts', 'target', 'gen', '.tmp', 'release-local'])
const violations = []

async function sourceFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue
    const relativePath = path.join(relativeDirectory, entry.name)
    if (entry.isDirectory()) files.push(...await sourceFiles(relativePath))
    else if (sourceExtensions.has(path.extname(entry.name))) files.push(relativePath)
  }
  return files
}

async function checkImports(relativeDirectory, checks) {
  for (const relativePath of await sourceFiles(relativeDirectory)) {
    const source = await readFile(path.join(root, relativePath), 'utf8')
    for (const check of checks) {
      if (check.pattern.test(source)) violations.push(`${relativePath}: ${check.message}`)
    }
  }
}

await checkImports('packages/core/src', [
  {
    pattern: /from\s+['"]@xsheet-remap\/(?:ui|adapters|xdts)['"]/,
    message: 'core must not depend on ui, adapters, or xdts',
  },
])

await checkImports('packages/ui/src', [
  {
    pattern: /(?:from\s+|import\s*\()['"]@tauri-apps\/api/,
    message: 'ui must access Tauri through @xsheet-remap/adapters',
  },
])

for (const directory of ['apps', 'packages', 'tools']) {
  await checkImports(directory, [
    {
      pattern: /['"]@xsheet-remap\/[^'"]+\/src(?:\/|['"])/,
      message: 'workspace packages must be imported through their public exports',
    },
  ])
}

if (violations.length > 0) {
  console.error('[architecture] dependency boundary violations:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('[architecture] passed')
}
