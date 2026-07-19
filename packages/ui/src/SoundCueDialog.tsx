import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { formatLogicalSheetFrameTimecode, type TimedRangeCue } from '@xsheet-remap/core'
import type { SoundCueDialogState } from './appTypes'
import { DurationFrameControl } from './DurationFrameControl'
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
  sectionLabel,
  fps,
  frameMin,
  frameMax,
  labelHistory,
  onSubmit,
  onCancel,
}: {
  state: SoundCueDialogState
  cue: TimedRangeCue | null
  sectionLabel: string
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
  const [durationFrames, setDurationFrames] = useState(initialDuration)
  const labelInputRef = useRef<HTMLInputElement>(null)
  const frameStart = Math.max(frameMin, Math.min(frameMax, initialFrameStart))
  const maxDuration = Math.max(1, frameMax - frameStart + 1)
  const frameEnd = frameStart + durationFrames - 1
  const normalizedSectionLabel = sectionLabel.trim() || 'SOUND'
  const dialogTitle = `${normalizedSectionLabel}指示`

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

  function updateDuration(nextDuration: number) {
    setDurationFrames(Math.max(1, Math.min(maxDuration, Math.round(nextDuration))))
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
          <strong>{dialogTitle}</strong>
          <button type="button" className="dialogIconButton" aria-label="閉じる" onClick={onCancel}>×</button>
        </header>
        <div className="soundCueDialogBody">
          <label>
            <span>ラベル</span>
            <HistoryInput
              inputRef={labelInputRef}
              aria-label={`${normalizedSectionLabel}ラベル`}
              value={label}
              onChange={event => setLabel(event.currentTarget.value)}
              history={labelHistory}
              historyLimit={24}
              required
            />
          </label>
          <label className="soundCueContentField">
            <span>内容</span>
            <textarea
              aria-label={`${normalizedSectionLabel}内容`}
              value={text}
              rows={6}
              onChange={event => setText(event.currentTarget.value)}
              onKeyDown={handleTextKeyDown}
            />
            <small className="soundCueDialogCommitHint">Ctrl+Enterで確定</small>
          </label>
          <div className="timedRangeDialogTimingRow">
            <span><small>開始</small>{formatLogicalSheetFrameTimecode(frameStart, frameMin, safeFps)}</span>
            <span><small>終了</small>{formatLogicalSheetFrameTimecode(frameEnd, frameMin, safeFps)}</span>
            <DurationFrameControl frames={durationFrames} fps={safeFps} maxFrames={maxDuration} label="長さ" onChange={updateDuration} />
          </div>
        </div>
        <footer className="soundCueDialogFooter">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="primaryButton">{state.mode === 'edit' ? '更新' : '追加'}</button>
        </footer>
      </form>
    </div>
  )
}
