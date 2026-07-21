import crypto from 'node:crypto'

export const PAGES_APP_ID = 'xsheet-editor-pwa'
export const PAGES_CACHE_POLICY_VERSION = 1
export const PAGES_ARTIFACT_SCHEMA_VERSION = 2
export const PAGES_RUNTIME_CACHE_SCHEMA = 1

const METADATA_FILES = new Set(['sw.js', 'pages-artifact.json'])
const RUNTIME_PATH_PATTERNS = [
  /\.(?:woff2?|ttf)$/i,
  /\.wasm$/i,
  /\.onnx$/i,
  /(?:^|\/)opencv-[^/]+\.js$/i,
  /^(?:ocr|vad)\//i,
]

export function classifyPagesAsset(relativePath) {
  const normalizedPath = normalizePagesPath(relativePath)
  if (METADATA_FILES.has(normalizedPath)) return 'metadata'
  if (RUNTIME_PATH_PATTERNS.some(pattern => pattern.test(normalizedPath))) return 'runtime'
  return 'app'
}

export function createPagesCachePlan(version, files) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Pages version must be a semantic version: ${version}`)
  }
  const normalizedFiles = files.map(file => normalizeFileRecord(file)).sort(comparePath)
  assertUniquePaths(normalizedFiles)
  if (!normalizedFiles.some(file => file.path === 'index.html')) {
    throw new Error('Pages cache plan requires index.html')
  }

  const appFiles = normalizedFiles.filter(file => classifyPagesAsset(file.path) === 'app')
  const runtimeFiles = normalizedFiles.filter(file => classifyPagesAsset(file.path) === 'runtime')
  const contentHash = crypto.createHash('sha256')
  for (const file of normalizedFiles) {
    contentHash.update(file.path)
    contentHash.update(file.sha256)
  }
  const appRevision = `${version}-${contentHash.digest('hex').slice(0, 16)}`

  return {
    schemaVersion: PAGES_CACHE_POLICY_VERSION,
    appId: PAGES_APP_ID,
    appCachePrefix: `${PAGES_APP_ID}-app`,
    appRevision,
    runtimeCachePrefix: `${PAGES_APP_ID}-runtime`,
    runtimeCacheSchema: PAGES_RUNTIME_CACHE_SCHEMA,
    appShellUrl: './index.html',
    appPrecacheUrls: [
      './',
      ...appFiles.map(file => `./${file.path}`),
    ],
    knownUrls: [
      './',
      ...normalizedFiles.map(file => `./${file.path}`),
    ],
    runtimeAssets: runtimeFiles.map(file => ({
      url: `./${file.path}`,
      revision: file.sha256,
    })),
  }
}

export function createPagesArtifactRecord(file, cacheClass = classifyPagesAsset(file.path)) {
  const normalized = normalizeFileRecord(file)
  if (!['app', 'runtime', 'metadata'].includes(cacheClass)) {
    throw new Error(`Unsupported Pages cache class for ${normalized.path}: ${cacheClass}`)
  }
  return { ...normalized, cacheClass }
}

export function normalizePagesPath(relativePath) {
  if (typeof relativePath !== 'string') throw new Error('Pages asset path must be a string')
  const normalizedPath = relativePath.replaceAll('\\', '/').replace(/^\.\//, '')
  const segments = normalizedPath.split('/')
  if (
    normalizedPath.length === 0
    || normalizedPath.startsWith('/')
    || normalizedPath.includes('//')
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe Pages asset path: ${relativePath}`)
  }
  return normalizedPath
}

function normalizeFileRecord(file) {
  const normalizedPath = normalizePagesPath(file?.path)
  const bytes = Number(file?.bytes)
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error(`Invalid Pages asset byte length for ${normalizedPath}: ${file?.bytes}`)
  }
  const sha256 = String(file?.sha256 ?? '').toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`Invalid Pages asset SHA-256 for ${normalizedPath}`)
  }
  return { path: normalizedPath, bytes, sha256 }
}

function assertUniquePaths(files) {
  const paths = new Set()
  for (const file of files) {
    if (paths.has(file.path)) throw new Error(`Duplicate Pages asset path: ${file.path}`)
    paths.add(file.path)
  }
}

function comparePath(left, right) {
  return left.path.localeCompare(right.path, 'en')
}
