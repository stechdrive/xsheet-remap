import type { CellBinding, CutProject, PaperTrackName, SheetTimingRole, TimelineEvent, TimingKey } from './types'
import { nextId, withoutUndefined } from './core-utils'
import { DEFAULT_EXPORT_TIMING_ROLE, DEFAULT_SHEET_TIMING_ROLE } from './project-constants'
import { assetFileBaseName, compareTimelineEvents, defaultCspCellName, ensurePaperTrack, isNullCellKeyId, nextDisplayLabel, normalizeTimingKeyDisplayLabel, sameEventTarget, sheetTimingRoleForKey, uniqueCspCellNameForSlot } from './project-shared'

export function createKey(
  project: CutProject,
  paperTrack: PaperTrackName,
  displayLabel?: string,
  createdFrom: TimingKey['createdFrom'] = 'manual',
  paperToken?: string,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): { project: CutProject; key: TimingKey } {
  ensurePaperTrack(project, paperTrack)
  const label = displayLabel?.trim() || nextDisplayLabel(project, paperTrack, sheetRole)
  const existing = findTimingKeyByDisplayLabel(project, paperTrack, label, sheetRole)
  if (existing) return { project, key: existing }
  const key: TimingKey = {
    keyId: nextId('key', project.logicalSheet.keys.map(item => item.keyId)),
    paperTrack,
    sheetRole,
    displayLabel: label,
    paperToken,
    createdFrom,
  }
  return {
    project: {
      ...project,
      logicalSheet: {
        ...project.logicalSheet,
        keys: [...project.logicalSheet.keys, key],
      },
    },
    key,
  }
}

export function findTimingKeyByDisplayLabel(
  project: CutProject,
  paperTrack: PaperTrackName,
  displayLabel: string,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): TimingKey | null {
  const label = normalizeTimingKeyDisplayLabel(displayLabel)
  if (!label) return null
  return project.logicalSheet.keys.find(key =>
    key.paperTrack === paperTrack
    && sheetTimingRoleForKey(key) === sheetRole
    && normalizeTimingKeyDisplayLabel(key.displayLabel) === label
  ) ?? null
}

export function setEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  keyId: string,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
  options: { fontSizePx?: number; source?: TimelineEvent['source'] } = {},
): CutProject {
  ensurePaperTrack(project, paperTrack)
  if (!isNullCellKeyId(keyId)) {
    const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
    if (!key) throw new Error(`key not found: ${keyId}`)
    if (key.paperTrack !== paperTrack) throw new Error(`key ${keyId} does not belong to paperTrack ${paperTrack}`)
    if (sheetTimingRoleForKey(key) !== sheetRole) throw new Error(`key ${keyId} does not belong to ${sheetRole}`)
  }
  const event: TimelineEvent = {
    eventId: nextId('event', project.logicalSheet.events.map(item => item.eventId)),
    paperTrack,
    sheetRole,
    frame,
    keyId,
    ...(typeof options.fontSizePx === 'number' && Number.isFinite(options.fontSizePx) ? { fontSizePx: options.fontSizePx } : {}),
    source: options.source ?? 'manual',
  }
  const events = project.logicalSheet.events
    .filter(item => !sameEventTarget(item, paperTrack, frame, sheetRole))
    .concat(event)
    .sort(compareTimelineEvents)
  return { ...project, logicalSheet: { ...project.logicalSheet, events } }
}

export function clearEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): CutProject {
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      events: project.logicalSheet.events.filter(item => !sameEventTarget(item, paperTrack, frame, sheetRole)),
    },
  }
}

export function createOrSetEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole = DEFAULT_SHEET_TIMING_ROLE,
): { project: CutProject; key: TimingKey } {
  const created = createKey(project, paperTrack, undefined, 'manual', undefined, sheetRole)
  const withEvent = setEvent(created.project, paperTrack, frame, created.key.keyId, sheetRole)
  return { project: ensureDefaultBindingsForKey(withEvent, created.key.keyId), key: created.key }
}

export type CreateRecognizedEventStatus = 'created' | 'already-present' | 'conflict'

