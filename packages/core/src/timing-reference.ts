import type { CutProject, PaperTrack, SheetTimingRole, TimingReferenceMark } from './types'
import { sheetTimingRoleForEvent, timingEventValueKind } from './project-shared'
import { DEFAULT_SHEET_TIMING_ROLE } from './project-constants'

export function timingReferenceAddress(mark: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole }): string {
  return JSON.stringify([mark.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE, mark.paperTrack, mark.frame])
}

export function normalizeTimingReferenceMarks(value: unknown, tracks: readonly PaperTrack[]): TimingReferenceMark[] {
  const allowed = new Set(tracks.map(track => track.paperTrack))
  const marks = new Map<string, TimingReferenceMark>()
  if (!Array.isArray(value)) return []
  for (const input of value) {
    if (!input || typeof input !== 'object' || !allowed.has(input.paperTrack)
      || (input.sheetRole !== 'action' && input.sheetRole !== 'cell') || !Number.isSafeInteger(input.frame)) continue
    const mark: TimingReferenceMark = { paperTrack: input.paperTrack, sheetRole: input.sheetRole, frame: input.frame }
    marks.set(timingReferenceAddress(mark), mark)
  }
  return [...marks.values()]
}

export function setTimingReferenceRange(
  project: CutProject,
  range: { role: SheetTimingRole; paperTracks: readonly string[]; frameStart: number; frameEnd: number },
  enabled: boolean,
): CutProject {
  const before = project.logicalSheet.referenceMarks ?? []
  const tracks = new Set(range.paperTracks.filter(name => project.logicalSheet.paperTracks.some(track => track.paperTrack === name)))
  const start = Math.round(range.frameStart), end = Math.round(range.frameEnd)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || tracks.size === 0) return project
  const inRange = (mark: TimingReferenceMark) => mark.sheetRole === range.role && tracks.has(mark.paperTrack) && mark.frame >= start && mark.frame <= end
  let referenceMarks: TimingReferenceMark[]
  if (!enabled) {
    referenceMarks = before.filter(mark => !inRange(mark))
  } else {
    const occupied = new Set(before.map(timingReferenceAddress))
    const special = new Set(project.logicalSheet.events.filter(event => timingEventValueKind(event) !== 'cell')
      .map(event => timingReferenceAddress({ ...event, sheetRole: sheetTimingRoleForEvent(event) })))
    referenceMarks = [...before]
    for (const paperTrack of tracks) for (let frame = start; frame <= end; frame++) {
      const mark = { paperTrack, sheetRole: range.role, frame }
      const key = timingReferenceAddress(mark)
      if (!occupied.has(key) && !special.has(key)) { referenceMarks.push(mark); occupied.add(key) }
    }
  }
  if (referenceMarks.length === before.length) return project
  return { ...project, logicalSheet: { ...project.logicalSheet, referenceMarks } }
}

export function setTimingReferenceAt(project: CutProject, paperTrack: string, frame: number, role: SheetTimingRole, enabled: boolean): CutProject {
  return setTimingReferenceRange(project, { role, paperTracks: [paperTrack], frameStart: frame, frameEnd: frame }, enabled)
}

export function mapTimingReferenceFrames(
  marks: TimingReferenceMark[] | undefined, transform: (mark: TimingReferenceMark) => number | null,
): TimingReferenceMark[] | undefined {
  return marks?.flatMap(mark => {
    const frame = transform(mark)
    return frame === null ? [] : [frame === mark.frame ? mark : { ...mark, frame }]
  })
}
