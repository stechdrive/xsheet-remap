import { buildExportPlan, defaultCorrectionLayerId, defaultCspCellName, sheetTimingRoleForKey, stackGuideGapIndex, stackGuideStackBand } from './project'
import type { CutProject, MaterialState, SheetTimingRole } from './types'

export interface CspLayerTreeCel {
  nodeId: string
  cspCellName: string
  keyId?: string
  bindingId?: string
  assetId?: string
  displayLabel?: string
  sheetRole?: SheetTimingRole
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
  unregisteredTracks: CspLayerTreeTrack[]
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

  const projectedSlotIds = new Set<string>()
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

    const cels = slot
      ? cspTrackCelsForSlot(project, slot.slotId, track.frames)
      : cspTrackCelsForStackGuide(track.trackNo, track.frames, stackLabel?.label, registration)
    const paperTrack = slot
      ? project.logicalSheet.paperTracks.find(item => item.paperTrack === slot.paperTrack)
      : undefined

    const trackNodeId = slot
      ? `track:slot:${slot.slotId}`
      : registration && stackLabel ? `track:stack:${stackLabel.labelId}:${registration.registrationId}` : `track:export:${track.trackNo}`
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
    if (slot) projectedSlotIds.add(slot.slotId)
  }

  const defaultLayerId = defaultCorrectionLayerId(project)
  const primaryEmptyOverlaySlotIds = new Set(
    project.logicalSheet.paperTracks
      .filter(item => item.source === 'overlay')
      .flatMap(paperTrack => {
        const slot = project.cspTrackSlots.find(item =>
          item.paperTrack === paperTrack.paperTrack
          && (!defaultLayerId || item.correctionLayerId === defaultLayerId),
        ) ?? project.cspTrackSlots.find(item => item.paperTrack === paperTrack.paperTrack)
        return slot ? [slot.slotId] : []
      }),
  )
  for (const slot of project.cspTrackSlots) {
    if (projectedSlotIds.has(slot.slotId)) continue
    const hasBindings = project.bindings.some(binding => binding.slotId === slot.slotId)
    if (!hasBindings && !primaryEmptyOverlaySlotIds.has(slot.slotId)) continue
    const paperTrack = project.logicalSheet.paperTracks.find(item => item.paperTrack === slot.paperTrack)
    if (!paperTrack) continue
    ensureLayerNode(slot.correctionLayerId).tracks.push({
      nodeId: `track:slot:${slot.slotId}`,
      label: paperTrack.label || paperTrack.paperTrack,
      paperTrack: paperTrack.paperTrack,
      stackItemId: `paper:${paperTrack.paperTrack}`,
      slotId: slot.slotId,
      cels: cspTrackCelsForSlot(project, slot.slotId, []),
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
    unregisteredTracks: cspUnregisteredTracks(project),
    topToBottomTrackNodeIds,
    bottomToTopTrackNodeIds: xdtsBottomToTopFromCspTopToBottom(topToBottomTrackNodeIds),
  }
}

function cspTrackCelsForSlot(
  project: CutProject,
  slotId: string,
  frames: Array<{ frame: number; value?: string | null }>,
): CspLayerTreeCel[] {
  const firstFrameByName = firstFrameByCspCellName(frames)
  const keyOrder = new Map(project.logicalSheet.keys.map((key, index) => [key.keyId, index]))
  const bindings = project.bindings
    .filter(binding => binding.slotId === slotId)
    .sort((a, b) => {
      const aFirstFrame = firstFrameByName.get(a.cspCellName) ?? Number.MAX_SAFE_INTEGER
      const bFirstFrame = firstFrameByName.get(b.cspCellName) ?? Number.MAX_SAFE_INTEGER
      return aFirstFrame - bFirstFrame
        || (keyOrder.get(a.keyId) ?? Number.MAX_SAFE_INTEGER) - (keyOrder.get(b.keyId) ?? Number.MAX_SAFE_INTEGER)
        || a.bindingId.localeCompare(b.bindingId, 'ja')
    })
  const bottomToTopCels = bindings.map<CspLayerTreeCel>(binding => {
    const key = project.logicalSheet.keys.find(item => item.keyId === binding.keyId)
    return {
      nodeId: `cel:binding:${binding.bindingId}`,
      cspCellName: binding.cspCellName,
      keyId: binding.keyId,
      bindingId: binding.bindingId,
      assetId: binding.assetId,
      displayLabel: key?.displayLabel,
      sheetRole: key ? sheetTimingRoleForKey(key) : undefined,
      materialState: binding.materialState,
    } satisfies CspLayerTreeCel
  })
  // The helper imports first-use/registration order and each imported CSP layer lands above the previous one.
  return cspTopToBottomFromXdtsBottomToTop(bottomToTopCels)
}

function cspTrackCelsForStackGuide(
  trackNo: number,
  frames: Array<{ frame: number; value?: string | null }>,
  displayLabel: string | undefined,
  registration: { registrationId: string; cspCellName?: string; assetIds: string[] } | undefined,
): CspLayerTreeCel[] {
  const firstFrames = firstFrameByCspCellName(frames)
  const cspCellName = registration?.cspCellName?.trim()
  if (cspCellName && !firstFrames.has(cspCellName)) firstFrames.set(cspCellName, Number.MAX_SAFE_INTEGER)
  return cspTopToBottomFromXdtsBottomToTop([...firstFrames].map(([name]) => {
    const isRegistration = registration?.cspCellName === name
    return {
      nodeId: `cel:${trackNo}:${name}`,
      cspCellName: name,
      assetId: isRegistration ? registration.assetIds[0] : undefined,
      displayLabel,
      materialState: isRegistration && registration.assetIds.length > 0 ? 'assigned' : 'unassigned',
    } satisfies CspLayerTreeCel
  }))
}

function cspUnregisteredTracks(project: CutProject): CspLayerTreeTrack[] {
  const boundKeyIds = new Set(project.bindings.map(binding => binding.keyId))
  const paperTrackOrder = new Map(project.logicalSheet.paperTracks.map((track, index) => [track.paperTrack, index]))
  const firstFrameByKeyId = new Map<string, number>()
  for (const event of project.logicalSheet.events) {
    if (boundKeyIds.has(event.keyId)) continue
    const current = firstFrameByKeyId.get(event.keyId)
    if (current === undefined || event.frame < current) firstFrameByKeyId.set(event.keyId, event.frame)
  }

  const grouped = new Map<string, { paperTrack: string; sheetRole: SheetTimingRole; cels: Array<CspLayerTreeCel & { firstFrame: number; keyOrder: number }> }>()
  project.logicalSheet.keys.forEach((key, keyOrder) => {
    if (boundKeyIds.has(key.keyId)) return
    const firstFrame = firstFrameByKeyId.get(key.keyId)
    if (firstFrame === undefined) return
    const sheetRole = sheetTimingRoleForKey(key)
    const groupId = `${sheetRole}:${key.paperTrack}`
    const group = grouped.get(groupId) ?? { paperTrack: key.paperTrack, sheetRole, cels: [] }
    group.cels.push({
      nodeId: `cel:unregistered:${key.keyId}`,
      cspCellName: defaultCspCellName(key.displayLabel, key.paperTrack),
      keyId: key.keyId,
      displayLabel: key.displayLabel,
      sheetRole,
      materialState: 'unassigned',
      firstFrame,
      keyOrder,
    })
    grouped.set(groupId, group)
  })

  return [...grouped.values()]
    .sort((a, b) =>
      (paperTrackOrder.get(b.paperTrack) ?? Number.MAX_SAFE_INTEGER) - (paperTrackOrder.get(a.paperTrack) ?? Number.MAX_SAFE_INTEGER)
      || sheetRoleOrder(a.sheetRole) - sheetRoleOrder(b.sheetRole)
      || b.paperTrack.localeCompare(a.paperTrack, 'ja'),
    )
    .map(group => {
      const paperTrack = project.logicalSheet.paperTracks.find(track => track.paperTrack === group.paperTrack)
      return {
        nodeId: `track:unregistered:${group.sheetRole}:${group.paperTrack}`,
        label: `${group.sheetRole === 'action' ? 'ACTION' : 'CELL'} ${paperTrack?.label || group.paperTrack}`,
        paperTrack: group.paperTrack,
        cels: group.cels
          .sort((a, b) => a.firstFrame - b.firstFrame || a.keyOrder - b.keyOrder || a.nodeId.localeCompare(b.nodeId, 'ja'))
          .reverse()
          .map(cel => ({
            nodeId: cel.nodeId,
            cspCellName: cel.cspCellName,
            keyId: cel.keyId,
            displayLabel: cel.displayLabel,
            sheetRole: cel.sheetRole,
            materialState: cel.materialState,
          })),
      }
    })
}

function sheetRoleOrder(role: SheetTimingRole): number {
  return role === 'action' ? 0 : 1
}

function firstFrameByCspCellName(frames: Array<{ frame: number; value?: string | null }>): Map<string, number> {
  const result = new Map<string, number>()
  for (const frame of frames) {
    const name = frame.value?.trim()
    if (!name || result.has(name)) continue
    result.set(name, frame.frame)
  }
  return result
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
