import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { addTimelineMemo, appendTimelineMemoStroke, deleteTimelineMemo, updateTimelineMemoPlacement } from './timeline-memo'

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
})