export function createRecognizedEvent(
  project: CutProject,
  paperTrack: PaperTrackName,
  frame: number,
  sheetRole: SheetTimingRole,
  displayLabel: string,
): { project: CutProject; key: TimingKey | null; status: CreateRecognizedEventStatus } {
  const normalizedLabel = normalizeTimingKeyDisplayLabel(displayLabel)
  if (!normalizedLabel) return { project, key: null, status: 'conflict' }

  const existingEvent = project.logicalSheet.events.find(event => sameEventTarget(event, paperTrack, frame, sheetRole))
  if (existingEvent) {
    const existingKey = project.logicalSheet.keys.find(key => key.keyId === existingEvent.keyId) ?? null
    const matches = existingKey
      && normalizeTimingKeyDisplayLabel(existingKey.displayLabel) === normalizedLabel
    return {
      project,
      key: matches ? existingKey : null,
      status: matches ? 'already-present' : 'conflict',
    }
  }

  const created = createKey(project, paperTrack, displayLabel, 'recognition', undefined, sheetRole)
  const withEvent = setEvent(created.project, paperTrack, frame, created.key.keyId, sheetRole, { source: 'recognition' })
  return {
    project: ensureDefaultBindingsForKey(withEvent, created.key.keyId),
    key: created.key,
    status: 'created',
  }
}

export function upsertBinding(
  project: CutProject,
  input: {
    slotId: string
    keyId: string
    cspCellName?: string
    assetId?: string
    materialState?: CellBinding['materialState']
  },
): CutProject {
  const slot = project.cspTrackSlots.find(item => item.slotId === input.slotId)
  if (!slot) throw new Error(`slot not found: ${input.slotId}`)
  const key = project.logicalSheet.keys.find(item => item.keyId === input.keyId)
  if (!key) throw new Error(`key not found: ${input.keyId}`)
  const existing = project.bindings.find(item => item.slotId === input.slotId && item.keyId === input.keyId)
  const cspCellName = input.cspCellName ?? existing?.cspCellName ?? defaultCspCellName(key.displayLabel, slot.paperTrack)
  const materialState = input.materialState ?? (input.assetId || existing?.assetId ? 'assigned' : existing?.materialState ?? 'unassigned')
  const binding: CellBinding = {
    bindingId: existing?.bindingId ?? nextId('binding', project.bindings.map(item => item.bindingId)),
    slotId: input.slotId,
    keyId: input.keyId,
    cspCellName,
    assetId: input.assetId ?? existing?.assetId,
    materialState,
  }
  return {
    ...project,
    bindings: [...project.bindings.filter(item => item.bindingId !== binding.bindingId), binding].sort((a, b) =>
      a.slotId.localeCompare(b.slotId) || a.keyId.localeCompare(b.keyId),
    ),
  }
}

export interface RegisterAssetsToCspTrackResult {
  project: CutProject
  addedKeyIds: string[]
  duplicateKeyIds: string[]
  missingAssetIds: string[]
}

export function registerAssetsToCspTrack(
  project: CutProject,
  input: { slotId: string; assetIds: string[]; sheetRole?: SheetTimingRole },
): RegisterAssetsToCspTrackResult {
  const slot = project.cspTrackSlots.find(item => item.slotId === input.slotId)
  if (!slot) throw new Error(`slot not found: ${input.slotId}`)

  const requestedAssetIds = Array.from(new Set(input.assetIds.filter(Boolean)))
  const addedKeyIds: string[] = []
  const duplicateKeyIds: string[] = []
  const missingAssetIds: string[] = []
  const sheetRole = input.sheetRole ?? DEFAULT_EXPORT_TIMING_ROLE
  let next = project

  for (const assetId of requestedAssetIds) {
    const asset = next.assets.find(item => item.assetId === assetId)
    if (!asset) {
      missingAssetIds.push(assetId)
      continue
    }

    const duplicate = next.bindings.find(binding => binding.slotId === slot.slotId && binding.assetId === assetId)
    if (duplicate) {
      duplicateKeyIds.push(duplicate.keyId)
      continue
    }

    const created = createKey(next, slot.paperTrack, undefined, 'asset-drop', undefined, sheetRole)
    next = updateKey(created.project, created.key.keyId, { displayLabel: '', paperToken: '' })

    const desiredCspCellName = assetFileBaseName(asset) || defaultCspCellName(created.key.displayLabel, slot.paperTrack)
    const cspCellName = uniqueCspCellNameForSlot(next, slot.slotId, desiredCspCellName)
    next = upsertBinding(next, {
      slotId: slot.slotId,
      keyId: created.key.keyId,
      assetId,
      cspCellName,
      materialState: 'assigned',
    })
    addedKeyIds.push(created.key.keyId)
  }

  return { project: next, addedKeyIds, duplicateKeyIds, missingAssetIds }
}

