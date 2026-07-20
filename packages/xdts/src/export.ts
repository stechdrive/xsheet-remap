import type { CutProject, ExportPlan, TimedRangeCue } from '@xsheet-remap/core'
import { SYMBOL_HYPHEN, SYMBOL_NULL_CELL, XDTS_TEXT_HEADER } from './types'

interface RawXdtsFrame {
  frame: number
  data: Array<{ id: number; values: string[] }>
}

export function exportXdts(plan: ExportPlan): string {
  return serializeXdts(plan, [])
}

export interface ProjectXdtsExportOptions {
  includeSound?: boolean
  includeCamera?: boolean
}

/** Standalone XDTS export. CSP registration continues to use the cell-only exportXdts API. */
export function exportProjectXdts(
  plan: ExportPlan,
  project: Pick<CutProject, 'logicalSheet' | 'timedRangeCues'>,
  options: ProjectXdtsExportOptions = {},
): string {
  const fields: RawRangeField[] = []
  if (options.includeSound === true) {
    fields.push(buildRangeField(project, 'sound', 3))
  }
  if (options.includeCamera === true) {
    fields.push(buildRangeField(project, 'camera', 5))
  }
  return serializeXdts(plan, fields.filter(field => field.tracks.length > 0))
}

interface RawRangeField {
  fieldId: 3 | 5
  names: string[]
  tracks: Array<{ trackNo: number; frames: RawXdtsFrame[] }>
}

function serializeXdts(plan: ExportPlan, rangeFields: RawRangeField[]): string {
  const sortedTracks = [...plan.tracks].sort((a, b) => a.trackNo - b.trackNo)
  const names = sortedTracks.map(track => track.name)
  const raw = {
    version: rangeFields.length > 0 ? 10 : 5,
    header: {
      cut: plan.metadata.cut,
      scene: plan.metadata.scene,
    },
    timeTables: [
      {
        name: plan.metadata.timeTableName,
        duration: plan.durationFrames,
        frameRate: plan.fps,
        timeTableHeaders: [
          {
            fieldId: 0,
            names,
          },
          ...rangeFields.map(field => ({ fieldId: field.fieldId, names: field.names })),
        ],
        fields: [
          {
            fieldId: 0,
            tracks: sortedTracks.map((track, index) => ({
              trackNo: index,
              frames: compactFrames(
                track.frames.map(frame => ({
                  frame: frame.frame,
                  data: [{ id: 0, values: [frame.value ?? SYMBOL_NULL_CELL] }],
                })),
              ),
            })),
          },
          ...rangeFields.map(field => ({ fieldId: field.fieldId, tracks: field.tracks })),
        ],
      },
    ],
  }
  return `${XDTS_TEXT_HEADER}\n${JSON.stringify(raw, null, 2)}\n`
}

function buildRangeField(
  project: Pick<CutProject, 'logicalSheet' | 'timedRangeCues'>,
  role: 'sound' | 'camera',
  fieldId: 3 | 5,
): RawRangeField {
  const section = project.logicalSheet.timelineSections.find(item => item.role === role)
  const lanes = [...(section?.lanes ?? [])].sort((left, right) => left.order - right.order)
  const cuesByLane = new Map<string, TimedRangeCue[]>()
  for (const cue of project.timedRangeCues) {
    if (cue.role !== role) continue
    const existing = cuesByLane.get(cue.laneId) ?? []
    existing.push(cue)
    cuesByLane.set(cue.laneId, existing)
  }
  const usedLanes = lanes.filter(lane => (cuesByLane.get(lane.laneId)?.length ?? 0) > 0)
  return {
    fieldId,
    names: usedLanes.map(lane => lane.label),
    tracks: usedLanes.map((lane, trackNo) => ({
      trackNo,
      frames: (cuesByLane.get(lane.laneId) ?? [])
        .slice()
        .sort((left, right) => left.frameStart - right.frameStart || left.frameEnd - right.frameEnd)
        .flatMap(cue => rangeCueFrames(cue, project.logicalSheet.frameOrigin, fieldId)),
    })),
  }
}

function rangeCueFrames(cue: TimedRangeCue, frameOrigin: number, fieldId: 3 | 5): RawXdtsFrame[] {
  const start = Math.max(0, cue.frameStart - frameOrigin)
  const end = Math.max(start, cue.frameEnd - frameOrigin)
  const values = fieldId === 3
    ? [cue.label, cue.text]
    : [cameraInstructionLabel(cue)]
  const frames: RawXdtsFrame[] = [{ frame: start, data: [{ id: 0, values }] }]
  for (let frame = start + 1; frame <= end; frame += 1) {
    frames.push({ frame, data: [{ id: 0, values: [SYMBOL_HYPHEN] }] })
  }
  return frames
}

function cameraInstructionLabel(cue: TimedRangeCue): string {
  if (cue.label.trim()) return cue.label.trim()
  switch (cue.camera?.shape) {
    case 'fade-in': return 'FI'
    case 'fade-out': return 'FO'
    case 'overlap': return 'OL'
    default: return ''
  }
}

function compactFrames(frames: RawXdtsFrame[]): RawXdtsFrame[] {
  const sorted = [...frames].sort((a, b) => a.frame - b.frame)
  const result: RawXdtsFrame[] = []
  let previous: string | undefined
  for (const frame of sorted) {
    const value = frame.data[0]?.values[0]
    if (value === previous) continue
    previous = value
    result.push(frame)
  }
  return result
}
