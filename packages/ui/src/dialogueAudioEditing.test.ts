import { describe, expect, it } from 'vitest'
import {
  addDialogueAudioClip,
  copyDialogueAudioClips,
  copyDialogueAudioRange,
  insertDialogueAudioSilence,
  moveDialogueAudioClip,
  moveDialogueAudioClips,
  pasteDialogueAudioClipboard,
  reconcileDialogueSpeechCandidates,
  removeDialogueAudioClips,
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
      { candidateId: 'candidate-2', frameStart: 15, frameEnd: 20, status: 'linked' },
    ],
    dialogueRegions: [],
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

  it('adds an overlapping recording without trimming the clip or candidate already underneath it', () => {
    const source = track()
    const added = addDialogueAudioClip(source, {
      clipId: 'clip-2',
      placementId: 'placement-2',
      assetId: 'asset-2',
      timelineStartFrame: 5,
      sourceOffsetFrames: 0,
      durationFrames: 12,
    })
    expect(added.clips).toHaveLength(2)
    expect(added.clips[0]).toEqual(source.clips[0])
    expect(added.speechCandidates).toEqual(source.speechCandidates)
  })

  it('moves an ID-selected clip group and only its source-associated VAD candidates', () => {
    const source = track()
    source.clips = [
      { clipId: 'clip-a', placementId: 'placement-a', assetId: 'asset-a', timelineStartFrame: 1, sourceOffsetFrames: 0, durationFrames: 12 },
      { clipId: 'clip-b', placementId: 'placement-b', assetId: 'asset-b', timelineStartFrame: 4, sourceOffsetFrames: 0, durationFrames: 12 },
      { clipId: 'clip-c', placementId: 'placement-c', assetId: 'asset-c', timelineStartFrame: 20, sourceOffsetFrames: 0, durationFrames: 8 },
    ]
    source.speechCandidates = [
      { candidateId: 'vad-a', frameStart: 3, frameEnd: 7, status: 'pending', source: { placementId: 'placement-a', assetId: 'asset-a', sourceFrameStart: 2, sourceFrameEnd: 6 } },
      { candidateId: 'vad-b', frameStart: 5, frameEnd: 8, status: 'pending', source: { placementId: 'placement-b', assetId: 'asset-b', sourceFrameStart: 1, sourceFrameEnd: 4 } },
      { candidateId: 'vad-c', frameStart: 21, frameEnd: 23, status: 'pending', source: { placementId: 'placement-c', assetId: 'asset-c', sourceFrameStart: 1, sourceFrameEnd: 3 } },
    ]

    const moved = moveDialogueAudioClips(source, ['clip-a', 'clip-c'], 6)
    expect(moved.clips.map(clip => [clip.clipId, clip.timelineStartFrame])).toEqual([
      ['clip-b', 4],
      ['clip-a', 7],
      ['clip-c', 26],
    ])
    expect(moved.speechCandidates.map(candidate => [candidate.candidateId, candidate.frameStart, candidate.frameEnd])).toEqual([
      ['vad-b', 5, 8],
      ['vad-a', 9, 13],
      ['vad-c', 27, 29],
    ])
  })

  it('deletes selected clip IDs without erasing another clip at the same timeline range', () => {
    const source = track()
    source.clips.push({
      clipId: 'clip-2',
      placementId: 'placement-2',
      assetId: 'asset-2',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      durationFrames: 24,
    })
    source.speechCandidates = [{
      candidateId: 'vad-2',
      frameStart: 3,
      frameEnd: 8,
      status: 'pending',
      source: { placementId: 'placement-2', assetId: 'asset-2', sourceFrameStart: 2, sourceFrameEnd: 7 },
    }]

    const removed = removeDialogueAudioClips(source, ['clip-1'])
    expect(removed.clips.map(clip => clip.clipId)).toEqual(['clip-2'])
    expect(removed.speechCandidates.map(candidate => candidate.candidateId)).toEqual(['vad-2'])
  })

  it('copies multiple clips as an ID set and preserves their relative placement when pasted', () => {
    const source = track()
    source.clips.push({
      clipId: 'clip-2',
      placementId: 'placement-2',
      assetId: 'asset-2',
      timelineStartFrame: 30,
      sourceOffsetFrames: 4,
      durationFrames: 6,
    })
    const clipboard = copyDialogueAudioClips(source, ['clip-1', 'clip-2'])
    expect(clipboard).not.toBeNull()
    const pasted = pasteDialogueAudioClipboard(source, clipboard!, 50, 'overwrite')
    expect(pasted.clips.some(clip => clip.timelineStartFrame === 50 && clip.durationFrames === 24)).toBe(true)
    expect(pasted.clips.some(clip => clip.timelineStartFrame === 79 && clip.durationFrames === 6)).toBe(true)
  })

  it('re-detects only the addressed source placement when overlapping recordings share a time range', () => {
    const existing = [
      { candidateId: 'vad-a', frameStart: 3, frameEnd: 6, status: 'pending' as const, source: { placementId: 'placement-a', assetId: 'asset-a', sourceFrameStart: 2, sourceFrameEnd: 5 } },
      { candidateId: 'vad-b', frameStart: 3, frameEnd: 6, status: 'pending' as const, source: { placementId: 'placement-b', assetId: 'asset-b', sourceFrameStart: 2, sourceFrameEnd: 5 } },
    ]
    const reconciled = reconcileDialogueSpeechCandidates(existing, [{ frameStart: 8, frameEnd: 10 }], 'dialogue-1', {
      placementId: 'placement-a',
      assetId: 'asset-a',
      timelineStartFrame: 1,
      sourceOffsetFrames: 0,
      sourceFrameStart: 0,
      sourceFrameEnd: 11,
    })
    expect(reconciled.find(candidate => candidate.candidateId === 'vad-b')).toEqual(existing[1])
    expect(reconciled.some(candidate => candidate.source?.placementId === 'placement-a' && candidate.frameStart === 8)).toBe(true)
    expect(reconciled.some(candidate => candidate.candidateId === 'vad-a')).toBe(false)
  })
})
