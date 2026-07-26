import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { formatLogicalSheetFrameTimecode, type TimedRangeCue } from '@xsheet-remap/core'
import { assignmentForCandidate } from './dialogueAudioBinding'
import type { DialogueAudioRange } from './dialogueAudioEditing'
import type { DialogueSileroAnalysis, DialogueVadEngineStatus } from './dialogueAudioSileroVad'
import type {
  DialogueAudioClip,
  DialogueAudioCutState,
  DialogueAudioTrackState,
  DialogueSpeechCandidate,
} from './dialogueAudioProject'
import type {
  DialogueAudioContextCommand,
  DialogueAudioContextTarget,
  DialogueAudioSelectionFocus,
} from './dialogueAudioContextMenuModel'
import type {
  DialogueAudioSelectionEntity,
  DialogueAudioSelectionState,
} from './dialogueAudioSelectionModel'
import { planDialogueAudioRulerTicks } from './dialogueAudioTimelineModel'
import { TooltipTarget } from './Tooltip'
import type { SoundCueNavigationRequest } from './workspaceInteractionPolicy'

export type DialogueAudioTimelineTool = 'select' | 'range'

export interface DialogueAudioTimelineProps {
  cutState: DialogueAudioCutState
  fps: number
  frameOrigin: number
  cutDurationFrames?: number
  /** @deprecated Kept for embedders while they migrate to cutDurationFrames. */
  durationFrames?: number
  activeRevisionId: string
  soundCues: TimedRangeCue[]
  selectedSoundCueId: string | null
  soundCueNavigationRequest?: SoundCueNavigationRequest | null
  onCutStateChange: (change: {
    cutState: DialogueAudioCutState
    cueUpdates?: Array<{ cueId: string; frameStart: number; frameEnd: number }>
    recordHistory?: boolean
  }) => boolean | void
  canUndo?: boolean
  canRedo?: boolean
  onUndo?: () => void
  onRedo?: () => void
  onCutDurationChange?: (durationFrames: number) => void
  onPlayheadChange: (frame: number) => void
  onSoundCueSelect: (cueId: string) => void
  onSoundCueEdit: (cueId: string) => void
  onSoundCueTransform: (cueId: string, updates: { laneId: string; frameStart: number; frameEnd: number }) => void
  onSoundCandidateEdit: (trackId: string, candidateIds: string[], frameStart: number, frameEnd: number, cueId?: string) => void
  onAutoCreateDialogueRegions: (state: DialogueAudioCutState, trackId: string, candidateIds: string[]) => DialogueAudioCutState
}

export interface DialogueAudioTimelineGesture {
  pointerId: number
  trackId: string
  startClientX: number
  startClientY: number
  currentClientX: number
  currentClientY: number
  anchorFrame: number
  moved: boolean
  additive: boolean
  tool: DialogueAudioTimelineTool
  initialSelection: DialogueAudioSelectionState
  contentRect: { left: number; top: number; width: number; height: number }
}

export function clipSelectionForIds(
  track: DialogueAudioTrackState,
  clipIdsInput: string[],
): Extract<DialogueAudioSelectionFocus, { kind: 'clip' }> | null {
  const requested = new Set(clipIdsInput)
  const clips = track.clips.filter(clip => requested.has(clip.clipId))
  if (clips.length === 0) return null
  return {
    kind: 'clip',
    trackId: track.trackId,
    clipIds: clips.map(clip => clip.clipId),
    frameStart: Math.min(...clips.map(clip => clip.timelineStartFrame)),
    frameEnd: Math.max(...clips.map(clip => clip.timelineStartFrame + clip.durationFrames - 1)),
  }
}

export function candidateSelection(
  trackId: string,
  candidates: DialogueSpeechCandidate[],
): Extract<DialogueAudioSelectionFocus, { kind: 'candidate' }> {
  return {
    kind: 'candidate',
    trackId,
    candidateIds: candidates.map(candidate => candidate.candidateId),
    frameStart: Math.min(...candidates.map(candidate => candidate.frameStart)),
    frameEnd: Math.max(...candidates.map(candidate => candidate.frameEnd)),
  }
}

