import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { CameraInstruction, CameraInstructionShape, LogicalTimelineLane, TimedRangeCue } from '@xsheet-remap/core'
import type { CameraCueDialogState } from './appTypes'

export interface CameraCueDialogSubmit {
  cueId?: string
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
  text: string
  camera: CameraInstruction
}

const shapeOptions: Array<{ value: CameraInstructionShape; label: string }> = [
  { value: 'range', label: '区間指示（▼―▲）' },
  { value: 'fade-in', label: 'フェードイン（三角形）' },
  { value: 'fade-out', label: 'フェードアウト（逆三角形）' },
  { value: 'overlap', label: 'オーバーラップ（交差）' },
]

export function CameraCueDialog({ state, cue, lane, fps, frameMin, frameMax, onSubmit, onCancel }: {
  state: CameraCueDialogState
  cue: TimedRangeCue | null
  lane: LogicalTimelineLane | null
  fps: number
  frameMin: number
  frameMax: number
  onSubmit: (input: CameraCueDialogSubmit) => void
  onCancel: () => void
}) {
  const safeFps = Math.max(1, Math.round(fps))
  const initialFrameStart = cue?.frameStart ?? state.frameStart
  const initialFrameEnd = cue?.frameEnd ?? state.frameEnd
  const initialDuration = Math.max(1, initialFrameEnd - initialFrameStart + 1)
  const initialCamera = cue?.camera
  const [shape, setShape] = useState<CameraInstructionShape>(initialCamera?.shape ?? 'range')
  const [label, setLabel] = useState(cue?.label ?? '')
  const [text, setText] = useState(cue?.text ?? '')
  const [startLabel, setStartLabel] = useState(initialCamera?.startLabel ?? '')
  const [endLabel, setEndLabel] = useState(initialCamera?.endLabel ?? '')
  const [frameStart, setFrameStart] = useState(initialFrameStart)
  const [durationFrames, setDurationFrames] = useState(initialDuration)
  const [pivotOffset, setPivotOffset] = useState(Math.max(0, (initialCamera?.pivotFrame ?? Math.round((initialFrameStart + initialFrameEnd) / 2)) - initialFrameStart))
  const [labelPlacement, setLabelPlacement] = useState(initialCamera?.labelPlacement)
  const instructionInputRef = useRef<HTMLInputElement>(null)
  const seconds = Math.floor(durationFrames / safeFps)
  const frames = durationFrames % safeFps
  const frameEnd = Math.min(frameMax, frameStart + durationFrames - 1)
  const pivotFrame = Math.max(frameStart, Math.min(frameEnd, frameStart + pivotOffset))
  const laneLabel = lane?.label || state.laneId
  const dialogTitle = state.mode === 'edit' ? 'CAMERA指示を編集' : 'CAMERA指示を追加'

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

  function setDurationParts(nextSeconds: number, nextFrames: number) {
    const normalizedSeconds = Math.max(0, Math.round(nextSeconds))
    const normalizedFrames = Math.max(0, Math.min(safeFps - 1, Math.round(nextFrames)))
    setDurationFrames(Math.max(1, normalizedSeconds * safeFps + normalizedFrames))
  }

  function submit(event: FormEvent) {
    event.preventDefault()
    const normalizedLabel = label.trim()
    if (!normalizedLabel) {
      instructionInputRef.current?.focus()
      return
    }
    onSubmit({
      cueId: state.cueId,
      laneId: state.laneId,
      frameStart,
      frameEnd,
      label: normalizedLabel,
      text: text.trim(),
      camera: {
        shape,
        startLabel: startLabel.trim(),
        endLabel: endLabel.trim(),
        pivotFrame: shape === 'overlap' ? pivotFrame : undefined,
        labelPlacement,
      },
    })
  }

  function handleTextKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <div className="assetQuickPreviewBackdrop soundCueDialogBackdrop" role="dialog" aria-modal="true" aria-label={dialogTitle} onPointerDown={onCancel}>
      <form className="soundCueDialog cameraCueDialog" onSubmit={submit} onPointerDown={event => event.stopPropagation()}>
        <header className="soundCueDialogHeader">
          <div>
            <strong>{dialogTitle}</strong>
            <span>{laneLabel} / {frameStart}–{frameEnd}F</span>
          </div>
          <button type="button" className="dialogIconButton" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="soundCueDialogBody">
          <label>
            <span>描画</span>
            <select aria-label="CAMERA描画種別" value={shape} onChange={event => setShape(event.currentTarget.value as CameraInstructionShape)}>
              {shapeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>指示</span>
            <input ref={instructionInputRef} aria-label="CAMERA指示" value={label} onChange={event => setLabel(event.currentTarget.value)} required placeholder="PAN、TU、フェードなど" />
          </label>
          <div className="cameraCueEndpointFields">
            <label><span>開始キュー（任意）</span><input aria-label="CAMERA開始キュー" value={startLabel} onChange={event => setStartLabel(event.currentTarget.value)} placeholder="A" /></label>
            <label><span>終了キュー（任意）</span><input aria-label="CAMERA終了キュー" value={endLabel} onChange={event => setEndLabel(event.currentTarget.value)} placeholder="B" /></label>
          </div>
          <label>
            <span>補足</span>
            <textarea aria-label="CAMERA補足" value={text} rows={3} onChange={event => setText(event.currentTarget.value)} onKeyDown={handleTextKeyDown} placeholder="追加の撮影指示など" />
          </label>
          <div className="soundCueTimingFields">
            <label><span>開始フレーム</span><input type="number" aria-label="CAMERA開始フレーム" min={frameMin} max={frameMax} value={frameStart} onChange={event => setFrameStart(Math.max(frameMin, Math.min(frameMax, Math.round(Number(event.currentTarget.value)))))} /></label>
            <fieldset>
              <legend>デュレーション</legend>
              <label><span>秒</span><input type="number" aria-label="CAMERAデュレーション秒" min={0} value={seconds} onChange={event => setDurationParts(Number(event.currentTarget.value), frames)} /></label>
              <span aria-hidden="true">+</span>
              <label><span>コマ</span><input type="number" aria-label="CAMERAデュレーションコマ" min={0} max={safeFps - 1} value={frames} onChange={event => setDurationParts(seconds, Number(event.currentTarget.value))} /></label>
            </fieldset>
          </div>
          {shape === 'overlap' && (
            <label><span>交差フレーム</span><input type="number" aria-label="CAMERA交差フレーム" min={frameStart} max={frameEnd} value={pivotFrame} onChange={event => setPivotOffset(Math.round(Number(event.currentTarget.value)) - frameStart)} /></label>
          )}
          {labelPlacement && (
            <div className="cameraCueManualPlacementNotice">
              <span>シート上で調整したラベル位置を使用します。</span>
              <button type="button" onClick={() => setLabelPlacement(undefined)}>自動配置に戻す</button>
            </div>
          )}
          <small>区間と中間点はシート上でもドラッグ編集できます。補足欄は Ctrl+Enter で確定します。</small>
        </div>
        <footer className="soundCueDialogFooter">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="primaryButton">{state.mode === 'edit' ? '更新' : '追加'}</button>
        </footer>
      </form>
    </div>
  )
}
