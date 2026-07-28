import { createSheetPages, resolveSheetTemplatePageSize, standardA3SheetTemplate, type TimelineInkMemo } from '@xsheet-remap/core'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TimelineMemoLayer } from './TimelineMemoLayer'

afterEach(() => {
  vi.restoreAllMocks()
})

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
    expect(container.querySelector('.timelineMemoSegment')?.hasAttribute('data-sheet-touch-interaction')).toBe(false)

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
          editMode="new"
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
    const moveFrame = container.querySelector<SVGRectElement>('.timelineMemoMoveFrame')
    expect(svg).toBeTruthy()
    expect(moveFrame).toBeTruthy()
    expect(container.querySelector('.timelineMemoSegment')?.getAttribute('data-sheet-touch-interaction')).toBe('direct')
    expect(container.querySelector('.timelineMemoMoveHandle')).toBeNull()
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }),
    })
    Object.defineProperty(moveFrame, 'setPointerCapture', { value: vi.fn() })

    fireEvent.pointerDown(moveFrame as SVGRectElement, { pointerId: 9, clientX: 10, clientY: 20 })
    expect(moveFrame?.getAttribute('data-dragging')).toBe('true')
    fireEvent.pointerMove(window, { pointerId: 9, buttons: 1, clientX: 110, clientY: 70 })
    fireEvent.pointerUp(window, { pointerId: 9, buttons: 0, clientX: 160, clientY: 100 })
    fireEvent.pointerMove(window, { pointerId: 9, buttons: 1, clientX: 300, clientY: 300 })

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
    expect(container.querySelector('.timelineMemoMoveFrame')).toBeTruthy()
    expect(container.querySelector('.timelineMemoMoveHandle')).toBeNull()
    expect(container.querySelector('.sheetTransformHandleMoveVisual')).toBeNull()
    expect(container.querySelector('.timelineMemoResizeHandle.sheetTransformHandle.resize')).toBeTruthy()
    expect(container.querySelector('.sheetTransformHandleResizeVisual')).toBeTruthy()

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

  it('preserves dense memo pen samples while drawing incremental canvas segments', () => {
    const context = {
      beginPath: vi.fn(),
      clearRect: vi.fn(),
      clip: vi.fn(),
      lineTo: vi.fn(),
      moveTo: vi.fn(),
      rect: vi.fn(),
      restore: vi.fn(),
      save: vi.fn(),
      setLineDash: vi.fn(),
      setTransform: vi.fn(),
      stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context)
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    const editorHost = document.createElement('div')
    document.body.append(editorHost)
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const selected = memo('memo_1')
    const onAppendStroke = vi.fn()
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[selected]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: 1000, heightPx: 1000 }}
          selectedMemoId={selected.memoId}
          editMode="pen"
          penColor="#111"
          penWidth={0.002}
          eraserWidth={0.018}
          textFontSizePx={18}
          editorHost={editorHost}
          onAppendStroke={onAppendStroke}
          onEraseStroke={vi.fn()}
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )
    const svg = container.querySelector('svg')!
    const drawSurface = container.querySelector<SVGRectElement>('.timelineMemoDrawSurface')!
    const canvas = editorHost.querySelector<HTMLCanvasElement>('.timelineMemoInkCanvas')!
    Object.defineProperty(svg, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, right: 1000, bottom: 1000, width: 1000, height: 1000, x: 0, y: 0, toJSON: () => ({}) }),
    })
    Object.defineProperty(drawSurface, 'setPointerCapture', { value: vi.fn() })

    fireEvent.pointerDown(drawSurface, { pointerId: 18, button: 0, buttons: 1, clientX: 100, clientY: 100 })
    for (let index = 0; index < 500; index += 1) {
      fireEvent.pointerMove(window, {
        pointerId: 18,
        buttons: 1,
        clientX: 101 + index,
        clientY: 101 + index,
        pressure: 0.6,
      })
    }

    expect(requestFrame).not.toHaveBeenCalled()
    expect(canvas.dataset.inkActive).toBe('true')
    expect(canvas.dataset.inkSampleCount).toBe('501')
    expect(context.lineTo).toHaveBeenCalledTimes(501)
    expect(container.querySelector('.timelineMemoStroke.draft')).toBeNull()
    fireEvent.pointerUp(window, { pointerId: 18, buttons: 0, clientX: 700, clientY: 700 })

    expect(canvas.dataset.inkActive).toBe('false')
    expect(onAppendStroke).toHaveBeenCalledTimes(1)
    expect(onAppendStroke.mock.calls[0]?.[1].points).toHaveLength(502)
    editorHost.remove()
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
    const inkLayer = container.querySelector('.timelineMemoInkLayer')
    expect(inkLayer?.getAttribute('clip-path')).toMatch(/^url\(#timeline-memo-clip-/)
    expect(inkLayer?.querySelector('.timelineMemoStrokeHit')).toBeTruthy()
    expect(inkLayer?.querySelector('.timelineMemoStroke')).toBeTruthy()
    expect(container.querySelector('.timelineMemoAnchorHitArea')).toBeTruthy()
  })

  it('clips preserved ink and its hit target to resized memo bounds without rewriting the stroke', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.placement.widthUnits = 2
    source.strokes = [{
      strokeId: 'stroke_1',
      color: '#111',
      widthUnits: 0.2,
      points: [{ x: 1, y: 1 }, { x: 7, y: 5 }],
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

    const inkLayer = container.querySelector('.timelineMemoInkLayer')
    const clipId = inkLayer?.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1]
    const clipPath = [...container.querySelectorAll('clipPath')].find(item => item.id === clipId)
    const clipRect = clipPath?.querySelector('rect')
    const visibleStroke = inkLayer?.querySelector('.timelineMemoStroke')
    const hitStroke = inkLayer?.querySelector('.timelineMemoStrokeHit')

    expect(clipRect).toBeTruthy()
    expect(Number(clipRect?.getAttribute('width'))).toBeGreaterThan(0)
    expect(visibleStroke?.getAttribute('d')).toContain('L ')
    expect(hitStroke?.getAttribute('d')).toBe(visibleStroke?.getAttribute('d'))
    expect(source.strokes[0]?.points.at(-1)?.x).toBe(7)
  })

  it('starts new anchored memo text with the default black pen color', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    const onUpsertText = vi.fn()
    const { getByLabelText } = render(
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
          penColor="#000000"
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

    const editor = getByLabelText('メモ文字') as HTMLTextAreaElement
    expect(editor.style.color).toBe('rgb(0, 0, 0)')
    fireEvent.change(editor, { target: { value: '黒いメモ' } })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })

    expect(onUpsertText).toHaveBeenCalledWith(
      source.memoId,
      expect.objectContaining({ text: '黒いメモ' }),
      expect.objectContaining({ text: expect.objectContaining({ color: '#000000' }) }),
    )
  })

  it('renders and edits text inside the selected anchored memo', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.appearance = {
      inkOpacity: 1,
      textOpacity: 1,
      text: { color: '#123456', fontSizeUnits: 1 },
      background: { enabled: false, color: '#fff6a8', opacity: 0.28 },
    }
    source.texts = [{ textId: 'text_1', text: '指示\n\n補足', x: 1, y: 1 }]
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
    const renderedLines = [...(rendered?.querySelectorAll('tspan') ?? [])]
    expect(renderedLines.map(line => line.textContent)).toEqual(['指示', '', '補足'])
    expect(renderedLines.map(line => Number(line.getAttribute('y')))).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
    expect(Number(renderedLines[2]?.getAttribute('y')) - Number(renderedLines[0]?.getAttribute('y')))
      .toBeCloseTo(2 * (Number(renderedLines[1]?.getAttribute('y')) - Number(renderedLines[0]?.getAttribute('y'))))
    expect(rendered?.getAttribute('transform')).toBe(`scale(${1 / pageSize.widthPx} ${1 / pageSize.heightPx})`)
    expect(rendered?.getAttribute('clip-path')).toBeNull()
    expect(container.querySelector('.timelineMemoTextLayer')?.getAttribute('clip-path')).toMatch(/^url\(#timeline-memo-clip-/)
    expect(container.querySelector('.timelineMemoTextViewport')).toBeNull()
    expect(container.querySelector('.timelineMemoLayer clipPath')).toBeTruthy()
    fireEvent.doubleClick(rendered as SVGTextElement)
    const editor = getByLabelText('メモ文字') as HTMLTextAreaElement
    expect(editor.wrap).toBe('soft')
    fireEvent.change(editor, { target: { value: '更新' } })
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })

    expect(onUpsertText).toHaveBeenCalledWith(
      source.memoId,
      expect.objectContaining({ textId: 'text_1', text: '更新' }),
      expect.objectContaining({ text: { color: '#123456', fontSizeUnits: 1 } }),
    )
  })

  it('keeps the inline editor and committed text at the same logical font size across zoom', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.appearance = {
      inkOpacity: 1,
      textOpacity: 1,
      text: { color: '#123456', fontSizeUnits: 1.4 },
      background: { enabled: false, color: '#fff6a8', opacity: 0.28 },
    }
    source.texts = [{ textId: 'text_1', text: '同じ大きさ', x: 1, y: 1 }]
    const { container, getByLabelText } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[source]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={{ widthPx: pageSize.widthPx * 0.79, heightPx: pageSize.heightPx * 0.79 }}
          selectedMemoId={source.memoId}
          editMode="text"
          zoom={0.79}
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
    const rendered = container.querySelector<SVGTextElement>('[data-timeline-memo-text-id="text_1"]')!
    fireEvent.doubleClick(rendered)
    const editor = getByLabelText('メモ文字') as HTMLTextAreaElement
    const committedDisplayPx = Number(rendered.getAttribute('font-size')) * 0.79
    expect(Number.parseFloat(editor.style.fontSize)).toBeCloseTo(committedDisplayPx, 5)
    expect(editor.classList.contains('timelineMemoTextEditor')).toBe(true)
  })

  it('extends the automatic text editor to the shared memo boundary instead of capping it at five frames', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.placement.heightFrames = 12
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
          onUpsertText={vi.fn()}
          onUpdatePlacement={vi.fn()}
        />
      </svg>,
    )

    const bounds = container.querySelector<SVGRectElement>('.timelineMemoBounds')!
    const editor = getByLabelText('メモ文字') as HTMLTextAreaElement
    const boundsRight = Number(bounds.getAttribute('x')) + Number(bounds.getAttribute('width'))
    const boundsBottom = Number(bounds.getAttribute('y')) + Number(bounds.getAttribute('height'))
    const editorRight = (Number.parseFloat(editor.style.left) + Number.parseFloat(editor.style.width)) / 100
    const editorBottom = (Number.parseFloat(editor.style.top) + Number.parseFloat(editor.style.height)) / 100
    const editorHeight = Number.parseFloat(editor.style.height) / 100
    const boundsHeight = Number(bounds.getAttribute('height'))

    expect(editorRight).toBeCloseTo(boundsRight, 6)
    expect(editorBottom).toBeCloseTo(boundsBottom, 6)
    expect(editorHeight).toBeGreaterThan(boundsHeight * 0.75)
  })

  it('renders shared background and independent ink/text opacity from memo appearance', () => {
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pageSize = resolveSheetTemplatePageSize(standardA3SheetTemplate)
    const source = memo('memo_1')
    source.appearance = {
      inkOpacity: 0.35,
      textOpacity: 0.6,
      text: { color: '#123456', fontSizeUnits: 1 },
      background: { enabled: true, color: '#ffee88', opacity: 0.25 },
    }
    source.texts = [
      { textId: 'text_1', text: '注釈', x: 1, y: 1 },
      { textId: 'text_2', text: '追記', x: 1, y: 3 },
    ]
    const { container } = render(
      <svg viewBox="0 0 1 1">
        <TimelineMemoLayer
          memos={[source]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={['A']}
          pageSize={pageSize}
          surface={pageSize}
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
    expect(container.querySelector('[data-memo-background="solid"]')?.getAttribute('fill')).toBe('#ffee88')
    expect(container.querySelector('.timelineMemoInkLayer')?.getAttribute('opacity')).toBe('0.35')
    expect(container.querySelector('.timelineMemoTextLayer')?.getAttribute('opacity')).toBe('0.6')
    expect([...container.querySelectorAll('.timelineMemoText')].map(text => [text.getAttribute('fill'), text.getAttribute('font-size')]))
      .toEqual([['#123456', expect.any(String)], ['#123456', expect.any(String)]])
    expect(new Set([...container.querySelectorAll('.timelineMemoText')].map(text => text.getAttribute('font-size'))).size).toBe(1)
  })
})