export function resolveDialogueAudioSelectionFocus(
  selection: DialogueAudioSelectionState,
  state: DialogueAudioCutState,
): DialogueAudioSelectionFocus | null {
  if (selection.timeRange) return { kind: 'range', ...selection.timeRange }
  const first = selection.entities[0]
  if (!first || selection.entities.some(entity => entity.kind !== first.kind || entity.trackId !== first.trackId)) return null
  const track = state.tracks.find(item => item.trackId === first.trackId)
  if (!track) return null
  if (first.kind === 'clip') return clipSelectionForIds(track, selection.entities.map(entity => entity.id))
  if (first.kind === 'candidate') {
    const ids = new Set(selection.entities.map(entity => entity.id))
    const candidates = track.speechCandidates.filter(candidate => ids.has(candidate.candidateId))
    return candidates.length > 0 ? candidateSelection(track.trackId, candidates) : null
  }
  if (selection.entities.length !== 1) return null
  const region = track.dialogueRegions.find(item => item.regionId === first.id)
  return region ? {
    kind: 'region',
    trackId: track.trackId,
    regionId: region.regionId,
    candidateIds: region.candidateIds,
    frameStart: region.frameStart,
    frameEnd: region.frameEnd,
  } : null
}

export function dialogueAudioSelectionSummary(
  selection: DialogueAudioSelectionState,
  range: DialogueAudioRange,
): string {
  if (selection.timeRange) {
    return `時間範囲 ${range.frameStart}–${range.frameEnd}F (${range.frameEnd - range.frameStart + 1}F)`
  }
  const counts = new Map<DialogueAudioSelectionEntity['kind'], number>()
  selection.entities.forEach(entity => counts.set(entity.kind, (counts.get(entity.kind) ?? 0) + 1))
  const speechCount = (counts.get('candidate') ?? 0) + (counts.get('region') ?? 0)
  const labels = [
    counts.get('clip') ? `${counts.get('clip')}クリップ` : '',
    speechCount ? `セリフ区間${speechCount}個` : '',
  ].filter(Boolean)
  return `${labels.join('・')} / ${range.frameStart}–${range.frameEnd}F`
}

export function timelineMarqueeStyle(
  gesture: DialogueAudioTimelineGesture,
  minimumTop: number,
): CSSProperties {
  const rect = gesture.contentRect
  const left = Math.max(0, Math.min(gesture.startClientX, gesture.currentClientX) - rect.left)
  const top = Math.max(minimumTop, Math.min(gesture.startClientY, gesture.currentClientY) - rect.top)
  const right = Math.min(rect.width, Math.max(gesture.startClientX, gesture.currentClientX) - rect.left)
  const bottom = Math.min(rect.height, Math.max(gesture.startClientY, gesture.currentClientY) - rect.top)
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  }
}

export function dialogueAudioClipHandleLane(clips: DialogueAudioClip[], targetClipId: string): number {
  const laneEnds: number[] = []
  const ordered = [...clips].sort((left, right) =>
    left.timelineStartFrame - right.timelineStartFrame
    || left.timelineStartFrame + left.durationFrames - (right.timelineStartFrame + right.durationFrames)
    || left.clipId.localeCompare(right.clipId))
  for (const clip of ordered) {
    const frameEnd = clip.timelineStartFrame + clip.durationFrames - 1
    let lane = laneEnds.findIndex(end => end < clip.timelineStartFrame)
    if (lane < 0) lane = laneEnds.length
    laneEnds[lane] = frameEnd
    if (clip.clipId === targetClipId) return lane
  }
  return 0
}

export function contextMenuTitle(target: DialogueAudioContextTarget): string {
  switch (target.kind) {
    case 'track': return 'トラック'
    case 'empty': return 'トラック空白'
    case 'range': return `選択範囲 ${target.frameStart}–${target.frameEnd}F`
    case 'clip': return `音声クリップ ${target.clipIds.length}個 / ${target.frameStart}–${target.frameEnd}F`
    case 'candidate': return `セリフ区間 ${target.candidateIds.length}個`
    case 'region': return 'セリフ区間'
    case 'cue': return 'リンクSOUND'
  }
}

export function contextMenuAriaLabel(target: DialogueAudioContextTarget): string {
  return `${contextMenuTitle(target)}の操作`
}

