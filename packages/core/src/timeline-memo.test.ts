import { describe, expect, it } from 'vitest'
import { createDefaultProject } from './project-model'
import { addTimelineMemo, appendTimelineMemoStroke, clearTimelineMemoStrokes, deleteTimelineMemo, eraseTimelineMemoStrokes, updateTimelineMemoAppearance, updateTimelineMemoPlacement, upsertTimelineMemoText } from './timeline-memo'
import { timelineMemos } from './sheet-memo'
import { normalizeMemoAppearance } from './memo-appearance'
import type { TimelineInkMemo } from './types'

describe('timeline memos', () => {
  it('adds, resizes, draws, and deletes immutable memo state', () => {
    const source = createDefaultProject()
    const memo: TimelineInkMemo = {
      kind: 'timeline',
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

    expect(timelineMemos(source)).toEqual([])
    expect(timelineMemos(drawn)[0]?.placement).toMatchObject({ widthUnits: 14, heightFrames: 20 })
    expect(timelineMemos(drawn)[0]?.strokes[0]?.points).toEqual([{ x: 0, y: 0 }, { x: 14, y: 20 }])
    expect(timelineMemos(deleteTimelineMemo(drawn, memo.memoId))).toEqual([])
  })

  it('erases memo ink by splitting strokes without deleting the anchored memo', () => {
    const source = createDefaultProject()
    const memo: TimelineInkMemo = {
      kind: 'timeline',
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

    expect(timelineMemos(erased)).toHaveLength(1)
    expect(timelineMemos(erased)[0]?.strokes).toHaveLength(2)
    expect(timelineMemos(erased)[0]?.strokes.map(stroke => stroke.points)).toEqual([
      [{ x: 0, y: 5 }, { x: 2.5, y: 5 }],
      [{ x: 7.5, y: 5 }, { x: 10, y: 5 }],
    ])
    const emptied = eraseTimelineMemoStrokes(erased, {
      memoId: memo.memoId,
      widthUnits: 30,
      points: [{ x: 5, y: 5 }],
    })
    expect(timelineMemos(emptied)).toHaveLength(1)
    expect(timelineMemos(emptied)[0]?.strokes).toEqual([])
    expect(timelineMemos(clearTimelineMemoStrokes(erased, memo.memoId))[0]?.strokes).toEqual([])
  })

  it('adds, updates, and removes text inside an anchored memo', () => {
    const source = addTimelineMemo(createDefaultProject(), {
      kind: 'timeline',
      memoId: 'timeline_memo_1',
      anchor: { role: 'camera', frame: 12, laneId: 'camera_lane_1' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 12 },
      strokes: [],
      texts: [],
      order: 1,
    })
    const added = upsertTimelineMemoText(source, 'timeline_memo_1', {
      textId: 'text_1', text: ' PAN ', color: '#123456', x: 1, y: 2, fontSizeUnits: 1.5,
    })
    const updated = upsertTimelineMemoText(added, 'timeline_memo_1', {
      textId: 'text_1', text: 'TU', color: '#654321', x: 2, y: 3, fontSizeUnits: 0.1,
    })
    const removed = upsertTimelineMemoText(updated, 'timeline_memo_1', {
      textId: 'text_1', text: '   ', color: '#654321', x: 2, y: 3, fontSizeUnits: 1,
    })

    expect(timelineMemos(added)[0]?.texts).toEqual([
      { textId: 'text_1', text: 'PAN', color: '#123456', x: 1, y: 2, fontSizeUnits: 1.5 },
    ])
    expect(timelineMemos(updated)[0]?.texts).toEqual([
      { textId: 'text_1', text: 'TU', color: '#654321', x: 2, y: 3, fontSizeUnits: 0.25 },
    ])
    expect(timelineMemos(removed)[0]?.texts).toEqual([])
  })

  it('normalizes and updates bounded memo appearance as project data', () => {
    const source = addTimelineMemo(createDefaultProject(), {
      kind: 'timeline',
      memoId: 'timeline_memo_1',
      anchor: { role: 'sound', frame: 1, laneId: 'sound_lane_1' },
      placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 12 },
      strokes: [],
      order: 1,
    })
    const updated = updateTimelineMemoAppearance(source, 'timeline_memo_1', {
      inkOpacity: 2,
      textOpacity: -1,
      background: { enabled: true, color: '#abcdef', opacity: 0.42 },
    })

    expect(normalizeMemoAppearance(timelineMemos(source)[0]?.appearance)).toMatchObject({
      inkOpacity: 1,
      textOpacity: 1,
      background: { enabled: false },
    })
    expect(timelineMemos(updated)[0]?.appearance).toEqual({
      inkOpacity: 1,
      textOpacity: 0,
      background: { enabled: true, color: '#abcdef', opacity: 0.42 },
    })
  })
})
