import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = join(process.cwd(), 'packages', 'ui', 'src')

describe('template authoring tooltip contract', () => {
  it('uses the shared application tooltip instead of native title attributes', () => {
    const sources = [
      readSource('TemplateEditorApp.tsx'),
      readSource('TemplateRegionNavigator.tsx'),
      readSource('template-workspace-workspace.tsx'),
    ]

    for (const source of sources) {
      expect(source).not.toMatch(/\btitle=/)
      expect(source).toContain("from './Tooltip'")
    }
  })
})

function readSource(fileName: string): string {
  return readFileSync(join(sourceRoot, fileName), 'utf8')
}
