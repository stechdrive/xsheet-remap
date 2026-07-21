export function createPagesServiceWorker(plan) {
  assertPlan(plan)
  return `const APP_CACHE_PREFIX = ${JSON.stringify(plan.appCachePrefix)}
const APP_CACHE_REVISION = ${JSON.stringify(plan.appRevision)}
const RUNTIME_CACHE_PREFIX = ${JSON.stringify(plan.runtimeCachePrefix)}
const RUNTIME_CACHE_SCHEMA = ${JSON.stringify(plan.runtimeCacheSchema)}
const APP_SHELL_URL = ${JSON.stringify(plan.appShellUrl)}
const APP_PRECACHE_URLS = ${JSON.stringify(plan.appPrecacheUrls)}
const KNOWN_PATHS = new Set(${JSON.stringify(plan.knownUrls)}.map(url => new URL(url, self.registration.scope).pathname))
const RUNTIME_REVISIONS = new Map(${JSON.stringify(plan.runtimeAssets.map(asset => [asset.url, asset.revision]))}.map(([url, revision]) => [new URL(url, self.registration.scope).pathname, revision]))
const RUNTIME_REVISION_PARAM = '__xsheet_asset_revision'
const LEGACY_APP_CACHE_PATTERN = /^xsheet-pages-\\d+\\.\\d+\\.\\d+-[0-9a-f]{16}$/
const CACHE_SCOPE = scopeCacheSegment(self.registration.scope)
const APP_CACHE_KEY = \`${'${APP_CACHE_PREFIX}'}-${'${CACHE_SCOPE}'}-${'${APP_CACHE_REVISION}'}\`
const RUNTIME_CACHE_KEY = \`${'${RUNTIME_CACHE_PREFIX}'}-${'${CACHE_SCOPE}'}-v${'${RUNTIME_CACHE_SCHEMA}'}\`

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE_KEY).then(cache => cache.addAll(APP_PRECACHE_URLS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', event => {
  event.waitUntil(activateCaches().then(() => self.clients.claim()))
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(APP_CACHE_KEY).then(cache => cache.match(APP_SHELL_URL))))
    return
  }
  if (!KNOWN_PATHS.has(url.pathname)) return
  const runtimeRevision = RUNTIME_REVISIONS.get(url.pathname)
  if (runtimeRevision) {
    event.respondWith(runtimeResponse(event, request, runtimeRevision))
    return
  }
  event.respondWith(appResponse(event, request))
})

async function activateCaches() {
  const keys = await caches.keys()
  await Promise.all(keys
    .filter(key => (
      (key.startsWith(\`${'${APP_CACHE_PREFIX}'}-${'${CACHE_SCOPE}'}-\`) && key !== APP_CACHE_KEY)
      || (key.startsWith(\`${'${RUNTIME_CACHE_PREFIX}'}-${'${CACHE_SCOPE}'}-\`) && key !== RUNTIME_CACHE_KEY)
      || LEGACY_APP_CACHE_PATTERN.test(key)
    ))
    .map(key => caches.delete(key)))
  await pruneRuntimeCache()
}

async function pruneRuntimeCache() {
  const cache = await caches.open(RUNTIME_CACHE_KEY)
  const expectedUrls = new Set([...RUNTIME_REVISIONS.entries()].map(([pathname, revision]) => runtimeCacheUrl(new URL(pathname, self.registration.scope), revision)))
  const requests = await cache.keys()
  await Promise.all(requests.filter(request => !expectedUrls.has(request.url)).map(request => cache.delete(request)))
}

async function runtimeResponse(event, request, revision) {
  const cache = await caches.open(RUNTIME_CACHE_KEY)
  const cacheUrl = runtimeCacheUrl(new URL(request.url), revision)
  const cached = await cache.match(cacheUrl)
  if (cached) return cached
  const response = await fetch(cacheUrl)
  if (response.status !== 200 || response.type === 'opaque') return response
  const write = cache.put(cacheUrl, response.clone())
  event.waitUntil(write)
  return response
}

async function appResponse(event, request) {
  const cache = await caches.open(APP_CACHE_KEY)
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (!response.ok || response.type === 'opaque') return response
  const write = cache.put(request, response.clone())
  event.waitUntil(write)
  return response
}

function runtimeCacheUrl(url, revision) {
  const revisedUrl = new URL(url)
  revisedUrl.search = ''
  revisedUrl.searchParams.set(RUNTIME_REVISION_PARAM, revision)
  return revisedUrl.toString()
}

function scopeCacheSegment(scope) {
  const pathname = new URL(scope).pathname
  return pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'root'
}
`
}

function assertPlan(plan) {
  if (plan?.schemaVersion !== 1) throw new Error('Unsupported Pages cache plan')
  for (const key of ['appCachePrefix', 'appRevision', 'runtimeCachePrefix', 'appShellUrl']) {
    if (typeof plan[key] !== 'string' || plan[key].length === 0) throw new Error(`Pages cache plan is missing ${key}`)
  }
  if (!Number.isSafeInteger(plan.runtimeCacheSchema) || plan.runtimeCacheSchema < 1) {
    throw new Error('Pages cache plan has an invalid runtime cache schema')
  }
  for (const key of ['appPrecacheUrls', 'knownUrls', 'runtimeAssets']) {
    if (!Array.isArray(plan[key])) throw new Error(`Pages cache plan is missing ${key}`)
  }
}
