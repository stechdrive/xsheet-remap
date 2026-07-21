import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

// These tests execute the generated worker so cache behavior stays part of the build contract.
import {
  classifyPagesAsset,
  createPagesCachePlan,
  normalizePagesPath,
} from './pages-cache-policy.mjs'
import { createPagesServiceWorker } from './pages-service-worker.mjs'

const APP_SHA = 'a'.repeat(64)
const RUNTIME_SHA = 'b'.repeat(64)
const UPDATED_RUNTIME_SHA = 'c'.repeat(64)

describe('Pages cache policy', () => {
  it('keeps the app shell separate from reusable runtime assets', () => {
    expect(classifyPagesAsset('index.html')).toBe('app')
    expect(classifyPagesAsset('assets/index-a1.js')).toBe('app')
    expect(classifyPagesAsset('assets/line-seed-jp-1.woff2')).toBe('runtime')
    expect(classifyPagesAsset('assets/ort-wasm-a1.wasm')).toBe('runtime')
    expect(classifyPagesAsset('assets/opencv-a1.js')).toBe('runtime')
    expect(classifyPagesAsset('vad/models/silero_vad.onnx')).toBe('runtime')
    expect(classifyPagesAsset('sw.js')).toBe('metadata')
  })

  it('creates a versioned app revision and content-revisioned runtime manifest', () => {
    const plan = cachePlan('0.1.1', RUNTIME_SHA)
    expect(plan.appRevision).toMatch(/^0\.1\.1-[0-9a-f]{16}$/)
    expect(plan.appPrecacheUrls).toEqual(['./', './assets/index-a1.js', './index.html'])
    expect(plan.appPrecacheUrls).not.toContain('./assets/ort-wasm-a1.wasm')
    expect(plan.runtimeAssets).toEqual([{
      url: './assets/ort-wasm-a1.wasm',
      revision: RUNTIME_SHA,
    }])
    expect(cachePlan('0.1.2', RUNTIME_SHA).runtimeCacheSchema).toBe(plan.runtimeCacheSchema)
    expect(cachePlan('0.1.2', RUNTIME_SHA).appRevision).not.toBe(plan.appRevision)
  })

  it('rejects paths that could escape or alias the generated artifact', () => {
    expect(() => normalizePagesPath('../asset.wasm')).toThrow('Unsafe Pages asset path')
    expect(() => normalizePagesPath('/asset.wasm')).toThrow('Unsafe Pages asset path')
    expect(() => normalizePagesPath('assets//asset.wasm')).toThrow('Unsafe Pages asset path')
  })
})

describe('Pages service worker runtime cache', () => {
  it('reuses unchanged runtime content across app versions and prunes changed revisions', async () => {
    const sharedCaches = new FakeCacheStorage(SCOPE)
    await sharedCaches.open(`xsheet-pages-0.1.661-${'d'.repeat(16)}`)
    await sharedCaches.open('xsheet-editor-pwa-runtime-xsheet-remap-v0')
    const network = { requests: [] }

    const firstWorker = evaluateWorker(cachePlan('0.1.1', RUNTIME_SHA), sharedCaches, network)
    await firstWorker.dispatch('install')
    await firstWorker.dispatch('activate')
    await firstWorker.fetch(RUNTIME_URL)
    expect(network.requests).toHaveLength(1)
    expect(network.requests[0]).toContain(`__xsheet_asset_revision=${RUNTIME_SHA}`)

    const firstKeys = await sharedCaches.keys()
    expect(firstKeys.some(key => key === 'xsheet-editor-pwa-runtime-xsheet-remap-v1')).toBe(true)
    expect(firstKeys.some(key => key.startsWith('xsheet-pages-'))).toBe(false)
    expect(firstKeys).not.toContain('xsheet-editor-pwa-runtime-xsheet-remap-v0')

    const secondWorker = evaluateWorker(cachePlan('0.1.2', RUNTIME_SHA), sharedCaches, network)
    await secondWorker.dispatch('install')
    await secondWorker.dispatch('activate')
    await secondWorker.fetch(RUNTIME_URL)
    expect(network.requests).toHaveLength(1)
    expect((await sharedCaches.keys()).filter(key => key.startsWith('xsheet-editor-pwa-app-xsheet-remap-'))).toHaveLength(1)

    const thirdWorker = evaluateWorker(cachePlan('0.1.3', UPDATED_RUNTIME_SHA), sharedCaches, network)
    await thirdWorker.dispatch('install')
    await thirdWorker.dispatch('activate')
    await thirdWorker.fetch(RUNTIME_URL)
    expect(network.requests).toHaveLength(2)
    expect(network.requests[1]).toContain(`__xsheet_asset_revision=${UPDATED_RUNTIME_SHA}`)

    const runtimeCache = await sharedCaches.open('xsheet-editor-pwa-runtime-xsheet-remap-v1')
    const runtimeKeys = await runtimeCache.keys()
    expect(runtimeKeys).toHaveLength(1)
    expect(runtimeKeys[0].url).toContain(`__xsheet_asset_revision=${UPDATED_RUNTIME_SHA}`)
  })

  it('generates a standalone service worker with scoped cache names', () => {
    const source = createPagesServiceWorker(cachePlan('0.1.1', RUNTIME_SHA))
    expect(() => new vm.Script(source)).not.toThrow()
    expect(source).toContain('xsheet-editor-pwa-runtime')
    expect(source).toContain('__xsheet_asset_revision')
    expect(source).toContain('LEGACY_APP_CACHE_PATTERN')
  })
})

