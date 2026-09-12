import { describe, expect, it } from 'vitest'
import { inspectSourceBoundaries } from './architecture-policy.mjs'

describe('parsed dependency and event ownership boundaries', () => {
  it.each(["import { x } from '@xsheet-remap/ui'", "export * from '../ui/src/x'", "void import('@xsheet-remap/adapters')", "require('@xsheet-remap/xdts')"])( 'rejects a forbidden core dependency: %s', source => {
    expect(inspectSourceBoundaries('packages/core/example.ts', source)).not.toEqual([])
  })
  it('ignores comments and ordinary string data', () => {
    expect(inspectSourceBoundaries('packages/core/example.ts', "// import x from '@xsheet-remap/ui'\nconst fixture = \"require('@xsheet-remap/ui')\"" )).toEqual([])
  })
  it('accepts renamed shared imports and detects real private global listeners', () => {
    const file = 'packages/ui/src/TimelineMemoLayer.tsx'
    expect(inspectSourceBoundaries(file, "import { renamed as session } from './input'; session()" )).toEqual([])
    expect(inspectSourceBoundaries(file, "window.addEventListener('pointerup', onUp)" )).not.toEqual([])
  })
})
