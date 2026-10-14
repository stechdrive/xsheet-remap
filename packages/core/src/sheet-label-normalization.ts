import type { CutProject, SheetTimingRole } from './types'
import { isSpecialTimingKeyId, normalizeTimingKeyDisplayLabel, sheetTimingRoleForEvent, sheetTimingRoleForKey } from './project-shared'

export interface SheetLabelNormalizationOptions {
  sheetRole: SheetTimingRole
  paperTracks?: string[]
  keyIds?: string[]
  method: 'strip-leading-zeros' | 'sequence'
}

export interface SheetLabelNormalizationPlan {
  kind: 'sheet-labels'
  projectId: string
  options: SheetLabelNormalizationOptions
  items: Array<{ keyId: string; paperTrack: string; currentLabel: string; nextLabel: string; occurrences: number }>
  conflicts: Array<{ paperTrack: string; label: string; keyIds: string[] }>
}

/** Sheet labels belong to logical cells, independently of CSP bindings and files. */
export function buildSheetLabelNormalizationPlan(project: CutProject, options: SheetLabelNormalizationOptions): SheetLabelNormalizationPlan {
  const tracks = options.paperTracks && new Set(options.paperTracks)
  const ids = options.keyIds && new Set(options.keyIds)
  const firstFrames = new Map<string, number>(), occurrences = new Map<string, number>()
  for (const event of project.logicalSheet.events) {
    if (sheetTimingRoleForEvent(event) !== options.sheetRole) continue
    firstFrames.set(event.keyId, Math.min(firstFrames.get(event.keyId) ?? Infinity, event.frame))
    occurrences.set(event.keyId, (occurrences.get(event.keyId) ?? 0) + 1)
  }
  const trackOrder = new Map(project.logicalSheet.paperTracks.map(track => [track.paperTrack, track.order]))
  const keys = project.logicalSheet.keys.filter(key =>
    sheetTimingRoleForKey(key) === options.sheetRole && !isSpecialTimingKeyId(key.keyId)
    // Blank cards carry the image-drop linking contract. Never assign them a label here.
    && key.displayLabel.trim() && (!tracks || tracks.has(key.paperTrack)) && (!ids || ids.has(key.keyId)),
  ).sort((a, b) => (trackOrder.get(a.paperTrack) ?? Infinity) - (trackOrder.get(b.paperTrack) ?? Infinity)
    || a.paperTrack.localeCompare(b.paperTrack)
    || (firstFrames.get(a.keyId) ?? Infinity) - (firstFrames.get(b.keyId) ?? Infinity)
    || a.displayLabel.localeCompare(b.displayLabel, 'ja', { numeric: true }) || a.keyId.localeCompare(b.keyId))
  const sequence = new Map<string, number>()
  const items = keys.map(key => {
    const index = (sequence.get(key.paperTrack) ?? 0) + 1
    sequence.set(key.paperTrack, index)
    return {
      keyId: key.keyId, paperTrack: key.paperTrack, currentLabel: key.displayLabel,
      nextLabel: options.method === 'sequence' ? String(index)
        : /^\d+$/.test(key.displayLabel) ? key.displayLabel.replace(/^0+(?=\d)/, '') : key.displayLabel,
      occurrences: occurrences.get(key.keyId) ?? 0,
    }
  })
  const byId = new Map(items.map(item => [item.keyId, item]))
  const owners = new Map<string, { paperTrack: string; label: string; keyIds: string[] }>()
  for (const key of project.logicalSheet.keys) {
    if (sheetTimingRoleForKey(key) !== options.sheetRole || isSpecialTimingKeyId(key.keyId)) continue
    const label = normalizeTimingKeyDisplayLabel(byId.get(key.keyId)?.nextLabel ?? key.displayLabel)
    if (!label) continue
    const identity = JSON.stringify([key.paperTrack, label])
    const owner = owners.get(identity) ?? { paperTrack: key.paperTrack, label, keyIds: [] }
    owner.keyIds.push(key.keyId)
    owners.set(identity, owner)
  }
  const conflicts = [...owners.values()].filter(owner => owner.keyIds.length > 1
    && owner.keyIds.some(id => { const item = byId.get(id); return item && item.currentLabel !== item.nextLabel }))
  return { kind: 'sheet-labels', projectId: project.projectId, options, items, conflicts }
}

export function applySheetLabelNormalizationPlan(project: CutProject, plan: SheetLabelNormalizationPlan): CutProject {
  const current = buildSheetLabelNormalizationPlan(project, plan.options)
  if (plan.projectId !== project.projectId || JSON.stringify(current.items) !== JSON.stringify(plan.items)) {
    throw new Error('シートが変更されています。変更前後の一覧を確認し直してください。')
  }
  if (current.conflicts.length) throw new Error('同じ列に変更後のシート記載が重複します。対象や変更方法を見直してください。')
  const changes = new Map(current.items.filter(item => item.currentLabel !== item.nextLabel).map(item => [item.keyId, item.nextLabel]))
  if (!changes.size) return project
  // Apply simultaneously: swaps must not merge cells or trigger updateKey's CSP-name coupling.
  return { ...project, logicalSheet: { ...project.logicalSheet, keys: project.logicalSheet.keys.map(key => {
    const label = changes.get(key.keyId)
    return label === undefined ? key : { ...key, displayLabel: label, paperToken: label }
  }) } }
}
