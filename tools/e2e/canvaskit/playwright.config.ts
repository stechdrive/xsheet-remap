import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { browserProjects } from '../../verification/plan.mjs'

const localBrowsers = path.resolve(import.meta.dirname, '../../../.cache/playwright')
if (process.platform === 'win32' && !process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(localBrowsers)) process.env.PLAYWRIGHT_BROWSERS_PATH = localBrowsers

// Propagate one id to all workers; later focused runs must not erase a failure trace.
const runId = process.env.XSHEET_BROWSER_RUN_ID ??= `${Date.now()}-${process.pid}`
if (!/^[a-zA-Z0-9_-]+$/.test(runId)) throw new Error('Invalid browser evidence run id')

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', timeout: 60_000, fullyParallel: false, workers: 1,
  retries: 0,
  outputDir: `../../../reference-local/canvaskit-browser/${runId}`,
  reporter: [['list'], ['json', { outputFile: path.resolve(import.meta.dirname, `../../../reference-local/verification/browser-${runId}.json`) }], ['junit', { outputFile: path.resolve(import.meta.dirname, `../../../reference-local/verification/browser-${runId}.xml`) }]],
  webServer: {
    // Serve the inspected Pages candidate; no second build or mid-test reload.
    command: 'node tools/e2e/canvaskit/pages-server.mjs',
    cwd: '../../..', url: 'http://127.0.0.1:5178/xsheet-remap/', reuseExistingServer: false, timeout: 15_000,
  },
  use: { baseURL: 'http://127.0.0.1:5178/xsheet-remap/', viewport: { width: 1440, height: 1000 },
    serviceWorkers: 'block', actionTimeout: 10_000, navigationTimeout: 30_000,
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: browserProjects.map(name => ({
    name, grepInvert: name.endsWith('-touch') ? undefined : /@touch/,
    metadata: { device: 'browser emulation', input: 'scenario-specific mouse, touch tap or renderer protocol; not physical-device acceptance' },
    use: { browserName: name.startsWith('chromium') ? 'chromium' as const : 'webkit' as const,
      ...(name.endsWith('-touch') ? { viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } : {}) },
  })),
})
