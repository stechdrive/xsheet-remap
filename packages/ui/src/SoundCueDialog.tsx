import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { LogicalTimelineLane, TimedRangeCue } from '@xsheet-remap/core'
import type { SoundCueDialogState } from './appTypes'
import { HistoryInput } from './HistoryInput'

export interface SoundCueDialogSubmit {
  cueId?: string
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
  text: string
}

export function SoundCueDialog({
  state,
  cue,
  lane,
  fps,
  frameMin,
  frameMax,
  labelHistory,
  onSubmit,
  onCancel,
}: {
  state: SoundCueDialogState
  cue: TimedRangeCue | null
  lane: LogicalTimelineLane | null
  fps: number
  frameMin: number
  frameMax: number
  labelHistory: string[]
  onSubmit: (input: SoundCueDialogSubmit) => void
  onCancel: () => void
}) {
  const safeFps = Math.max(1, Math.round(fps))
  const initialFrameStart = cue?.frameStart ?? state.frameStart
  const initialDuration = Math.max(1, (cue?.frameEnd ?? state.frameEnd) - initialFrameStart + 1)
  const [label, setLabel] = useState(cue?.label ?? '')
  const [text, setText] = useState(cue?.text ?? '')
  const [frameStart, setFrameStart] = useState(initialFrameStart)
  const [durationFrames, setDurationFrames] = useState(initialDuration)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const seconds = Math.floor(durationFrames / safeFps)
  const frames = durationFrames % safeFps
  const frameEnd = Math.min(frameMax, frameStart + durationFrames - 1)
  const laneLabel = lane?.label || state.laneId
  const dialogTitle = state.mode === 'edit' ? 'SOUND区間を編集' : 'SOUND区間を追加'

  useEffect(() => {
    labelInputRef.current?.focus()
    labelInputRef.current?.select()
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
      labelInputRef.current?.focus()
      return
    }
    onSubmit({
      cueId: state.cueId,
      laneId: state.laneId,
      frameStart,
      frameEnd,
      label: normalizedLabel,
      text: text.trim(),
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
      <form className="soundCueDialog" onSubmit={submit} onPointerDown={event => event.stopPropagation()}>
        <header className="soundCueDialogHeader">
          <div>
            <strong>{dialogTitle}</strong>
            <span>{laneLabel} / {frameStart}–{frameEnd}F</span>
          </div>
          <button type="button" className="dialogIconButton" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="soundCueDialogBody">
          <label>
            <span>ラベル</span>
            <HistoryInput
              inputRef={labelInputRef}
              aria-label="SOUNDラベル"
              value={label}
              onChange={event => setLabel(event.currentTarget.value)}
              history={labelHistory}
              historyLimit={24}
              required
            />
          </label>
          <label>
            <span>内容</span>
            <textarea
              aria-label="SOUND内容"
              value={text}
              rows={6}
              onChange={event => setText(event.currentTarget.value)}
              onKeyDown={handleTextKeyDown}
              placeholder="セリフ、効果音の内容など"
            />
          </label>
          <div className="soundCueTimingFields">
            <label>
              <span>開始フレーム</span>
              <input
                type="number"
                aria-label="SOUND開始フレーム"
                min={frameMin}
                max={frameMax}
                value={frameStart}
                onChange={event => setFrameStart(Math.max(frameMin, Math.min(frameMax, Math.round(Number(event.currentTarget.value)))))}
              />
            </label>
            <fieldset>
              <legend>デュレーション</legend>
              <label>
                <span>秒</span>
                <input
                  type="number"
                  aria-label="SOUNDデュレーション秒"
                  min={0}
                  value={seconds}
                  onChange={event => setDurationParts(Number(event.currentTarget.value), frames)}
                />
              </label>
              <span aria-hidden="true">+</span>
              <label>
                <span>コマ</span>
                <input
                  type="number"
                  aria-label="SOUNDデュレーションコマ"
                  min={0}
                  max={safeFps - 1}
                  value={frames}
                  onChange={event => setDurationParts(seconds, Number(event.currentTarget.value))}
                />
              </label>
            </fieldset>
          </div>
          <small>ラベル履歴は最近使った順に保存されます。内容欄は Ctrl+Enter で確定します。</small>
        </div>
        <footer className="soundCueDialogFooter">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="primaryButton">{state.mode === 'edit' ? '更新' : '追加'}</button>
        </footer>
      </form>
    </div>
  )
}
