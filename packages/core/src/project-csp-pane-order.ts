import type { CutProject } from './types'
import type { CspStackReorderEdge } from './project-cell-stack-order'

export function reorderProductionStage(
  project: CutProject,
  stageId: string,
  referenceStageId: string,
  edge: CspStackReorderEdge,
): CutProject | null {
  const topToBottom = [...project.productionStages]
    .sort((a, b) => b.order - a.order || b.stageId.localeCompare(a.stageId, 'ja'))
    .map(stage => stage.stageId)
  const reordered = reorderIdsByReference(topToBottom, stageId, referenceStageId, edge)
  if (!reordered) return null
  const orderById = normalizedTopToBottomOrder(reordered)
  return {
    ...project,
    productionStages: project.productionStages.map(stage => {
      const order = orderById.get(stage.stageId)
      return typeof order === 'number' && order !== stage.order ? { ...stage, order } : stage
    }),
  }
}

export function reorderCorrectionLayer(
  project: CutProject,
  layerId: string,
  referenceLayerId: string,
  edge: CspStackReorderEdge,
): CutProject | null {
  const layer = project.correctionLayers.find(candidate => candidate.layerId === layerId)
  const reference = project.correctionLayers.find(candidate => candidate.layerId === referenceLayerId)
  if (!layer || !reference || layer.stageId !== reference.stageId) return null
  const topToBottom = project.correctionLayers
    .filter(candidate => candidate.stageId === layer.stageId)
    .sort((a, b) => b.order - a.order || b.layerId.localeCompare(a.layerId, 'ja'))
    .map(candidate => candidate.layerId)
  const reordered = reorderIdsByReference(topToBottom, layerId, referenceLayerId, edge)
  if (!reordered) return null
  const orderById = normalizedTopToBottomOrder(reordered)
  return {
    ...project,
    correctionLayers: project.correctionLayers.map(candidate => {
      const order = orderById.get(candidate.layerId)
      return typeof order === 'number' && order !== candidate.order ? { ...candidate, order } : candidate
    }),
  }
}

function normalizedTopToBottomOrder(ids: string[]): Map<string, number> {
  return new Map(ids.map((id, index) => [id, ids.length - index - 1]))
}

function reorderIdsByReference(ids: string[], itemId: string, referenceItemId: string, edge: CspStackReorderEdge): string[] | null {
  if (itemId === referenceItemId || !ids.includes(itemId) || !ids.includes(referenceItemId)) return null
  const next = ids.filter(id => id !== itemId)
  const referenceIndex = next.indexOf(referenceItemId)
  if (referenceIndex < 0) return null
  next.splice(referenceIndex + (edge === 'after' ? 1 : 0), 0, itemId)
  return next.every((id, index) => id === ids[index]) ? null : next
}
