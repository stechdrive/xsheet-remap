import type { CutProject } from '@xsheet-remap/core'
import { decodeAudioDataUrl, pcmToWavBlob, type PcmAudio } from './dialogueAudioEngine'
import { encodeDialogueAudioMp3 } from './dialogueAudioMp3'
import { dialogueAudioCutStateFromProject, type DialogueAudioAsset, type DialogueAudioClip } from './dialogueAudioProject'
import { dialogueAudioTrackFileName, type DialogueAudioTrackExportFormat } from './outputFileNames'

export type { DialogueAudioTrackExportFormat } from './outputFileNames'

export const DIALOGUE_AUDIO_EXPORT_SAMPLE_RATE = 48_000

export interface DialogueAudioTrackExportPlan {
  trackId: string
  trackIndex: number
  clips: DialogueAudioClip[]
  frameOrigin: number
  durationFrames: number
  fps: number
}

export interface DialogueAudioTrackBinaryOutput {
  fileName: string
  bytes: Uint8Array
  mimeType: 'audio/wav' | 'audio/mpeg'
}

export function dialogueAudioTrackExportPlans(project: CutProject): DialogueAudioTrackExportPlan[] {
  const frameOrigin = project.logicalSheet.frameOrigin
  const durationFrames = project.logicalSheet.durationFrames
  const frameEnd = frameOrigin + durationFrames
  const state = dialogueAudioCutStateFromProject(project, frameOrigin, durationFrames)
  return state.tracks.flatMap((track, trackIndex) => {
    const clips = track.clips.filter(clip => (
      clip.timelineStartFrame < frameEnd
      && clip.timelineStartFrame + clip.durationFrames > frameOrigin
    ))
    return clips.length > 0 ? [{
      trackId: track.trackId,
      trackIndex,
      clips,
      frameOrigin,
      durationFrames,
      fps: project.logicalSheet.fps,
    }] : []
  })
}

export function renderDialogueAudioTrackPcm(
  plan: DialogueAudioTrackExportPlan,
  decodedAssets: ReadonlyMap<string, PcmAudio>,
  sampleRate = DIALOGUE_AUDIO_EXPORT_SAMPLE_RATE,
): PcmAudio {
  const safeFps = Math.max(1, plan.fps)
  const safeSampleRate = Math.max(1, Math.round(sampleRate))
  const output = new Float32Array(Math.max(0, Math.round(plan.durationFrames * safeSampleRate / safeFps)))
  const cutFrameEnd = plan.frameOrigin + plan.durationFrames

  for (const clip of plan.clips) {
    const source = decodedAssets.get(clip.assetId)
    if (!source || source.samples.length === 0) continue
    const clipFrameEnd = clip.timelineStartFrame + clip.durationFrames
    const overlapStart = Math.max(plan.frameOrigin, clip.timelineStartFrame)
    const overlapEnd = Math.min(cutFrameEnd, clipFrameEnd)
    if (overlapEnd <= overlapStart) continue
    const outputStart = Math.max(0, Math.round((overlapStart - plan.frameOrigin) * safeSampleRate / safeFps))
    const outputEnd = Math.min(output.length, Math.round((overlapEnd - plan.frameOrigin) * safeSampleRate / safeFps))

    for (let outputIndex = outputStart; outputIndex < outputEnd; outputIndex += 1) {
      const timelineFrame = plan.frameOrigin + outputIndex * safeFps / safeSampleRate
      const sourceFrame = clip.sourceOffsetFrames + timelineFrame - clip.timelineStartFrame
      const sourcePosition = sourceFrame * source.sampleRate / safeFps
      if (sourcePosition < 0 || sourcePosition >= source.samples.length) continue
      const low = Math.floor(sourcePosition)
      const high = Math.min(source.samples.length - 1, low + 1)
      const mix = sourcePosition - low
      output[outputIndex] += source.samples[low] * (1 - mix) + source.samples[high] * mix
    }
  }

  for (let index = 0; index < output.length; index += 1) {
    output[index] = Math.max(-1, Math.min(1, output[index]))
  }
  return { samples: output, sampleRate: safeSampleRate }
}

export async function createDialogueAudioTrackExports(
  project: CutProject,
  format: DialogueAudioTrackExportFormat,
  options: {
    createAudioContext?: () => AudioContext
    decodeAsset?: (asset: DialogueAudioAsset, context: AudioContext) => Promise<PcmAudio>
  } = {},
): Promise<DialogueAudioTrackBinaryOutput[]> {
  const plans = dialogueAudioTrackExportPlans(project)
  if (plans.length === 0) return []
  const state = dialogueAudioCutStateFromProject(
    project,
    project.logicalSheet.frameOrigin,
    project.logicalSheet.durationFrames,
  )
  const requiredAssetIds = new Set(plans.flatMap(plan => plan.clips.map(clip => clip.assetId)))
  const requiredAssets = state.assets.filter(asset => requiredAssetIds.has(asset.assetId))
  const context = (options.createAudioContext ?? (() => new AudioContext()))()
  const decodeAsset = options.decodeAsset ?? ((asset: DialogueAudioAsset, audioContext: AudioContext) => (
    decodeAudioDataUrl(asset.audioDataUrl, audioContext)
  ))
  try {
    const decodedEntries = await Promise.all(requiredAssets.map(async asset => (
      [asset.assetId, await decodeAsset(asset, context)] as const
    )))
    const decodedAssets = new Map(decodedEntries)
    const outputs: DialogueAudioTrackBinaryOutput[] = []
    for (const plan of plans) {
      const pcm = renderDialogueAudioTrackPcm(plan, decodedAssets)
      const bytes = format === 'wav'
        ? new Uint8Array(await pcmToWavBlob(pcm).arrayBuffer())
        : await encodeDialogueAudioMp3(pcm)
      outputs.push({
        fileName: dialogueAudioTrackFileName(project, plan.trackIndex, format),
        bytes,
        mimeType: format === 'wav' ? 'audio/wav' : 'audio/mpeg',
      })
    }
    return outputs
  } finally {
    await context.close()
  }
}
