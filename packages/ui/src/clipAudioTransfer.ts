import { createTimedRangeCue, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, type CutProject } from '@xsheet-remap/core'
import type { ClipAudioReadResult } from '@xsheet-remap/adapters'
import { blobToDataUrl, decodeAudioBlob, durationFramesForAudio, summarizeDialogueWaveform } from './dialogueAudioEngine'
import { dialogueAudioCutStateFromProject, updateDialogueAudioCutStateInProject, type DialogueAudioAsset, type DialogueAudioClip, type DialogueRegion } from './dialogueAudioProject'
import { bindDialogueRegionsToCue } from './dialogueAudioBinding'
import { resolveAvailableSoundCueLane, SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE } from './soundCueEditing'

export interface PreparedClipAudio { fps: number; assets: DialogueAudioAsset[]; clips: DialogueAudioClip[]; importId: string }

export async function prepareClipAudio(data: ClipAudioReadResult, importId: string, frameOrigin: number, context: AudioContext): Promise<PreparedClipAudio> {
  const assets: DialogueAudioAsset[] = []
  for (const item of data.assets) {
    const blob = new Blob([Uint8Array.from(item.bytes)], { type: item.mimeType })
    const audio = await decodeAudioBlob(blob, context)
    assets.push({ assetId: `${importId}:${item.id}`, sourceName: item.name, audioDataUrl: await blobToDataUrl(blob),
      durationFrames: durationFramesForAudio(audio, data.fps), waveform: summarizeDialogueWaveform(audio.samples, 1024) })
  }
  const clips = data.clips.map((item, index) => ({ clipId: `${importId}:${index}`, placementId: `${importId}:${index}`, assetId: `${importId}:${item.assetId}`,
    timelineStartFrame: frameOrigin + item.startFrame, sourceOffsetFrames: item.sourceOffsetFrames, durationFrames: item.durationFrames }))
  return { fps: data.fps, assets, clips, importId }
}

/** One immutable transaction, including optional SOUND ranges and their audio links. */
export function placeClipAudio(project: CutProject, prepared: PreparedClipAudio, options: { trackId: string; muted: boolean; revisionId?: string; sound: boolean }): CutProject {
  const { frameOrigin, durationFrames, fps } = project.logicalSheet
  if (Math.abs(prepared.fps - fps) > 0.0001) throw new Error(`CLIPは${prepared.fps}fps、シートは${fps}fpsです。FPSを合わせてから取り込んでください。`)
  let state = dialogueAudioCutStateFromProject(project, frameOrigin, durationFrames)
  const track = state.tracks.find(item => item.trackId === options.trackId)
  if (!track) throw new Error('取り込み先の音声トラックを選択してください。')
  if (state.assets.some(asset => asset.assetId.startsWith(prepared.importId + ':'))) throw new Error('この音声レイヤー・タイムラインは取り込み済みです。')
  if (!prepared.clips.length) throw new Error('取り込める音声クリップがありません。')
  if (track.clips.length && track.muted !== options.muted) throw new Error('ミュート状態の異なる音声があります。空のトラックを選択してください。')
  for (const clip of prepared.clips) {
    const asset = prepared.assets.find(item => item.assetId === clip.assetId)
    if (!asset || clip.sourceOffsetFrames < 0 || clip.durationFrames < 1 || clip.sourceOffsetFrames + clip.durationFrames > asset.durationFrames) throw new Error('音声クリップの素材範囲が音声データを超えています。')
    if (track.clips.some(existing => existing.timelineStartFrame < clip.timelineStartFrame + clip.durationFrames && existing.timelineStartFrame + existing.durationFrames > clip.timelineStartFrame)) throw new Error('取り込み先の音声と重なります。空のトラックを選択してください。')
  }
  const regions: DialogueRegion[] = prepared.clips.map(clip => ({ regionId: clip.clipId, candidateIds: [],
    frameStart: clip.timelineStartFrame, frameEnd: clip.timelineStartFrame + clip.durationFrames - 1, headPaddingFrames: 0, tailPaddingFrames: 0, status: 'ready',
    anchors: [{ anchorId: clip.clipId, placementId: clip.placementId, assetId: clip.assetId, sourceFrameStart: clip.sourceOffsetFrames, sourceFrameEnd: clip.sourceOffsetFrames + clip.durationFrames - 1, candidateIds: [] }] }))
  state = { ...state, assets: [...state.assets, ...prepared.assets], activeTrackId: track.trackId,
    tracks: state.tracks.map(item => item.trackId === track.trackId ? { ...item, clips: [...item.clips, ...prepared.clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame), dialogueRegions: [...item.dialogueRegions, ...regions], muted: options.muted } : item) }
  let next = project
  if (options.sound) {
    if (!options.revisionId) throw new Error('SOUNDを登録するシート版がありません。')
    for (const region of regions) {
      if (region.frameStart < logicalSheetDisplayFrameStart(project.logicalSheet) || region.frameEnd > logicalSheetDisplayFrameEnd(project.logicalSheet)) throw new Error('音声がシートの表示範囲を超えています。尺を広げるか「SOUNDに区間を表示」を外してください。')
      const lane = resolveAvailableSoundCueLane(next, '', region.frameStart, region.frameEnd)
      if (!lane) throw new Error(SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE)
      const label = prepared.assets.find(asset => asset.assetId === region.anchors[0].assetId)?.sourceName ?? '音声'
      const created = createTimedRangeCue(next, { role: 'sound', laneId: lane.laneId, frameStart: region.frameStart, frameEnd: region.frameEnd, label })
      next = created.project
      state = bindDialogueRegionsToCue(state, [{ trackId: track.trackId, regionId: region.regionId }], created.cue, options.revisionId, next.timedRangeCues)
    }
  }
  return updateDialogueAudioCutStateInProject(next, state, frameOrigin, durationFrames)
}
