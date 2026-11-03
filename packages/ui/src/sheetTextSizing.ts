import { uiText } from './i18n'
import { sheetTimingRoleForEvent, timingEventValueKind, updateTimedRangeCue,
  type CutProject, type SheetTemplate, type TimedRangeCue, type TimelineEvent } from '@xsheet-remap/core'
import type { SheetSelection } from './appTypes'
import { clampTextFontSizePx, defaultTimingTextFontSizePx, resolveTimingTextFontSizePx, TEXT_FONT_SIZE_PRESETS } from './sheetTextLayout'
import { cueTextSizes, type CueTextSizeStyle } from './cueTextSizing'

export type TextSizePart = 'all' | 'primary' | 'secondary'
export type TextSizeOperation = { kind: 'set'; value: number; part?: TextSizePart }
  | { kind: 'step'; direction: -1 | 1 } | { kind: 'reset' } | { kind: 'fit' }
export type SheetTextTargets = { events: TimelineEvent[]; cues: TimedRangeCue[]; label: string; nextOnly: boolean }

export function selectedSheetTextTargets(project: CutProject, selection: SheetSelection): SheetTextTargets {
  const keys = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const events = project.logicalSheet.events.filter(event => {
    if (timingEventValueKind(event) !== 'cell' || !keys.get(event.keyId)?.displayLabel.trim()) return false
    const role = sheetTimingRoleForEvent(event)
    if (selection.kind === 'cell') return event.paperTrack === selection.hit.paperTrack
      && event.frame === selection.hit.frame && role === selection.hit.role
    if (selection.kind !== 'range') return false
    const range = selection.range, tracks = range.paperTracks.length ? range.paperTracks : [range.paperTrack]
    return role === range.role && tracks.includes(event.paperTrack) && event.frame >= range.frameStart && event.frame <= range.frameEnd
  })
  const cues = project.timedRangeCues.filter(cue => {
    if (selection.kind === 'cue') return cue.cueId === selection.cueId
    if (selection.kind !== 'range') return false
    const range = selection.range
    return cue.role === range.role && cue.laneId === range.anchorHit.timelineLaneId
      && cue.frameStart <= range.frameEnd && cue.frameEnd >= range.frameStart
  })
  const count = events.length + cues.length
  const role = cues.at(0)?.role ?? (events[0] ? sheetTimingRoleForEvent(events[0])
    : selection.kind === 'range' ? selection.range.role : selection.kind === 'cell' ? selection.hit.role : null)
  const nextOnly = count === 0 && (selection.kind === 'none' || (selection.kind === 'cell' && (role === 'action' || role === 'cell')))
  return { events, cues, nextOnly, label: count ? `${role === 'cell' ? uiText.sheetRoles.cell : role?.toUpperCase()} ${count}件` : nextOnly ? '次に入力する文字' : '変更できる文字がありません' }
}

export function stepTextFontSize(value: number, direction: -1 | 1): number {
  return direction > 0 ? TEXT_FONT_SIZE_PRESETS.find(size => size > value) ?? 256
    : [...TEXT_FONT_SIZE_PRESETS].reverse().find(size => size < value) ?? 6
}

export function sheetTextSizeValues(template: SheetTemplate, targets: SheetTextTargets, nextSize: number, pageSize: { widthPx: number; heightPx: number } = template.page) {
  const values = [...targets.events.map(event => resolveTimingTextFontSizePx(template, sheetTimingRoleForEvent(event), event.fontSizePx)),
    ...targets.cues.map(cue => cueTextSizes(template, cue, pageSize).primary)]
  const secondary = targets.cues.map(cue => cueTextSizes(template, cue, pageSize).secondary)
  const common = (items: number[], fallback: number) => !items.length ? fallback : items.every(value => Math.abs(value - items[0]) < .01) ? items[0] : null
  const items = [...targets.events, ...targets.cues]
  const modes = items.map(item => item.fontSizeMode === 'fixed' ? '指定サイズ' : item.fontSizeMode === 'fit' ? '枠に収める' : '標準')
  return { value: common(values, nextSize), secondary: secondary.length ? common(secondary, nextSize) : undefined,
    secondaryLabel: targets.cues[0]?.role === 'sound' ? '本文' : '開始・終了ラベル',
    primaryLabel: targets.cues[0]?.role === 'sound' ? 'ラベル' : '指示',
    mode: modes.length && !modes.every(mode => mode === modes[0]) ? '混在' : modes[0] ?? '次回入力',
    disabled: !targets.nextOnly && !items.length, count: items.length }
}

export function applySheetTextSize(project: CutProject, template: SheetTemplate, targets: SheetTextTargets, operation: TextSizeOperation, pageSize: { widthPx: number; heightPx: number } = template.page): CutProject {
  const ids = new Set(targets.events.map(event => event.eventId))
  let changed = false
  const events = project.logicalSheet.events.map(event => {
    if (!ids.has(event.eventId)) return event
    const current = resolveTimingTextFontSizePx(template, sheetTimingRoleForEvent(event), event.fontSizePx)
    const style = changedTextSize(event, current, current, operation)
    if (sameTextSize(event, style)) return event
    changed = true
    const next = { ...event }
    delete next.fontSizePx
    delete next.fontSizeMode
    return { ...next, ...style }
  })
  let next = changed ? { ...project, logicalSheet: { ...project.logicalSheet, events } } : project
  for (const cue of targets.cues) {
    const sizes = cueTextSizes(template, cue, pageSize)
    next = updateTimedRangeCue(next, cue.cueId, {
      fontSizePx: undefined, secondaryFontSizePx: undefined, fontSizeMode: undefined,
      ...changedTextSize(cue, sizes.primary, sizes.secondary, operation),
    })
  }
  return next
}

export function changedTextSize(style: CueTextSizeStyle, primary: number, secondary: number, operation: TextSizeOperation): CueTextSizeStyle {
  style = { fontSizePx: style.fontSizePx, secondaryFontSizePx: style.secondaryFontSizePx, fontSizeMode: style.fontSizeMode }
  if (operation.kind === 'reset') return {}
  if (operation.kind === 'fit') return { ...style, fontSizeMode: 'fit' }
  const value = operation.kind === 'step' ? stepTextFontSize(primary, operation.direction) : clampTextFontSizePx(operation.value)
  if (operation.kind === 'set' && operation.part === 'secondary') return { ...style, secondaryFontSizePx: value, fontSizeMode: 'fixed' }
  const secondarySize = operation.kind === 'set' && operation.part === 'primary' ? secondary
    : style.secondaryFontSizePx === undefined ? undefined : clampTextFontSizePx(secondary * value / Math.max(1, primary))
  return { fontSizePx: value, fontSizeMode: 'fixed', ...(secondarySize === undefined ? {} : { secondaryFontSizePx: secondarySize }) }
}

function sameTextSize(left: CueTextSizeStyle, right: CueTextSizeStyle): boolean {
  return left.fontSizePx === right.fontSizePx && left.fontSizeMode === right.fontSizeMode && left.secondaryFontSizePx === right.secondaryFontSizePx
}

export function defaultNextTimingSize(template: SheetTemplate, selection: SheetSelection): number {
  const role = selection.kind === 'cell' ? selection.hit.role : selection.kind === 'range' ? selection.range.role : 'cell'
  return defaultTimingTextFontSizePx(template, role === 'action' ? 'action' : 'cell')
}
