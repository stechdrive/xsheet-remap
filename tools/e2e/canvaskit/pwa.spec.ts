import fs from 'node:fs/promises'
import { expect, test } from './fixtures'
import { startPagesServer } from './pages-server.mjs'
import { createPagesCachePlan } from '../../pages/pages-cache-policy.mjs'
import { createPagesServiceWorker } from '../../pages/pages-service-worker.mjs'

test('Pages subpath upgrades its worker, reuses runtime bytes and reopens offline', async ({ browser }, info) => {
  // The previous revision is an explicit compatibility fixture; the final worker
  // and all application/runtime bytes are the actual deployment candidate.
  const manifest = JSON.parse(await fs.readFile('apps/web/dist-pages/pages-artifact.json', 'utf8'))
  const oldPlan = createPagesCachePlan('0.0.0', manifest.files.filter((file: { cacheClass: string }) => file.cacheClass !== 'metadata'))
  let worker = createPagesServiceWorker(oldPlan)
  const server = await startPagesServer({ worker: () => worker })
  const context = await browser.newContext({ serviceWorkers: 'allow' })
  const page = await context.newPage()
  const runtime = manifest.files.find((file: { path: string }) => /(?:^|\/)canvaskit[^/]*\.wasm$/.test(file.path))
  try {
    expect(runtime).toBeTruthy()
    await page.goto(server.url)
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await page.evaluate(async () => { await navigator.serviceWorker.ready })
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
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
    await expect(page.locator('.sheetSvg').first()).toHaveAttribute('data-canvaskit-state', 'active', { timeout: 40_000 })
    await expect(page.getByRole('button', { name: 'MEMOを編集', exact: true })).toBeVisible()
    await page.screenshot({ path: info.outputPath('pages-offline.png') })
    expect(new URL(page.url()).pathname).toBe('/xsheet-remap/')
  } finally { await context.close(); await server.close() }
})
