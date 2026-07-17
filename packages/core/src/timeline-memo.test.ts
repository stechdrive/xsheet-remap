import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { addTimelineMemo, appendTimelineMemoStroke, clearTimelineMemoStrokes, deleteTimelineMemo, eraseTimelineMemoStrokes, updateTimelineMemoPlacement } from './timeline-memo'

describe('timeline memos', () => {
  it('adds, resizes, draws, and deletes immutable memo state', () => {
    const source = createDefaultProject()
    const memo = {
      memoId: 'timeline_memo_1',
      anchor: { role: 'sound' as const, frame: 12, laneId: 'sound_lane_1' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 12 },
      strokes: [],
      order: 1,
    }
    const added = addTimelineMemo(source, memo)
    const resized = updateTimelineMemoPlacement(added, memo.memoId, { ...memo.placement, widthUnits: 14, heightFrames: 20 })
    const drawn = appendTimelineMemoStroke(resized, memo.memoId, {
      strokeId: 'stroke_1', color: '#000', widthUnits: 0.2,
      points: [{ x: -1, y: -1 }, { x: 99, y: 99 }],
    })

    expect(source.timelineMemos).toEqual([])
    expect(drawn.timelineMemos[0]?.placement).toMatchObject({ widthUnits: 14, heightFrames: 20 })
    expect(drawn.timelineMemos[0]?.strokes[0]?.points).toEqual([{ x: 0, y: 0 }, { x: 14, y: 20 }])
    expect(deleteTimelineMemo(drawn, memo.memoId).timelineMemos).toEqual([])
  })

  it('erases memo ink by splitting strokes without deleting the anchored memo', () => {
    const source = createDefaultProject()
    const memo = {
      memoId: 'timeline_memo_1',
      anchor: { role: 'action' as const, frame: 1, paperTrack: 'A' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 10, heightFrames: 10 },
      strokes: [{
        strokeId: 'stroke_1',
        color: '#000',
        widthUnits: 0.2,
        points: [
          { x: 0, y: 5 },
          { x: 2.5, y: 5 },
          { x: 5, y: 5 },
          { x: 7.5, y: 5 },
          { x: 10, y: 5 },
        ],
      }],
      order: 1,
    }
    const added = addTimelineMemo(source, memo)
    const erased = eraseTimelineMemoStrokes(added, {
      memoId: memo.memoId,
      widthUnits: 1,
      points: [{ x: 5, y: 4 }, { x: 5, y: 6 }],
    })

    expect(erased.timelineMemos).toHaveLength(1)
    expect(erased.timelineMemos[0]?.strokes).toHaveLength(2)
    expect(erased.timelineMemos[0]?.strokes.map(stroke => stroke.points)).toEqual([
      [{ x: 0, y: 5 }, { x: 2.5, y: 5 }],
      [{ x: 7.5, y: 5 }, { x: 10, y: 5 }],
    ])
    const emptied = eraseTimelineMemoStrokes(erased, {
      memoId: memo.memoId,
      widthUnits: 30,
      points: [{ x: 5, y: 5 }],
    })
    expect(emptied.timelineMemos).toHaveLength(1)
    expect(emptied.timelineMemos[0]?.strokes).toEqual([])
    expect(clearTimelineMemoStrokes(erased, memo.memoId).timelineMemos[0]?.strokes).toEqual([])
  })
})
