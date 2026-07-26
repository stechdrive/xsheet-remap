import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx', 'apps/**/*.test.tsx', 'tools/**/*.test.ts'],
    testTimeout: 20_000,
  },
})