export function contextCommandLabel(command: DialogueAudioContextCommand): string {
  switch (command) {
    case 'redetect-track': return 'トラック全体をVAD再検出'
    case 'clear-track': return 'トラックをクリア'
    case 'import-here': return '再生ヘッドへ音声ファイルを読み込む'
    case 'paste-overwrite': return '再生ヘッドへ上書き貼り付け　Ctrl+V'
    case 'paste-insert': return '再生ヘッドへ挿入貼り付け　Ctrl+Shift+V'
    case 'assign-sound': return 'SOUNDへ割り付け…'
    case 'copy': return 'コピー　Ctrl+C'
    case 'cut': return '切り取り　Ctrl+X'
    case 'silence': return '無音化（リフト）　Delete'
    case 'ripple-delete': return 'リップル削除　Shift+Delete'
    case 'delete-clips': return '選択クリップを削除　Delete'
    case 'redetect-clips': return '選択クリップをVAD再検出'
    case 'ignore-candidate': return 'セリフ区間を無視'
    case 'restore-candidate': return 'セリフ区間を検出対象へ戻す'
    case 'edit-sound': return 'リンクSOUNDを編集…'
    case 'select-sheet-cue': return 'タイムシート側のSOUNDを選択'
    case 'align-audio-to-cue': return '音声をSOUND位置へ揃える'
    case 'align-cue-to-audio': return 'SOUNDを音声位置へ揃える'
    case 'unlink-sound': return 'SOUNDとのリンクを解除'
    case 'remove-region': return 'セリフ区間を解除'
    case 'track-vad-mode':
    case 'track-height':
    case 'insert-silence':
      return ''
  }
}

export function candidatePresentation(
  candidate: DialogueSpeechCandidate,
  state: DialogueAudioCutState,
  activeRevisionId: string,
) {
  if (candidate.status === 'ignored') return { state: 'ignored', label: '', title: `無視したセリフ区間 ${candidate.frameStart}–${candidate.frameEnd}F` }
  const assignment = assignmentForCandidate(state, candidate.candidateId, activeRevisionId)
  if (assignment?.status === 'linked') return { state: 'linked', label: '', title: `音響指示へ割付済みのセリフ区間 ${candidate.frameStart}–${candidate.frameEnd}F` }
  if (assignment || candidate.status === 'review') return { state: 'review', label: '', title: assignment?.reviewReason ?? candidate.reviewReason ?? 'リンク状態を確認してください。' }
  return { state: 'pending', label: '', title: `セリフ区間 ${candidate.frameStart}–${candidate.frameEnd}F。ダブルクリックで音響指示へ割り付け` }
}

export function rangeStyle(
  frameStart: number,
  rangeFrameEnd: number,
  frameOrigin: number,
  durationFrames: number,
) {
  return {
    left: `${(frameStart - frameOrigin) / Math.max(1, durationFrames) * 100}%`,
    width: `${Math.max(1, rangeFrameEnd - frameStart + 1) / Math.max(1, durationFrames) * 100}%`,
  }
}

export function candidateHitStyle(
  frameStart: number,
  rangeFrameEnd: number,
  frameOrigin: number,
  durationFrames: number,
  timelineWidth: number,
): CSSProperties {
  const safeDuration = Math.max(1, durationFrames)
  const safeWidth = Math.max(1, timelineWidth)
  const visualLeft = (frameStart - frameOrigin) / safeDuration * safeWidth
  const visualWidth = Math.max(1, (rangeFrameEnd - frameStart + 1) / safeDuration * safeWidth)
  const hitWidth = Math.min(safeWidth, Math.max(16, visualWidth))
  const hitLeft = Math.max(0, Math.min(safeWidth - hitWidth, visualLeft - (hitWidth - visualWidth) / 2))
  return {
    left: `${hitLeft}px`,
    width: `${hitWidth}px`,
    '--candidate-visual-left': `${visualLeft - hitLeft}px`,
    '--candidate-visual-width': `${visualWidth}px`,
  } as CSSProperties
}

export function DialogueSpeechSegmentButton(props: {
  tooltip: string
  className: string
  style: CSSProperties
  label: string
  ariaLabel: string
  regionId?: string
  suppressClick: () => boolean
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void
  onOpen: () => void
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  return <TooltipTarget label={props.tooltip}>
    {tooltipProps => <button
      type="button"
      className={props.className}
      style={props.style}
      data-region-id={props.regionId}
      {...tooltipProps}
      onPointerDown={event => {
        tooltipProps.onPointerDown()
        props.onPointerDown(event)
      }}
      onClick={event => {
        if (props.suppressClick()) {
          event.stopPropagation()
          return
        }
        props.onSelect(event)
      }}
      onDoubleClick={event => {
        event.stopPropagation()
        props.onOpen()
      }}
      onContextMenu={props.onContextMenu}
      aria-label={props.ariaLabel}
    >
      <span className="dialogueSpeechSegmentVisual">
        <span className="dialogueSpeechSegmentHandle isStart" data-segment-edge="start" />
        {props.label && <span className="dialogueSpeechSegmentLabel">{props.label}</span>}
        <span className="dialogueSpeechSegmentHandle isEnd" data-segment-edge="end" />
      </span>
    </button>}
  </TooltipTarget>
}

export function SelectionToolIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 3.5 18 13l-6.2 1.1L8.6 20Z" fill="currentColor" />
  </svg>
}

