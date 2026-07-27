import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { formatLogicalSheetFrameTimecode, type LogicalTimelineLane, type TimedRangeCue } from '@xsheet-remap/core'
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
  existingCueId?: string
  alignment?: SoundCueAudioAlignment
}

export type SoundCueAudioAlignment = 'keep-offset' | 'move-cue-to-audio' | 'move-audio-to-cue'

export function SoundCueDialog({
  state,
  cue,
  sectionLabel,
  fps,
  frameMin,
  frameMax,
  labelHistory,
  soundLanes = [],
  soundCues = [],
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
  soundLanes?: LogicalTimelineLane[]
  soundCues?: TimedRangeCue[]
  onSubmit: (input: SoundCueDialogSubmit) => void
  onCancel: () => void
}) {
  const safeFps = Math.max(1, Math.round(fps))
  const initialFrameStart = cue?.frameStart ?? state.frameStart
  const initialDuration = Math.max(1, (cue?.frameEnd ?? state.frameEnd) - initialFrameStart + 1)
  const [label, setLabel] = useState(cue?.label ?? '')
  const [text, setText] = useState(cue?.text ?? '')
  const [durationFrames, setDurationFrames] = useState(initialDuration)
  const [laneId, setLaneId] = useState(state.laneId)
  const [assignmentTarget, setAssignmentTarget] = useState(state.audioCandidate?.cueId ?? 'new')
  const [alignment, setAlignment] = useState<SoundCueAudioAlignment>('keep-offset')
  const labelInputRef = useRef<HTMLInputElement>(null)
  const frameStart = Math.max(frameMin, Math.min(frameMax, initialFrameStart))
  const maxDuration = Math.max(1, frameMax - frameStart + 1)
  const frameEnd = frameStart + durationFrames - 1
  const normalizedSectionLabel = sectionLabel.trim() || 'SOUND'
  const dialogTitle = `${normalizedSectionLabel}指示`
  const assigningAudio = Boolean(state.audioCandidate)
  const selectedExistingCue = assignmentTarget === 'new'
    ? null
    : soundCues.find(item => item.cueId === assignmentTarget && item.role === 'sound') ?? null
  const laneLabelById = new Map(soundLanes.map(lane => [lane.laneId, lane.label]))

  useEffect(() => {
    if (!selectedExistingCue) {
      labelInputRef.current?.focus()
      labelInputRef.current?.select()
    }
  }, [selectedExistingCue])

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
    onSubmit({
      cueId: state.cueId,
      laneId,
      frameStart,
      frameEnd,
      label: label.trim(),
      text: text.trim(),
      ...(selectedExistingCue ? { existingCueId: selectedExistingCue.cueId, alignment } : {}),
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
          {assigningAudio && (
            <label>
              <span>割付先</span>
              <select aria-label="音響指示の割付先" value={assignmentTarget} onChange={event => setAssignmentTarget(event.currentTarget.value)}>
                <option value="new">新しいラベルを作成</option>
                {soundCues.filter(item => item.role === 'sound').map(item => (
                  <option key={item.cueId} value={item.cueId}>
                    {laneLabelById.get(item.laneId) ?? item.laneId}：{item.label || item.text || '名称なし'}（{formatLogicalSheetFrameTimecode(item.frameStart, frameMin, safeFps)}–{formatLogicalSheetFrameTimecode(item.frameEnd, frameMin, safeFps)}）
                  </option>
                ))}
              </select>
            </label>
          )}
          {selectedExistingCue ? (
            <>
              <div className="soundCueAssignmentSummary">
                <strong>{laneLabelById.get(selectedExistingCue.laneId) ?? selectedExistingCue.laneId}：{selectedExistingCue.label || '名称なし'}</strong>
                <span>{selectedExistingCue.text || '内容なし'}</span>
              </div>
              <label>
                <span>位置の合わせ方</span>
                <select aria-label="位置の合わせ方" value={alignment} onChange={event => setAlignment(event.currentTarget.value as SoundCueAudioAlignment)}>
                  <option value="keep-offset">現在位置のまま追加</option>
                  <option value="move-cue-to-audio">ラベルを音声区間へ移動</option>
                  <option value="move-audio-to-cue">音声区間をラベルへ移動</option>
                </select>
                <small>通常は現在位置のまま追加します。位置を揃える操作は必要な場合だけ選択してください。</small>
              </label>
            </>
          ) : (
            <>
              {assigningAudio && soundLanes.length > 0 && (
                <label>
                  <span>列</span>
                  <select aria-label={`${normalizedSectionLabel}列`} value={laneId} onChange={event => setLaneId(event.currentTarget.value)}>
                    {soundLanes.map(lane => <option key={lane.laneId} value={lane.laneId}>{lane.label}</option>)}
                  </select>
                </label>
              )}
              <label>
                <span>ラベル（任意）</span>
                <HistoryInput
                  inputRef={labelInputRef}
                  aria-label={`${normalizedSectionLabel}ラベル`}
                  value={label}
                  onChange={event => setLabel(event.currentTarget.value)}
                  history={labelHistory}
                  historyLimit={24}
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
            </>
          )}
        </div>
        <footer className="soundCueDialogFooter">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="primaryButton">{selectedExistingCue ? '割り付け' : state.mode === 'edit' ? '更新' : assigningAudio ? '作成して割り付け' : '追加'}</button>
        </footer>
      </form>
    </div>
  )
}
