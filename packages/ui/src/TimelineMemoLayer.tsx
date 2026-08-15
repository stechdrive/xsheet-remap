import { useMemo, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { normalizeMemoAppearance, type SheetMemoAnchorPresentation, type SheetPage, type SheetTemplate, type SheetTemplateLayoutResolveOptions, type SheetViewLayoutOverrides, type TimelineInkMemo, type TimelineMemoPlacement, type TimelineMemoPoint, type TimelineMemoStroke, type TimelineMemoText } from '@xsheet-remap/core'
import type { EditMode } from './appTypes'
import {
  timelineMemoAnchorConnectorPoints,
  timelineMemoAnchorHitRect,
  timelineMemoAnchorMarkerRect,
  timelineMemoPointFromPagePoint,
  timelineMemoPointToPagePoint,
  type TimelineMemoSegment,
} from './timelineMemoGeometry'
import { sheetCellCornerTrianglePoints } from './sheetCellCornerMarker'
import { SheetSelectionOutline } from './sheet-selection-visuals'
import { useInlineEditorSession } from './useInlineEditorSession'
import { SheetTransformHandle } from './SheetTransformHandle'
import { buildTimelineMemoTextLayout } from './timelineMemoTextLayout'
import { SvgMultilineTspans } from './SvgMultilineTspans'
import { LowLatencyInkCanvas, useLowLatencyInkCanvas } from './LowLatencyInkCanvas'
import { useInkStrokeSession } from './useInkStrokeSession'
import { usePointerDragSession } from './usePointerDragSession'
import { createTimelineMemoRenderCache, type TimelineMemoPageRenderItem } from './timelineMemoRenderModel'

type MemoInkInteraction = {
  pointerId: number
  mode: 'draw' | 'erase'
  memo: TimelineInkMemo
  segment: TimelineMemoSegment
  svgRect: { left: number; top: number; width: number; height: number }
  points: TimelineMemoPoint[]
}

type MemoTransformInteraction = {
  pointerId: number
  mode: 'move' | 'resize'
  memo: TimelineInkMemo
  segment: TimelineMemoSegment
  startClient: { x: number; y: number }
  svgRect: { left: number; top: number; width: number; height: number }
  previewPlacement: TimelineMemoPlacement
}

type MemoInteractionMode = MemoInkInteraction['mode'] | MemoTransformInteraction['mode']

type TimelineTextDraft = {
  memoId: string
  segment: TimelineMemoSegment
  value: TimelineMemoText
  appearance: ReturnType<typeof normalizeMemoAppearance>
}

function timelineMemoTextEditorRect(segment: TimelineMemoSegment, value: TimelineMemoText) {
  const point = timelineMemoPointToPagePoint(segment, value)
  const right = segment.rect.x + segment.rect.w
  const bottom = segment.rect.y + segment.rect.h
  const x = Math.max(segment.rect.x, Math.min(point.x, right))
  const y = Math.max(segment.rect.y, Math.min(point.y, bottom))
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  }
}

