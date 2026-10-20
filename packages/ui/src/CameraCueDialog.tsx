import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  cameraInstructionIntervals, cameraIntervalDivisionLengths, changeCameraIntervalDuration,
  clampCameraOverlapPivotAnchorFrame, defaultCameraOverlapPivotAnchorFrame, divideCameraInstruction,
  formatLogicalSheetFrameTimecode, removeCameraInstructionBoundary, resizeCameraInstruction,
  resolveCameraInstructionPoints, resolveCameraInstructionSegments, scaleCameraInstruction, shapeForCameraSegmentKind,
  type CameraInstruction, type CameraInstructionRange, type CameraInstructionSegment, type CameraInstructionSegmentKind, type TimedRangeCue,
} from '@xsheet-remap/core'
import type { CameraCueDialogState } from './appTypes'
import { CAMERA_INSTRUCTION_BUILT_INS, CAMERA_INSTRUCTION_HISTORY_LIMIT, CAMERA_POINT_LABEL_HISTORY_LIMIT } from './cameraCueEditing'
import { CompactDurationFrameControl, DurationFrameControl } from './DurationFrameControl'
import { HistoryInput } from './HistoryInput'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

export interface CameraCueDialogSubmit {
  cueId?: string
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
  camera: CameraInstruction
}

const segmentOptions: { id: string; kind: CameraInstructionSegmentKind; label: string }[] = [
  { id: 'straight', kind: 'straight', label: '直線の区間指示' },
  { id: 'wave', kind: 'wave', label: '波線の区間指示' },
  { id: 'fade-in', kind: 'fade-in', label: 'フェードイン・ワイプイン' },
  { id: 'fade-out', kind: 'fade-out', label: 'フェードアウト・ワイプアウト' },
  { id: 'overlap', kind: 'overlap', label: 'オーバーラップ' },
]

type IntervalAction = 'frames' | 'count' | 'at' | 'ripple' | 'scale'

