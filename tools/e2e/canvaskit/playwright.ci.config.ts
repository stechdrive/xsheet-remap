import { defineConfig } from '@playwright/test'
import local from './playwright.config'
import { ciBrowserTestFiles } from '../../verification/plan.mjs'

// Full WebKit/touch, editing and GPU work-count checks remain in local preflight.
// This job accepts the built Pages files, without simulated gestures or frame cadence.
export default defineConfig({
  ...local,
  testMatch: ciBrowserTestFiles,
  projects: [{ name: 'chromium-smoke', use: { browserName: 'chromium' },
    metadata: { purpose: 'Published entry points and PWA lifecycle, not physical-device acceptance' } }],
})
