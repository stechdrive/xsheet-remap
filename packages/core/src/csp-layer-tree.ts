import { buildExportPlan, defaultCorrectionLayerId, stackGuideGapIndex, stackGuideStackBand } from './project'
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
  const stages: CspLayerTreeStage[] = []
  const stageById = new Map<string, CspLayerTreeStage>()
  const layerById = new Map<string, CspLayerTreeLayer>()

  function ensureStageNode(stageId?: string): CspLayerTreeStage {
    const stage = stageId ? project.productionStages.find(item => item.stageId === stageId) : undefined
    const stageKey = stage?.stageId ?? 'unassigned-stage'
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
    return stageNode
  }

  function ensureLayerNode(layerId?: string): CspLayerTreeLayer {
    const layer = layerId ? project.correctionLayers.find(item => item.layerId === layerId) : undefined
    const layerKey = layer?.layerId ?? 'unassigned-layer'
    let layerNode = layerById.get(layerKey)
    if (!layerNode) {
      layerNode = {
        nodeId: `layer:${layerKey}`,
        layerId: layer?.layerId,
        label: layer?.label ?? 'レイヤー未設定',
        tracks: [],
      }
      layerById.set(layerKey, layerNode)
      ensureStageNode(layer?.stageId).layers.push(layerNode)
    }
    return layerNode
  }

  for (const stage of [...project.productionStages].sort((a, b) => b.order - a.order || a.stageId.localeCompare(b.stageId))) {
    const layers = project.correctionLayers
      .filter(layer => layer.stageId === stage.stageId)
      .sort((a, b) => b.order - a.order || a.layerId.localeCompare(b.layerId))
    for (const layer of layers) ensureLayerNode(layer.layerId)
  }

  const projectedPaperTracks = new Set<string>()
  for (const track of plan.tracks.filter(track => !track.dummy)) {
    const slot = track.slotId ? project.cspTrackSlots.find(item => item.slotId === track.slotId) : undefined
    const stackLabel = track.stackGuideLabelId
      ? project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
      : undefined
    const registration = stackLabel && track.stackGuideRegistrationId
      ? stackLabel.registrations?.find(item => item.registrationId === track.stackGuideRegistrationId)
      : undefined
    const layerId = slot?.correctionLayerId ?? registration?.correctionLayerId
    const layerNode = ensureLayerNode(layerId)

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

    const trackNodeId = slot
      ? `track:slot:${slot.slotId}`
      : registration ? `track:stack:${registration.registrationId}` : `track:export:${track.trackNo}`
    layerNode.tracks.push({
      nodeId: trackNodeId,
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
    if (slot) projectedPaperTracks.add(slot.paperTrack)
  }

  const defaultLayerId = defaultCorrectionLayerId(project)
  for (const paperTrack of project.logicalSheet.paperTracks.filter(item => item.source === 'overlay')) {
    if (projectedPaperTracks.has(paperTrack.paperTrack)) continue
    const slot = project.cspTrackSlots.find(item =>
      item.paperTrack === paperTrack.paperTrack
      && (!defaultLayerId || item.correctionLayerId === defaultLayerId),
    ) ?? project.cspTrackSlots.find(item => item.paperTrack === paperTrack.paperTrack)
    if (!slot) continue
    ensureLayerNode(slot.correctionLayerId).tracks.push({
      nodeId: `track:slot:${slot.slotId}`,
      label: paperTrack.label || paperTrack.paperTrack,
      paperTrack: paperTrack.paperTrack,
      stackItemId: `paper:${paperTrack.paperTrack}`,
      slotId: slot.slotId,
      cels: [],
    })
  }

  for (const stage of stages) {
    for (const layer of stage.layers) {
      layer.tracks.sort((a, b) => compareCspTreeTracksTopToBottom(project, a, b))
    }
  }

  const topToBottomTrackNodeIds = stages.flatMap(stage => stage.layers.flatMap(layer => layer.tracks.map(track => track.nodeId)))
  return {
    stages,
    topToBottomTrackNodeIds,
    bottomToTopTrackNodeIds: xdtsBottomToTopFromCspTopToBottom(topToBottomTrackNodeIds),
  }
}

function compareCspTreeTracksTopToBottom(project: CutProject, a: CspLayerTreeTrack, b: CspLayerTreeTrack): number {
  const aPosition = cspTreeTrackPosition(project, a)
  const bPosition = cspTreeTrackPosition(project, b)
  return bPosition.position - aPosition.position
    || bPosition.orderInGap - aPosition.orderInGap
    || b.label.localeCompare(a.label, 'ja')
    || b.nodeId.localeCompare(a.nodeId, 'ja')
}

function cspTreeTrackPosition(project: CutProject, track: CspLayerTreeTrack): { position: number; orderInGap: number } {
  if (track.paperTrack) {
    const paperTrack = project.logicalSheet.paperTracks.find(item => item.paperTrack === track.paperTrack)
    return { position: (paperTrack?.order ?? Number.MAX_SAFE_INTEGER) + 0.5, orderInGap: 0 }
  }
  const label = track.stackGuideLabelId
    ? project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
    : undefined
  if (!label) return { position: Number.MAX_SAFE_INTEGER, orderInGap: 0 }
  const band = stackGuideStackBand(label)
  if (band === 'cell-interleave') {
    return { position: stackGuideGapIndex(project, label), orderInGap: label.orderInGap }
  }
  return {
    position: project.logicalSheet.paperTracks.length + (band === 'camera-note' ? 1 : 2),
    orderInGap: label.orderInGap,
  }
}