export function CameraCueDialog({
  state, cue, fps, frameMin, frameMax, instructionHistory, pointLabelHistory, onSubmit, onCancel,
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
  const [draft, setDraft] = useState<CameraInstructionRange>(() => ({
    camera: cue?.camera ?? { shape: 'range', points: [] },
    frameStart: cue?.frameStart ?? state.frameStart,
    frameEnd: cue?.frameEnd ?? state.frameEnd,
  }))
  const [label, setLabel] = useState(cue?.label ?? '')
  const initialPoints = resolveCameraInstructionPoints(cue?.camera, draft.frameStart, draft.frameEnd)
  const [startLabel, setStartLabel] = useState(initialPoints.find(point => point.role === 'start')?.label ?? '')
  const [endLabel, setEndLabel] = useState(initialPoints.find(point => point.role === 'end')?.label ?? '')
  const [toolsOpen, setToolsOpen] = useState(false)
  const [toolTarget, setToolTarget] = useState('all')
  const [action, setAction] = useState<IntervalAction>('frames')
  const [actionValue, setActionValue] = useState(12)
  const instructionInputRef = useRef<HTMLInputElement>(null)
  const intervalToolsRef = useRef<HTMLDetailsElement>(null)
  const dialogRef = useModalDialogKeyboardBoundary<HTMLDivElement>(onCancel)
  const intervals = cameraInstructionIntervals(draft)
  const points = resolveCameraInstructionPoints(draft.camera, draft.frameStart, draft.frameEnd)
  const duration = draft.frameEnd - draft.frameStart + 1
  const maxDuration = frameMax - draft.frameStart + 1
  const target = intervals.find(item => item.endPointId === toolTarget)
  const targetDuration = target?.durationFrames ?? duration
  const valueIsInteger = Number.isInteger(actionValue) && actionValue >= 1
  const lengths = action === 'frames' || action === 'count' || action === 'at'
    ? cameraIntervalDivisionLengths(targetDuration, { mode: action, value: actionValue }) : []
  const validAction = valueIsInteger && (action === 'scale'
    ? actionValue >= intervals.length && actionValue <= maxDuration
    : action === 'ripple' ? Boolean(target && duration - target.durationFrames + actionValue <= maxDuration)
      : lengths.length >= 2 && (toolTarget === 'all' || Boolean(target)))
  const preview = validAction
    ? action === 'scale' ? scaleCameraInstruction(draft, actionValue)
      : action === 'ripple' ? changeCameraIntervalDuration(draft, toolTarget, actionValue, 'ripple', frameMax)
        : divideCameraInstruction(draft, toolTarget === 'all' ? null : toolTarget, { mode: action, value: actionValue })
    : null
  const previewIntervals = preview ? cameraInstructionIntervals(preview) : []

  useEffect(() => {
    instructionInputRef.current?.focus()
    instructionInputRef.current?.select()
  }, [])

  useEffect(() => {
    if (toolsOpen) intervalToolsRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [toolsOpen, toolTarget])

  function updateSegment(segment: CameraInstructionSegment) {
    setDraft(current => {
      const segments = resolveCameraInstructionSegments(current.camera, current.frameStart, current.frameEnd)
        .map(item => item.endPointId === segment.endPointId ? segment : item)
      return { ...current, camera: { ...current.camera, segments, shape: shapeForCameraSegmentKind(segments[0]!.kind) } }
    })
  }

  function updateInstruction(value: string) {
    setLabel(value)
    const kind = state.mode === 'create' ? suggestedKindForInstruction(value) : null
    if (kind) updateSegment({ ...intervals[0]!, kind })
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    onSubmit({
      cueId: state.cueId, laneId: state.laneId, frameStart: draft.frameStart, frameEnd: draft.frameEnd, label: label.trim(),
      camera: {
        ...draft.camera,
        segments: resolveCameraInstructionSegments(draft.camera, draft.frameStart, draft.frameEnd),
        points: [
          ...(startLabel.trim() ? [{ pointId: 'point_start', role: 'start' as const, frameOffset: 0, label: startLabel.trim() }] : []),
          ...points.filter(point => point.role === 'intermediate').map(point => ({ ...point, label: point.label.trim() })),
          ...(endLabel.trim() ? [{ pointId: 'point_end', role: 'end' as const, frameOffset: duration - 1, label: endLabel.trim() }] : []),
        ],
      },
    })
  }

  return (
    <div ref={dialogRef} className="assetQuickPreviewBackdrop soundCueDialogBackdrop" role="dialog" aria-modal="true" aria-label="撮影指示" tabIndex={-1} data-workspace-keyboard-scope="dialog" onPointerDown={onCancel}>
      <form className="soundCueDialog cameraCueDialog" onSubmit={submit} onPointerDown={event => event.stopPropagation()}>
        <header className="soundCueDialogHeader">
          <strong>撮影指示</strong>
          <button type="button" className="dialogIconButton" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="soundCueDialogBody cameraCueDialogBody">
          <label><span>指示</span>
            <HistoryInput inputRef={instructionInputRef} aria-label="CAMERA指示" value={label}
              onChange={event => updateInstruction(event.currentTarget.value)} history={instructionHistory}
              pinned={CAMERA_INSTRUCTION_BUILT_INS} historyLimit={CAMERA_INSTRUCTION_HISTORY_LIMIT} placeholder="PAN、TU、OLなど" />
          </label>
          <div className="timedRangeDialogTimingRow">
            <span><small>開始</small>{formatLogicalSheetFrameTimecode(draft.frameStart, frameMin, safeFps)}</span>
            <span><small>終了</small>{formatLogicalSheetFrameTimecode(draft.frameEnd, frameMin, safeFps)}</span>
            <DurationFrameControl frames={duration} fps={safeFps} maxFrames={maxDuration} label="全体の長さ"
              onChange={frames => setDraft(current => resizeCameraInstruction(current, current.frameStart, current.frameStart + frames - 1))} />
          </div>
          <div className="cameraCueEndpointFields">
            <label>開始ラベル<HistoryInput aria-label="CAMERA開始ラベル" value={startLabel} history={pointLabelHistory}
              historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT} placeholder="任意" onChange={event => setStartLabel(event.currentTarget.value)} /></label>
            <label>終了ラベル<HistoryInput aria-label="CAMERA終了ラベル" value={endLabel} history={pointLabelHistory}
              historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT} placeholder="任意" onChange={event => setEndLabel(event.currentTarget.value)} /></label>
          </div>
          <p className="cameraIntervalHint">区間の尺は終わりの境界を動かします。全体の長さは末尾だけを伸縮します。各区間は最低1コマです。</p>
          <div className="cameraIntervalEditor">
            <div className="cameraIntervalHeader" aria-hidden="true"><span>区間・開始〜終了</span><span>尺</span><span>図形</span><span>終わりの境界ラベル</span><span /></div>
            {intervals.map((interval, index) => {
              const boundary = points.find(point => point.role === 'intermediate' && point.pointId === interval.endPointId)
              const next = intervals[index + 1]
              return <div className="cameraIntervalRow" key={interval.endPointId} data-camera-interval={index + 1}>
                <span className="cameraIntervalPosition"><b>区間{index + 1}</b><small>
                  {formatLogicalSheetFrameTimecode(interval.frameStart, frameMin, safeFps)}〜{formatLogicalSheetFrameTimecode(interval.frameEnd, frameMin, safeFps)}
                </small></span>
                <CompactDurationFrameControl frames={interval.durationFrames} fps={safeFps}
                  maxFrames={next ? interval.durationFrames + next.durationFrames - 1 : frameMax - interval.frameStart + 1}
                  label={`CAMERA区間${index + 1}の尺`}
                  onChange={frames => setDraft(current => changeCameraIntervalDuration(current, interval.endPointId, frames, 'boundary', frameMax))} />
                <SegmentKindControl value={interval} label={`区間${index + 1}`} frameStart={interval.frameStart} frameEnd={interval.frameEnd}
                  frameMin={frameMin} fps={safeFps} onChange={updateSegment} />
                {boundary ? <HistoryInput aria-label={`CAMERA境界ラベル${index + 1}`} value={boundary.label} history={pointLabelHistory}
                  historyLimit={CAMERA_POINT_LABEL_HISTORY_LIMIT} placeholder="任意"
                  onChange={event => { const value = event.currentTarget.value; setDraft(current => ({ ...current, camera: { ...current.camera,
                    points: resolveCameraInstructionPoints(current.camera, current.frameStart, current.frameEnd)
                      .map(point => point.pointId === boundary.pointId ? { ...point, label: value } : point),
                  } })) }} /> : <span className="cameraIntervalEndLabel">終了ラベル</span>}
                <span className="cameraIntervalActions">
                  <button type="button" aria-label={`区間${index + 1}の分割・尺変更`} onClick={() => { setToolTarget(interval.endPointId); setToolsOpen(true) }}>操作</button>
                  {boundary && <button type="button" aria-label={`区間${index + 1}と次を結合`} title="次の区間の図形を使って結合"
                    onClick={() => setDraft(current => removeCameraInstructionBoundary(current, boundary.pointId))}>結合</button>}
                </span>
              </div>
            })}
          </div>
          <details ref={intervalToolsRef} className="cameraIntervalTools" open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)}>
            <summary>区間の分割・尺変更</summary>
            <div className="cameraIntervalToolFields">
              <label>対象<select aria-label="区間操作の対象" value={toolTarget} disabled={action === 'scale'} onChange={event => setToolTarget(event.currentTarget.value)}>
                <option value="all">指示全体</option>
                {intervals.map((interval, index) => <option key={interval.endPointId} value={interval.endPointId}>区間{index + 1}</option>)}
              </select></label>
              <label>操作<select aria-label="区間操作" value={action} onChange={event => setAction(event.currentTarget.value as IntervalAction)}>
                <option value="frames">指定コマ数で分割</option><option value="count">指定区間数で等分</option>
                <option value="at">指定位置で二つに分割</option><option value="ripple">後続をずらして尺変更</option>
                <option value="scale">全体を比例伸縮</option>
              </select></label>
              <label>{action === 'count' ? '区間数' : action === 'at' ? '先頭からのコマ数' : 'コマ数'}
                <input type="number" aria-label="区間操作の値" min={1} step={1} value={actionValue}
                  onChange={event => setActionValue(Number(event.currentTarget.value))} />
              </label>
              <button type="button" disabled={!preview} onClick={() => { if (preview) { setDraft(preview); setToolTarget('all'); setToolsOpen(false) } }}>適用</button>
            </div>
            {preview ? <output className="cameraIntervalPreview" aria-label="区間操作のプレビュー">
              {previewIntervals.slice(0, 32).map(item => item.durationFrames).join('・')}{previewIntervals.length > 32 ? '…' : ''} コマ
              （{previewIntervals.length}区間・計{preview.frameEnd - preview.frameStart + 1}コマ）
            </output> : <p className="cameraIntervalHint" role="status">{action === 'ripple' && !target ? '変更する区間を選んでください。'
              : action === 'scale' ? `${intervals.length}〜${maxDuration}コマで指定してください。` : '各区間が1コマ以上になる分割を指定してください。'}</p>}
            <p className="cameraIntervalHint">{action === 'scale' ? '区間の比率を保ち、合計が指定尺になるようコマ数を配分します。'
              : action === 'ripple' ? '同じ指示の後続区間を移動します。後続の尺は変わりません。'
              : toolTarget === 'all' && intervals.length > 1 ? '全体の分割は既存の区切り・中間ラベルを置き換え、最初の区間の図形を引き継ぎます。'
              : '図形を引き継いで分割します。指定コマ数の余りは末尾へ、等分の余りは先頭から配ります。'}</p>
          </details>
          {draft.camera.labelPlacement && <div className="cameraCueManualPlacementNotice"><span>シート上のラベル位置を使用中</span>
            <button type="button" onClick={() => setDraft(current => ({ ...current, camera: { ...current.camera, labelPlacement: undefined } }))}>自動配置に戻す</button>
          </div>}
        </div>
        <footer className="soundCueDialogFooter"><button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="primaryButton">{state.mode === 'edit' ? '更新' : '追加'}</button>
        </footer>
      </form>
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
  const pivotMax = (frameEnd - frameStart + 1) % 2 === 0 ? Math.max(frameStart, frameEnd - 1) : frameEnd
  const pivot = value.kind === 'overlap'
    ? clampCameraOverlapPivotAnchorFrame(value.pivotAnchorFrame ?? defaultCameraOverlapPivotAnchorFrame(frameStart, frameEnd), frameStart, frameEnd)
    : undefined

  function choose(kind: CameraInstructionSegmentKind) {
    onChange({
      endPointId: value.endPointId,
      kind,
      pivotAnchorFrame: kind === 'overlap'
        ? clampCameraOverlapPivotAnchorFrame(pivot ?? defaultCameraOverlapPivotAnchorFrame(frameStart, frameEnd), frameStart, frameEnd)
        : undefined,
    })
  }

  return (
    <div className="cameraSegmentKindControl">
      <div className="cameraSegmentKindOptions" role="radiogroup" aria-label={`${label}の図形`}>
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
