import { buildExportPlan } from './project'
import type { CutProject, MaterialState } from './types'

export interface CspLayerTreeCel {
  nodeId: string
  cspCellName: string
  firstFrame: number
  keyId?: string
  bindingId?: string
  assetId?: string
  displayLabel?: string
  materialState: MaterialState
}

export interface CspLayerTreeTrack {
  nodeId: string
  label: string
  paperTrack?: string
  stackItemId?: string
  slotId?: string
  stackGuideLabelId?: string
  stackGuideRegistrationId?: string
  cels: CspLayerTreeCel[]
}

export interface CspLayerTreeLayer {
  nodeId: string
  layerId?: string
  label: string
  tracks: CspLayerTreeTrack[]
}

export interface CspLayerTreeStage {
  nodeId: string
  stageId?: string
  label: string
  layers: CspLayerTreeLayer[]
}

export interface CspLayerTree {
  stages: CspLayerTreeStage[]
  topToBottomTrackNodeIds: string[]
  bottomToTopTrackNodeIds: string[]
}

/** CSP displays higher layers at the top; XDTS stores the same stack bottom-to-top. */
export function cspTopToBottomFromXdtsBottomToTop<T>(items: readonly T[]): T[] {
  return [...items].reverse()
}

export function xdtsBottomToTopFromCspTopToBottom<T>(items: readonly T[]): T[] {
  return [...items].reverse()
}

export function buildCspLayerTree(project: CutProject, profileId?: string): CspLayerTree {
  const plan = buildExportPlan(project, profileId)
  const visualTracks = cspTopToBottomFromXdtsBottomToTop(plan.tracks.filter(track => !track.dummy))
  const stages: CspLayerTreeStage[] = []
  const stageById = new Map<string, CspLayerTreeStage>()
  const layerById = new Map<string, CspLayerTreeLayer>()

  for (const track of visualTracks) {
    const slot = track.slotId ? project.cspTrackSlots.find(item => item.slotId === track.slotId) : undefined
    const stackLabel = track.stackGuideLabelId
      ? project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
      : undefined
    const registration = stackLabel && track.stackGuideRegistrationId
      ? stackLabel.registrations?.find(item => item.registrationId === track.stackGuideRegistrationId)
      : undefined
    const layerId = slot?.correctionLayerId ?? registration?.correctionLayerId
    const layer = layerId ? project.correctionLayers.find(item => item.layerId === layerId) : undefined
    const stage = layer ? project.productionStages.find(item => item.stageId === layer.stageId) : undefined
    const stageKey = stage?.stageId ?? 'unassigned-stage'
    const layerKey = layer?.layerId ?? 'unassigned-layer'

    let stageNode = stageById.get(stageKey)
    if (!stageNode) {
      stageNode = {
        nodeId: `stage:${stageKey}`,
        stageId: stage?.stageId,
        label: stage?.label ?? '工程未設定',
        layers: [],
      }
      stageById.set(stageKey, stageNode)
      stages.push(stageNode)
    }

    let layerNode = layerById.get(layerKey)
    if (!layerNode) {
      layerNode = {
        nodeId: `layer:${layerKey}`,
        layerId: layer?.layerId,
        label: layer?.label ?? 'レイヤー未設定',
        tracks: [],
      }
      layerById.set(layerKey, layerNode)
      stageNode.layers.push(layerNode)
    }

    const firstFrameByName = new Map<string, number>()
    for (const frame of track.frames) {
      const name = frame.value?.trim()
      if (!name || firstFrameByName.has(name)) continue
      firstFrameByName.set(name, frame.frame)
    }

    const bottomToTopCels = [...firstFrameByName].map(([cspCellName, firstFrame]) => {
      const binding = slot
        ? project.bindings.find(item => item.slotId === slot.slotId && item.cspCellName === cspCellName)
        : undefined
      const key = binding ? project.logicalSheet.keys.find(item => item.keyId === binding.keyId) : undefined
      const stackAssetId = registration?.cspCellName === cspCellName ? registration.assetIds[0] : undefined
      return {
        nodeId: `cel:${track.trackNo}:${cspCellName}`,
        cspCellName,
        firstFrame,
        keyId: binding?.keyId,
        bindingId: binding?.bindingId,
        assetId: binding?.assetId ?? stackAssetId,
        displayLabel: key?.displayLabel ?? stackLabel?.label,
        materialState: binding?.materialState ?? (stackAssetId ? 'assigned' : 'unassigned'),
      } satisfies CspLayerTreeCel
    })
    // The helper imports first-use order and each imported CSP layer lands above the previous one.
    const cels = cspTopToBottomFromXdtsBottomToTop(bottomToTopCels)
    const paperTrack = slot
      ? project.logicalSheet.paperTracks.find(item => item.paperTrack === slot.paperTrack)
      : undefined

    layerNode.tracks.push({
      nodeId: `track:${track.trackNo}`,
      label: paperTrack?.label ?? track.name,
      paperTrack: paperTrack?.paperTrack,
      stackItemId: slot
        ? `paper:${slot.paperTrack}`
        : stackLabel ? `stack:${stackLabel.labelId}` : undefined,
      slotId: slot?.slotId,
      stackGuideLabelId: stackLabel?.labelId,
      stackGuideRegistrationId: registration?.registrationId,
      cels,
    })
  }

  const topToBottomTrackNodeIds = stages.flatMap(stage => stage.layers.flatMap(layer => layer.tracks.map(track => track.nodeId)))
  return {
    stages,
    topToBottomTrackNodeIds,
    bottomToTopTrackNodeIds: xdtsBottomToTopFromCspTopToBottom(topToBottomTrackNodeIds),
  }
}
