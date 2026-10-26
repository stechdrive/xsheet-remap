import {
  clearEvent,
  createKey,
  isNullLabel,
  INBETWEEN_KEY_ID,
  NULL_CELL_KEY_ID,
  REVERSE_SHEET_KEY_ID,
  setEvent,
  setTimingReferenceAt,
  timingReferenceAddress,
  timingReferenceMap,
  setTimingSpecialEvent,
  sheetTimingRoleForEvent,
  uniqueCspCellNameForSlot,
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
  circleOnInput = false,
): { project: CutProject; keyId: string | null } {
  if (!hit.paperTrack) return { project, keyId: null }
  const value = rawValue.trim()
  const sheetRole = sheetRoleForHit(hit)
  const finish = (next: CutProject, keyId: string) => ({ project: circleOnInput
    && timingReferenceMap(next.logicalSheet.referenceMarks).get(timingReferenceAddress({ paperTrack: hit.paperTrack!, sheetRole, frame: hit.frame })) !== 'triangle'
    ? setTimingReferenceAt(next, hit.paperTrack!, hit.frame, sheetRole, 'circle') : next, keyId })
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

  const projectWithLeadingBlank = ensureLeadingBlankBeforeFirstKey(project, hit.paperTrack, hit.frame, sheetRole)
  // Sheet entry selects a cell for this frame; renaming a shared key belongs to the cell editor.
  const created = createKey(projectWithLeadingBlank, hit.paperTrack, value, 'manual', value, sheetRole)
  const withEvent = setEvent(created.project, hit.paperTrack, hit.frame, created.key.keyId, sheetRole, { fontSizePx })
  return finish(registerTimingKey(withEvent, created.key.keyId, correctionLayerId), created.key.keyId)
}

function ensureLeadingBlankBeforeFirstKey(
  project: CutProject,
  paperTrack: string,
  frame: number,
  sheetRole: ReturnType<typeof sheetRoleForHit>,
): CutProject {
  const firstFrame = project.logicalSheet.frameOrigin
  if (frame <= firstFrame) return project
  const hasEarlierEvent = project.logicalSheet.events.some(event =>
    event.paperTrack === paperTrack
    && event.frame <= frame
    && sheetTimingRoleForEvent(event) === sheetRole,
  )
  if (hasEarlierEvent) return project
  return setTimingSpecialEvent(project, paperTrack, firstFrame, 'blank', sheetRole)
}

function registerTimingKey(project: CutProject, keyId: string, correctionLayerId: string): CutProject {
  if (project.bindings.some(binding => binding.keyId === keyId)) return project
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) return project
  if (key.requiresExplicitBinding) return project
  const slot = project.cspTrackSlots.find(item =>
    item.paperTrack === key.paperTrack && item.correctionLayerId === correctionLayerId,
  )
  if (!slot) return project
  return upsertBinding(project, {
    slotId: slot.slotId,
    keyId,
    cspCellName: uniqueCspCellNameForSlot(project, slot.slotId, key.displayLabel),
    materialState: 'unassigned',
  })
}
