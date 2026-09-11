import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', timeout: 60_000, fullyParallel: false, workers: 1,
  outputDir: '../../../reference-local/canvaskit-browser',
  reporter: [['list']],
  webServer: process.env.XSHEET_BROWSER_URL ? undefined : {
    // A built application cannot reload mid-test when version sync updates source files.
    command: 'npm run build:web && npm run preview -w @xsheet-remap/web -- --host 127.0.0.1 --port 5178 --strictPort',
    cwd: '../../..', url: 'http://127.0.0.1:5178', reuseExistingServer: false, timeout: 120_000,
  },
  use: { baseURL: process.env.XSHEET_BROWSER_URL || 'http://127.0.0.1:5178', viewport: { width: 1440, height: 1000 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
    { name: 'tablet', use: { browserName: 'chromium', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
    { name: 'ipad', use: { browserName: 'webkit', viewport: { width: 1024, height: 768 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true } },
  ],
})
