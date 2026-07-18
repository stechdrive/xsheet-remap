import {
  clearEvent,
  createKey,
  defaultCspCellName,
  findTimingKeyByDisplayLabel,
  isSpecialTimingKeyId,
  isNullLabel,
  INBETWEEN_KEY_ID,
  NULL_CELL_KEY_ID,
  REVERSE_SHEET_KEY_ID,
  setEvent,
  setTimingSpecialEvent,
  sheetTimingRoleForEvent,
  uniqueCspCellNameForSlot,
  updateKey,
  upsertBinding,
  type CutProject,
  type SheetHit,
} from '@xsheet-remap/core'
import { sheetRoleForHit } from './sheetInteraction'

export function setTimingValueAt(
  project: CutProject,
  hit: SheetHit,
  rawValue: string,
  fontSizePx: number,
  correctionLayerId: string,
): { project: CutProject; keyId: string | null } {
  if (!hit.paperTrack) return { project, keyId: null }
  const value = rawValue.trim()
  const sheetRole = sheetRoleForHit(hit)
  if (!value) return { project: clearEvent(project, hit.paperTrack, hit.frame, sheetRole), keyId: null }
  if (value === '/') {
    return {
      project: setTimingSpecialEvent(project, hit.paperTrack, hit.frame, 'inbetween', sheetRole, { fontSizePx }),
      keyId: INBETWEEN_KEY_ID,
    }
  }
  if (value === '.') {
    return {
      project: setTimingSpecialEvent(project, hit.paperTrack, hit.frame, 'reverse', sheetRole, { fontSizePx }),
      keyId: REVERSE_SHEET_KEY_ID,
    }
  }
  if (isNullLabel(value)) {
    return {
      project: setTimingSpecialEvent(project, hit.paperTrack, hit.frame, 'blank', sheetRole, { fontSizePx }),
      keyId: NULL_CELL_KEY_ID,
    }
  }

  const existingKeyId = project.logicalSheet.events.find(event =>
    event.paperTrack === hit.paperTrack
    && event.frame === hit.frame
    && sheetTimingRoleForEvent(event) === sheetRole,
  )?.keyId ?? null
  const reusableKey = findTimingKeyByDisplayLabel(project, hit.paperTrack, value, sheetRole)
  if (reusableKey && reusableKey.keyId !== existingKeyId) {
    const withEvent = setEvent(project, hit.paperTrack, hit.frame, reusableKey.keyId, sheetRole, { fontSizePx })
    return { project: registerTimingKey(withEvent, reusableKey.keyId, correctionLayerId), keyId: reusableKey.keyId }
  }
  if (existingKeyId && !isSpecialTimingKeyId(existingKeyId)) {
    const updated = updateKey(project, existingKeyId, { displayLabel: value, paperToken: value })
    return { project: registerTimingKey(updated, existingKeyId, correctionLayerId), keyId: existingKeyId }
  }

  const created = createKey(project, hit.paperTrack, value, 'manual', value, sheetRole)
  const withEvent = setEvent(created.project, hit.paperTrack, hit.frame, created.key.keyId, sheetRole, { fontSizePx })
  return { project: registerTimingKey(withEvent, created.key.keyId, correctionLayerId), keyId: created.key.keyId }
}

function registerTimingKey(project: CutProject, keyId: string, correctionLayerId: string): CutProject {
  if (project.bindings.some(binding => binding.keyId === keyId)) return project
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) return project
  const slot = project.cspTrackSlots.find(item =>
    item.paperTrack === key.paperTrack && item.correctionLayerId === correctionLayerId,
  )
  if (!slot) return project
  return upsertBinding(project, {
    slotId: slot.slotId,
    keyId,
    cspCellName: uniqueCspCellNameForSlot(project, slot.slotId, defaultCspCellName(key.displayLabel, slot.paperTrack)),
    materialState: 'unassigned',
  })
}
