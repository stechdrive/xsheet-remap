import { Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  CAMERA_INSTRUCTION_CUE_END_POINT_ID,
  defaultCameraOverlapPivotAnchorFrame,
  formatLogicalSheetFrameTimecode,
  resolveCameraInstructionPoints,
  resolveCameraInstructionSegmentStyles,
  type CameraInstruction,
  type CameraInstructionPathStyle,
  type CameraInstructionPoint,
  type CameraInstructionShape,
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

type CameraShapeOption = {
  id: string
  shape: CameraInstructionShape
  pathStyle?: CameraInstructionPathStyle
  label: string
}

const shapeOptions: CameraShapeOption[] = [
  { id: 'range-straight', shape: 'range', pathStyle: 'straight', label: '直線の区間指示' },
  { id: 'range-wave', shape: 'range', pathStyle: 'wave', label: '波線の区間指示' },
  { id: 'fade-in', shape: 'fade-in', label: 'フェードイン・ワイプイン' },
  { id: 'fade-out', shape: 'fade-out', label: 'フェードアウト・ワイプアウト' },
  { id: 'overlap', shape: 'overlap', label: 'オーバーラップ' },
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
  const initialPathStyle: CameraInstructionPathStyle = initialCamera?.pathStyle === 'wave' ? 'wave' : 'straight'
  const initialPivotAnchor = initialCamera?.pivotAnchorFrame
    ?? defaultCameraOverlapPivotAnchorFrame(frameStart, initialFrameEnd)
  const [shape, setShape] = useState<CameraInstructionShape>(initialCamera?.shape ?? 'range')
  const [pathStyle, setPathStyle] = useState<CameraInstructionPathStyle>(initialPathStyle)
  const [segmentStyleByEndPointId, setSegmentStyleByEndPointId] = useState<Record<string, CameraInstructionPathStyle>>(
    () => Object.fromEntries(resolveCameraInstructionSegmentStyles(initialCamera, frameStart, initialFrameEnd, initialPoints)
      .map(item => [item.endPointId, item.style])),
  )
  const [label, setLabel] = useState(cue?.label ?? '')
  const [startLabel, setStartLabel] = useState(initialPoints.find(point => point.role === 'start')?.label ?? '')
  const [endLabel, setEndLabel] = useState(initialPoints.find(point => point.role === 'end')?.label ?? '')
  const [intermediatePoints, setIntermediatePoints] = useState<CameraInstructionPoint[]>(
    initialPoints.filter(point => point.role === 'intermediate'),
  )
  const [durationFrames, setDurationFrames] = useState(initialDuration)
  const [pivotAnchorOffset, setPivotAnchorOffset] = useState(Math.max(0, initialPivotAnchor - frameStart))
  const [labelPlacement, setLabelPlacement] = useState(initialCamera?.labelPlacement)
  const instructionInputRef = useRef<HTMLInputElement>(null)
  const maxDuration = Math.max(1, frameMax - frameStart + 1)
  const minimumDuration = Math.max(1, ...intermediatePoints.map(point => point.frameOffset + 2))
  const frameEnd = frameStart + durationFrames - 1
  const evenDuration = durationFrames % 2 === 0
  const pivotAnchorMax = evenDuration ? Math.max(frameStart, frameEnd - 1) : frameEnd
  const pivotAnchorFrame = Math.max(frameStart, Math.min(pivotAnchorMax, frameStart + pivotAnchorOffset))
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
    const suggestedShape = suggestedShapeForInstruction(value)
    if (suggestedShape) setShape(suggestedShape)
  }

  function selectShapeOption(option: CameraShapeOption) {
    setShape(option.shape)
    if (option.shape !== 'range' || !option.pathStyle) return
    setPathStyle(option.pathStyle)
    setSegmentStyleByEndPointId({})
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
    setSegmentStyleByEndPointId(current => ({
      ...current,
      [pointId]: current[nextTargetId] ?? pathStyle,
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
    setSegmentStyleByEndPointId(current => {
      const remaining = { ...current }
      delete remaining[pointId]
      return remaining
    })
  }

  function segmentStyle(endPointId: string): CameraInstructionPathStyle {
    return segmentStyleByEndPointId[endPointId] ?? pathStyle
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedLabel = label.trim()
    const submittedIntermediatePoints = intermediatePoints
      .filter(point => point.label.trim())
      .map(point => ({ ...point, label: point.label.trim() }))
    const points: CameraInstructionPoint[] = [
      ...(startLabel.trim() ? [{ pointId: 'point_start', role: 'start' as const, frameOffset: 0, label: startLabel.trim() }] : []),
      ...submittedIntermediatePoints,
      ...(endLabel.trim() ? [{ pointId: 'point_end', role: 'end' as const, frameOffset: durationFrames - 1, label: endLabel.trim() }] : []),
    ]
    onSubmit({
      cueId: state.cueId,
      laneId: state.laneId,
      frameStart,
      frameEnd,
      label: normalizedLabel,
      camera: {
        shape,
        pathStyle: shape === 'range' ? pathStyle : undefined,
        segmentStyles: shape === 'range'
          ? [...submittedIntermediatePoints.map(point => point.pointId), CAMERA_INSTRUCTION_CUE_END_POINT_ID]
              .map(endPointId => ({ endPointId, style: segmentStyle(endPointId) }))
          : undefined,
        points,
        pivotAnchorFrame: shape === 'overlap' ? pivotAnchorFrame : undefined,
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
          <div className="cameraShapePicker" role="radiogroup" aria-label="CAMERA描画種別">
            {shapeOptions.map(option => (
              <button
                key={option.id}
                type="button"
                className={shape === option.shape && (option.shape !== 'range' || pathStyle === option.pathStyle) ? 'cameraShapeButton selected' : 'cameraShapeButton'}
                role="radio"
                aria-label={option.label}
                aria-checked={shape === option.shape && (option.shape !== 'range' || pathStyle === option.pathStyle)}
                onClick={() => selectShapeOption(option)}
              >
                <CameraShapeIcon option={option} />
              </button>
            ))}
          </div>
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
            />
            {intermediatePoints.map((point, index) => {
              const previous = intermediatePoints[index - 1]?.frameOffset ?? 0
              const next = intermediatePoints[index + 1]?.frameOffset ?? durationFrames - 1
              const fromName = index === 0
                ? '開始'
                : pointConnectionName(intermediatePoints[index - 1]?.label, `中間${index}`)
              const toName = pointConnectionName(point.label, `中間${index + 1}`)
              return (
                <Fragment key={point.pointId}>
                  {shape === 'range' && (
                    <ConnectionStyleRow
                      from={fromName}
                      to={toName}
                      value={segmentStyle(point.pointId)}
                      label={`${index === 0 ? '開始' : `中間ラベル${index}`}から中間ラベル${index + 1}まで`}
                      onChange={style => setSegmentStyleByEndPointId(current => ({ ...current, [point.pointId]: style }))}
                    />
                  )}
                  <div className="cameraIntermediatePointRow">
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
                    <button type="button" className="dialogIconButton compact" aria-label={`中間ラベル${index + 1}を削除`} onClick={() => removeIntermediatePoint(point.pointId)}>×</button>
                  </div>
                </Fragment>
              )
            })}
            {shape === 'range' && intermediatePoints.length > 0 && (
              <ConnectionStyleRow
                from={pointConnectionName(intermediatePoints.at(-1)?.label, `中間${intermediatePoints.length}`)}
                to="終了"
                value={segmentStyle(CAMERA_INSTRUCTION_CUE_END_POINT_ID)}
                label={`中間ラベル${intermediatePoints.length}から終了まで`}
                onChange={style => setSegmentStyleByEndPointId(current => ({ ...current, [CAMERA_INSTRUCTION_CUE_END_POINT_ID]: style }))}
              />
            )}
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
          {shape === 'overlap' && (
            <label className="cameraPivotField">
              <span>交点</span>
              <input
                type="number"
                aria-label="CAMERA交差フレーム"
                min={frameStart}
                max={pivotAnchorMax}
                value={pivotAnchorFrame}
                onChange={event => setPivotAnchorOffset(Math.round(Number(event.currentTarget.value)) - frameStart)}
              />
              <output>{formatLogicalSheetFrameTimecode(pivotAnchorFrame, frameMin, safeFps)}</output>
            </label>
          )}
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

function PointLabelRow({ kindLabel, ariaLabel, value, history, onChange }: {
  kindLabel: string
  ariaLabel: string
  value: string
  history: string[]
  onChange: (value: string) => void
}) {
  return (
    <label className="cameraPointLabelRow">
      <span>{kindLabel}</span>
      <HistoryInput
        aria-label={ariaLabel}
        value={value}
        history={history}
        historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT}
        placeholder="任意"
        onChange={event => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function ConnectionStyleRow({ from, to, value, label, onChange }: {
  from: string
  to: string
  value: CameraInstructionPathStyle
  label: string
  onChange: (value: CameraInstructionPathStyle) => void
}) {
  return (
    <div className="cameraConnectionStyleRow">
      <span className="cameraConnectionRelation">{from}<span aria-hidden="true"> → </span>{to}</span>
      <ConnectionStyleControl value={value} label={label} onChange={onChange} />
    </div>
  )
}

function ConnectionStyleControl({ value, label, onChange }: {
  value: CameraInstructionPathStyle
  label: string
  onChange: (value: CameraInstructionPathStyle) => void
}) {
  return (
    <span className="cameraConnectionStyleControl" role="radiogroup" aria-label={`${label}の線`}>
      <button type="button" role="radio" aria-label={`${label}を直線`} aria-checked={value === 'straight'} className={value === 'straight' ? 'selected' : ''} onClick={() => onChange('straight')}>
        <ConnectionStyleIcon style="straight" />
      </button>
      <button type="button" role="radio" aria-label={`${label}を波線`} aria-checked={value === 'wave'} className={value === 'wave' ? 'selected' : ''} onClick={() => onChange('wave')}>
        <ConnectionStyleIcon style="wave" />
      </button>
    </span>
  )
}

function ConnectionStyleIcon({ style }: { style: CameraInstructionPathStyle }) {
  return style === 'straight'
    ? <svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 2V18" /></svg>
    : <svg viewBox="0 0 16 20" aria-hidden="true"><path d="M8 2C12 3.333 12 4.667 8 6C4 7.333 4 8.667 8 10C12 11.333 12 12.667 8 14C4 15.333 4 16.667 8 18" /></svg>
}

function pointConnectionName(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback
}

function CameraShapeIcon({ option }: { option: CameraShapeOption }) {
  if (option.shape === 'range') return (
    <svg className="cameraRangeShapeIcon" viewBox="0 0 36 24" aria-hidden="true">
      <polygon points="12,2 24,2 18,7" />
      <path d={option.pathStyle === 'wave'
        ? 'M18 7C24 7.833 24 8.667 18 9.5C12 10.333 12 11.167 18 12C24 12.833 24 13.667 18 14.5C12 15.333 12 16.167 18 17'
        : 'M18 7V17'} />
      <polygon points="12,22 24,22 18,17" />
    </svg>
  )
  if (option.shape === 'fade-in') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M18 3L6 21h24Z" /></svg>
  if (option.shape === 'fade-out') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M6 3h24L18 21Z" /></svg>
  return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M7 3H29L18 12Z M7 21H29L18 12Z" /></svg>
}

function suggestedShapeForInstruction(value: string): CameraInstructionShape | null {
  const normalized = value.trim().toLocaleUpperCase('ja-JP')
  if (normalized === 'OL') return 'overlap'
  if (normalized === 'FI' || normalized === 'WI') return 'fade-in'
  if (normalized === 'FO' || normalized === 'WO') return 'fade-out'
  if (CAMERA_INSTRUCTION_BUILT_INS.some(item => item.toLocaleUpperCase('ja-JP') === normalized)) return 'range'
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
