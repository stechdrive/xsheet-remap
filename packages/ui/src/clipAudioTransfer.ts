import { createTimedRangeCue, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart, type CutProject } from '@xsheet-remap/core'
import type { ClipAudioReadResult } from '@xsheet-remap/adapters'
import { blobToDataUrl, decodeAudioBlob, durationFramesForAudio, summarizeDialogueWaveform } from './dialogueAudioEngine'
import { dialogueAudioCutStateFromProject, updateDialogueAudioCutStateInProject, type DialogueAudioAsset, type DialogueAudioClip, type DialogueClipSource, type DialogueRegion } from './dialogueAudioProject'
import { addDialogueAudioTrack } from './dialogueAudioCommands'
import { bindDialogueRegionsToCue } from './dialogueAudioBinding'
import { resolveAvailableSoundCueLane, SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE } from './soundCueEditing'

export interface PreparedClipAudio { fps: number; assets: DialogueAudioAsset[]; clips: DialogueAudioClip[]; importId: string; source?: DialogueClipSource; name?: string }

export async function prepareClipAudio(data: ClipAudioReadResult, importId: string, frameOrigin: number, context: AudioContext): Promise<PreparedClipAudio> {
  const assets: DialogueAudioAsset[] = []
  for (const item of data.assets) {
    const blob = new Blob([Uint8Array.from(item.bytes)], { type: item.mimeType })
    const audio = await decodeAudioBlob(blob, context)
    assets.push({ assetId: `${importId}:${item.id}`, sourceItemId: item.id, sourceName: item.name, audioDataUrl: await blobToDataUrl(blob),
      durationFrames: durationFramesForAudio(audio, data.fps), waveform: summarizeDialogueWaveform(audio.samples, 1024) })
  }
  const clips = data.clips.map((item, index) => ({ clipId: `${importId}:${index}`, placementId: `${importId}:${index}`, assetId: `${importId}:${item.assetId}`,
    timelineStartFrame: frameOrigin + item.startFrame, sourceOffsetFrames: item.sourceOffsetFrames, durationFrames: item.durationFrames, ...(item.muted ? { muted: true } : {}) }))
  return { fps: data.fps, assets, clips, importId }
}

/** One immutable transaction, including optional SOUND ranges and their audio links. */
export function placeClipAudio(project: CutProject, prepared: PreparedClipAudio, options: { trackId: string; muted: boolean; revisionId?: string; sound: boolean }): CutProject {
  const { frameOrigin, durationFrames, fps } = project.logicalSheet
  if (Math.abs(prepared.fps - fps) > 0.0001) throw new Error(`CLIPは${prepared.fps}fps、シートは${fps}fpsです。FPSを合わせてから取り込んでください。`)
  let state = dialogueAudioCutStateFromProject(project, frameOrigin, durationFrames)
  if (options.trackId === 'new') state = addDialogueAudioTrack(state, prepared.name)
  const track = state.tracks.find(item => item.trackId === (options.trackId === 'new' ? state.activeTrackId : options.trackId))
  if (!track) throw new Error('取り込み先の音声トラックを選択してください。')
  if (track.locked) throw new Error('取り込み先の音声トラックをロック解除してください。')
  if (prepared.source && state.managedClipSources?.some(item => item.fileHash === prepared.source!.fileHash && item.layerId === prepared.source!.layerId && item.timelineId === prepared.source!.timelineId)) throw new Error('この音声レイヤー・タイムラインは取り込み済みです。')
  if (prepared.source && track.clipSource) throw new Error('別のCLIP音声が対応済みです。新規トラックを選択してください。')
  if (state.assets.some(asset => asset.assetId.startsWith(prepared.importId + ':'))) throw new Error('この音声レイヤー・タイムラインは取り込み済みです。')
  if (!prepared.clips.length) throw new Error('取り込める音声クリップがありません。')
  if (track.clips.length && track.muted !== options.muted) throw new Error('ミュート状態の異なる音声があります。空のトラックを選択してください。')
  for (const clip of prepared.clips) {
    const asset = prepared.assets.find(item => item.assetId === clip.assetId)
    if (!asset || clip.sourceOffsetFrames < 0 || clip.durationFrames < 1 || clip.sourceOffsetFrames + clip.durationFrames > asset.durationFrames) throw new Error('音声クリップの素材範囲が音声データを超えています。')
    if (track.clips.some(existing => existing.timelineStartFrame < clip.timelineStartFrame + clip.durationFrames && existing.timelineStartFrame + existing.durationFrames > clip.timelineStartFrame)) throw new Error('取り込み先の音声と重なります。空のトラックを選択してください。')
  }
  const assetIds = new Map(prepared.assets.map(asset => [asset.assetId, state.assets.find(item => asset.sourceItemId && item.sourceItemId === asset.sourceItemId && item.audioDataUrl === asset.audioDataUrl)?.assetId ?? asset.assetId]))
  prepared = { ...prepared, assets: prepared.assets.filter(asset => assetIds.get(asset.assetId) === asset.assetId), clips: prepared.clips.map(clip => ({ ...clip, assetId: assetIds.get(clip.assetId)! })) }
  const regions: DialogueRegion[] = prepared.clips.map(clip => ({ regionId: clip.clipId, candidateIds: [],
    frameStart: clip.timelineStartFrame, frameEnd: clip.timelineStartFrame + clip.durationFrames - 1, headPaddingFrames: 0, tailPaddingFrames: 0, status: 'ready',
    anchors: [{ anchorId: clip.clipId, placementId: clip.placementId, assetId: clip.assetId, sourceFrameStart: clip.sourceOffsetFrames, sourceFrameEnd: clip.sourceOffsetFrames + clip.durationFrames - 1, candidateIds: [] }] }))
  state = { ...state, assets: [...state.assets, ...prepared.assets], activeTrackId: track.trackId,
    managedClipSources: [...(state.managedClipSources ?? []), ...(prepared.source ? [prepared.source] : [])],
    tracks: state.tracks.map(item => item.trackId === track.trackId ? { ...item, clipSource: prepared.source, name: prepared.name ?? item.name, clips: [...item.clips, ...prepared.clips].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame), dialogueRegions: [...item.dialogueRegions, ...regions], muted: options.muted } : item) }
  let next = project
  if (options.sound) {
    if (!options.revisionId) throw new Error('SOUNDを登録するシート版がありません。')
    for (const region of regions) {
      if (region.frameStart < logicalSheetDisplayFrameStart(project.logicalSheet) || region.frameEnd > logicalSheetDisplayFrameEnd(project.logicalSheet)) throw new Error('音声がシートの表示範囲を超えています。尺を広げるか「SOUNDに区間を表示」を外してください。')
      const lane = resolveAvailableSoundCueLane(next, '', region.frameStart, region.frameEnd)
      if (!lane) throw new Error(SOUND_CUE_PLACEMENT_CONFLICT_MESSAGE)
      const label = state.assets.find(asset => asset.assetId === region.anchors[0].assetId)?.sourceName ?? '音声'
      const created = createTimedRangeCue(next, { role: 'sound', laneId: lane.laneId, frameStart: region.frameStart, frameEnd: region.frameEnd, label })
      next = created.project
      state = bindDialogueRegionsToCue(state, [{ trackId: track.trackId, regionId: region.regionId }], created.cue, options.revisionId, next.timedRangeCues)
    }
  }
  return updateDialogueAudioCutStateInProject(next, state, frameOrigin, durationFrames)
}
