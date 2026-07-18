import { createSheetPages, resolveSheetTemplatePageSize, standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TimelineMemoLayer } from './TimelineMemoLayer'

function memo(memoId: string, frameOffset = 0): TimelineInkMemo {
  return {
    kind: 'timeline',
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
          editMode="new"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={vi.fn()}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )

    const cues = container.querySelectorAll('.timelineMemoAnchorCue')
    expect(cues).toHaveLength(1)
    expect(cues[0]?.getAttribute('data-timeline-memo-count')).toBe('2')
    expect(cues[0]?.getAttribute('data-timeline-memo-ids')).toBe('memo_1 memo_2')
    expect(cues[0]?.getAttribute('data-timeline-memo-anchor-frame')).toBe('10')
    expect(cues[0]?.querySelectorAll('.timelineMemoAnchorMarker')).toHaveLength(1)
    expect(cues[0]?.querySelector('.timelineMemoAnchorMarker')?.tagName.toLowerCase()).toBe('polygon')
    expect(cues[0]?.querySelectorAll('.timelineMemoAnchorHitArea')).toHaveLength(1)
  })

  it('shows a connector only while a displaced memo is selected', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const displaced = {
      ...memo('memo_1', 8),
      anchor: { role: 'camera' as const, frame: 10, laneId: 'camera_lane_1' },
    }
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
          editMode="pen"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={vi.fn()}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelector('.timelineMemoAnchorCue.selected')).toBeTruthy()
    expect(container.querySelector('.timelineMemoAnchorCue.selected .timelineMemoAnchorHitArea')).toBeNull()
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
          editMode="new"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={vi.fn()}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelector('.timelineMemoAnchorConnector')).toBeNull()
    expect(container.querySelector('.timelineMemoAnchorCue')).toBeTruthy()
    expect(container.querySelector('.timelineMemoAnchorHitArea')).toBeTruthy()
  })

  it('moves the selected memo canvas while keeping its anchor on the logical frame', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const selected = memo('memo_1')
    const onUpdatePlacement = vi.fn()
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[selected]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={selected.memoId}
          editMode="pen"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={vi.fn()}
          onUpsertText={vi.fn()}
          onUpdatePlacement={onUpdatePlacement}
        />
      </svg>,
    )
    const svg = container.querySelector('svg')
    const handle = container.querySelector<SVGGElement>('.timelineMemoMoveHandle')
    expect(svg).toBeTruthy()
    expect(handle).toBeTruthy()
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }),
    })
    Object.defineProperty(handle, 'setPointerCapture', { value: vi.fn() })

    fireEvent.pointerDown(handle as SVGGElement, { pointerId: 9, clientX: 10, clientY: 20 })
    fireEvent.pointerMove(handle as SVGGElement, { pointerId: 9, clientX: 110, clientY: 70 })
    fireEvent.pointerUp(handle as SVGGElement, { pointerId: 9, clientX: 110, clientY: 70 })

    expect(onUpdatePlacement).toHaveBeenCalledTimes(1)
    const placement = onUpdatePlacement.mock.calls[0]?.[1]
    expect(placement.crossOffsetUnits).toBeGreaterThan(selected.placement.crossOffsetUnits)
    expect(placement.frameOffset).toBeGreaterThan(selected.placement.frameOffset)
    expect(container.querySelector('.timelineMemoAnchorCue')?.getAttribute('data-timeline-memo-anchor-frame')).toBe('10')
  })

  it('routes the selected memo surface through the active annotation tool', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const selected = memo('memo_1')
    const onEraseStroke = vi.fn()
    const { container, rerender } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[selected]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={selected.memoId}
          editMode="new"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={onEraseStroke}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelector('.timelineMemoDrawSurface')).toBeNull()
    expect(container.querySelector('.timelineMemoMoveHandle.sheetTransformHandle.move')).toBeTruthy()
    expect(container.querySelector('.sheetTransformHandleMoveVisual')).toBeTruthy()
    expect(container.querySelectorAll('.sheetTransformHandleMoveGrip')).toHaveLength(3)
    expect(container.querySelector('.timelineMemoResizeHandle.sheetTransformHandle.resize')).toBeTruthy()
    expect(container.querySelector('.sheetTransformHandleResizeVisual')).toBeTruthy()
    expect(container.querySelector('.timelineMemoMoveHandleGlyph')).toBeNull()

    rerender(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[selected]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={selected.memoId}
          editMode="eraser"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={onEraseStroke}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    const eraserSurface = container.querySelector<SVGRectElement>('.timelineMemoDrawSurface.eraser')
    expect(eraserSurface).toBeTruthy()
    Object.defineProperty(eraserSurface, 'setPointerCapture', { value: vi.fn() })
    fireEvent.pointerDown(eraserSurface as SVGRectElement, { pointerId: 7, clientX: 10, clientY: 10 })
    fireEvent.pointerUp(eraserSurface as SVGRectElement, { pointerId: 7, clientX: 10, clientY: 10 })
    expect(onEraseStroke).toHaveBeenCalledTimes(1)
    expect(onEraseStroke.mock.calls[0]?.[0]).toBe(selected.memoId)
    expect(onEraseStroke.mock.calls[0]?.[2]).toBeGreaterThan(0)
  })

  it('releases an unselected transparent canvas while keeping ink and the anchor targetable', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.strokes = [{
      strokeId: 'stroke_1',
      color: '#111',
      widthUnits: 0.2,
      points: [{ x: 1, y: 1 }, { x: 5, y: 5 }],
    }]
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[source]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={null}
          editMode="new"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={vi.fn()}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )

    expect(container.querySelector('.timelineMemoHitArea')).toBeNull()
    expect(container.querySelector('.timelineMemoStrokeHit')).toBeTruthy()
    expect(container.querySelector('.timelineMemoAnchorHitArea')).toBeTruthy()
  })

  it('renders and edits text inside the selected anchored memo', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.texts = [{ textId: 'text_1', text: '指示\n補足', color: '#123456', x: 1, y: 1, fontSizeUnits: 1 }]
    const onUpsertText = vi.fn()
    const { container, getByLabelText } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[source]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.5, heightPx: pageSize.heightPx * 0.5 }}
          selectedMemoId={source.memoId}
          editMode="text"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          onAppendStroke={vi.fn()}
          onEraseStroke={vi.fn()}
          onUpsertText={onUpsertText}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )

    const rendered = container.querySelector<SVGTextElement>('.timelineMemoText')
    expect(rendered?.querySelectorAll('tspan')).toHaveLength(2)
    expect(rendered?.getAttribute('clip-path')).toBeNull()
    expect(container.querySelector('.timelineMemoTextViewport')?.getAttribute('overflow')).toBe('hidden')
    expect(container.querySelector('.timelineMemoLayer clipPath')).toBeNull()
    fireEvent.doubleClick(rendered as SVGTextElement)
    const editor = getByLabelText('メモ文字')
    fireEvent.change(editor, { target: { value: '更新' } })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })

    expect(onUpsertText).toHaveBeenCalledWith(source.memoId, expect.objectContaining({ textId: 'text_1', text: '更新' }))
  })
})
