import { describe, expect, it } from 'vitest'
import { createDefaultProject, createProjectDocumentFromCutProject } from '@xsheet-remap/core'
import { jsonValuesEqual, projectDocumentsEqual } from './projectDocumentEquality'

describe('project document equality', () => {
  it('treats structurally equal project documents as equal and detects an ink change', () => {
    const document = createProjectDocumentFromCutProject(createDefaultProject())
    const copy = structuredClone(document)
    const changed = structuredClone(document)
    changed.cuts[0]!.revisions[0]!.memos = [{
      kind: 'page',
      memoId: 'memo_1',
      target: { kind: 'page', pageId: 'page_1' },
      strokes: [],
      texts: [],
      order: 1,
    }]

    expect(projectDocumentsEqual(document, copy)).toBe(true)
    expect(projectDocumentsEqual(document, changed)).toBe(false)
  })

  it('skips shared immutable subtrees', () => {
    const shared = Object.defineProperty({}, 'expensive', {
      enumerable: true,
      get: () => {
        throw new Error('shared subtree must not be traversed')
      },
    })

    expect(jsonValuesEqual(
      { shared, changed: { value: 1 } },
      { shared, changed: { value: 2 } },
    )).toBe(false)
  })

  it('matches JSON object semantics for omitted undefined properties', () => {
    expect(jsonValuesEqual({ value: 1, optional: undefined }, { value: 1 })).toBe(true)
    expect(jsonValuesEqual({ value: -0 }, { value: 0 })).toBe(true)
  })
})
