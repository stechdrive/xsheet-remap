export type DialogueAudioContextTarget =
  | { kind: 'track'; trackId: string }
  | { kind: 'empty'; trackId: string; frame: number }
  | { kind: 'range'; trackId: string; frameStart: number; frameEnd: number }
  | { kind: 'clip'; trackId: string; clipId: string; frameStart: number; frameEnd: number }
  | { kind: 'candidate'; trackId: string; candidateIds: string[]; ignored: boolean }
  | { kind: 'region'; trackId: string; regionId: string; linked: boolean }
  | { kind: 'cue'; cueId: string; trackId: string; linked: boolean }

export type DialogueAudioSelectionFocus = {
  kind: 'range' | 'candidate' | 'region' | 'clip'
  trackId: string
  frameStart: number
  frameEnd: number
}

export type DialogueAudioContextCommand =
  | 'track-vad-mode'
  | 'redetect-track'
  | 'track-height'
  | 'clear-track'
  | 'import-here'
  | 'paste-overwrite'
  | 'paste-insert'
  | 'insert-silence'
  | 'assign-sound'
  | 'copy'
  | 'cut'
  | 'silence'
  | 'ripple-delete'
  | 'select-clip'
  | 'redetect-clip'
  | 'ignore-candidate'
  | 'restore-candidate'
  | 'edit-sound'
  | 'select-sheet-cue'
  | 'align-audio-to-cue'
  | 'align-cue-to-audio'
  | 'unlink-sound'
  | 'remove-region'

export interface DialogueAudioContextAvailability {
  hasClipboard: boolean
  busy: boolean
  targetHasAudio: boolean
}

/**
 * Resolves overlapping timeline layers before any menu changes selection.
 * A manually dragged range owns its covered track area; semantic selections
 * (VAD, dialogue region, clip) do not mask a newly hit object.
 */
export function resolveDialogueAudioContextTarget(
  hitTarget: DialogueAudioContextTarget,
  selection: DialogueAudioSelectionFocus | null,
  frame: number,
): DialogueAudioContextTarget {
  if (hitTarget.kind === 'track' || hitTarget.kind === 'cue') return hitTarget
  if (selection?.kind === 'range'
    && selection.trackId === hitTarget.trackId
    && frame >= selection.frameStart
    && frame <= selection.frameEnd) {
    return {
      kind: 'range',
      trackId: selection.trackId,
      frameStart: selection.frameStart,
      frameEnd: selection.frameEnd,
    }
  }
  return hitTarget
}

/**
 * Owns the target-to-command contract. The UI deliberately omits commands
 * which do not make sense for the object that was actually right-clicked.
 */
export function dialogueAudioContextCommands(
  target: DialogueAudioContextTarget,
  availability: DialogueAudioContextAvailability,
): DialogueAudioContextCommand[] {
  const paste = availability.hasClipboard && !availability.busy
    ? ['paste-overwrite', 'paste-insert'] as const
    : []
  switch (target.kind) {
    case 'track':
      return [
        'track-vad-mode',
        ...(!availability.busy && availability.targetHasAudio ? ['redetect-track'] as const : []),
        'track-height',
        ...(!availability.busy && availability.targetHasAudio ? ['clear-track'] as const : []),
      ]
    case 'empty':
      return [
        ...(!availability.busy ? ['import-here'] as const : []),
        ...paste,
        ...(!availability.busy ? ['insert-silence'] as const : []),
      ]
    case 'range':
      return [
        'assign-sound',
        'copy',
        ...(!availability.busy ? ['cut'] as const : []),
        ...paste,
        ...(!availability.busy ? ['silence', 'ripple-delete', 'insert-silence'] as const : []),
      ]
    case 'clip':
      return [
        'select-clip',
        'copy',
        ...(!availability.busy ? ['cut', 'silence', 'ripple-delete', 'redetect-clip'] as const : []),
      ]
    case 'candidate':
      return target.ignored ? ['restore-candidate'] : ['assign-sound', 'ignore-candidate']
    case 'region':
      return [
        target.linked ? 'edit-sound' : 'assign-sound',
        ...(target.linked
          ? ['select-sheet-cue', 'align-audio-to-cue', 'align-cue-to-audio', 'unlink-sound'] as const
          : []),
        ...(!availability.busy ? ['silence', 'ripple-delete', 'remove-region'] as const : []),
      ]
    case 'cue':
      return [
        'edit-sound',
        'select-sheet-cue',
        ...(target.linked
          ? ['align-audio-to-cue', 'align-cue-to-audio', 'unlink-sound'] as const
          : []),
      ]
  }
}
