import type { CutProject, LogicalSheet, ProcessTiming, SheetTimingRole, TimingKey } from './types'
import { isSpecialTimingKeyId, sheetTimingRoleForEvent } from './project-shared'

export function timingForProcess(sheet: LogicalSheet, processId: string): ProcessTiming {
  if (!sheet.processTimings || sheet.processTimings.activeProcessId === processId) return sheet
  return sheet.processTimings.inactive[processId] ?? { events: [], referenceMarks: [] }
}

/** Switch the editor's working slice without copying timing between processes. */
export function selectTimingProcess(project: CutProject, processId: string): CutProject {
  const sheet = project.logicalSheet, bank = sheet.processTimings
  if (!bank || bank.activeProcessId === processId || !project.correctionLayers.some(layer => layer.layerId === processId)) return project
  const next = timingForProcess(sheet, processId)
  const inactive = { ...bank.inactive }
  if (sheet.events.length || sheet.referenceMarks?.length) inactive[bank.activeProcessId] = { events: sheet.events, referenceMarks: sheet.referenceMarks }
  else delete inactive[bank.activeProcessId]
  delete inactive[processId]
  return { ...project, logicalSheet: { ...sheet, events: next.events, referenceMarks: next.referenceMarks, processTimings: { activeProcessId: processId, inactive } } }
}

export function keyInActiveProcess(project: Pick<CutProject, 'logicalSheet'>, key: Pick<TimingKey, 'processId'>): boolean {
  return !project.logicalSheet.processTimings || key.processId === project.logicalSheet.processTimings.activeProcessId
}

export function allProcessEvents(sheet: LogicalSheet) {
  return [...sheet.events, ...Object.values(sheet.processTimings?.inactive ?? {}).flatMap(timing => timing.events)]
}

export function emptyProcessTimings(sheet: Pick<LogicalSheet, 'processTimings'>): LogicalSheet['processTimings'] {
  return sheet.processTimings && { activeProcessId: sheet.processTimings.activeProcessId, inactive: {} }
}

export function mapInactiveProcessTimings(sheet: Pick<LogicalSheet, 'processTimings'>, transform: (timing: ProcessTiming) => ProcessTiming): LogicalSheet['processTimings'] {
  return sheet.processTimings && { ...sheet.processTimings, inactive: Object.fromEntries(Object.entries(sheet.processTimings.inactive).map(([id, timing]) => [id, transform(timing)])) }
}

/** Saved ordering is independent of which process happens to be on screen. */
export function canonicalTimingProject(project: CutProject): CutProject {
  return project.logicalSheet.processTimings ? selectTimingProcess(project, project.correctionLayers[0]?.layerId ?? '') : project
}

export function validateProcessTimings(project: Pick<CutProject, 'logicalSheet' | 'correctionLayers'>): void {
  const bank = project.logicalSheet.processTimings
  if (!bank) return
  const processes = new Set(project.correctionLayers.map(layer => layer.layerId))
  if (!processes.has(bank.activeProcessId) || !bank.inactive || typeof bank.inactive !== 'object' || Array.isArray(bank.inactive)
    || Object.hasOwn(bank.inactive, bank.activeProcessId)) throw new Error('工程別タイミングの構成が不正です。')
  const keys = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  for (const timing of Object.values(bank.inactive)) {
    if (!timing || typeof timing !== 'object' || !Array.isArray(timing.events)) throw new Error('工程別タイミングの構成が不正です。')
  }
  for (const processId of [bank.activeProcessId, ...Object.keys(bank.inactive)]) {
    const timing = timingForProcess(project.logicalSheet, processId)
    if (!processes.has(processId) || !Array.isArray(timing.events)) throw new Error('工程別タイミングの参照先が不正です。')
    if (timing.referenceMarks && (!Array.isArray(timing.referenceMarks) || timing.referenceMarks.some(mark => !mark || !Number.isSafeInteger(mark.frame) || !project.logicalSheet.paperTracks.some(track => track.paperTrack === mark.paperTrack)))) throw new Error('工程別タイミングの参照指定が不正です。')
    const positions = new Set<string>()
    for (const event of timing.events) {
      if (!event || typeof event !== 'object') throw new Error('工程別タイミングのセル指定が不正です。')
      const position = JSON.stringify([event.paperTrack, sheetTimingRoleForEvent(event), event.frame])
      if (!Number.isSafeInteger(event.frame) || positions.has(position) || !project.logicalSheet.paperTracks.some(track => track.paperTrack === event.paperTrack)
        || !isSpecialTimingKeyId(event.keyId) && keys.get(event.keyId)?.processId !== processId) throw new Error('工程別タイミングのセル指定が不正です。')
      positions.add(position)
    }
  }
}

