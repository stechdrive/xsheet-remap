import type { CutProject, TimelineEvent } from './types'
import { NULL_CELL_KEY_ID } from './types'
import type { SheetTemplate } from './sheet-template-schema'
import { sheetTimingRoleForEvent, timingEventValueKind } from './project-shared'
import { createKey, setEvent, setTimingSpecialEvent } from './project-timing'
import { logicalSheetDisplayFrameEnd } from './logical-sheet'
import { assertPaperTranscriptionContext } from './paper-transcription-request'
import { validatePaperTranscription } from './paper-transcription-parse'
import type { PaperTranscriptionRequest, PaperTranscriptionResult, PaperTranscriptionTarget, PaperTranscriptionRun } from './paper-transcription-types'

export interface PaperTranscriptionImportOptions {
  targetIds: string[]
  replaceExisting: boolean
}
export interface PaperTranscriptionImportPlan {
  project: CutProject
  changed: boolean
  targets: number
  recordedMarks: number
  replacedMarks: number
  boundaryMarks: number
}

/** Pure transaction: caller commits once after review. Cell labels never rename existing keys/bindings. */
export function planPaperTranscriptionImport(
  source: CutProject, template: SheetTemplate, scopeKey: string,
  request: PaperTranscriptionRequest, result: PaperTranscriptionResult, options: PaperTranscriptionImportOptions,
): PaperTranscriptionImportPlan {
  assertPaperTranscriptionContext(request, source, template, scopeKey)
  validatePaperTranscription(result, request)
  const selected = new Set(options.targetIds)
  if (!selected.size || selected.size !== options.targetIds.length || [...selected].some(id => !request.targets.some(target => target.targetId === id))) throw new Error('反映する対象を選択してください。')
  const entries = request.targets.filter(target => selected.has(target.targetId)).map(target => {
    const runs = result.targets.find(entry => entry.targetId === target.targetId)!.runs
    if (runs.some(run => run.kind === 'uncertain' || run.kind === 'unread')) throw new Error(`${target.label} ${target.column}列 ${target.from}〜${target.to}F: 要確認・未読が残っています。修正するか、この対象を反映から外してください。`)
    return { ...target, runs }
  }).sort((a, b) => a.role.localeCompare(b.role) || a.column.localeCompare(b.column) || a.from - b.from)
  const groups: (PaperTranscriptionTarget & { runs: PaperTranscriptionRun[] })[] = []
  for (const entry of entries) {
    const previous = groups.at(-1)
    if (previous && previous.role === entry.role && previous.column === entry.column && previous.to + 1 === entry.from) {
      previous.to = entry.to; previous.runs.push(...entry.runs)
    } else groups.push({ ...entry, runs: [...entry.runs] })
  }
  let project = source, recordedMarks = 0, replacedMarks = 0, boundaryMarks = 0
  for (const group of groups) {
    const matches = (event: TimelineEvent) => event.paperTrack === group.column && sheetTimingRoleForEvent(event) === group.role
    const sourceEvents = source.logicalSheet.events.filter(matches).sort((a, b) => a.frame - b.frame)
    const old = sourceEvents.filter(event => event.frame >= group.from && event.frame <= group.to)
    const marks = group.runs.filter(run => ['cell', 'blank', 'inbetween', 'reverse'].includes(run.kind))
    const oldReferences = (source.logicalSheet.referenceMarks ?? []).filter(mark => mark.paperTrack === group.column && mark.sheetRole === group.role && mark.frame >= group.from && mark.frame <= group.to)
    const same = old.length === marks.length && !oldReferences.length && old.every((event, index) => {
      const mark = marks[index]!
      return event.frame === mark.from && timingEventValueKind(event) === mark.kind
        && (mark.kind !== 'cell' || source.logicalSheet.keys.find(key => key.keyId === event.keyId)?.displayLabel === mark.value)
    })
    let preceding = effectiveKey(sourceEvents, group.from - 1)
    for (const run of group.runs) {
      if (run.kind === 'hold' && !preceding) throw new Error(`${group.label} ${group.column}列 ${run.from}F: 継続元のセルがありません。前のコマも読み取るか、番号を確認してください。`)
      if (run.kind === 'cell') preceding = run.value!
      if (run.kind === 'blank') preceding = NULL_CELL_KEY_ID
    }
    if (same) continue
    if ((old.length || oldReferences.length) && !options.replaceExisting) throw new Error(`${group.label} ${group.column}列 ${group.from}〜${group.to}Fに既存の記入があります。原画像と差分を確認し、範囲の置き換えを選択してください。`)
    project = { ...project, logicalSheet: { ...project.logicalSheet,
      events: project.logicalSheet.events.filter(event => !matches(event) || event.frame < group.from || event.frame > group.to),
      referenceMarks: project.logicalSheet.referenceMarks?.filter(mark => mark.paperTrack !== group.column || mark.sheetRole !== group.role || mark.frame < group.from || mark.frame > group.to),
    } }
    replacedMarks += old.length + oldReferences.length
    for (const mark of marks) {
      if (mark.kind === 'cell') {
        const created = createKey(project, group.column, mark.value, 'recognition', mark.raw, group.role)
        project = setEvent(created.project, group.column, mark.from, created.key.keyId, group.role, { source: 'recognition' })
      } else {
        project = setTimingSpecialEvent(project, group.column, mark.from, mark.kind as 'blank' | 'inbetween' | 'reverse', group.role, { source: 'recognition' })
      }
      recordedMarks++
    }
    // A later unreviewed range must retain its original exposure, including empty paper.
    const after = group.to + 1
    const originalKey = effectiveKey(sourceEvents, after)
    const nextKey = effectiveKey(project.logicalSheet.events.filter(matches), after)
    if (after <= logicalSheetDisplayFrameEnd(source.logicalSheet) && (originalKey ?? NULL_CELL_KEY_ID) !== (nextKey ?? NULL_CELL_KEY_ID)) {
      const existing = sourceEvents.find(event => event.frame === after)
      if (existing && !['cell', 'blank'].includes(timingEventValueKind(existing))) throw new Error(`${after}Fの記号を保ったまま継続を戻せません。読み取り・反映範囲を次のセル指定まで広げてください。`)
      project = setEvent(project, group.column, after, originalKey ?? NULL_CELL_KEY_ID, group.role, { source: 'recognition' })
      boundaryMarks++
    }
  }
  return { project, changed: project !== source, targets: entries.length, recordedMarks, replacedMarks, boundaryMarks }
}

function effectiveKey(events: TimelineEvent[], frame: number): string | null {
  let previous: TimelineEvent | undefined
  for (const event of events) if (event.frame <= frame && (!previous || event.frame >= previous.frame)
    && ['cell', 'blank'].includes(timingEventValueKind(event))) previous = event
  return previous?.keyId ?? null
}
