import { describe, expect, it } from 'vitest'
import type { TimelineMemoText } from '@xsheet-remap/core'
import type { TimelineMemoSegment } from './timelineMemoGeometry'
import { buildTimelineMemoTextLayout, timelineMemoFontSizePx, timelineMemoFontSizeUnitsForPx } from './timelineMemoTextLayout'

const segment: TimelineMemoSegment = {
  memoId: 'memo_1',
  pageId: 'page_1',
  regionId: 'action_grid',
  rect: { x: 0.1, y: 0.2, w: 0.08, h: 0.3 },
  rowHeightX: 0.01,
  rowHeightY: 0.01,
  memoYStart: 0,
  memoYEnd: 30,
  startsMemo: true,
  endsMemo: true,
}

const measurement = {
  measure: (value: string) => ({
    widthPx: Array.from(value).length * 10,
    ascentPx: 8,
    descentPx: 2,
    exact: true,
  }),
}

describe('timeline memo text layout', () => {
  it('wraps Japanese text to the remaining memo width without changing its source text', () => {
    const text: TimelineMemoText = { textId: 'text_1', text: 'あいうえお', x: 2, y: 1 }
    const layout = buildTimelineMemoTextLayout(segment, text, 1, { widthPx: 500, heightPx: 1000 }, measurement)

    expect(layout.maxWidthPx).toBeCloseTo(30)
    expect(layout.lines).toEqual(['あいう', 'えお'])
    expect(text.text).toBe('あいうえお')
  })

  it('keeps explicit line breaks and turns a one-character-wide memo into vertical-like text', () => {
    const text: TimelineMemoText = { textId: 'text_1', text: '縦書\n補足', x: 7, y: 1 }
    const layout = buildTimelineMemoTextLayout(segment, text, 1, { widthPx: 500, heightPx: 1000 }, measurement)

    expect(layout.maxWidthPx).toBeCloseTo(5)
    expect(layout.lines).toEqual(['縦', '書', '補', '足'])
    expect(layout.lineHeightPx).toBe(12.5)
  })

  it('uses the resolved continuous page height for displayed font size and round-trips edits', () => {
    const pageSize = { heightPx: 6480 }
    const fontSizePx = timelineMemoFontSizePx(segment, 2, pageSize)

    expect(fontSizePx).toBeCloseTo(129.6)
    expect(timelineMemoFontSizeUnitsForPx(segment, fontSizePx, pageSize)).toBeCloseTo(2)
  })
})
