import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import type { TimelineInkMemo, TimelineMemoPoint, TimelineMemoStroke } from './types'
import { validateProject } from './validation'

function countingPoint(onRead: () => void): TimelineMemoPoint {
  return Object.defineProperties({}, {
    x: { enumerable: true, get: () => { onRead(); return 1 } },
    y: { enumerable: true, get: () => { onRead(); return 1 } },
  }) as TimelineMemoPoint
}

function memo(stroke: TimelineMemoStroke): TimelineInkMemo {
  return {
    kind: 'timeline',
    memoId: 'memo_1',
    anchor: { role: 'action', frame: 1, paperTrack: 'A' },
    placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 4, heightFrames: 4 },
    strokes: [stroke],
    order: 1,
  }
}

describe('timeline memo validation reuse', () => {
  it('does not rescan point arrays of immutable strokes', () => {
    let reads = 0
    const stroke: TimelineMemoStroke = {
      strokeId: 'stroke_1',
      color: '#111111',
      widthUnits: 0.2,
      points: [countingPoint(() => { reads += 1 })],
    }
    const project = { ...createDefaultProject(), memos: [memo(stroke)] }

    validateProject(project)
    const firstReads = reads
    validateProject({ ...project, memos: [...project.memos] })

    expect(firstReads).toBeGreaterThan(0)
    expect(reads).toBe(firstReads)
  })

  it('validates a newly created stroke object', () => {
    const original: TimelineMemoStroke = {
      strokeId: 'stroke_1', color: '#111111', widthUnits: 0.2, points: [{ x: 1, y: 1 }],
    }
    const project = { ...createDefaultProject(), memos: [memo(original)] }
    validateProject(project)
    const invalid = { ...original, points: [{ x: Number.NaN, y: 1 }] }

    const issues = validateProject({ ...project, memos: [memo(invalid)] })

    expect(issues.some(issue => issue.code === 'memo.stroke.invalid')).toBe(true)
  })
})
