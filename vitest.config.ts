import { defineConfig } from 'vitest/config'

const nodeTests = [
  'packages/core/**/*.test.ts',
  'packages/xdts/**/*.test.ts',
  'packages/ui/src/canvasKitPainter.test.ts',
  'tools/checks/**/*.test.ts',
  'tools/desktop/**/*.test.ts',
  'tools/pages/**/*.test.ts',
  'tools/release/**/*.test.ts',
  'tools/verification/**/*.test.ts',
]

export default defineConfig({
  test: {
    testTimeout: 20_000,
    reporters: ['default', 'json'],
    outputFile: 'reference-local/verification/unit-results.json',
    projects: [
      { extends: true, test: { name: 'node', environment: 'node', include: nodeTests } },
      { extends: true, test: {
        name: 'dom', environment: 'jsdom',
        include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx', 'apps/**/*.test.tsx', 'tools/**/*.test.ts'],
        exclude: nodeTests,
      } },
    ],
  },
})
