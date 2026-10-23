import type { CutGroupProjectDocument, PaperTrack, SheetTimingRole } from './types'
import { sheetTimingRoleForEvent } from './project-shared'

/** Placement belongs to the column, independent of the selected process or current events. */
export function paperTrackDisplayRole(track: PaperTrack): SheetTimingRole {
  return track.viewPlacement?.sheetRole
    ?? (Number.isFinite(track.viewPlacement?.snapIndex) ? 'cell' : track.clipSource?.sheetRole)
    ?? 'cell'
}

/** Recover only unambiguous imported placement; never reinterpret a saved manual position. */
export function migrateImportedPaperTrackPlacement(document: CutGroupProjectDocument): CutGroupProjectDocument {
  if (!document.clipDocument?.source) return document
  const needsPlacement = (track: PaperTrack) => track.source !== 'overlay' && !track.viewPlacement?.sheetRole && !Number.isFinite(track.viewPlacement?.snapIndex)
  if (!document.cuts.some(cut => cut.revisions.some(revision => revision.logicalSheet.paperTracks.some(needsPlacement)))) return document
  const roles = new Map<string, Set<SheetTimingRole>>()
  const documentRoles = new Set<SheetTimingRole>()
  for (const cut of document.cuts) for (const revision of cut.revisions) {
    const timings = [revision.logicalSheet, ...Object.values(revision.logicalSheet.processTimings?.inactive ?? {})]
    for (const timing of timings) for (const event of timing.events) {
      const role = sheetTimingRoleForEvent(event)
      const trackRoles = roles.get(event.paperTrack) ?? new Set<SheetTimingRole>()
      trackRoles.add(role); roles.set(event.paperTrack, trackRoles); documentRoles.add(role)
    }
  }
  let changed = false
  const cuts = document.cuts.map(cut => ({ ...cut, revisions: cut.revisions.map(revision => ({ ...revision,
    logicalSheet: { ...revision.logicalSheet, paperTracks: revision.logicalSheet.paperTracks.map(track => {
      if (!needsPlacement(track)) return track
      const candidates = roles.get(track.paperTrack) ?? documentRoles
      const role = track.clipSource?.sheetRole ?? (candidates.size === 1 ? [...candidates][0] : undefined)
      if (!role) return track
      changed = true
      return { ...track, viewPlacement: { ...track.viewPlacement, sheetRole: role } }
    }) },
  })) }))
  return changed ? { ...document, cuts } : document
}
