import { describe, expect, it } from 'vitest'
import { commitHistory, createDefaultProject, createProjectHistory, createTimedRangeCue, redoHistory, timelineLanesForLayout, undoHistory } from '@xsheet-remap/core'
import { placeClipAudio, type PreparedClipAudio } from './clipAudioTransfer'
import { dialogueAudioCutStateFromProject } from './dialogueAudioProject'
import { applySoundCueChangesToDialogueAudio, resolveDialogueBinding } from './dialogueAudioBinding'

function prepared(): PreparedClipAudio {
  return { fps: 24, importId: 'import', assets: [{ assetId: 'import:wave', sourceName: 'セリフ001', audioDataUrl: 'data:audio/wav;base64,AA==', durationFrames: 96, waveform: [.1, .2] }],
    clips: [{ clipId: 'import:0', placementId: 'import:0', assetId: 'import:wave', timelineStartFrame: 13, sourceOffsetFrames: 6, durationFrames: 24 }] }
}
const options = { trackId: 'dialogue-2', muted: false, revisionId: 'sheet-main', sound: true }
const audio = (project: ReturnType<typeof createDefaultProject>) => dialogueAudioCutStateFromProject(project, project.logicalSheet.frameOrigin, project.logicalSheet.durationFrames)

describe('CLIP audio to dialogue audio and SOUND', () => {
  it('copies placement and source trim, links SOUND, and undoes/redoes the entire import once', () => {
    const project = createDefaultProject(), next = placeClipAudio(project, prepared(), options), state = audio(next)
    expect(state.tracks[1].clips[0]).toMatchObject(prepared().clips[0])
    expect(state.assets[0].audioDataUrl).toBe(prepared().assets[0].audioDataUrl)
    expect(next.timedRangeCues[0]).toMatchObject({ frameStart: 13, frameEnd: 36, label: 'セリフ001', text: '' })
    expect(state.soundBindings[0]).toMatchObject({ status: 'linked', revisionId: 'sheet-main' })
    expect(resolveDialogueBinding(state, state.soundBindings[0])).toMatchObject({ frameStart: 13, frameEnd: 36, complete: true })
    const movedCues = next.timedRangeCues.map(cue => ({ ...cue, frameStart: cue.frameStart + 5, frameEnd: cue.frameEnd + 5 }))
    const moved = applySoundCueChangesToDialogueAudio(state, next.timedRangeCues, movedCues, 'sheet-main', 'move-binding')
    expect(moved.tracks[1].clips[0]).toMatchObject({ timelineStartFrame: 18, sourceOffsetFrames: 6, durationFrames: 24 })
    const history = commitHistory(createProjectHistory(project), next)
    expect(undoHistory(history).present).toEqual(project)
    expect(redoHistory(undoHistory(history)).present).toEqual(next)
    expect(project.timedRangeCues).toEqual([])
  })
  it('keeps existing sound and audio on collisions, duplicated imports, fps mismatch and invalid trim', () => {
    const project = createDefaultProject(), data = prepared(), first = placeClipAudio(project, data, options)
    expect(() => placeClipAudio(first, data, options)).toThrow('取り込み済み')
    expect(() => placeClipAudio(project, { ...data, fps: 30 }, options)).toThrow('FPS')
    expect(() => placeClipAudio(project, { ...data, clips: [{ ...data.clips[0], durationFrames: 100 }] }, options)).toThrow('素材範囲')
    const occupied = timelineLanesForLayout(project).sound!.reduce((result, lane) => createTimedRangeCue(result, { role: 'sound', laneId: lane.laneId, frameStart: 1, frameEnd: 144, label: '既存' }).project, project)
    expect(() => placeClipAudio(occupied, data, options)).toThrow('空きSOUND')
    expect(occupied.timedRangeCues).toHaveLength(timelineLanesForLayout(project).sound!.length); expect(audio(occupied).assets).toHaveLength(0)
    const second = { ...data, importId: 'another', assets: data.assets.map(asset => ({ ...asset, assetId: 'another:wave' })), clips: data.clips.map(clip => ({ ...clip, clipId: 'another:0', placementId: 'another:0', assetId: 'another:wave' })) }
    expect(() => placeClipAudio(first, second, { ...options, sound: false })).toThrow('重なります')
  })
  it('allows audio beyond the sheet only when SOUND creation is disabled; preserves muted import', () => {
    const data = prepared(); data.clips[0].timelineStartFrame = 1000
    expect(() => placeClipAudio(createDefaultProject(), data, options)).toThrow('表示範囲')
    const next = placeClipAudio(createDefaultProject(), data, { ...options, sound: false, muted: true })
    expect(next.timedRangeCues).toEqual([])
    expect(audio(next).tracks[1].muted).toBe(true)
    expect(audio(next).tracks[1].dialogueRegions[0]).toMatchObject({ frameStart: 1000, frameEnd: 1023, status: 'ready' })
  })
})
