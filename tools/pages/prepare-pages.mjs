import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const outputRoot = path.join(repoRoot, 'apps', 'web', 'dist-pages')
const version = (await fs.readFile(path.join(repoRoot, 'VERSION'), 'utf8')).trim()
const sourceFiles = await listFiles(outputRoot)
const knownFiles = sourceFiles.filter(file => !['sw.js', 'pages-artifact.json'].includes(file))
const contentHash = crypto.createHash('sha256')
for (const relativePath of knownFiles) {
  contentHash.update(relativePath)
  contentHash.update(await fs.readFile(path.join(outputRoot, relativePath)))
}
const cacheKey = `xsheet-pages-${version}-${contentHash.digest('hex').slice(0, 16)}`
const coreFiles = knownFiles.filter(file =>
  !/\.(?:woff2?|ttf|wasm)$/i.test(file)
  && !/(?:^|\/)opencv-[^/]+\.js$/i.test(file)
)
const coreUrls = ['./', ...coreFiles.filter(file => file !== 'index.html').map(file => `./${file}`)]
const knownUrls = ['./', ...knownFiles.filter(file => file !== 'index.html').map(file => `./${file}`)]
await fs.writeFile(path.join(outputRoot, 'sw.js'), serviceWorkerSource(cacheKey, coreUrls, knownUrls), 'utf8')

const artifactFiles = (await listFiles(outputRoot)).filter(file => file !== 'pages-artifact.json')
const inventory = []
for (const relativePath of artifactFiles) {
  const bytes = await fs.readFile(path.join(outputRoot, relativePath))
  inventory.push({
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  })
}
await fs.writeFile(path.join(outputRoot, 'pages-artifact.json'), `${JSON.stringify({
  schemaVersion: 1,
  app: 'xsheet-editor-pwa',
  version,
  cacheKey,
  files: inventory,
}, null, 2)}\n`, 'utf8')
console.log(`[pages] prepared ${inventory.length + 1} files with cache ${cacheKey}`)

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

function serviceWorkerSource(cacheKey, coreUrls, knownUrls) {
  return `const CACHE_KEY = ${JSON.stringify(cacheKey)}\nconst CORE_URLS = ${JSON.stringify(coreUrls, null, 2)}\nconst KNOWN_PATHS = new Set(${JSON.stringify(knownUrls, null, 2)}.map(url => new URL(url, self.registration.scope).pathname))\n\nself.addEventListener('install', event => {\n  event.waitUntil(caches.open(CACHE_KEY).then(cache => cache.addAll(CORE_URLS)).then(() => self.skipWaiting()))\n})\n\nself.addEventListener('activate', event => {\n  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('xsheet-pages-') && key !== CACHE_KEY).map(key => caches.delete(key)))).then(() => self.clients.claim()))\n})\n\nself.addEventListener('fetch', event => {\n  const request = event.request\n  if (request.method !== 'GET') return\n  const url = new URL(request.url)\n  if (url.origin !== self.location.origin) return\n  if (request.mode === 'navigate') {\n    event.respondWith(fetch(request).catch(() => caches.match('./index.html')))\n    return\n  }\n  if (!KNOWN_PATHS.has(url.pathname)) return\n  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {\n    if (!response.ok || response.type === 'opaque') return response\n    const copy = response.clone()\n    event.waitUntil(caches.open(CACHE_KEY).then(cache => cache.put(request, copy)))\n    return response\n  })))\n})\n`
}
