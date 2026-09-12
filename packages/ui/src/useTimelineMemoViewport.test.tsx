import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { memoRevealScrollOffset, useTimelineMemoViewport } from './useTimelineMemoViewport'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('moves only enough to expose small memos and the writing origin of oversized memos', () => {
  expect(memoRevealScrollOffset(100, 80, 0, 600, 2000)).toBe(0)
  expect(memoRevealScrollOffset(700, 120, 0, 600, 2000)).toBe(244)
  expect(memoRevealScrollOffset(150, 80, 300, 600, 2000)).toBe(126)
  expect(memoRevealScrollOffset(700, 1000, 0, 600, 2000)).toBe(676)
  expect(memoRevealScrollOffset(0, 80, 300, 600, 2000)).toBe(0)
  expect(memoRevealScrollOffset(1980, 80, 0, 600, 2000)).toBe(1400)
})

it('reveals an editing memo once, keeps its page pinned, and respects subsequent navigation and zoom', () => {
  const viewport = document.createElement('div')
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  Object.defineProperties(viewport, {
    clientWidth: { value: 600 }, clientHeight: { value: 400 },
    scrollWidth: { value: 2000 }, scrollHeight: { value: 3000 },
  })
  vi.spyOn(viewport, 'getBoundingClientRect').mockImplementation(() => new DOMRect(20, 30, 600, 400))
  vi.spyOn(svg, 'getBoundingClientRect').mockImplementation(() => new DOMRect(20 - viewport.scrollLeft, 30 - viewport.scrollTop, 1000, 1500))
  const memo: TimelineInkMemo = { kind: 'timeline', memoId: 'memo_1', order: 0,
    anchor: { role: 'cell', paperTrack: 'A', frame: 50 },
    placement: { frameOffset: 0, crossOffsetUnits: 0, widthUnits: 8, heightFrames: 10 }, strokes: [] }
  const input = { memoId: memo.memoId as string | null, memos: [memo],
    pages: [{ pageId: 'page_1', pageIndex: 0, frameStart: 1, frameEnd: 144 }], template: standardA3SheetTemplate,
    paperTracks: ['A', 'B'], timelineLanes: {}, layoutOverrides: undefined,
    viewportRef: { current: viewport }, svgRefs: { current: { page_1: svg } },
    singlePage: false, activePageIndex: 0, setActivePageIndex: vi.fn(), zoom: 1 }
  const { result, rerender } = renderHook(useTimelineMemoViewport, { initialProps: input })
  expect(result.current).toBe('page_1')
  expect(viewport.scrollTop).toBeGreaterThan(0)
  viewport.scrollTop = 1800
  rerender({ ...input, zoom: 1.5, memos: [{ ...memo, strokes: [] }] })
  expect(viewport.scrollTop).toBe(1800)
  expect(result.current).toBe('page_1')
  rerender({ ...input, memoId: null })
  expect(result.current).toBeUndefined()
  rerender(input)
  expect(viewport.scrollTop).toBeLessThan(1800)
})
