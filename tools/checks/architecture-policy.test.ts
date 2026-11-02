import { describe, expect, it } from 'vitest'
import { inspectSourceBoundaries } from './architecture-policy.mjs'

describe('parsed dependency and event ownership boundaries', () => {
  it.each(["import { x } from 'celcodec-legacy/write'", "export * from './test-support/container'", "void import('./fixtures/media-fixture')", "require('celcodec-legacy')"])( 'rejects a legacy production dependency: %s', source => {
    expect(inspectSourceBoundaries('packages/adapters/src/clip/writer.ts', source)).not.toEqual([])
  })
  it('allows fixture builders and tests to use the isolated legacy oracle', () => {
    expect(inspectSourceBoundaries('packages/adapters/src/clip/test-support/legacy.ts', "export * from 'celcodec-legacy/write'")).toEqual([])
    expect(inspectSourceBoundaries('packages/adapters/src/clip/writer.test.ts', "import { x } from './test-support/legacy'")).toEqual([])
    expect(inspectSourceBoundaries('packages/adapters/src/clip/material/vector.ts', "export * from 'celcodec/material'")).toEqual([])
  })
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
