import { activeCutProjectFromDocument, type ClipRegistrationPlan, type CutGroupProjectDocument } from '@xsheet-remap/core'
import { dialogueAudioCutStateFromProject, type DialogueClipSource } from './dialogueAudioProject'

/** UI extension boundary: the CLIP adapter receives a format-independent audio plan. */
export function withDialogueAudioPlan(document: CutGroupProjectDocument, plan: ClipRegistrationPlan): ClipRegistrationPlan {
  return { ...plan, timelines: plan.timelines.map(timeline => {
    const project = activeCutProjectFromDocument({ ...document, activeCutId: timeline.id })
    const { frameOrigin, durationFrames } = project.logicalSheet
    const state = dialogueAudioCutStateFromProject(project, frameOrigin, durationFrames)
    const sources = state.managedClipSources ?? []
    if (!state.tracks.some(track => track.clips.length) && !sources.length) return timeline
    // Older audio-only imports did not populate the cut-to-native-timeline map.
    // Recover only an unambiguous single-cut mapping from verified source provenance.
    const sourceIds = new Set(sources.map(source => source.timelineId))
    const sourceTimelineId = timeline.sourceTimelineId ?? (document.cuts.length === 1 && sourceIds.size === 1 ? sources[0].timelineId : undefined)
    const matching = (source: DialogueClipSource) => source.fileHash === document.clipDocument?.source?.fileHash && source.timelineId === sourceTimelineId
    if (sources.some(source => !matching(source))) throw new Error('取り込んだ音声と書き戻し先のCLIP・タイムラインが一致しません。読み込み元のカットで書き出してください。')
    const tracks = state.tracks.filter(track => track.clips.length || track.clipSource).map(track => ({
      id: `${timeline.id}:${track.trackId}`, name: track.name ?? track.trackId, sourceLayerId: track.clipSource && matching(track.clipSource) ? track.clipSource.layerId : undefined,
      muted: track.muted,
      clips: track.clips.map(clip => ({ id: clip.clipId, assetId: clip.assetId, startFrame: clip.timelineStartFrame - frameOrigin, sourceOffsetFrames: clip.sourceOffsetFrames, durationFrames: clip.durationFrames, muted: clip.muted })),
    }))
    return { ...timeline, sourceTimelineId, audio: { replacedLayerIds: sources.map(source => source.layerId), tracks,
      assets: state.assets.map(asset => ({ id: asset.assetId, name: asset.sourceName ?? '音声', dataUrl: asset.audioDataUrl, durationFrames: asset.durationFrames, sourceItemId: sources.length ? asset.sourceItemId : undefined })),
    } }
  }) }
}
