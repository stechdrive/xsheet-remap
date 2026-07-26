import { describe, expect, it } from 'vitest'
import {
  dialogueAudioContextCommands,
  resolveDialogueAudioContextTarget,
  type DialogueAudioContextTarget,
} from './dialogueAudioContextMenuModel'

const available = { hasClipboard: true, busy: false, targetHasAudio: true }

describe('dialogueAudioContextCommands', () => {
  it('keeps global VAD settings out of every context target', () => {
    const targets: DialogueAudioContextTarget[] = [
      { kind: 'track', trackId: 'dialogue-1' },
      { kind: 'empty', trackId: 'dialogue-1' },
      { kind: 'range', trackId: 'dialogue-1', frameStart: 12, frameEnd: 24 },
      { kind: 'clip', trackId: 'dialogue-1', clipIds: ['clip-1'], frameStart: 12, frameEnd: 24 },
      { kind: 'candidate', trackId: 'dialogue-1', candidateIds: ['vad-1'], ignored: false },
      { kind: 'region', trackId: 'dialogue-1', regionId: 'region-1', linked: true },
      { kind: 'cue', cueId: 'cue-1', trackId: 'dialogue-1', linked: true },
    ]
    targets.forEach(target => expect(dialogueAudioContextCommands(target, available)).not.toContain('global-vad-settings'))
  })

  it('offers track management only on a track header', () => {
    expect(dialogueAudioContextCommands({ kind: 'track', trackId: 'dialogue-1' }, available)).toEqual([
      'track-vad-mode',
      'redetect-track',
      'track-height',
      'clear-track',
    ])
  })

  it('uses the playhead for placement operations on an empty track area', () => {
    expect(dialogueAudioContextCommands({ kind: 'empty', trackId: 'dialogue-2' }, available)).toEqual([
      'import-here',
      'paste-overwrite',
      'paste-insert',
      'insert-silence',
    ])
  })

  it('does not mix audio deletion into a VAD candidate menu', () => {
    expect(dialogueAudioContextCommands({
      kind: 'candidate',
      trackId: 'dialogue-1',
      candidateIds: ['vad-1'],
      ignored: false,
    }, available)).toEqual(['assign-sound', 'ignore-candidate'])
  })

  it('uses ID-based clip commands instead of destructive time-range commands', () => {
    expect(dialogueAudioContextCommands({
      kind: 'clip',
      trackId: 'dialogue-1',
      clipIds: ['clip-1', 'clip-2'],
      frameStart: 10,
      frameEnd: 30,
    }, available)).toEqual(['copy', 'cut', 'delete-clips', 'redetect-clips'])
  })

  it('shows link maintenance only for linked regions and cues', () => {
    expect(dialogueAudioContextCommands({
      kind: 'region',
      trackId: 'dialogue-1',
      regionId: 'region-1',
      linked: true,
    }, available)).toContain('unlink-sound')
    expect(dialogueAudioContextCommands({
      kind: 'region',
      trackId: 'dialogue-1',
      regionId: 'region-1',
      linked: false,
    }, available)).not.toContain('unlink-sound')
  })

  it('omits mutating commands while playback or recording is busy', () => {
    expect(dialogueAudioContextCommands({
      kind: 'range',
      trackId: 'dialogue-1',
      frameStart: 1,
      frameEnd: 12,
    }, { hasClipboard: true, busy: true, targetHasAudio: true })).toEqual(['assign-sound', 'copy'])
  })
})

describe('resolveDialogueAudioContextTarget', () => {
  const manualRange = { kind: 'range' as const, trackId: 'dialogue-1', frameStart: 10, frameEnd: 30 }

  it.each([
    { kind: 'empty' as const, trackId: 'dialogue-1' },
    { kind: 'candidate' as const, trackId: 'dialogue-1', candidateIds: ['vad-1'], ignored: false },
    { kind: 'region' as const, trackId: 'dialogue-1', regionId: 'region-1', linked: true },
    { kind: 'clip' as const, trackId: 'dialogue-1', clipIds: ['clip-1'], frameStart: 1, frameEnd: 40 },
  ])('keeps a manual range active over an overlapping $kind hit', hitTarget => {
    expect(resolveDialogueAudioContextTarget(hitTarget, manualRange, 20)).toEqual({
      kind: 'range',
      trackId: 'dialogue-1',
      frameStart: 10,
      frameEnd: 30,
    })
  })

  it('uses the hit object outside the manual range or on another track', () => {
    const candidate = { kind: 'candidate' as const, trackId: 'dialogue-1', candidateIds: ['vad-1'], ignored: false }
    expect(resolveDialogueAudioContextTarget(candidate, manualRange, 40)).toBe(candidate)
    expect(resolveDialogueAudioContextTarget(
      { ...candidate, trackId: 'dialogue-2' },
      manualRange,
      20,
    )).toEqual({ ...candidate, trackId: 'dialogue-2' })
  })

  it('does not let semantic selections mask another explicit hit', () => {
    const candidate = { kind: 'candidate' as const, trackId: 'dialogue-1', candidateIds: ['vad-2'], ignored: false }
    expect(resolveDialogueAudioContextTarget(candidate, {
      kind: 'candidate',
      trackId: 'dialogue-1',
      candidateIds: ['vad-1'],
      frameStart: 10,
      frameEnd: 30,
    }, 20)).toBe(candidate)
  })

  it('always preserves dedicated cue and track-header targets', () => {
    const cue = { kind: 'cue' as const, cueId: 'cue-1', trackId: 'dialogue-1', linked: true }
    const track = { kind: 'track' as const, trackId: 'dialogue-1' }
    expect(resolveDialogueAudioContextTarget(cue, manualRange, 20)).toBe(cue)
    expect(resolveDialogueAudioContextTarget(track, manualRange, 20)).toBe(track)
  })

  it('keeps the complete multi-clip selection when a selected handle is right-clicked', () => {
    const selection = {
      kind: 'clip' as const,
      trackId: 'dialogue-1',
      clipIds: ['clip-1', 'clip-2'],
      frameStart: 10,
      frameEnd: 42,
    }
    expect(resolveDialogueAudioContextTarget({
      kind: 'clip',
      trackId: 'dialogue-1',
      clipIds: ['clip-2'],
      frameStart: 30,
      frameEnd: 42,
    }, selection, 35)).toEqual(selection)
  })
})