export function TimelineMemoLayer({
  memos,
  template,
  page,
  paperTracks,
  timelineLanes,
  layoutOverrides,
  pageSize,
  surface,
  selectedMemoId,
  editMode,
  penColor,
  penWidth,
  eraserWidth,
  textFontSizePx,
  zoom = 1,
  editorHost,
  onAppendStroke,
  onEraseStroke,
  onUpsertText,
  onUpdatePlacement,
}: {
  memos: readonly TimelineInkMemo[]
  template: SheetTemplate
  page: SheetPage
  paperTracks: string[]
  timelineLanes?: SheetTemplateLayoutResolveOptions['timelineLanes']
  layoutOverrides?: SheetViewLayoutOverrides
  pageSize: { widthPx: number; heightPx: number }
  surface: { widthPx: number; heightPx: number }
  selectedMemoId: string | null
  editMode: EditMode
  penColor: string
  penWidth: number
  eraserWidth: number
  textFontSizePx: number
  zoom?: number
  editorHost?: HTMLElement | null
  onAppendStroke: (memoId: string, stroke: Omit<TimelineMemoStroke, 'strokeId'>) => void
  onEraseStroke: (memoId: string, points: TimelineMemoPoint[], widthUnits: number) => void
  onUpsertText: (memoId: string, text: TimelineMemoText, appearance: ReturnType<typeof normalizeMemoAppearance>) => void
  onUpdatePlacement: (memoId: string, placement: TimelineMemoPlacement) => void
}) {
  const [textDraft, setTextDraft] = useState<TimelineTextDraft | null>(null)
  const { editorRef: textEditorRef, commit: commitTextEditor, cancel: cancelTextEditor } = useInlineEditorSession<HTMLTextAreaElement>({
    active: Boolean(textDraft),
    sessionKey: textDraft ? `${textDraft.memoId}:${textDraft.value.textId}` : null,
    selectOnFocus: !textDraft?.value.text,
    onCommit: () => {
      const draft = textDraft
      setTextDraft(null)
      if (draft) onUpsertText(draft.memoId, draft.value, draft.appearance)
    },
    onCancel: () => setTextDraft(null),
  })
  const [automaticTextSessionKey, setAutomaticTextSessionKey] = useState<string | null>(null)
  const [memoRenderCache] = useState(createTimelineMemoRenderCache)
  const inkCanvas = useLowLatencyInkCanvas()
  const memoInkDrag = useInkStrokeSession<MemoInkInteraction>({
    onPointerEvent: inkCanvas.updateDelegatedInk,
    onActualPoints: (current, points) => {
      const canvasPoints: Array<{ x: number; y: number }> = []
      for (const point of points) {
        current.points.push(timelineMemoPointFromPagePoint(
          current.segment,
          pagePointFromClient(current.svgRect, point.clientX, point.clientY),
        ))
        canvasPoints.push({
          x: point.clientX - current.svgRect.left,
          y: point.clientY - current.svgRect.top,
        })
      }
      inkCanvas.append(canvasPoints)
      return current
    },
    onPredictedPoints: (current, points) => {
      inkCanvas.replacePredicted(points.map(point => ({
        x: point.clientX - current.svgRect.left,
        y: point.clientY - current.svgRect.top,
      })))
    },
    onFinish: (current, finish) => {
      inkCanvas.clear()
      if (finish.cancelled) return
      if (current.mode === 'draw') {
        if (current.points.length > 1) {
          onAppendStroke(current.memo.memoId, {
            color: penColor,
            widthUnits: Math.max(0.04, penWidth / Math.max(Number.EPSILON, current.segment.rowHeightY)),
            points: current.points.slice(),
          })
        }
      } else {
        onEraseStroke(
          current.memo.memoId,
          current.points.slice(),
          Math.max(0.04, eraserWidth / Math.max(Number.EPSILON, current.segment.rowHeightY)),
        )
      }
    },
  })
  const memoTransformDrag = usePointerDragSession<MemoTransformInteraction>({
    previewMode: 'animation-frame',
    onUpdate: (current, point) => {
      const deltaUnits = (point.clientX - current.startClient.x) / Math.max(1, current.svgRect.width * current.segment.rowHeightX)
      const deltaFrames = (point.clientY - current.startClient.y) / Math.max(1, current.svgRect.height * current.segment.rowHeightY)
      return {
        ...current,
        previewPlacement: current.mode === 'move'
          ? {
              ...current.memo.placement,
              crossOffsetUnits: current.memo.placement.crossOffsetUnits + deltaUnits,
              frameOffset: current.memo.placement.frameOffset + deltaFrames,
            }
          : {
              ...current.memo.placement,
              widthUnits: Math.max(1, current.memo.placement.widthUnits + deltaUnits),
              heightFrames: Math.max(1, current.memo.placement.heightFrames + deltaFrames),
            },
      }
    },
    onFinish: (current, finish) => {
      if (!finish.cancelled) onUpdatePlacement(current.memo.memoId, current.previewPlacement)
    },
  })
  const placementInteraction = memoTransformDrag.active
  const renderedMemos = useMemo(() => memos
    .slice()
    .sort((left, right) => left.order - right.order)
    .map(memo => placementInteraction?.memo.memoId === memo.memoId
      ? { ...memo, placement: placementInteraction.previewPlacement }
      : memo), [memos, placementInteraction])
  const renderedMemoSegments = useMemo(() => memoRenderCache.render(renderedMemos, {
    template,
    page,
    paperTracks,
    timelineLanes,
    layoutOverrides,
  }), [layoutOverrides, memoRenderCache, page, paperTracks, renderedMemos, template, timelineLanes])
  const anchorGroups = useMemo(() => {
    const groups = new Map<string, {
      anchorCell: NonNullable<TimelineMemoPageRenderItem['anchorCell']>
      anchorFrame: number
      anchorRole: TimelineInkMemo['anchor']['role']
      anchorPaperTrack?: string
      anchorCueIds: string[]
      presentation: SheetMemoAnchorPresentation
      memoIds: string[]
    }>()
    for (const renderedMemo of renderedMemoSegments) {
      const { memo, anchorCell, anchorPresentation } = renderedMemo
      if (!anchorCell) continue
      const key = [anchorCell.regionId, memo.anchor.role, memo.anchor.frame, memo.anchor.paperTrack ?? '', memo.anchor.laneId ?? ''].join(':')
      const existing = groups.get(key)
      if (existing) {
        existing.memoIds.push(memo.memoId)
        if (memo.anchor.cueId && !existing.anchorCueIds.includes(memo.anchor.cueId)) existing.anchorCueIds.push(memo.anchor.cueId)
      }
      else groups.set(key, {
        anchorCell,
        anchorFrame: memo.anchor.frame,
        anchorRole: memo.anchor.role,
        anchorPaperTrack: memo.anchor.paperTrack,
        anchorCueIds: memo.anchor.cueId ? [memo.anchor.cueId] : [],
        presentation: anchorPresentation,
        memoIds: [memo.memoId],
      })
    }
    return groups
  }, [renderedMemoSegments])
  const selectedRender = renderedMemoSegments.find(item => item.memo.memoId === selectedMemoId)
  const selectedAnchorGroup = [...anchorGroups.values()].find(group => selectedMemoId && group.memoIds.includes(selectedMemoId))
  const selectedStartSegment = selectedRender?.segments.find(segment => segment.startsMemo)
  const selectedAnchorMarker = selectedAnchorGroup ? timelineMemoAnchorMarkerRect(selectedAnchorGroup.anchorCell.rect, surface) : null
  const selectedConnectorPoints = selectedAnchorGroup?.presentation === 'camera-connector' && selectedAnchorMarker && selectedStartSegment
    ? timelineMemoAnchorConnectorPoints(selectedAnchorMarker, selectedStartSegment.rect, surface)
    : null

  function newTextDraft(memo: TimelineInkMemo, segment: TimelineMemoSegment, point?: TimelineMemoPoint): TimelineTextDraft {
    const fontSizeUnits = Math.max(0.25, textFontSizePx / Math.max(1, segment.rowHeightY * pageSize.heightPx))
    const appearance = memo.appearance
      ? normalizeMemoAppearance(memo.appearance)
      : {
          ...normalizeMemoAppearance(),
          text: { color: penColor, fontSizeUnits },
        }
    const insetX = Math.min(Math.max(0.12, fontSizeUnits * 0.12), Math.max(0, memo.placement.widthUnits - 0.5))
    const insetY = Math.max(0.12, fontSizeUnits * 0.12)
    return {
      memoId: memo.memoId,
      segment,
      appearance,
      value: {
        textId: nextTimelineMemoTextId(memo),
        text: '',
        x: point?.x ?? insetX,
        y: point?.y ?? Math.min(segment.memoYEnd - 0.25, segment.memoYStart + insetY),
      },
    }
  }

  const nextAutomaticTextSessionKey = editMode === 'text' && selectedMemoId && selectedRender && selectedStartSegment
    ? `${selectedMemoId}:${page.pageId}`
    : null
  if (automaticTextSessionKey !== nextAutomaticTextSessionKey) {
    setAutomaticTextSessionKey(nextAutomaticTextSessionKey)
    setTextDraft(nextAutomaticTextSessionKey && selectedRender && selectedStartSegment
      ? newTextDraft(selectedRender.memo, selectedStartSegment)
      : null)
  }

  function begin(event: PointerEvent<SVGElement>, memo: TimelineInkMemo, segment: TimelineMemoSegment, mode: MemoInteractionMode) {
    if (memo.memoId !== selectedMemoId) return
    event.preventDefault()
    event.stopPropagation()
    const svgRect = event.currentTarget.ownerSVGElement?.getBoundingClientRect()
    if (!svgRect) return
    const point = timelineMemoPointFromPagePoint(
      segment,
      pagePointFromClient(svgRect, event.clientX, event.clientY),
    )
    const rect = {
      left: svgRect.left,
      top: svgRect.top,
      width: svgRect.width,
      height: svgRect.height,
    }
    if (mode === 'draw' || mode === 'erase') {
      memoTransformDrag.cancel()
      memoInkDrag.cancel()
      const normalizedLineWidth = mode === 'draw' ? penWidth : eraserWidth
      const lineWidth = normalizedLineWidth * Math.min(svgRect.width, svgRect.height)
      const appearance = normalizeMemoAppearance(memo.appearance)
      const inputMode = memoInkDrag.begin({
        pointerId: event.pointerId,
        mode,
        memo,
        segment,
        svgRect: rect,
        points: mode === 'draw' ? [point] : [],
      }, event.currentTarget, event.nativeEvent)
      inkCanvas.begin({
        width: svgRect.width,
        height: svgRect.height,
        color: mode === 'draw' ? penColor : 'rgb(36 121 94 / 0.56)',
        lineWidth,
        opacity: mode === 'draw' ? 0.72 * appearance.inkOpacity : 1,
        clip: {
          x: segment.rect.x * svgRect.width,
          y: segment.rect.y * svgRect.height,
          width: segment.rect.w * svgRect.width,
          height: segment.rect.h * svgRect.height,
        },
        point: {
          x: event.clientX - svgRect.left,
          y: event.clientY - svgRect.top,
        },
        pointerEvent: mode === 'draw' ? event.nativeEvent : undefined,
        inputMode,
      })
      return
    }
    memoInkDrag.cancel()
    memoTransformDrag.cancel()
    memoTransformDrag.begin({
      pointerId: event.pointerId,
      mode,
      memo,
      segment,
      startClient: { x: event.clientX, y: event.clientY },
      svgRect: rect,
      previewPlacement: memo.placement,
    }, event.currentTarget)
  }

  function beginText(event: PointerEvent<SVGElement>, memo: TimelineInkMemo, segment: TimelineMemoSegment) {
    if (memo.memoId !== selectedMemoId) return
    event.preventDefault()
    event.stopPropagation()
    const point = timelineMemoPointFromPagePoint(segment, pagePoint(event))
    setTextDraft(newTextDraft(memo, segment, point))
  }

  function editText(event: MouseEvent<SVGTextElement>, memo: TimelineInkMemo, segment: TimelineMemoSegment, text: TimelineMemoText) {
    if (memo.memoId !== selectedMemoId) return
    event.preventDefault()
    event.stopPropagation()
    setTextDraft({ memoId: memo.memoId, segment, value: text, appearance: normalizeMemoAppearance(memo.appearance) })
  }

  function handleTextDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelTextEditor()
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      commitTextEditor()
    }
  }

  return (
    <>
      {editorHost && selectedMemoId && (editMode === 'pen' || editMode === 'eraser') && createPortal(
        <LowLatencyInkCanvas
          canvasRef={inkCanvas.canvasRef}
          predictionLayerRef={inkCanvas.predictionLayerRef}
          className="timelineMemoInkCanvas"
          predictionClassName="timelineMemoInkPredictionLayer"
          label="タイムラインメモの手描きプレビュー"
        />,
        editorHost,
      )}
      <g className="timelineMemoLayer" aria-label="フレームに紐づくメモ">
      <defs>
        {renderedMemoSegments.flatMap(({ memo, segments }) => segments.map(segment => {
          const clipId = timelineMemoSegmentClipId(memo.memoId, segment.regionId)
          return <clipPath key={clipId} id={clipId} clipPathUnits="userSpaceOnUse">
            <rect x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} />
          </clipPath>
        }))}
      </defs>
      {renderedMemoSegments.flatMap(({ memo, segments, appearance }) => segments.map(segment => {
        const selected = memo.memoId === selectedMemoId
        const drawingToolActive = editMode === 'pen' || editMode === 'eraser'
        const clipId = timelineMemoSegmentClipId(memo.memoId, segment.regionId)
        return (
          <g
            key={`${memo.memoId}:${segment.regionId}`}
            data-timeline-memo-id={memo.memoId}
            data-sheet-touch-interaction={selected && editMode !== 'pen' && editMode !== 'eraser' ? 'direct' : undefined}
            className={selected ? 'timelineMemoSegment selected' : 'timelineMemoSegment'}
          >
            {appearance.background.enabled && <rect
              className="timelineMemoBackground"
              data-memo-background="solid"
              x={segment.rect.x}
              y={segment.rect.y}
              width={segment.rect.w}
              height={segment.rect.h}
              fill={appearance.background.color}
              opacity={appearance.background.opacity}
              clipPath={`url(#${clipId})`}
            />}
            {selected && <rect className="timelineMemoHitArea" x={segment.rect.x} y={segment.rect.y} width={segment.rect.w} height={segment.rect.h} />}
            <g className="timelineMemoInkLayer" data-memo-ink-opacity={appearance.inkOpacity} opacity={appearance.inkOpacity} clipPath={`url(#${clipId})`}>
              {!selected && segment.hitPath && <path className="timelineMemoStrokeHit" d={segment.hitPath} />}
              {segment.visibleStrokeGroups.map(group => <path
                key={group.key}
                className="timelineMemoStroke"
                d={group.path}
                stroke={group.color}
                strokeWidth={group.width}
              />)}
            </g>
            {selected && editMode === 'text' && <rect
              className="timelineMemoTextSurface"
              x={segment.rect.x}
              y={segment.rect.y}
              width={segment.rect.w}
              height={segment.rect.h}
              onPointerDown={event => beginText(event, memo, segment)}
            />}
            {selected && drawingToolActive && <rect
              className={editMode === 'eraser' ? 'timelineMemoDrawSurface eraser' : 'timelineMemoDrawSurface'}
              x={segment.rect.x}
              y={segment.rect.y}
              width={segment.rect.w}
              height={segment.rect.h}
              onPointerDown={event => begin(event, memo, segment, editMode === 'eraser' ? 'erase' : 'draw')}
            />}
            {selected && <rect
              className="timelineMemoMoveFrame"
              data-dragging={placementInteraction?.memo.memoId === memo.memoId && placementInteraction.mode === 'move'}
              aria-label="メモの枠をドラッグして移動"
              x={segment.rect.x}
              y={segment.rect.y}
              width={segment.rect.w}
              height={segment.rect.h}
              onPointerDown={event => begin(event, memo, segment, 'move')}
            />}
            <g className="timelineMemoTextLayer" data-memo-text-opacity={appearance.textOpacity} opacity={appearance.textOpacity} clipPath={`url(#${clipId})`}>
              {(memo.texts ?? []).filter(text => text.y >= segment.memoYStart && text.y < segment.memoYEnd).map(text => {
                if (textDraft?.memoId === memo.memoId && textDraft.value.textId === text.textId) return null
                const layout = buildTimelineMemoTextLayout(segment, text, appearance.text.fontSizeUnits, pageSize)
                return <text
                  key={text.textId}
                  className="timelineMemoText"
                  data-timeline-memo-text-id={text.textId}
                  x={layout.xPx}
                  y={layout.yPx}
                  fill={appearance.text.color}
                  fontSize={layout.fontSizePx}
                  transform={`scale(${1 / Math.max(1, pageSize.widthPx)} ${1 / Math.max(1, pageSize.heightPx)})`}
                  dominantBaseline="hanging"
                  onDoubleClick={event => editText(event, memo, segment, text)}
                ><SvgMultilineTspans
                  lines={layout.lines}
                  xPx={layout.xPx}
                  yPx={layout.yPx}
                  lineHeightPx={layout.lineHeightPx}
                  keyPrefix={text.textId}
                /></text>
              })}
            </g>
            {selected && <SheetSelectionOutline rect={segment.rect} className="timelineMemoBounds" />}
            {textDraft?.memoId === memo.memoId && textDraft.segment.regionId === segment.regionId && (() => {
              const editorRect = timelineMemoTextEditorRect(segment, textDraft.value)
              const host = editorHost === undefined && typeof document !== 'undefined' ? document.body : editorHost
              return host ? createPortal(
                <textarea
                  ref={textEditorRef}
                  autoFocus
                  className="timelineMemoTextEditor"
                  data-workspace-keyboard-scope="editor"
                  value={textDraft.value.text}
                  style={{
                    left: `${editorRect.x * 100}%`,
                    top: `${editorRect.y * 100}%`,
                    width: `${editorRect.width * 100}%`,
                    height: `${editorRect.height * 100}%`,
                    fontSize: `${textDraft.appearance.text.fontSizeUnits * segment.rowHeightY * pageSize.heightPx * zoom}px`,
                    color: textDraft.appearance.text.color,
                    opacity: textDraft.appearance.textOpacity,
                  }}
                  wrap="soft"
                  spellCheck={false}
                  onChange={event => {
                    const text = event.currentTarget.value
                    setTextDraft(current => current ? { ...current, value: { ...current.value, text } } : null)
                  }}
                  onKeyDown={handleTextDraftKeyDown}
                  onBlur={() => commitTextEditor()}
                  onPointerDown={event => event.stopPropagation()}
                  aria-label="メモ文字"
                />,
                host,
              ) : null
            })()}
            {selected && segment.endsMemo && <SheetTransformHandle
              rect={segment.rect}
              surface={surface}
              kind="resize"
              className="timelineMemoResizeHandle"
              label="メモの大きさを変更"
              onPointerDown={event => begin(event, memo, segment, 'resize')}
            />}
          </g>
        )
      }))}
      {selectedConnectorPoints && <polygon className="timelineMemoAnchorConnector" points={selectedConnectorPoints} />}
      {[...anchorGroups.entries()].map(([key, group]) => {
        const hitRect = timelineMemoAnchorHitRect(group.anchorCell.rect, surface)
        const selected = Boolean(selectedMemoId && group.memoIds.includes(selectedMemoId))
        const memoCount = group.memoIds.length
        return (
          <g
            key={key}
            className={selected ? 'timelineMemoAnchorCue selected' : 'timelineMemoAnchorCue'}
            data-timeline-memo-id={selectedMemoId && group.memoIds.includes(selectedMemoId) ? selectedMemoId : undefined}
            data-timeline-memo-ids={group.memoIds.join(' ')}
            data-timeline-memo-anchor-frame={group.anchorFrame}
            data-timeline-memo-anchor-role={group.anchorRole}
            data-timeline-memo-anchor-track={group.anchorPaperTrack}
            data-timeline-memo-anchor-cue-ids={group.anchorCueIds.join(' ') || undefined}
            data-timeline-memo-count={memoCount}
            aria-label={memoCount === 1 ? 'メモのアンカー' : `メモのアンカー ${memoCount}件`}
          >
            <title>{memoCount === 1 ? 'メモ' : `メモ ${memoCount}件`}</title>
            {!selected && <rect
              className="timelineMemoAnchorHitArea"
              x={hitRect.x}
              y={hitRect.y}
              width={hitRect.w}
              height={hitRect.h}
            />}
            <polygon className="timelineMemoAnchorMarker" points={sheetCellCornerTrianglePoints(group.anchorCell.rect, surface, 'top-left')} />
          </g>
        )
      })}
      </g>
    </>
  )
}

function pagePoint(event: PointerEvent<SVGElement>) {
  const svg = event.currentTarget.ownerSVGElement
  const rect = svg?.getBoundingClientRect()
  return rect ? pagePointFromClient(rect, event.clientX, event.clientY) : { x: 0, y: 0 }
}

function pagePointFromClient(
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) {
  return {
    x: (clientX - rect.left) / Math.max(1, rect.width),
    y: (clientY - rect.top) / Math.max(1, rect.height),
  }
}

function nextTimelineMemoTextId(memo: TimelineInkMemo): string {
  const used = new Set((memo.texts ?? []).map(text => text.textId))
  let index = used.size + 1
  while (used.has(`${memo.memoId}_text_${index}`)) index += 1
  return `${memo.memoId}_text_${index}`
}

function timelineMemoSegmentClipId(memoId: string, regionId: string): string {
  return `timeline-memo-clip-${memoId}-${regionId}`.replace(/[^a-zA-Z0-9_-]/g, '-')
}
