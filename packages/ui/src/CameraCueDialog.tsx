import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import {
  CAMERA_INSTRUCTION_CUE_END_POINT_ID,
  cameraSegmentKindForLegacyInstruction,
  clampCameraOverlapPivotAnchorFrame,
  defaultCameraOverlapPivotAnchorFrame,
  formatLogicalSheetFrameTimecode,
  resolveCameraInstructionPoints,
  resolveCameraInstructionSegments,
  shapeForCameraSegmentKind,
  type CameraInstruction,
  type CameraInstructionPathStyle,
  type CameraInstructionPoint,
  type CameraInstructionSegment,
  type CameraInstructionSegmentKind,
  type TimedRangeCue,
} from '@xsheet-remap/core'
import type { CameraCueDialogState } from './appTypes'
import {
  CAMERA_INSTRUCTION_BUILT_INS,
  CAMERA_INSTRUCTION_HISTORY_LIMIT,
  CAMERA_POINT_LABEL_HISTORY_LIMIT,
} from './cameraCueEditing'
import { DurationFrameControl } from './DurationFrameControl'
import { HistoryInput } from './HistoryInput'

export interface CameraCueDialogSubmit {
  cueId?: string
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
  camera: CameraInstruction
}

type CameraSegmentOption = {
  id: string
  kind: CameraInstructionSegmentKind
  label: string
}

const segmentOptions: CameraSegmentOption[] = [
  { id: 'straight', kind: 'straight', label: '直線の区間指示' },
  { id: 'wave', kind: 'wave', label: '波線の区間指示' },
  { id: 'fade-in', kind: 'fade-in', label: 'フェードイン・ワイプイン' },
  { id: 'fade-out', kind: 'fade-out', label: 'フェードアウト・ワイプアウト' },
  { id: 'overlap', kind: 'overlap', label: 'オーバーラップ' },
]

