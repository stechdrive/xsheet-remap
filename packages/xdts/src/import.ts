import {
  createKey,
  createTimedRangeCue,
  setTimingSpecialEvent,
  replaceTimedRangeCues,
  setEvent,
  sheetTimingRoleForEvent,
  updateLogicalSheetSettings,
  type CameraInstructionShape,
  type CutProject,
  type LogicalTimelineLane,
  type SheetTimingRole,
} from '@xsheet-remap/core'
import type { XdtsData, XdtsRangeCue, XdtsTimeTable } from './types'

export type XdtsImportConflictMode = 'replace' | 'empty-only'

export interface XdtsImportOptions {
  tableIndex: number
  targetRole: SheetTimingRole
  includeSound: boolean
  includeCamera: boolean
  conflictMode: XdtsImportConflictMode
  applyCutIdentity: boolean
  expandDuration: boolean
}

export interface XdtsImportSummary {
  table: XdtsTimeTable
  cellEventCount: number
  soundCueCount: number
  cameraCueCount: number
  warnings: string[]
}

export interface XdtsImportResult extends XdtsImportSummary {
  project: CutProject
  skippedCount: number
}

export const DEFAULT_XDTS_IMPORT_OPTIONS: XdtsImportOptions = {
  tableIndex: 0,
  targetRole: 'action',
  includeSound: true,
  includeCamera: true,
  conflictMode: 'replace',
  applyCutIdentity: false,
  expandDuration: true,
}

export function summarizeXdtsImport(data: XdtsData, options: XdtsImportOptions): XdtsImportSummary {
  const table = selectedTable(data, options.tableIndex)
  const warnings: string[] = []
  if (table.unknownFields.length > 0) {
    warnings.push(`未対応のXDTSフィールド（${table.unknownFields.map(field => field.fieldId).join(', ')}）は読み込みません。`)
  }
  const cameraCoordinateCount = table.cameraCues.filter(cue => cue.values.slice(1).some(value => value.trim())).length
  if (cameraCoordinateCount > 0) {
    warnings.push(`CAMERA座標を含む指示 ${cameraCoordinateCount} 件は、区間と指示名だけを読み込みます。`)
  }
  return {
    table,
    cellEventCount: table.tracks.reduce((count, track) => count + track.frames.length, 0),
    soundCueCount: options.includeSound ? table.dialogueCues.length : 0,
    cameraCueCount: options.includeCamera ? table.cameraCues.length : 0,
    warnings,
  }
}

