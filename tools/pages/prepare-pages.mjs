import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PAGES_APP_ID,
  PAGES_ARTIFACT_SCHEMA_VERSION,
  createPagesArtifactRecord,
  createPagesCachePlan,
} from './pages-cache-policy.mjs'
import { createPagesServiceWorker } from './pages-service-worker.mjs'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputRoot = path.join(repoRoot, 'apps', 'web', 'dist-pages')
const version = (await fs.readFile(path.join(repoRoot, 'VERSION'), 'utf8')).trim()
const sourceFiles = await listFiles(outputRoot)
const knownFiles = sourceFiles.filter(file => !['sw.js', 'pages-artifact.json'].includes(file))
const sourceRecords = await inspectFiles(knownFiles)
const cachePlan = createPagesCachePlan(version, sourceRecords)
await fs.writeFile(path.join(outputRoot, 'sw.js'), createPagesServiceWorker(cachePlan), 'utf8')

const artifactFiles = (await listFiles(outputRoot)).filter(file => file !== 'pages-artifact.json')
const inventory = (await inspectFiles(artifactFiles)).map(file => createPagesArtifactRecord(file))
await fs.writeFile(path.join(outputRoot, 'pages-artifact.json'), `${JSON.stringify({
  schemaVersion: PAGES_ARTIFACT_SCHEMA_VERSION,
  app: PAGES_APP_ID,
  version,
  cachePolicy: {
    schemaVersion: cachePlan.schemaVersion,
    appCachePrefix: cachePlan.appCachePrefix,
    appRevision: cachePlan.appRevision,
    runtimeCachePrefix: cachePlan.runtimeCachePrefix,
    runtimeCacheSchema: cachePlan.runtimeCacheSchema,
    appFileCount: inventory.filter(file => file.cacheClass === 'app').length,
    runtimeFileCount: inventory.filter(file => file.cacheClass === 'runtime').length,
  },
  files: inventory,
}, null, 2)}\n`, 'utf8')
console.log(`[pages] prepared ${inventory.length + 1} files with app revision ${cachePlan.appRevision} and persistent runtime cache v${cachePlan.runtimeCacheSchema}`)

async function inspectFiles(relativePaths) {
  const records = []
  for (const relativePath of relativePaths) {
    const bytes = await fs.readFile(path.join(outputRoot, relativePath))
    records.push({
      path: relativePath,
      bytes: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return records
}

async function listFiles(root, relativeDirectory = '') {
  const directory = path.join(root, relativeDirectory)
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Pages output must not contain symbolic links: ${path.join(relativeDirectory, entry.name)}`)
    const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(root, relativePath))
    else if (entry.isFile()) files.push(relativePath)
    else throw new Error(`Unsupported Pages output entry: ${relativePath}`)
  }
  return files.sort((a, b) => a.localeCompare(b, 'en'))
}
