import { createSheetPages, resolveSheetTemplatePageSize, standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineMemoLayer } from './TimelineMemoLayer'

function memo(memoId: string, frameOffset = 0): TimelineInkMemo {
  return {
    memoId,
    anchor: { role: 'action', frame: 10, paperTrack: 'A' },
    placement: { frameOffset, crossOffsetUnits: frameOffset ? 3 : 0, widthUnits: 8, heightFrames: 8 },
    strokes: [],
    order: Number(memoId.replace(/\D/g, '')) || 1,
  }
}

describe('TimelineMemoLayer anchor cues', () => {
  it('keeps one left-side anchor cue visible for memos sharing a frame', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[memo('memo_1'), memo('memo_2')]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={null}
          penColor="#111"
          penWidth={0.002}
          onAppendStroke={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )

    const cues = container.querySelectorAll('.timelineMemoAnchorCue')
    expect(cues).toHaveLength(1)
    expect(cues[0]?.getAttribute('data-timeline-memo-count')).toBe('2')
    expect(cues[0]?.getAttribute('data-timeline-memo-anchor-frame')).toBe('10')
    expect(cues[0]?.querySelectorAll('.timelineMemoAnchorMarker')).toHaveLength(1)
  })

  it('shows a connector only while a displaced memo is selected', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const displaced = memo('memo_1', 8)
    const { container, rerender } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[displaced]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={displaced.memoId}
          penColor="#111"
          penWidth={0.002}
          onAppendStroke={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelector('.timelineMemoAnchorCue.selected')).toBeTruthy()
    expect(container.querySelector('.timelineMemoAnchorConnector')).toBeTruthy()

    rerender(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[displaced]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={null}
          penColor="#111"
          penWidth={0.002}
          onAppendStroke={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelector('.timelineMemoAnchorConnector')).toBeNull()
    expect(container.querySelector('.timelineMemoAnchorCue')).toBeTruthy()
  })
})