/** Builds the complete next project without mutating the source. Commit this result once for atomic undo. */
export function importXdtsIntoProject(
  sourceProject: CutProject,
  data: XdtsData,
  options: XdtsImportOptions,
): XdtsImportResult {
  const summary = summarizeXdtsImport(data, options)
  const { table } = summary
  const durationFrames = options.expandDuration
    ? Math.max(sourceProject.logicalSheet.durationFrames, table.duration)
    : sourceProject.logicalSheet.durationFrames
  let project = updateLogicalSheetSettings(sourceProject, {
    durationFrames,
    fps: table.fps,
  })
  if (options.applyCutIdentity) {
    project = {
      ...project,
      cut: { ...project.cut, cut: data.header.cut, scene: data.header.scene },
    }
  }

  const targetTracks = project.logicalSheet.paperTracks
    .filter(track => track.source !== 'overlay')
    .slice()
    .sort((left, right) => left.order - right.order)
  const mappings = table.tracks
    .slice()
    .sort((left, right) => left.trackNo - right.trackNo)
    .map((track, index) => ({ source: track, target: targetTracks[track.trackNo] ?? targetTracks[index] }))
  const warnings = [...summary.warnings]
  const unmapped = mappings.filter(mapping => !mapping.target)
  if (unmapped.length > 0) {
    warnings.push(`対応する列がないXDTSトラック ${unmapped.map(item => `${item.source.name}(#${item.source.trackNo})`).join(', ')} は読み込みません。`)
  }

  const importFrameStart = project.logicalSheet.frameOrigin
  const importFrameEnd = importFrameStart + table.duration - 1
  if (options.conflictMode === 'replace') {
    const mappedNames = new Set(mappings.flatMap(mapping => mapping.target ? [mapping.target.paperTrack] : []))
    project = {
      ...project,
      logicalSheet: {
        ...project.logicalSheet,
        events: project.logicalSheet.events.filter(event =>
          sheetTimingRoleForEvent(event) !== options.targetRole
          || !mappedNames.has(event.paperTrack)
          || event.frame < importFrameStart
          || event.frame > importFrameEnd,
        ),
      },
    }
  }

  let skippedCount = 0
  for (const mapping of mappings) {
    if (!mapping.target) continue
    for (const frame of mapping.source.frames) {
      const targetFrame = importFrameStart + frame.frameIndex
      if (targetFrame < importFrameStart || targetFrame > importFrameEnd) continue
      const occupied = project.logicalSheet.events.some(event =>
        event.paperTrack === mapping.target!.paperTrack
        && event.frame === targetFrame
        && sheetTimingRoleForEvent(event) === options.targetRole,
      )
      if (options.conflictMode === 'empty-only' && occupied) {
        skippedCount += 1
        continue
      }
      if (frame.valueKind !== 'cell') {
        project = setTimingSpecialEvent(project, mapping.target.paperTrack, targetFrame, frame.valueKind, options.targetRole, { source: 'import' })
        continue
      }
      if (frame.cellName === null) continue
      const created = createKey(project, mapping.target.paperTrack, frame.cellName, 'import', frame.cellName, options.targetRole)
      project = setEvent(created.project, mapping.target.paperTrack, targetFrame, created.key.keyId, options.targetRole, { source: 'import' })
    }
  }

  if (options.includeSound) {
    const result = importRangeCues(project, table.dialogueCues, 'sound', options.conflictMode, importFrameStart, importFrameEnd)
    project = result.project
    skippedCount += result.skippedCount
    warnings.push(...result.warnings)
  }
  if (options.includeCamera) {
    const result = importRangeCues(project, table.cameraCues, 'camera', options.conflictMode, importFrameStart, importFrameEnd)
    project = result.project
    skippedCount += result.skippedCount
    warnings.push(...result.warnings)
  }

  return { ...summary, project, skippedCount, warnings }
}

function importRangeCues(
  sourceProject: CutProject,
  sourceCues: XdtsRangeCue[],
  role: 'sound' | 'camera',
  conflictMode: XdtsImportConflictMode,
  frameStart: number,
  frameEnd: number,
): { project: CutProject; skippedCount: number; warnings: string[] } {
  const lanes = timelineLanes(sourceProject, role)
  const mappedLaneIds = new Set<string>()
  const mappings = sourceCues.map(cue => {
    const lane = lanes[cue.trackNo]
    if (lane) mappedLaneIds.add(lane.laneId)
    return { cue, lane }
  })
  const warnings: string[] = []
  const missingTracks = Array.from(new Set(mappings.filter(item => !item.lane).map(item => item.cue.trackNo)))
  if (missingTracks.length > 0) {
    warnings.push(`${role === 'sound' ? 'SOUND' : 'CAMERA'}欄に対応レーンがないトラック #${missingTracks.join(', #')} は読み込みません。`)
  }
  let project = sourceProject
  if (conflictMode === 'replace') {
    project = replaceTimedRangeCues(project, project.timedRangeCues.filter(cue =>
      cue.role !== role
      || !mappedLaneIds.has(cue.laneId)
      || cue.frameEnd < frameStart
      || cue.frameStart > frameEnd,
    ))
  }
  let skippedCount = 0
  for (const mapping of mappings) {
    if (!mapping.lane) continue
    const cueStart = frameStart + mapping.cue.frameStart
    const cueEnd = Math.min(frameEnd, frameStart + mapping.cue.frameEnd)
    const occupied = project.timedRangeCues.some(cue => cue.role === role
      && cue.laneId === mapping.lane!.laneId
      && cue.frameStart <= cueEnd
      && cue.frameEnd >= cueStart)
    if (conflictMode === 'empty-only' && occupied) {
      skippedCount += 1
      continue
    }
    const label = mapping.cue.values[0] ?? ''
    const created = createTimedRangeCue(project, {
      role,
      laneId: mapping.lane.laneId,
      frameStart: cueStart,
      frameEnd: cueEnd,
      label,
      text: role === 'sound' ? mapping.cue.values.slice(1).join('\n') : '',
      camera: role === 'camera' ? { shape: cameraShape(label) } : undefined,
      source: 'import',
    })
    project = created.project
  }
  return { project, skippedCount, warnings }
}

function timelineLanes(project: CutProject, role: 'sound' | 'camera'): LogicalTimelineLane[] {
  return project.logicalSheet.timelineSections
    .find(section => section.role === role)
    ?.lanes?.slice().sort((left, right) => left.order - right.order) ?? []
}

function cameraShape(label: string): CameraInstructionShape {
  switch (label.trim().toUpperCase()) {
    case 'FI': return 'fade-in'
    case 'FO': return 'fade-out'
    case 'OL': return 'overlap'
    default: return 'range'
  }
}

function selectedTable(data: XdtsData, tableIndex: number): XdtsTimeTable {
  const table = data.timeTables[tableIndex]
  if (!table) throw new Error(`XDTSタイムテーブルが見つかりません: ${tableIndex + 1}`)
  return table
}
