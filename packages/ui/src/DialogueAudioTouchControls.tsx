import { bindingForRegion } from './dialogueAudioBinding'
import type { DialogueAudioCutState } from './dialogueAudioProject'
import type { DialogueAudioContextTarget, DialogueAudioSelectionFocus } from './dialogueAudioContextMenuModel'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { Tooltip } from './Tooltip'

export function dialogueAudioContextTargetForSelection(
  selection: DialogueAudioSelectionFocus | null,
  cutState: DialogueAudioCutState,
  activeRevisionId: string,
): DialogueAudioContextTarget | null {
  if (!selection) return null
  if (selection.kind === 'range' || selection.kind === 'clip') return selection
  if (selection.kind === 'candidate') {
    const track = cutState.tracks.find(item => item.trackId === selection.trackId)
    const selected = track?.speechCandidates.filter(candidate => selection.candidateIds.includes(candidate.candidateId)) ?? []
    return {
      kind: 'candidate',
      trackId: selection.trackId,
      candidateIds: selection.candidateIds,
      ignored: selected.length > 0 && selected.every(candidate => candidate.status === 'ignored'),
    }
  }
  const binding = bindingForRegion(cutState, {
    trackId: selection.trackId,
    regionId: selection.regionId,
  }, activeRevisionId)
  return {
    kind: 'region',
    trackId: selection.trackId,
    regionId: selection.regionId,
    linked: Boolean(binding),
  }
}

export function DialogueAudioTouchControls({
  visible,
  additiveSelection,
  contextMenuAvailable,
  soundLabel,
  onToggleAdditiveSelection,
  onOpenContextMenu,
}: {
  visible: boolean
  additiveSelection: boolean
  contextMenuAvailable: boolean
  soundLabel: string
  onToggleAdditiveSelection: () => void
  onOpenContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void
}) {
  if (!visible) return null
  return (
    <span className="dialogueAudioToolGroup dialogueAudioTouchTools" aria-label="タッチ選択操作">
      <Tooltip label="追加選択。タップしたクリップや発話区間を選択に追加・解除">
      <button
        type="button"
        className={`dialogueAudioIconButton ${additiveSelection ? 'isActiveTool' : ''}`}
        aria-label="項目を追加選択"
        aria-pressed={additiveSelection}
        onClick={onToggleAdditiveSelection}
      >＋</button>
      </Tooltip>
      <Tooltip label={`選択した音声の操作メニュー。コピー・削除・${soundLabel}割付など`}>
      <button
        type="button"
        className="dialogueAudioIconButton"
        aria-label="選択中の音声操作メニュー"
        disabled={!contextMenuAvailable}
        onClick={onOpenContextMenu}
      >…</button>
      </Tooltip>
    </span>
  )
}
