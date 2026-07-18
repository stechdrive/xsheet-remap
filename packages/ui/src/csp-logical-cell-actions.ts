import { isSpecialTimingKeyId, removeCellBinding, type CutProject } from '@xsheet-remap/core'
import { confirmUserAction } from '@xsheet-remap/adapters'
import { uiText } from './i18n'
import { registeredCellAssetRows } from './registered-cells-model'
import { deleteRegisteredCellKey } from './stack-guides-paper-track'

export interface CspTreeCardDeletionResult {
  project: CutProject
  keyDeleted: boolean
}

export async function deleteCspTreeCardWithConfirmation(
  project: CutProject,
  keyId: string,
  bindingId?: string,
): Promise<CspTreeCardDeletionResult | null> {
  if (isSpecialTimingKeyId(keyId)) return null
  if (!bindingId) return deleteLogicalCellWithConfirmation(project, keyId)
  const binding = project.bindings.find(item => item.bindingId === bindingId)
  if (!binding) return null
  const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
  const layer = slot?.correctionLayerId
    ? project.correctionLayers.find(item => item.layerId === slot.correctionLayerId)
    : undefined
  const confirmed = await confirmUserAction(uiText.keys.deleteProcessCardConfirm(layer?.label ?? slot?.displayPath ?? '工程', binding.cspCellName), {
    title: uiText.keys.deleteProcessCard,
    okLabel: uiText.keys.deleteConfirmOk,
    cancelLabel: uiText.keys.deleteConfirmCancel,
  })
  if (!confirmed) return null
  const next = removeCellBinding(project, bindingId)
  return { project: next, keyDeleted: !next.logicalSheet.keys.some(key => key.keyId === keyId) }
}

async function deleteLogicalCellWithConfirmation(project: CutProject, keyId: string): Promise<CspTreeCardDeletionResult | null> {
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) return null
  const materialCount = registeredCellAssetRows(project, key).length
  const bindingCount = project.bindings.filter(binding => binding.keyId === keyId).length
  const eventCount = project.logicalSheet.events.filter(event => event.keyId === keyId).length
  if (materialCount > 0 || bindingCount > 0 || eventCount > 0) {
    const confirmed = await confirmUserAction(uiText.keys.deleteConfirm(key.displayLabel || key.paperTrack, materialCount, eventCount), {
      title: uiText.keys.delete,
      okLabel: uiText.keys.deleteConfirmOk,
      cancelLabel: uiText.keys.deleteConfirmCancel,
    })
    if (!confirmed) return null
  }
  return { project: deleteRegisteredCellKey(project, keyId), keyDeleted: true }
}
