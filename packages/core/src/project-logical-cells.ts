import type { CutProject, TimelineEvent } from './types'
import { compareTimelineEvents, sheetTimingRoleForKey } from './project-shared'
import { findTimingKeyByDisplayLabel, updateKey } from './project-timing'

export interface UpdateOrMergeTimingKeyResult {
  project: CutProject
  keyId: string
  merged: boolean
}

export function updateOrMergeTimingKeyDisplayLabel(
  project: CutProject,
  keyId: string,
  displayLabel: string,
): UpdateOrMergeTimingKeyResult {
  const sourceKey = project.logicalSheet.keys.find(key => key.keyId === keyId)
  if (!sourceKey) throw new Error(`key not found: ${keyId}`)
  const targetKey = findTimingKeyByDisplayLabel(project, sourceKey.paperTrack, displayLabel, sheetTimingRoleForKey(sourceKey))
  if (!targetKey || targetKey.keyId === sourceKey.keyId) {
    return {
      project: updateKey(project, sourceKey.keyId, { displayLabel, paperToken: displayLabel }),
      keyId: sourceKey.keyId,
      merged: false,
    }
  }
  return {
    project: mergeTimingKeys(project, sourceKey.keyId, targetKey.keyId),
    keyId: targetKey.keyId,
    merged: true,
  }
}

export function mergeTimingKeys(project: CutProject, sourceKeyId: string, targetKeyId: string): CutProject {
  if (sourceKeyId === targetKeyId) return project
  const sourceKey = project.logicalSheet.keys.find(key => key.keyId === sourceKeyId)
  const targetKey = project.logicalSheet.keys.find(key => key.keyId === targetKeyId)
  if (!sourceKey) throw new Error(`source key not found: ${sourceKeyId}`)
  if (!targetKey) throw new Error(`target key not found: ${targetKeyId}`)
  if (sourceKey.paperTrack !== targetKey.paperTrack || sheetTimingRoleForKey(sourceKey) !== sheetTimingRoleForKey(targetKey)) {
    throw new Error('timing keys can only be merged within the same sheet column and role')
  }

  const targetBindingsBySlot = new Map(project.bindings
    .filter(binding => binding.keyId === targetKeyId)
    .map(binding => [binding.slotId, binding]))
  for (const sourceBinding of project.bindings.filter(binding => binding.keyId === sourceKeyId)) {
    const targetBinding = targetBindingsBySlot.get(sourceBinding.slotId)
    if (targetBinding && !sameBindingPayload(sourceBinding, targetBinding)) {
      throw new Error(`cannot merge logical cells with different bindings in slot ${sourceBinding.slotId}`)
    }
  }

  const bindings = project.bindings.flatMap(binding => {
    if (binding.keyId !== sourceKeyId) return [binding]
    if (targetBindingsBySlot.has(binding.slotId)) return []
    return [{ ...binding, keyId: targetKeyId }]
  })
  const remappedEvents = project.logicalSheet.events.map(event =>
    event.keyId === sourceKeyId ? { ...event, keyId: targetKeyId } : event,
  )
  return {
    ...project,
    logicalSheet: {
      ...project.logicalSheet,
      keys: project.logicalSheet.keys.filter(key => key.keyId !== sourceKeyId),
      events: uniqueTimelineEvents(remappedEvents).sort(compareTimelineEvents),
    },
    bindings,
  }
}

export function removeCellBinding(project: CutProject, bindingId: string): CutProject {
  const binding = project.bindings.find(item => item.bindingId === bindingId)
  if (!binding) return project
  const bindings = project.bindings.filter(item => item.bindingId !== bindingId)
  const keyStillUsed = bindings.some(item => item.keyId === binding.keyId)
    || project.logicalSheet.events.some(event => event.keyId === binding.keyId)
  return {
    ...project,
    logicalSheet: keyStillUsed
      ? project.logicalSheet
      : {
          ...project.logicalSheet,
          keys: project.logicalSheet.keys.filter(key => key.keyId !== binding.keyId),
        },
    bindings,
  }
}

function sameBindingPayload(
  a: CutProject['bindings'][number],
  b: CutProject['bindings'][number],
): boolean {
  return a.cspCellName === b.cspCellName
    && a.assetId === b.assetId
    && a.materialState === b.materialState
}

function uniqueTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  const result = new Map<string, TimelineEvent>()
  for (const event of events) {
    const identity = `${event.sheetRole ?? ''}\u0000${event.paperTrack}\u0000${event.frame}`
    if (!result.has(identity)) result.set(identity, event)
  }
  return Array.from(result.values())
}
