import { ESLint } from 'eslint'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../', import.meta.url))
const eslint = new ESLint({ cwd: root })

// The lint-only minimatch overrides address GHSA-g3hv-75wg-m249. Version 11
// changes glob matching, so exercise the real consumers and repository config.
// Remove the overrides when all three upstream consumers require a fixed release.
describe('lint dependency compatibility', () => {
  it('keeps source, test and tooling files in the lint scope', async () => {
    for (const file of [
      'apps/web/src/main.tsx',
      'packages/core/src/lint-probe.ts',
      'packages/ui/src/lint-probe.tsx',
      'packages/adapters/src/clip/lint-probe.test.ts',
      'tools/checks/lint-probe.test.ts',
      'tools/verification/lint-probe.mjs',
      'vite.config.ts',
    ]) {
      expect(await eslint.isPathIgnored(path.join(root, file)), file).toBe(false)
    }
  })

  it('keeps generated output and local evidence out of the lint scope', async () => {
    for (const file of [
      'packages/core/dist/nested/probe.js',
      'apps/web/dist-pages/assets/probe.js',
      'packages/ui/dist-ts/probe.js',
      'node_modules/probe/index.js',
      'apps/desktop/src-tauri/target/probe.js',
      'apps/sheet-corrector/src-tauri/gen/probe.ts',
      '.tmp/probe.ts',
      '.cache/probe.js',
      'reference-local/nested/probe.ts',
      'release-local/probe.js',
      'dev-local/probe.js',
    ]) {
      expect(await eslint.isPathIgnored(path.join(root, file)), file).toBe(true)
    }
  })

  it('still reports TypeScript and React Hooks violations', async () => {
    const [result] = await eslint.lintText(`
      import { useState } from 'react'
      export function Probe({ enabled }: { enabled: boolean }) {
        if (enabled) useState(0)
        const value: any = enabled
        return <div>{value}</div>
      }
    `, { filePath: 'packages/ui/src/lint-probe.tsx' })
    expect(result.fatalErrorCount).toBe(0)
    expect(result.messages.map(message => message.ruleId)).toEqual(expect.arrayContaining([
      '@typescript-eslint/no-explicit-any',
      'react-hooks/rules-of-hooks',
    ]))
  })

  it('applies Node globals to tools without allowing them in browser source', async () => {
    const source = 'export const runtime = process.platform\n'
    const [tool] = await eslint.lintText(source, { filePath: 'tools/verification/lint-probe.mjs' })
    const [browser] = await eslint.lintText(source, { filePath: 'apps/web/src/lint-probe.js' })
    expect(tool.messages).toEqual([])
    expect(browser.messages.map(message => message.ruleId)).toContain('no-undef')
  })
})