const SCOPE = 'https://example.test/xsheet-remap/'
const RUNTIME_URL = `${SCOPE}assets/ort-wasm-a1.wasm`

function cachePlan(version, runtimeSha) {
  return createPagesCachePlan(version, [
    { path: 'index.html', bytes: 20, sha256: APP_SHA },
    { path: 'assets/index-a1.js', bytes: 40, sha256: 'd'.repeat(64) },
    { path: 'assets/ort-wasm-a1.wasm', bytes: 80, sha256: runtimeSha },
  ])
}

function evaluateWorker(plan, caches, network) {
  const listeners = new Map()
  const context = {
    URL,
    Request,
    Response,
    caches,
    fetch: async request => {
      const url = request instanceof Request ? request.url : String(request.url ?? request)
      network.requests.push(url)
      return new Response(`network:${url}`, { status: 200 })
    },
    self: {
      registration: { scope: SCOPE },
      location: { origin: new URL(SCOPE).origin },
      clients: { claim: async () => undefined },
      skipWaiting: async () => undefined,
      addEventListener(type, listener) {
        listeners.set(type, listener)
      },
    },
  }
  vm.runInNewContext(createPagesServiceWorker(plan), context)
  return {
    async dispatch(type) {
      const event = lifecycleEvent()
      listeners.get(type)(event)
      await event.done()
    },
    async fetch(url) {
      const event = fetchEvent(new Request(url))
      listeners.get('fetch')(event)
      const response = await event.response()
      await event.done()
      return response
    },
  }
}

function lifecycleEvent() {
  const work = []
  return {
    waitUntil(promise) {
      work.push(Promise.resolve(promise))
    },
    async done() {
      await Promise.all(work)
    },
  }
}

function fetchEvent(request) {
  const event = lifecycleEvent()
  let responsePromise
  return {
    ...event,
    request,
    respondWith(promise) {
      responsePromise = Promise.resolve(promise)
    },
    async response() {
      if (!responsePromise) throw new Error(`Service worker did not handle ${request.url}`)
      return responsePromise
    },
  }
}

class FakeCacheStorage {
  constructor(scope) {
    this.scope = scope
    this.caches = new Map()
  }

  async open(name) {
    if (!this.caches.has(name)) this.caches.set(name, new FakeCache(this.scope))
    return this.caches.get(name)
  }

  async keys() {
    return [...this.caches.keys()]
  }

  async delete(name) {
    return this.caches.delete(name)
  }
}

class FakeCache {
  constructor(scope) {
    this.scope = scope
    this.entries = new Map()
  }

  async addAll(requests) {
    for (const request of requests) {
      const key = this.key(request)
      this.entries.set(key, new Response(`precache:${key}`))
    }
  }

  async match(request) {
    const response = this.entries.get(this.key(request))
    return response?.clone()
  }

  async put(request, response) {
    this.entries.set(this.key(request), response.clone())
  }

  async keys() {
    return [...this.entries.keys()].map(url => new Request(url))
  }

  async delete(request) {
    return this.entries.delete(this.key(request))
  }

  key(request) {
    const value = request instanceof Request ? request.url : String(request)
    return new URL(value, this.scope).toString()
  }
}
