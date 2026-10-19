import fs from 'node:fs/promises'
import { expect, test } from './fixtures'
import { startPagesServer } from './pages-server.mjs'
import { createPagesCachePlan } from '../../pages/pages-cache-policy.mjs'
import { createPagesServiceWorker } from '../../pages/pages-service-worker.mjs'

// Use the project-owned page so viewport, DPR, touch and error diagnostics are
// identical to the advertised environment, including the CI smoke project.
test.use({ serviceWorkers: 'allow' })

test('Pages subpath upgrades its worker, reuses runtime bytes and reopens offline', async ({ page }, info) => {
  // The previous revision is an explicit compatibility fixture; the final worker
  // and all application/runtime bytes are the actual deployment candidate.
  const manifest = JSON.parse(await fs.readFile('apps/web/dist-pages/pages-artifact.json', 'utf8'))
  const oldPlan = createPagesCachePlan('0.0.0', manifest.files.filter((file: { cacheClass: string }) => file.cacheClass !== 'metadata'))
  let worker = createPagesServiceWorker(oldPlan)
  const server = await startPagesServer({ worker: () => worker })
  const runtime = manifest.files.find((file: { path: string }) => /(?:^|\/)canvaskit[^/]*\.wasm$/.test(file.path))
  try {
    expect(runtime).toBeTruthy()
    await page.goto(server.url)
    await expect(page.getByRole('button', { name: 'シート編集', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
    // Registration happens after load. Visit under the installed worker while
    // online so this checks reuse of visited resources, including CSS fonts,
    // rather than expecting never-cached fonts to become available offline.
    await page.reload()
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await page.evaluate(() => document.fonts.ready)
    const visitedFonts = [...new Set(server.requests.filter((file: string) => /\.(?:woff2?|ttf)$/.test(file)))]
    expect(visitedFonts.length, 'visited UI requested its fonts').toBeGreaterThan(0)
    await expect.poll(() => page.evaluate(async () => {
      const keys = await Promise.all((await caches.keys()).map(async key => (await caches.open(key)).keys()))
      return keys.flat().map(request => new URL(request.url).pathname.replace('/xsheet-remap/', ''))
    }), { message: 'every visited font reached persistent runtime storage' }).toEqual(expect.arrayContaining(visitedFonts))
    // Warm a runtime explicitly after control; the initial load can race install.
    await page.evaluate(async asset => { const response = await fetch(asset); if (!response.ok) throw new Error('runtime fetch failed'); await response.arrayBuffer() }, './' + runtime.path)
    const oldCaches = await page.evaluate(() => caches.keys())
    expect(oldCaches.some(key => key.includes(oldPlan.appRevision))).toBe(true)
    const requestsBefore = server.requests.filter((file: string) => file === runtime.path).length
    worker = await fs.readFile('apps/web/dist-pages/sw.js', 'utf8')
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration!.update() })
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(expect.arrayContaining([expect.stringContaining(manifest.cachePolicy.appRevision)]))
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toEqual(expect.arrayContaining([expect.stringContaining(oldPlan.appRevision)]))
    await page.evaluate(async asset => { await (await fetch(asset)).arrayBuffer() }, './' + runtime.path)
    expect(server.requests.filter((file: string) => file === runtime.path).length).toBe(requestsBefore)
    // Disconnect the actual origin. Windows WebKit's protocol offline switch
    // aborts reload internally before the worker can receive a navigation.
    await server.close()
    await page.reload()
    await expect(page.getByRole('button', { name: 'シート編集', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.assetBrowser, .cspLayerTree')).toHaveCount(0)
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await expect(page.getByRole('button', { name: 'MEMOを編集', exact: true })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const offlineFonts = await page.evaluate(async files => Promise.all(files.map(async file => {
      const response = await fetch('./' + file)
      if (!response.ok) throw new Error(`offline font failed: ${file}`)
      const hash = await crypto.subtle.digest('SHA-256', await response.arrayBuffer())
      return { path: file, sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('') }
    })), visitedFonts)
    for (const font of offlineFonts) expect(font.sha256, `offline font bytes: ${font.path}`)
      .toBe(manifest.files.find((file: { path: string }) => file.path === font.path)?.sha256)
    await info.attach('offline-fonts', { body: JSON.stringify(offlineFonts), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('pages-offline.png') })
    expect(new URL(page.url()).pathname).toBe('/xsheet-remap/')
    expect(new URL(page.url()).search).toBe('')
  } finally { await server.close() }
})