export function pruneEmptyProcessTimings<T extends Pick<LogicalSheet, 'events' | 'referenceMarks' | 'processTimings'>>(sheet: T, removed: Set<string>, fallback: string): T {
  const bank = sheet.processTimings
  if (!bank) return sheet
  const timing = (id: string) => bank.activeProcessId === id ? sheet : bank.inactive[id]
  for (const id of removed) {
    const value = timing(id)
    if (value?.events.length || value?.referenceMarks?.length) throw new Error('別のカット・シートで使用中の表示グループは削除できません。')
  }
  const activeProcessId = removed.has(bank.activeProcessId) ? fallback : bank.activeProcessId
  const active = timing(activeProcessId) ?? { events: [], referenceMarks: [] }
  return { ...sheet, events: active.events, referenceMarks: active.referenceMarks, processTimings: { activeProcessId, inactive: Object.fromEntries(Object.entries(bank.inactive).filter(([id]) => !removed.has(id) && id !== activeProcessId)) } }
}

export interface ProcessTimingDifference {
  paperTrack: string
  role: SheetTimingRole
  frameStart: number
  frameEnd: number
  values: { processId: string; label: string; state: 'unmapped' | 'unspecified' | 'blank' | 'cell' | 'unregistered' }[]
}

/** Compare exposure intervals (not just key positions), without expanding every frame. */
export function processTimingDifferences(project: CutProject): ProcessTimingDifference[] {
  if (!project.logicalSheet.processTimings) return []
  const result: ProcessTimingDifference[] = [], sheet = project.logicalSheet
  const keys = new Map(sheet.keys.map(key => [key.keyId, key]))
  const bindings = new Map(project.bindings.map(binding => [JSON.stringify([binding.slotId, binding.keyId]), binding]))
  const start = sheet.frameOrigin - sheet.workRange.preRollFrames, end = sheet.frameOrigin + sheet.durationFrames + sheet.workRange.postRollFrames
  for (const track of sheet.paperTracks) for (const role of ['action', 'cell'] as const) {
    const streams = project.correctionLayers.map(process => {
      const slot = project.cspTrackSlots.find(slot => slot.paperTrack === track.paperTrack && slot.correctionLayerId === process.layerId)
      const target = project.clipDocument?.targets.find(target => target.slotId === slot?.slotId)
      const timing = timingForProcess(sheet, process.layerId), events = timing.events.filter(event => event.paperTrack === track.paperTrack && sheetTimingRoleForEvent(event) === role)
      const marks = new Map<number, string>()
      for (const event of events) if (event.valueKind === 'inbetween' || event.valueKind === 'reverse') marks.set(event.frame, event.valueKind === 'inbetween' ? '○' : '●')
      for (const mark of timing.referenceMarks ?? []) if (mark.paperTrack === track.paperTrack && mark.sheetRole === role) marks.set(mark.frame, `${marks.get(mark.frame) ?? ''}参考`)
      return { processId: process.layerId, slot, target, marks, events: events.filter(event => ['cell', 'blank'].includes(event.valueKind)).sort((a, b) => a.frame - b.frame) }
    })
    if (!streams.some(stream => stream.events.length || stream.marks.size) || streams.filter(stream => stream.target).length < 2) continue
    const boundaries = [...new Set([start, end, ...streams.flatMap(stream => [...stream.events.map(event => event.frame), ...[...stream.marks.keys()].flatMap(frame => [frame, frame + 1])].filter(frame => frame >= start && frame < end))])].sort((a, b) => a - b)
    const cursors = streams.map(() => -1)
    for (let index = 0; index < boundaries.length - 1; index++) {
      const frameStart = boundaries[index]!, frameEnd = boundaries[index + 1]! - 1
      const values: ProcessTimingDifference['values'] = streams.map((stream, streamIndex) => {
        while (stream.events[cursors[streamIndex]! + 1]?.frame <= frameStart) cursors[streamIndex]++
        const event = stream.events[cursors[streamIndex]!]
        const suffix = stream.marks.has(frameStart) ? `（${stream.marks.get(frameStart)}）` : ''
        if (!stream.target) return { processId: stream.processId, label: '未対応', state: 'unmapped' }
        if (!event) return { processId: stream.processId, label: `指定なし${suffix}`, state: 'unspecified' }
        if (event.valueKind === 'blank') return { processId: stream.processId, label: `×${suffix}`, state: 'blank' }
        const key = keys.get(event.keyId), binding = bindings.get(JSON.stringify([stream.slot?.slotId, event.keyId]))
        return { processId: stream.processId, label: `${key?.displayLabel ?? '未登録'}${suffix}`, state: binding?.clipLayerId ? 'cell' : 'unregistered' }
      })
      const mapped = values.filter(value => value.state !== 'unmapped')
      if (new Set(mapped.map(value => `${value.state}:${value.label}`)).size < 2) continue
      const previous = result.at(-1)
      if (previous?.paperTrack === track.paperTrack && previous.role === role && previous.frameEnd + 1 === frameStart && JSON.stringify(previous.values) === JSON.stringify(values)) previous.frameEnd = frameEnd
      else result.push({ paperTrack: track.paperTrack, role, frameStart, frameEnd, values })
    }
  }
  return result
}