export function RangeToolIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 5v14M18 5v14M9 12h6m-4-3-3 3 3 3m2-6 3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
}

export function SpeakerIcon({ muted }: { muted: boolean }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
    {muted
      ? <path d="m16 9 5 6m0-6-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      : <>
          <path d="M16 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </>}
  </svg>
}

export function AudioImportIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M3.5 6.5h6l2 2h9v10h-17Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    <path d="M10 16v-4.5l5-1v4.2" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="8.8" cy="16.2" r="1.6" fill="currentColor" />
    <circle cx="13.8" cy="14.8" r="1.6" fill="currentColor" />
  </svg>
}

export function DialogueAudioTimeRuler(props: {
  durationFrames: number
  fps: number
  pixelsPerFrame: number
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void
}) {
  const plan = planDialogueAudioRulerTicks(props.durationFrames, props.fps, props.pixelsPerFrame)
  return <div
    className="dialogueAudioRuler"
    onPointerDown={props.onPointerDown}
    onPointerMove={props.onPointerMove}
    onPointerUp={props.onPointerUp}
    onPointerCancel={props.onPointerCancel}
  >
    <div className="dialogueAudioRulerSeconds" aria-hidden="true">
      {plan.secondTicks.map(tick => <span
        key={tick.offsetFrames}
        className="dialogueAudioSecondTick"
        style={{ left: tick.offsetFrames * props.pixelsPerFrame }}
      ><span>{tick.second}秒</span></span>)}
    </div>
    <div className="dialogueAudioRulerFrames" aria-label="秒内フレーム目盛り">
      {plan.frameTicks.map(tick => <span
        key={tick.offsetFrames}
        className="dialogueAudioFrameTick"
        style={{ left: tick.offsetFrames * props.pixelsPerFrame }}
      ><span>{tick.frameInSecond}</span></span>)}
    </div>
  </div>
}

export function DialogueAudioTimelineBoundaryMarker(props: {
  kind: 'cut' | 'audio' | 'combined'
  positionPercent: number
  label: string
}) {
  return (
    <span
      className={`dialogueAudioBoundary dialogueAudioBoundary-${props.kind}`}
      style={{ left: `${props.positionPercent}%` }}
    >
      <TooltipTarget label={props.label}>
        {tooltipProps => <span
          className="dialogueAudioBoundaryHandle"
          role="img"
          aria-label={props.label}
          {...tooltipProps}
        />}
      </TooltipTarget>
    </span>
  )
}

export function mergeDialogueAudioRanges(ranges: DialogueAudioRange[]): DialogueAudioRange[] {
  return ranges.sort((left, right) => left.frameStart - right.frameStart).reduce<DialogueAudioRange[]>((result, range) => {
    const previous = result.at(-1)
    if (previous && range.frameStart <= previous.frameEnd + 1) previous.frameEnd = Math.max(previous.frameEnd, range.frameEnd)
    else result.push({ ...range })
    return result
  }, [])
}

export function dialogueVadEngineLabel(status: DialogueVadEngineStatus): string {
  if (status === 'loading') return 'Silero解析中…'
  if (status === 'silero') return 'Silero VAD'
  if (status === 'fallback') return '簡易検出'
  return 'Silero待機'
}

export function dialogueVadResultSuffix(analysis: DialogueSileroAnalysis | undefined): string {
  if (!analysis) return ''
  return analysis.engine === 'silero'
    ? ' Silero VADで検出しました。'
    : ` 簡易検出へ切り替えました${analysis.error ? `（${analysis.error}）` : '。'}`
}

export function formatDialogueAudioFrame(frame: number, frameOrigin: number, fps: number): string {
  const logicalFrame = Math.round(frame) - Math.round(frameOrigin) + 1
  return `${formatLogicalSheetFrameTimecode(frame, frameOrigin, fps)} / ${logicalFrame}F`
}

export function stopDialogueAudioSources(sources: AudioBufferSourceNode[]) {
  sources.forEach(source => {
    try { source.stop() } catch { /* already stopped */ }
    source.disconnect()
  })
}
