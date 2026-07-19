import { stackGuideRegistrations, stackGuideStackBand, type CutProject, type StackGuideStackBand } from '@xsheet-remap/core'

export type CspPaneSelection =
  | { kind: 'production-stage'; nodeId: string; label: string; stageId: string }
  | { kind: 'correction-layer'; nodeId: string; label: string; stageId: string; layerId: string }
  | { kind: 'template-track'; nodeId: string; label: string; itemId: string; paperTrack: string; correctionLayerId?: string; slotId?: string }
  | { kind: 'overlay-track'; nodeId: string; label: string; itemId: string; paperTrack: string; correctionLayerId?: string; slotId?: string }
  | { kind: 'stack-guide'; nodeId: string; label: string; itemId: string; labelId: string; band: StackGuideStackBand; correctionLayerId?: string }
  | { kind: 'registered-cell'; nodeId: string; label: string; keyId: string; bindingId: string; correctionLayerId?: string; slotId?: string }
  | { kind: 'unregistered-cell'; nodeId: string; label: string; keyId: string; correctionLayerId?: string; slotId?: string }
  | { kind: 'generated-readonly'; nodeId: string; label: string; correctionLayerId?: string }

export interface CspPaneNodeCapabilities {
  selectable: boolean
  renamable: boolean
  draggable: boolean
  deletable: boolean
  reorderScope?: string
  disabledReason?: string
}

export function cspPaneNodeCapabilities(project: CutProject, selection: CspPaneSelection): CspPaneNodeCapabilities {
  switch (selection.kind) {
    case 'production-stage':
      return {
        selectable: true,
        renamable: true,
        draggable: project.productionStages.length > 1,
        deletable: false,
        reorderScope: 'production-stages',
        disabledReason: '制作段階はこのペインから削除できません。',
      }
    case 'correction-layer': {
      const sameStageCount = project.correctionLayers.filter(layer => layer.stageId === selection.stageId).length
      const reason = correctionLayerDeleteDisabledReason(project, selection.layerId)
      return {
        selectable: true,
        renamable: true,
        draggable: sameStageCount > 1,
        deletable: reason === null,
        reorderScope: `correction-layers:${selection.stageId}`,
        disabledReason: reason ?? undefined,
      }
    }
    case 'template-track':
      return {
        selectable: true,
        renamable: true,
        draggable: true,
        deletable: false,
        reorderScope: trackReorderScope('cell-interleave', selection.correctionLayerId),
        disabledReason: 'テンプレート由来のセル列はテンプレート編集から変更してください。',
      }
    case 'overlay-track':
      return {
        selectable: true,
        renamable: true,
        draggable: true,
        deletable: true,
        reorderScope: trackReorderScope('cell-interleave', selection.correctionLayerId),
      }
    case 'stack-guide':
      return {
        selectable: true,
        renamable: true,
        draggable: true,
        deletable: true,
        reorderScope: trackReorderScope(selection.band, selection.correctionLayerId),
      }
    case 'registered-cell':
    case 'unregistered-cell':
      return { selectable: true, renamable: true, draggable: true, deletable: true }
    case 'generated-readonly':
      return {
        selectable: true,
        renamable: false,
        draggable: false,
        deletable: false,
        disabledReason: 'CSP出力から生成された読み取り専用項目です。',
      }
  }
}

export function cspPaneSelectionExists(project: CutProject, selection: CspPaneSelection): boolean {
  switch (selection.kind) {
    case 'production-stage':
      return project.productionStages.some(stage => stage.stageId === selection.stageId)
    case 'correction-layer':
      return project.correctionLayers.some(layer => layer.layerId === selection.layerId)
    case 'template-track':
    case 'overlay-track':
      return project.logicalSheet.paperTracks.some(track => track.paperTrack === selection.paperTrack)
    case 'stack-guide':
      return project.stackGuideLabels.some(label => label.labelId === selection.labelId)
    case 'registered-cell':
      return project.bindings.some(binding => binding.bindingId === selection.bindingId)
    case 'unregistered-cell':
      return project.logicalSheet.keys.some(key => key.keyId === selection.keyId)
    case 'generated-readonly':
      return true
  }
}

export function cspPaneSelectionCurrentLabel(project: CutProject, selection: CspPaneSelection): string | null {
  switch (selection.kind) {
    case 'production-stage':
      return project.productionStages.find(stage => stage.stageId === selection.stageId)?.label ?? null
    case 'correction-layer':
      return project.correctionLayers.find(layer => layer.layerId === selection.layerId)?.label ?? null
    case 'template-track':
    case 'overlay-track': {
      const track = project.logicalSheet.paperTracks.find(candidate => candidate.paperTrack === selection.paperTrack)
      return track ? track.label || track.paperTrack : null
    }
    case 'stack-guide':
      return project.stackGuideLabels.find(label => label.labelId === selection.labelId)?.label ?? null
    case 'registered-cell':
      return project.bindings.find(binding => binding.bindingId === selection.bindingId)?.cspCellName ?? null
    case 'unregistered-cell':
      return project.logicalSheet.keys.find(key => key.keyId === selection.keyId)?.displayLabel ?? null
    case 'generated-readonly':
      return selection.label
  }
}

export function correctionLayerIdForCspPaneSelection(selection: CspPaneSelection | null, fallbackLayerId: string): string {
  if (!selection) return fallbackLayerId
  if (selection.kind === 'correction-layer') return selection.layerId
  if (selection.kind === 'production-stage') return fallbackLayerId
  return selection.correctionLayerId ?? fallbackLayerId
}

export function stackGuideSelectionBand(project: CutProject, labelId: string): StackGuideStackBand {
  const label = project.stackGuideLabels.find(candidate => candidate.labelId === labelId)
  return label ? stackGuideStackBand(label) : 'cell-interleave'
}

function trackReorderScope(band: StackGuideStackBand, correctionLayerId: string | undefined): string {
  return `tracks:${band}:${correctionLayerId ?? 'unassigned'}`
}

function correctionLayerDeleteDisabledReason(project: CutProject, layerId: string): string | null {
  if (project.correctionLayers.length <= 1) return '最後の工程は削除できません。'
  const slotIds = new Set(project.cspTrackSlots.filter(slot => slot.correctionLayerId === layerId).map(slot => slot.slotId))
  if (project.bindings.some(binding => slotIds.has(binding.slotId))) return '登録セルがある工程は削除できません。'
  const hasUsedGuide = project.stackGuideLabels.some(label =>
    stackGuideRegistrations(label).some(registration =>
      registration.correctionLayerId === layerId
      && (registration.assetIds.length > 0 || Boolean(registration.cspCellName?.trim())),
    ),
  )
  return hasUsedGuide ? '素材またはCSPセル名が登録された工程は削除できません。' : null
}