export function CameraCueDialog({
  state,
  cue,
  fps,
  frameMin,
  frameMax,
  instructionHistory,
  pointLabelHistory,
  onSubmit,
  onCancel,
}: {
  state: CameraCueDialogState
  cue: TimedRangeCue | null
  fps: number
  frameMin: number
  frameMax: number
  instructionHistory: string[]
  pointLabelHistory: string[]
  onSubmit: (input: CameraCueDialogSubmit) => void
  onCancel: () => void
}) {
  const safeFps = Math.max(1, Math.round(fps))
  const frameStart = cue?.frameStart ?? state.frameStart
  const initialFrameEnd = cue?.frameEnd ?? state.frameEnd
  const initialDuration = Math.max(1, initialFrameEnd - frameStart + 1)
  const initialCamera = cue?.camera
  const initialPoints = resolveCameraInstructionPoints(initialCamera, frameStart, initialFrameEnd)
  const [segmentByEndPointId, setSegmentByEndPointId] = useState<Record<string, CameraInstructionSegment>>(
    () => Object.fromEntries(resolveCameraInstructionSegments(initialCamera, frameStart, initialFrameEnd, initialPoints)
      .map(item => [item.endPointId, item])),
  )
  const [label, setLabel] = useState(cue?.label ?? '')
  const [startLabel, setStartLabel] = useState(initialPoints.find(point => point.role === 'start')?.label ?? '')
  const [endLabel, setEndLabel] = useState(initialPoints.find(point => point.role === 'end')?.label ?? '')
  const [intermediatePoints, setIntermediatePoints] = useState<CameraInstructionPoint[]>(
    initialPoints.filter(point => point.role === 'intermediate'),
  )
  const [durationFrames, setDurationFrames] = useState(initialDuration)
  const [labelPlacement, setLabelPlacement] = useState(initialCamera?.labelPlacement)
  const instructionInputRef = useRef<HTMLInputElement>(null)
  const maxDuration = Math.max(1, frameMax - frameStart + 1)
  const minimumDuration = Math.max(1, ...intermediatePoints.map(point => point.frameOffset + 2))
  const frameEnd = frameStart + durationFrames - 1
  const occupiedOffsets = useMemo(() => new Set([0, durationFrames - 1, ...intermediatePoints.map(point => point.frameOffset)]), [durationFrames, intermediatePoints])
  const canAddIntermediate = durationFrames >= 3 && occupiedOffsets.size < durationFrames
  const pointCount = (startLabel.trim() ? 1 : 0)
    + intermediatePoints.filter(point => point.label.trim()).length
    + (endLabel.trim() ? 1 : 0)
  const tooManyPointLabels = pointCount > durationFrames

  useEffect(() => {
    instructionInputRef.current?.focus()
    instructionInputRef.current?.select()
  }, [])

  useEffect(() => {
    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onCancel()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onCancel])

  function updateInstruction(value: string) {
    setLabel(value)
    if (state.mode !== 'create') return
    const suggestedKind = suggestedKindForInstruction(value)
    if (!suggestedKind) return
    const firstTarget = intermediatePoints[0]?.pointId ?? CAMERA_INSTRUCTION_CUE_END_POINT_ID
    updateSegment(firstTarget, suggestedKind, frameStart, segmentEndFrame(firstTarget))
  }

  function updateDuration(nextDuration: number) {
    setDurationFrames(Math.max(minimumDuration, Math.min(maxDuration, Math.round(nextDuration))))
  }

  function addIntermediatePoint() {
    const offset = largestAvailableGapMidpoint(durationFrames, occupiedOffsets)
    if (offset === null) return
    const pointId = nextPointId(intermediatePoints)
    const nextTargetId = intermediatePoints.find(point => point.frameOffset > offset)?.pointId
      ?? CAMERA_INSTRUCTION_CUE_END_POINT_ID
    setSegmentByEndPointId(current => ({
      ...current,
      [pointId]: {
        ...(current[nextTargetId] ?? { endPointId: nextTargetId, kind: cameraSegmentKindForLegacyInstruction(initialCamera) }),
        endPointId: pointId,
      },
    }))
    setIntermediatePoints(current => [...current, {
      pointId,
      role: 'intermediate' as const,
      frameOffset: offset,
      label: '',
    }].sort((left, right) => left.frameOffset - right.frameOffset))
  }

  function updateIntermediatePoint(pointId: string, updates: Partial<Pick<CameraInstructionPoint, 'frameOffset' | 'label'>>) {
    setIntermediatePoints(current => current.map(point => point.pointId === pointId ? { ...point, ...updates } : point)
      .sort((left, right) => left.frameOffset - right.frameOffset))
  }

  function removeIntermediatePoint(pointId: string) {
    setIntermediatePoints(current => current.filter(item => item.pointId !== pointId))
    setSegmentByEndPointId(current => {
      const remaining = { ...current }
      delete remaining[pointId]
      return remaining
    })
  }

  function segmentEndFrame(endPointId: string): number {
    const point = intermediatePoints.find(item => item.pointId === endPointId)
    return point ? frameStart + point.frameOffset - 1 : frameEnd
  }

  function segmentStartFrame(endPointId: string): number {
    const targetIndex = intermediatePoints.findIndex(item => item.pointId === endPointId)
    if (targetIndex < 0) return intermediatePoints.length
      ? frameStart + intermediatePoints.at(-1)!.frameOffset
      : frameStart
    return targetIndex === 0 ? frameStart : frameStart + intermediatePoints[targetIndex - 1]!.frameOffset
  }

  function resolvedSegment(endPointId: string): CameraInstructionSegment {
    return segmentByEndPointId[endPointId] ?? {
      endPointId,
      kind: cameraSegmentKindForLegacyInstruction(initialCamera),
    }
  }

  function updateSegment(endPointId: string, kind: CameraInstructionSegmentKind, start: number, end: number, pivotAnchorFrame?: number) {
    setSegmentByEndPointId(current => ({
      ...current,
      [endPointId]: {
        endPointId,
        kind,
        pivotAnchorFrame: kind === 'overlap'
          ? clampCameraOverlapPivotAnchorFrame(
              pivotAnchorFrame ?? current[endPointId]?.pivotAnchorFrame ?? defaultCameraOverlapPivotAnchorFrame(start, end),
              start,
              end,
            )
          : undefined,
      },
    }))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedLabel = label.trim()
    const submittedIntermediatePoints = intermediatePoints.map(point => ({ ...point, label: point.label.trim() }))
    const points: CameraInstructionPoint[] = [
      ...(startLabel.trim() ? [{ pointId: 'point_start', role: 'start' as const, frameOffset: 0, label: startLabel.trim() }] : []),
      ...submittedIntermediatePoints,
      ...(endLabel.trim() ? [{ pointId: 'point_end', role: 'end' as const, frameOffset: durationFrames - 1, label: endLabel.trim() }] : []),
    ]
    const segmentTargetIds = [...submittedIntermediatePoints.map(point => point.pointId), CAMERA_INSTRUCTION_CUE_END_POINT_ID]
    const segments = segmentTargetIds.map(endPointId => {
      const segment = resolvedSegment(endPointId)
      const start = segmentStartFrame(endPointId)
      const end = segmentEndFrame(endPointId)
      return {
        ...segment,
        endPointId,
        pivotAnchorFrame: segment.kind === 'overlap'
          ? clampCameraOverlapPivotAnchorFrame(segment.pivotAnchorFrame ?? defaultCameraOverlapPivotAnchorFrame(start, end), start, end)
          : undefined,
      }
    })
    const firstKind = segments[0]?.kind ?? 'straight'
    const allRange = segments.every(segment => segment.kind === 'straight' || segment.kind === 'wave')
    onSubmit({
      cueId: state.cueId,
      laneId: state.laneId,
      frameStart,
      frameEnd,
      label: normalizedLabel,
      camera: {
        shape: shapeForCameraSegmentKind(firstKind),
        pathStyle: firstKind === 'straight' || firstKind === 'wave' ? firstKind : undefined,
        segmentStyles: allRange ? segments.map(segment => ({ endPointId: segment.endPointId, style: segment.kind as CameraInstructionPathStyle })) : undefined,
        segments,
        points,
        pivotAnchorFrame: segments.length === 1 && firstKind === 'overlap' ? segments[0]?.pivotAnchorFrame : undefined,
        labelPlacement,
      },
    })
  }

  return (
    <div className="assetQuickPreviewBackdrop soundCueDialogBackdrop" role="dialog" aria-modal="true" aria-label="撮影指示" onPointerDown={onCancel}>
      <form className="soundCueDialog cameraCueDialog" onSubmit={submit} onPointerDown={event => event.stopPropagation()}>
        <header className="soundCueDialogHeader">
          <strong>撮影指示</strong>
          <button type="button" className="dialogIconButton" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="soundCueDialogBody cameraCueDialogBody">
          <label>
            <span>指示</span>
            <HistoryInput
              inputRef={instructionInputRef}
              aria-label="CAMERA指示"
              value={label}
              onChange={event => updateInstruction(event.currentTarget.value)}
              history={instructionHistory}
              pinned={CAMERA_INSTRUCTION_BUILT_INS}
              historyLimit={CAMERA_INSTRUCTION_HISTORY_LIMIT}
              placeholder="PAN、TU、OLなど"
            />
          </label>
          <div className="timedRangeDialogTimingRow">
            <span><small>開始</small>{formatLogicalSheetFrameTimecode(frameStart, frameMin, safeFps)}</span>
            <span><small>終了</small>{formatLogicalSheetFrameTimecode(frameEnd, frameMin, safeFps)}</span>
            <DurationFrameControl frames={durationFrames} fps={safeFps} maxFrames={maxDuration} label="長さ" onChange={updateDuration} />
          </div>
          <div className="cameraPointEditor">
            <PointLabelRow
              kindLabel="開始ラベル"
              ariaLabel="CAMERA開始ラベル"
              value={startLabel}
              history={pointLabelHistory}
              onChange={setStartLabel}
            >
              <SegmentKindControl
                value={resolvedSegment(intermediatePoints[0]?.pointId ?? CAMERA_INSTRUCTION_CUE_END_POINT_ID)}
                label="開始から次の点まで"
                frameStart={frameStart}
                frameEnd={segmentEndFrame(intermediatePoints[0]?.pointId ?? CAMERA_INSTRUCTION_CUE_END_POINT_ID)}
                frameMin={frameMin}
                fps={safeFps}
                onChange={segment => setSegmentByEndPointId(current => ({ ...current, [segment.endPointId]: segment }))}
              />
            </PointLabelRow>
            {intermediatePoints.map((point, index) => {
              const previous = intermediatePoints[index - 1]?.frameOffset ?? 0
              const next = intermediatePoints[index + 1]?.frameOffset ?? durationFrames - 1
              return (
                <div className="cameraIntermediatePointRow" key={point.pointId}>
                    <span>中間ラベル</span>
                    <HistoryInput
                      aria-label={`CAMERA中間ラベル${index + 1}`}
                      value={point.label}
                      history={pointLabelHistory}
                      historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT}
                      placeholder="任意"
                      onChange={event => updateIntermediatePoint(point.pointId, { label: event.currentTarget.value })}
                    />
                    <input
                      className="cameraPointFrameInput"
                      type="number"
                      aria-label={`CAMERA中間ラベル${index + 1}位置`}
                      min={frameStart + previous + 1}
                      max={frameStart + next - 1}
                      value={frameStart + point.frameOffset}
                      onChange={event => updateIntermediatePoint(point.pointId, {
                        frameOffset: Math.max(previous + 1, Math.min(next - 1, Math.round(Number(event.currentTarget.value)) - frameStart)),
                      })}
                    />
                    <SegmentKindControl
                      value={resolvedSegment(intermediatePoints[index + 1]?.pointId ?? CAMERA_INSTRUCTION_CUE_END_POINT_ID)}
                      label={`中間ラベル${index + 1}から次の点まで`}
                      frameStart={frameStart + point.frameOffset}
                      frameEnd={segmentEndFrame(intermediatePoints[index + 1]?.pointId ?? CAMERA_INSTRUCTION_CUE_END_POINT_ID)}
                      frameMin={frameMin}
                      fps={safeFps}
                      onChange={segment => setSegmentByEndPointId(current => ({ ...current, [segment.endPointId]: segment }))}
                    />
                    <button type="button" className="dialogIconButton compact" aria-label={`中間ラベル${index + 1}を削除`} onClick={() => removeIntermediatePoint(point.pointId)}>×</button>
                  </div>
              )
            })}
            <PointLabelRow
              kindLabel="終了ラベル"
              ariaLabel="CAMERA終了ラベル"
              value={endLabel}
              history={pointLabelHistory}
              onChange={setEndLabel}
            />
            <button type="button" className="cameraAddPointButton" disabled={!canAddIntermediate} onClick={addIntermediatePoint}>＋ 中間ラベル</button>
            {tooManyPointLabels && <span className="cameraPointValidation" role="alert">位置ラベル数を区間のコマ数以下にしてください。</span>}
          </div>
          {labelPlacement && (
            <div className="cameraCueManualPlacementNotice">
              <span>シート上のラベル位置を使用中</span>
              <button type="button" onClick={() => setLabelPlacement(undefined)}>自動配置に戻す</button>
            </div>
          )}
        </div>
        <footer className="soundCueDialogFooter">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="primaryButton" disabled={tooManyPointLabels}>{state.mode === 'edit' ? '更新' : '追加'}</button>
        </footer>
      </form>
    </div>
  )
}

