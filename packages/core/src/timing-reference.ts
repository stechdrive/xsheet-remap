import type { CutProject, PaperTrack, SheetTimingRole, TimingReferenceMark, TimingEnclosure } from './types'
import { sheetTimingRoleForEvent, timingEventValueKind } from './project-shared'
import { DEFAULT_SHEET_TIMING_ROLE } from './project-constants'

export function timingReferenceAddress(mark: { paperTrack: string; frame: number; sheetRole?: SheetTimingRole }): string {
  return JSON.stringify([mark.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE, mark.paperTrack, mark.frame])
}

export function timingReferenceMap(marks: readonly TimingReferenceMark[] | undefined): Map<string, TimingEnclosure> {
  return new Map(marks?.map(mark => [timingReferenceAddress(mark), mark.shape ?? 'triangle']))
}

export function normalizeTimingReferenceMarks(value: unknown, tracks: readonly PaperTrack[]): TimingReferenceMark[] {
  const allowed = new Set(tracks.map(track => track.paperTrack))
  const marks = new Map<string, TimingReferenceMark>()
  if (!Array.isArray(value)) return []
  for (const input of value) {
    if (!input || typeof input !== 'object' || !allowed.has(input.paperTrack)
      || (input.sheetRole !== 'action' && input.sheetRole !== 'cell') || !Number.isSafeInteger(input.frame)) continue
    const mark: TimingReferenceMark = { paperTrack: input.paperTrack, sheetRole: input.sheetRole, frame: input.frame,
      ...(input.shape === 'circle' ? { shape: 'circle' } : {}) }
    marks.set(timingReferenceAddress(mark), mark)
  }
  return [...marks.values()]
}

export function setTimingReferenceRange(
  project: CutProject,
  range: { role: SheetTimingRole; paperTracks: readonly string[]; frameStart: number; frameEnd: number },
  enabled: boolean | TimingEnclosure,
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
    const occupied = new Map(before.map(mark => [timingReferenceAddress(mark), mark]))
    const special = new Set(project.logicalSheet.events.filter(event => timingEventValueKind(event) !== 'cell')
      .map(event => timingReferenceAddress({ ...event, sheetRole: sheetTimingRoleForEvent(event) })))
    const shape = enabled === 'circle' ? 'circle' : 'triangle'
    for (const paperTrack of tracks) for (let frame = start; frame <= end; frame++) {
      const mark: TimingReferenceMark = { paperTrack, sheetRole: range.role, frame, ...(shape === 'circle' ? { shape } : {}) }
      const key = timingReferenceAddress(mark)
      if (!special.has(key) && (!occupied.has(key) || (occupied.get(key)?.shape ?? 'triangle') !== shape)) occupied.set(key, mark)
    }
    referenceMarks = [...occupied.values()]
  }
  if (referenceMarks.length === before.length && referenceMarks.every((mark, index) => mark === before[index])) return project
  return { ...project, logicalSheet: { ...project.logicalSheet, referenceMarks } }
}

export function setTimingReferenceAt(project: CutProject, paperTrack: string, frame: number, role: SheetTimingRole, enabled: boolean | TimingEnclosure): CutProject {
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
