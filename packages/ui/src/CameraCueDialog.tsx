import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  defaultCameraOverlapPivotAnchorFrame,
  formatLogicalSheetFrameTimecode,
  resolveCameraInstructionPoints,
  type CameraInstruction,
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
import { Tooltip } from './Tooltip'

export interface CameraCueDialogSubmit {
  cueId?: string
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
  camera: CameraInstruction
}

const shapeOptions: Array<{ value: CameraInstructionShape; label: string }> = [
  { value: 'range', label: '区間指示' },
  { value: 'fade-in', label: 'フェードイン・ワイプイン' },
  { value: 'fade-out', label: 'フェードアウト・ワイプアウト' },
  { value: 'overlap', label: 'オーバーラップ' },
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
  const initialPivotAnchor = initialCamera?.pivotAnchorFrame
    ?? defaultCameraOverlapPivotAnchorFrame(frameStart, initialFrameEnd)
  const [shape, setShape] = useState<CameraInstructionShape>(initialCamera?.shape ?? 'range')
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

  function updateDuration(nextDuration: number) {
    setDurationFrames(Math.max(minimumDuration, Math.min(maxDuration, Math.round(nextDuration))))
  }

  function addIntermediatePoint() {
    const offset = largestAvailableGapMidpoint(durationFrames, occupiedOffsets)
    if (offset === null) return
    setIntermediatePoints(current => [...current, {
      pointId: nextPointId(current),
      role: 'intermediate' as const,
      frameOffset: offset,
      label: '',
    }].sort((left, right) => left.frameOffset - right.frameOffset))
  }

  function updateIntermediatePoint(pointId: string, updates: Partial<Pick<CameraInstructionPoint, 'frameOffset' | 'label'>>) {
    setIntermediatePoints(current => current.map(point => point.pointId === pointId ? { ...point, ...updates } : point)
      .sort((left, right) => left.frameOffset - right.frameOffset))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedLabel = label.trim()
    if (!normalizedLabel) {
      instructionInputRef.current?.focus()
      return
    }
    const points: CameraInstructionPoint[] = [
      ...(startLabel.trim() ? [{ pointId: 'point_start', role: 'start' as const, frameOffset: 0, label: startLabel.trim() }] : []),
      ...intermediatePoints.filter(point => point.label.trim()).map(point => ({ ...point, label: point.label.trim() })),
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
              <Tooltip key={option.value} label={option.label}>
                <button
                  type="button"
                  className={shape === option.value ? 'cameraShapeButton selected' : 'cameraShapeButton'}
                  role="radio"
                  aria-label={option.label}
                  aria-checked={shape === option.value}
                  onClick={() => setShape(option.value)}
                >
                  <CameraShapeIcon shape={option.value} />
                </button>
              </Tooltip>
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
              required
              placeholder="PAN、TU、OLなど"
            />
          </label>
          <div className="cameraCueTimingRow">
            <span><small>開始</small>{formatLogicalSheetFrameTimecode(frameStart, frameMin, safeFps)}</span>
            <span><small>終了</small>{formatLogicalSheetFrameTimecode(frameEnd, frameMin, safeFps)}</span>
            <DurationFrameControl frames={durationFrames} fps={safeFps} maxFrames={maxDuration} onChange={updateDuration} />
          </div>
          <div className="cameraPointEditor">
            <PointLabelRow
              kindLabel="開始点"
              ariaLabel="CAMERA開始点"
              value={startLabel}
              history={pointLabelHistory}
              onChange={setStartLabel}
            />
            {intermediatePoints.map((point, index) => {
              const previous = intermediatePoints[index - 1]?.frameOffset ?? 0
              const next = intermediatePoints[index + 1]?.frameOffset ?? durationFrames - 1
              return (
                <div className="cameraIntermediatePointRow" key={point.pointId}>
                  <span>中間点</span>
                  <span className="cameraPointPosition">
                    <input
                      type="number"
                      aria-label={`CAMERA中間点${index + 1}位置`}
                      min={frameStart + previous + 1}
                      max={frameStart + next - 1}
                      value={frameStart + point.frameOffset}
                      onChange={event => updateIntermediatePoint(point.pointId, {
                        frameOffset: Math.max(previous + 1, Math.min(next - 1, Math.round(Number(event.currentTarget.value)) - frameStart)),
                      })}
                    />
                    <output>{formatLogicalSheetFrameTimecode(frameStart + point.frameOffset, frameMin, safeFps)}</output>
                  </span>
                  <HistoryInput
                    aria-label={`CAMERA中間点${index + 1}`}
                    value={point.label}
                    history={pointLabelHistory}
                    historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT}
                    onChange={event => updateIntermediatePoint(point.pointId, { label: event.currentTarget.value })}
                  />
                  <button type="button" className="dialogIconButton compact" aria-label={`中間点${index + 1}を削除`} onClick={() => setIntermediatePoints(current => current.filter(item => item.pointId !== point.pointId))}>×</button>
                </div>
              )
            })}
            <button type="button" className="cameraAddPointButton" disabled={!canAddIntermediate} onClick={addIntermediatePoint}>＋ 中間点</button>
            <PointLabelRow
              kindLabel="終了点"
              ariaLabel="CAMERA終了点"
              value={endLabel}
              history={pointLabelHistory}
              onChange={setEndLabel}
            />
            {tooManyPointLabels && <span className="cameraPointValidation" role="alert">位置ラベル数を尺のコマ数以下にしてください。</span>}
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
        onChange={event => onChange(event.currentTarget.value)}
      />
    </label>
  )
}

function CameraShapeIcon({ shape }: { shape: CameraInstructionShape }) {
  if (shape === 'range') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M18 4v16M14 7l4-4 4 4M14 17l4 4 4-4" /></svg>
  if (shape === 'fade-in') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M18 3L6 21h24Z" /></svg>
  if (shape === 'fade-out') return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M6 3h24L18 21Z" /></svg>
  return <svg viewBox="0 0 36 24" aria-hidden="true"><path d="M7 3l22 18M29 3L7 21M12 12h12" /></svg>
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