function PointLabelRow({ kindLabel, ariaLabel, value, history, onChange, children }: {
  kindLabel: string
  ariaLabel: string
  value: string
  history: string[]
  onChange: (value: string) => void
  children?: ReactNode
}) {
  return (
    <div className="cameraPointLabelRow">
      <span>{kindLabel}</span>
      <HistoryInput
        aria-label={ariaLabel}
        value={value}
        history={history}
        historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT}
        placeholder="任意"
        onChange={event => onChange(event.currentTarget.value)}
      />
      {children}
    </div>
  )
}

function SegmentKindControl({ value, label, frameStart, frameEnd, frameMin, fps, onChange }: {
  value: CameraInstructionSegment
  label: string
  frameStart: number
  frameEnd: number
  frameMin: number
  fps: number
  onChange: (value: CameraInstructionSegment) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const option = segmentOptions.find(item => item.kind === value.kind) ?? segmentOptions[0]!
  const pivotMax = (frameEnd - frameStart + 1) % 2 === 0 ? Math.max(frameStart, frameEnd - 1) : frameEnd
  const pivot = value.kind === 'overlap'
    ? clampCameraOverlapPivotAnchorFrame(value.pivotAnchorFrame ?? defaultCameraOverlapPivotAnchorFrame(frameStart, frameEnd), frameStart, frameEnd)
    : undefined

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setOpen(false)
    }
    window.addEventListener('pointerdown', closeOutside, true)
    return () => window.removeEventListener('pointerdown', closeOutside, true)
  }, [open])

  function choose(kind: CameraInstructionSegmentKind) {
    onChange({
      endPointId: value.endPointId,
      kind,
      pivotAnchorFrame: kind === 'overlap'
        ? clampCameraOverlapPivotAnchorFrame(pivot ?? defaultCameraOverlapPivotAnchorFrame(frameStart, frameEnd), frameStart, frameEnd)
        : undefined,
    })
    if (kind !== 'overlap') setOpen(false)
  }

  return (
    <div ref={rootRef} className="cameraSegmentKindControl">
      <button
        type="button"
        className="cameraSegmentKindTrigger"
        aria-label={`${label}：${option.label}`}
        aria-expanded={open}
        onClick={event => { event.preventDefault(); setOpen(current => !current) }}
      >
        <CameraSegmentIcon kind={value.kind} />
      </button>
      {open && (
        <div className="cameraSegmentKindPopover" role="radiogroup" aria-label={`${label}の図形`}>
          <div className="cameraSegmentKindOptions">
            {segmentOptions.map(item => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-label={`${label}を${item.label}`}
                aria-checked={value.kind === item.kind}
                className={value.kind === item.kind ? 'selected' : ''}
                onClick={event => { event.preventDefault(); choose(item.kind) }}
              >
                <CameraSegmentIcon kind={item.kind} />
              </button>
            ))}
          </div>
          {value.kind === 'overlap' && pivot !== undefined && (
            <label className="cameraSegmentPivotField">
              <span>交点</span>
              <input
                type="number"
                aria-label={`${label}の交差フレーム`}
                min={frameStart}
                max={pivotMax}
                value={pivot}
                onChange={event => onChange({ ...value, pivotAnchorFrame: clampCameraOverlapPivotAnchorFrame(Number(event.currentTarget.value), frameStart, frameEnd) })}
              />
              <output>{formatLogicalSheetFrameTimecode(pivot, frameMin, fps)}</output>
            </label>
          )}
        </div>
      )}
    </div>
  )
}

