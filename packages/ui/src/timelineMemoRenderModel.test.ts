import { createSheetPages, standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { createTimelineMemoRenderCache } from './timelineMemoRenderModel'

function memo(memoId: string, color = '#111111'): TimelineInkMemo {
  return {
    kind: 'timeline',
    memoId,
    anchor: { role: 'action', frame: 10, paperTrack: 'A' },
    placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 8 },
    strokes: [
      {
        strokeId: `${memoId}_stroke_1`,
        color,
        widthUnits: 0.2,
        points: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
      },
      {
        strokeId: `${memoId}_stroke_2`,
        color,
        widthUnits: 0.2,
        points: [{ x: 2, y: 2 }, { x: 3, y: 3 }],
      },
    ],
    order: 1,
  }
}

describe('timeline memo render cache', () => {
  it('reuses unchanged memo render items while rebuilding only changed memos', () => {
    const cache = createTimelineMemoRenderCache()
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const firstMemo = memo('memo_1')
    const secondMemo = memo('memo_2')
    const input = { template: standardA3SheetTemplate, page, paperTracks: ['A'] }

    const first = cache.render([firstMemo, secondMemo], input)
    const same = cache.render([firstMemo, secondMemo], { ...input, paperTracks: ['A'] })
    const updatedFirstMemo = { ...firstMemo, placement: { ...firstMemo.placement, widthUnits: 9 } }
    const updated = cache.render([updatedFirstMemo, secondMemo], input)

    expect(same[0]).toBe(first[0])
    expect(same[1]).toBe(first[1])
    expect(updated[0]).not.toBe(first[0])
    expect(updated[1]).toBe(first[1])
  })

  it('batches consecutive equal-style visible paths and uses one hit path per segment', () => {
    const cache = createTimelineMemoRenderCache()
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const source = memo('memo_1')

    const rendered = cache.render([source], {
      template: standardA3SheetTemplate,
      page,
      paperTracks: ['A'],
    })[0]!
    const segment = rendered.segments[0]!

    expect(segment.visibleStrokeGroups).toHaveLength(1)
    expect(segment.visibleStrokeGroups[0]?.path.match(/M /g)).toHaveLength(2)
    expect(segment.hitPath.match(/M /g)).toHaveLength(2)
    expect(source.strokes).toHaveLength(2)
  })

  it('invalidates every memo when the current template geometry object changes', () => {
    const cache = createTimelineMemoRenderCache()
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const source = memo('memo_1')
    const first = cache.render([source], {
      template: standardA3SheetTemplate,
      page,
      paperTracks: ['A'],
    })[0]!
    const customTemplate = {
      ...standardA3SheetTemplate,
      name: `${standardA3SheetTemplate.name} custom`,
    }
    const updated = cache.render([source], {
      template: customTemplate,
      page,
      paperTracks: ['A'],
    })[0]!

    expect(updated).not.toBe(first)
  })
})
