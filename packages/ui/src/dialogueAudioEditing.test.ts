import { describe, expect, it } from 'vitest'
import {
  copyDialogueAudioRange,
  insertDialogueAudioSilence,
  moveDialogueAudioClip,
  pasteDialogueAudioClipboard,
  reconcileDialogueSpeechCandidates,
  rippleDeleteDialogueAudioRange,
  silenceDialogueAudioRange,
} from './dialogueAudioEditing'
import type { DialogueAudioTrackState } from './dialogueAudioProject'

function track(): DialogueAudioTrackState {
  return {
    trackId: 'dialogue-1',
    color: '#fff',
    clips: [{ clipId: 'clip-1', placementId: 'placement-1', assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 24 }],
    speechCandidates: [
      { candidateId: 'candidate-1', frameStart: 3, frameEnd: 8, status: 'pending' },
      { candidateId: 'candidate-2', frameStart: 15, frameEnd: 20, status: 'linked', cueLinks: [{ revisionId: 'revision-1', cueId: 'cue-1' }] },
    ],
    vadMode: 'candidates',
    muted: false,
  }
}

describe('dialogue audio non-destructive editing', () => {
  it('silences a range by splitting clip references and flags linked labels for review', () => {
    const edited = silenceDialogueAudioRange(track(), { frameStart: 5, frameEnd: 17 })
    expect(edited.clips).toEqual([
      expect.objectContaining({ timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 4 }),
      expect.objectContaining({ timelineStartFrame: 18, sourceOffsetFrames: 17, durationFrames: 7 }),
    ])
    expect(edited.speechCandidates).toEqual([
      expect.objectContaining({ candidateId: 'candidate-2', status: 'review' }),
    ])
  })

  it('ripple deletes a selected range and shifts later linked candidates', () => {
    const edited = rippleDeleteDialogueAudioRange(track(), { frameStart: 9, frameEnd: 12 })
    expect(edited.clips).toEqual([
      expect.objectContaining({ timelineStartFrame: 1, durationFrames: 8 }),
      expect.objectContaining({ timelineStartFrame: 9, sourceOffsetFrames: 12, durationFrames: 12 }),
    ])
    expect(edited.speechCandidates[1]).toMatchObject({ frameStart: 11, frameEnd: 16, status: 'linked' })
  })

  it('inserts arbitrary silence by splitting a source clip without rewriting its asset', () => {
    const edited = insertDialogueAudioSilence(track(), 10, 3)
    expect(edited.clips).toEqual([
      expect.objectContaining({ assetId: 'asset-1', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 9 }),
      expect.objectContaining({ assetId: 'asset-1', timelineStartFrame: 13, sourceOffsetFrames: 9, durationFrames: 15 }),
    ])
    expect(edited.speechCandidates[1]).toMatchObject({ frameStart: 18, frameEnd: 23 })
  })

  it('copies and insert-pastes clip slices as new references', () => {
    const source = track()
    const clipboard = copyDialogueAudioRange(source, { frameStart: 5, frameEnd: 8 })
    const pasted = pasteDialogueAudioClipboard(source, clipboard, 12, 'insert')
    expect(clipboard.spanFrames).toBe(4)
    expect(pasted.clips.some(clip => clip.assetId === 'asset-1' && clip.timelineStartFrame === 12 && clip.sourceOffsetFrames === 4 && clip.durationFrames === 4)).toBe(true)
    expect(pasted.clips.find(clip => clip.timelineStartFrame === 12)?.placementId).not.toBe('placement-1')
  })

  it('moves a clip and its contained VAD regions without changing source offsets', () => {
    const moved = moveDialogueAudioClip(track(), 'clip-1', 9)
    expect(moved.clips[0]).toMatchObject({ timelineStartFrame: 9, sourceOffsetFrames: 0, placementId: 'placement-1' })
    expect(moved.speechCandidates).toEqual([
      expect.objectContaining({ candidateId: 'candidate-1', frameStart: 11, frameEnd: 16 }),
      expect.objectContaining({ candidateId: 'candidate-2', frameStart: 23, frameEnd: 28 }),
    ])
  })

  it('preserves processed labels across re-detection and marks unmatched links for review', () => {
    const existing = track().speechCandidates
    const reconciled = reconcileDialogueSpeechCandidates(existing, [
      { frameStart: 4, frameEnd: 9 },
      { frameStart: 30, frameEnd: 35 },
    ], 'dialogue-1')
    expect(reconciled.some(candidate => candidate.candidateId === 'candidate-2' && candidate.status === 'review')).toBe(true)
    expect(reconciled.filter(candidate => candidate.status === 'pending')).toHaveLength(2)
  })
})
