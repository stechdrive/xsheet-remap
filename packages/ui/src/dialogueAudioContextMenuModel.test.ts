import { describe, expect, it } from 'vitest'
import { dialogueAudioContextCommands, type DialogueAudioContextTarget } from './dialogueAudioContextMenuModel'

const available = { hasClipboard: true, busy: false, targetHasAudio: true }

describe('dialogueAudioContextCommands', () => {
  it('keeps global VAD settings out of every context target', () => {
    const targets: DialogueAudioContextTarget[] = [
      { kind: 'track', trackId: 'dialogue-1' },
      { kind: 'empty', trackId: 'dialogue-1', frame: 12 },
      { kind: 'range', trackId: 'dialogue-1', frameStart: 12, frameEnd: 24 },
      { kind: 'clip', trackId: 'dialogue-1', clipId: 'clip-1', frameStart: 12, frameEnd: 24 },
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

  it('uses the clicked empty frame only for placement operations', () => {
    expect(dialogueAudioContextCommands({ kind: 'empty', trackId: 'dialogue-2', frame: 48 }, available)).toEqual([
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