function CameraSegmentIcon({ kind }: { kind: CameraInstructionSegmentKind }) {
  if (kind === 'straight' || kind === 'wave') return (
    <svg className="cameraRangeShapeIcon" viewBox="0 0 36 24" aria-hidden="true">
      <polygon points="12,2 24,2 18,7" />
      <path d={kind === 'wave'
        ? 'M18 7C24 7.833 24 8.667 18 9.5C12 10.333 12 11.167 18 12C24 12.833 24 13.667 18 14.5C12 15.333 12 16.167 18 17'
        : 'M18 7V17'} />
      <polygon points="12,22 24,22 18,17" />
    </svg>
  )
  if (kind === 'fade-in') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M18 3L6 21h24Z" /></svg>
  if (kind === 'fade-out') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M6 3h24L18 21Z" /></svg>
  return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M7 3H29L18 12Z M7 21H29L18 12Z" /></svg>
}

function suggestedKindForInstruction(value: string): CameraInstructionSegmentKind | null {
  const normalized = value.trim().toLocaleUpperCase('ja-JP')
  if (normalized === 'OL') return 'overlap'
  if (normalized === 'FI' || normalized === 'WI') return 'fade-in'
  if (normalized === 'FO' || normalized === 'WO') return 'fade-out'
  if (CAMERA_INSTRUCTION_BUILT_INS.some(item => item.toLocaleUpperCase('ja-JP') === normalized)) return 'straight'
  return null
}

function largestAvailableGapMidpoint(duration: number, occupied: Set<number>): number | null {
  const sorted = [...occupied].filter(offset => offset >= 0 && offset < duration).sort((left, right) => left - right)
  let best: { start: number; end: number } | null = null
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const start = sorted[index]!
    const end = sorted[index + 1]!
    if (end - start <= 1) continue
    if (!best || end - start > best.end - best.start) best = { start, end }
  }
  return best ? Math.floor((best.start + best.end) / 2) : null
}

function nextPointId(points: readonly CameraInstructionPoint[]): string {
  let index = 1
  const used = new Set(points.map(point => point.pointId))
  while (used.has(`point_${index}`)) index += 1
  return `point_${index}`
}
