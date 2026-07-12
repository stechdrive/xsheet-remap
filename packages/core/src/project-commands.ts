import type { CutProject, DomainCommand, ProjectHistory } from './types'
import { addAnnotation, clearAnnotations } from './annotations'
import { registerAsset } from './assets'
import { migrateProject } from './project-documents'
import { DEFAULT_SHEET_TIMING_ROLE } from './project-constants'
import { correctionLayerIdForSlot, defaultCorrectionLayerId } from './project-shared'
import { clearEvent, createKey, ensureDefaultBindingsForKey, setEvent, updateKey, upsertBinding } from './project-timing'

export function applyCommand(project: CutProject, command: DomainCommand): CutProject {
  switch (command.type) {
    case 'event.create': {
      const sheetRole = command.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE
      const created = createKey(project, command.paperTrack, command.displayLabel, command.createdFrom ?? 'manual', undefined, sheetRole)
      return ensureDefaultBindingsForKey(setEvent(created.project, command.paperTrack, command.frame, created.key.keyId, sheetRole), created.key.keyId)
    }
    case 'event.set':
      return setEvent(project, command.paperTrack, command.frame, command.keyId, command.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE)
    case 'event.clear':
      return clearEvent(project, command.paperTrack, command.frame, command.sheetRole ?? DEFAULT_SHEET_TIMING_ROLE)
    case 'key.update':
      return updateKey(project, command.keyId, { displayLabel: command.displayLabel, paperToken: command.paperToken })
    case 'asset.register': {
      const registered = registerAsset(project, command.file)
      if (!command.target?.keyId) return registered.project
      const targetKey = registered.project.logicalSheet.keys.find(key => key.keyId === command.target?.keyId)
      const targetLayerId = defaultCorrectionLayerId(registered.project)
      const slotId = command.target.slotId
        ?? registered.project.cspTrackSlots.find(slot => slot.paperTrack === targetKey?.paperTrack && correctionLayerIdForSlot(registered.project, slot) === targetLayerId)?.slotId
        ?? registered.project.cspTrackSlots.find(slot => slot.paperTrack === targetKey?.paperTrack)?.slotId
      return slotId
        ? upsertBinding(registered.project, {
            slotId,
            keyId: command.target.keyId,
            assetId: registered.asset.assetId,
            cspCellName: registered.asset.displayName.replace(/\.[^.]+$/, ''),
            materialState: 'assigned',
          })
        : registered.project
    }
    case 'binding.upsert':
      return upsertBinding(project, command)
    case 'annotation.add':
      return addAnnotation(project, command.stroke)
    case 'annotation.clear':
      return clearAnnotations(project)
  }
}

export function createProjectHistory(project: CutProject): ProjectHistory {
  return { past: [], present: migrateProject(project), future: [] }
}

export function commitHistory(history: ProjectHistory, project: CutProject): ProjectHistory {
  return { past: [...history.past, history.present], present: migrateProject(project), future: [] }
}

export function undoHistory(history: ProjectHistory): ProjectHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future],
  }
}

export function redoHistory(history: ProjectHistory): ProjectHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: history.future.slice(1),
  }
}
