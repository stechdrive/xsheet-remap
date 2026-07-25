import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const root = process.cwd()
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const ignoredDirectories = new Set(['node_modules', 'dist', 'dist-ts', 'target', 'gen', '.tmp', 'release-local'])
const violations = []
const implementationLineLimit = 2300
const testLineLimit = 1800

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

async function checkFilePatterns(relativePath, checks) {
  const source = await readFile(path.join(root, relativePath), 'utf8')
  for (const check of checks) {
    if (check.pattern.test(source)) violations.push(`${relativePath}: ${check.message}`)
  }
}

async function checkFileSizes(relativeDirectory) {
  for (const relativePath of await sourceFiles(relativeDirectory)) {
    const source = await readFile(path.join(root, relativePath), 'utf8')
    const lineCount = source.split(/\r?\n/).length
    const isTest = /(?:^|[\\/])[^\\/]+\.test\.[^.]+$/.test(relativePath)
    const limit = isTest ? testLineLimit : implementationLineLimit
    if (lineCount > limit) {
      violations.push(`${relativePath}: ${lineCount} lines exceeds the ${isTest ? 'test' : 'implementation'} limit of ${limit}`)
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

await checkFilePatterns('packages/ui/src/DialogueAudioTimeline.tsx', [
  {
    pattern: /\btitle\s*=/,
    message: 'audio timeline tooltips must use the shared Tooltip or TooltipTarget foundation instead of native title attributes',
  },
])

for (const directory of ['apps', 'packages', 'tools']) {
  await checkImports(directory, [
    {
      pattern: /['"]@xsheet-remap\/[^'"]+\/src(?:\/|['"])/,
      message: 'workspace packages must be imported through their public exports',
    },
  ])
  await checkFileSizes(directory)
}

if (violations.length > 0) {
  console.error('[architecture] dependency boundary violations:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log('[architecture] passed')
}
