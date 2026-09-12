import type { TimelineEvent, TimingKey, SheetTimingRole } from './types'
import { compareTimelineEvents, sameEventTarget, sheetTimingRoleForEvent } from './project-shared'

export const timingGroupKey = (role: SheetTimingRole, track: string) => `${role}\u0000${track}`
export type TimingChange = { role: SheetTimingRole; paperTrack: string; frameStart: number; frameEnd: number; eventIds: string[] }
type TimingIndex = { groups: ReadonlyMap<string, readonly TimelineEvent[]>; changes?: readonly TimingChange[] }
const indexes = new WeakMap<readonly TimelineEvent[], TimingIndex>()
const keys = new WeakMap<readonly TimingKey[], ReadonlyMap<string, TimingKey>>()
const orderedBuffers = new WeakSet<readonly TimelineEvent[]>()

/** Preserve the canonical order with one binary insertion after a local edit. */
export function replaceTimingEvent(events: readonly TimelineEvent[], event: TimelineEvent): TimelineEvent[] {
  let ordered = events
  if (!orderedBuffers.has(events)) {
    if (!events.every((item, index) => index === 0 || compareTimelineEvents(events[index - 1]!, item) <= 0)) ordered = [...events].sort(compareTimelineEvents)
    orderedBuffers.add(ordered)
  }
  const next = ordered.filter(item => !sameEventTarget(item, event.paperTrack, event.frame, sheetTimingRoleForEvent(event)))
  let low = 0, high = next.length
  while (low < high) { const mid = (low + high) >>> 1; if (compareTimelineEvents(next[mid]!, event) <= 0) low = mid + 1; else high = mid }
  next.splice(low, 0, event); orderedBuffers.add(next)
  return next
}

/** Runtime read model only: saved documents and undo snapshots retain their schema. */
export function timingEventIndex(events: readonly TimelineEvent[]): TimingIndex {
  const cached = indexes.get(events)
  if (cached) return cached
  const groups = new Map<string, TimelineEvent[]>()
  for (const event of events) {
    const key = timingGroupKey(sheetTimingRoleForEvent(event), event.paperTrack)
    const group = groups.get(key) ?? []
    group.push(event); groups.set(key, group)
  }
  for (const group of groups.values()) group.sort((a, b) => a.frame - b.frame)
  const index = { groups }
  indexes.set(events, index)
  return index
}
export function timingKeyIndex(items: readonly TimingKey[]) {
  let index = keys.get(items)
  if (!index) { index = new Map(items.map(key => [key.keyId, key])); keys.set(items, index) }
  return index
}
export function timingFrameLowerBound(events: readonly TimelineEvent[], frame: number) {
  let low = 0, high = events.length
  while (low < high) { const mid = (low + high) >>> 1; if (events[mid]!.frame < frame) low = mid + 1; else high = mid }
  return low
}
export function timingEventsInRange(events: readonly TimelineEvent[], start: number, end: number): TimelineEvent[] {
  const result: TimelineEvent[] = []
  for (const group of timingEventIndex(events).groups.values()) {
    const first = timingFrameLowerBound(group, start), after = timingFrameLowerBound(group, end + 1)
    for (let index = first; index < after; index++) result.push(group[index]!)
  }
  return result.sort(compareTimelineEvents)
}

/** Share every unaffected track block, including when undo returns to old arrays. */
export function registerTimingChange(before: readonly TimelineEvent[], after: TimelineEvent[], change: TimingChange, replacement?: TimelineEvent) {
  if (orderedBuffers.has(before)) orderedBuffers.add(after)
  const previous = indexes.get(before)
  if (!previous) return
  const key = timingGroupKey(change.role, change.paperTrack)
  const groups = new Map(previous.groups)
  const group = (groups.get(key) ?? []).filter(event => event.frame < change.frameStart || event.frame > change.frameEnd)
  if (replacement) group.splice(timingFrameLowerBound(group, replacement.frame), 0, replacement)
  groups.set(key, group)
  indexes.set(after, { groups, changes: [change] })
}
