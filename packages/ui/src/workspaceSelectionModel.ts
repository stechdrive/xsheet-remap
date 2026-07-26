import {
  INBETWEEN_KEY_ID,
  NULL_CELL_DISPLAY_LABEL,
  NULL_CELL_KEY_ID,
  REVERSE_SHEET_KEY_ID,
  isSpecialTimingKeyId,
  sheetTimingRoleForEvent,
  type CutProject,
  type SheetHit,
  type TimingKey,
} from '@xsheet-remap/core'
import { sheetRoleForHit } from './sheetInteraction'

export function eventKeyIdAtSheetHit(sourceProject: CutProject, hit: SheetHit | null): string | null {
  if (!hit?.paperTrack) return null
  const role = sheetRoleForHit(hit)
  return sourceProject.logicalSheet.events.find(event =>
    event.paperTrack === hit.paperTrack
    && event.frame === hit.frame
    && sheetTimingRoleForEvent(event) === role
  )?.keyId ?? null
}

export function timingKeyAtSheetHit(sourceProject: CutProject, hit: SheetHit | null): TimingKey | null {
  const keyId = eventKeyIdAtSheetHit(sourceProject, hit)
  if (!keyId || isSpecialTimingKeyId(keyId)) return null
  return sourceProject.logicalSheet.keys.find(key => key.keyId === keyId) ?? null
}

export function timingKeyDisplayLabel(sourceProject: CutProject, keyId: string | null | undefined): string {
  if (!keyId) return ''
  if (keyId === NULL_CELL_KEY_ID) return NULL_CELL_DISPLAY_LABEL
  if (keyId === INBETWEEN_KEY_ID) return '/'
  if (keyId === REVERSE_SHEET_KEY_ID) return '.'
  return sourceProject.logicalSheet.keys.find(item => item.keyId === keyId)?.displayLabel ?? ''
}