export function moveBindingToCorrectionLayer(
  project: CutProject,
  input: {
    keyId: string
    sourceSlotId: string
    targetCorrectionLayerId: string
    overwrite?: boolean
  },
): CutProject {
  const sourceBinding = project.bindings.find(binding => binding.keyId === input.keyId && binding.slotId === input.sourceSlotId)
  if (!sourceBinding) throw new Error(`binding not found: ${input.sourceSlotId} / ${input.keyId}`)
  const sourceSlot = project.cspTrackSlots.find(slot => slot.slotId === input.sourceSlotId)
  if (!sourceSlot) throw new Error(`slot not found: ${input.sourceSlotId}`)
  const targetSlot = project.cspTrackSlots.find(slot =>
    slot.paperTrack === sourceSlot.paperTrack
    && slot.correctionLayerId === input.targetCorrectionLayerId,
  )
  if (!targetSlot) throw new Error(`target slot not found: ${sourceSlot.paperTrack} / ${input.targetCorrectionLayerId}`)
  if (targetSlot.slotId === sourceSlot.slotId) return project

  const existingTargetBinding = project.bindings.find(binding => binding.keyId === input.keyId && binding.slotId === targetSlot.slotId)
  if (existingTargetBinding && !input.overwrite) {
    throw new Error(`target binding already exists: ${targetSlot.slotId} / ${input.keyId}`)
  }

  const withoutSourceAndTarget: CutProject = {
    ...project,
    bindings: project.bindings.filter(binding =>
      binding.bindingId !== sourceBinding.bindingId
      && binding.bindingId !== existingTargetBinding?.bindingId,
    ),
  }
  return upsertBinding(withoutSourceAndTarget, {
    slotId: targetSlot.slotId,
    keyId: sourceBinding.keyId,
    cspCellName: sourceBinding.cspCellName,
    assetId: sourceBinding.assetId,
    materialState: sourceBinding.materialState,
  })
}

export function ensureDefaultBindingsForKey(project: CutProject, keyId: string): CutProject {
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) throw new Error(`key not found: ${keyId}`)
  return project
}

export function updateKey(project: CutProject, keyId: string, updates: { displayLabel?: string; paperToken?: string }): CutProject {
  const key = project.logicalSheet.keys.find(item => item.keyId === keyId)
  if (!key) throw new Error(`key not found: ${keyId}`)
  if (updates.displayLabel !== undefined) {
    const duplicate = findTimingKeyByDisplayLabel(project, key.paperTrack, updates.displayLabel, sheetTimingRoleForKey(key))
    if (duplicate && duplicate.keyId !== keyId) {
      throw new Error(`displayLabel already exists in ${key.paperTrack}: ${updates.displayLabel}`)
    }
  }
  const cleanUpdates = withoutUndefined(updates)
  const nextKeys = project.logicalSheet.keys.map(item => item.keyId === keyId ? { ...item, ...cleanUpdates } : item)
  let next: CutProject = { ...project, logicalSheet: { ...project.logicalSheet, keys: nextKeys } }
  if (updates.displayLabel) {
    for (const slot of next.cspTrackSlots.filter(item => item.paperTrack === key.paperTrack)) {
      const binding = next.bindings.find(item => item.slotId === slot.slotId && item.keyId === keyId)
      if (binding && binding.cspCellName === defaultCspCellName(key.displayLabel, slot.paperTrack)) {
        next = upsertBinding(next, {
          slotId: slot.slotId,
          keyId,
          cspCellName: defaultCspCellName(updates.displayLabel, slot.paperTrack),
          materialState: binding?.materialState ?? 'unassigned',
          assetId: binding?.assetId,
        })
      }
    }
  }
  return next
}
