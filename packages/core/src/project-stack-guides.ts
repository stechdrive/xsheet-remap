import type { CutProject, PaperTrackName, StackGuideLabel, StackGuideRegistration } from './types'
import { nextId, withoutUndefined } from './core-utils'
import { assetFileBaseName, clampStackGuideGapIndex, compareStackGuideLabelsForProject, compareStackGuideRegistrationsForProject, defaultCorrectionLayerId, defaultStackGuidePlacementForKind, defaultStackGuideStackBandForKind, inferStackGuideLabelKind, nextStackGuideOrderInGap, nextStackGuideRegistrationId, normalizeOptionalStackGuideViewSnapIndex, paperTrackBeforeGap, stackGuideRegistrationForLayer, stackGuideRegistrations } from './project-shared'

export function createStackGuideLabel(
  project: CutProject,
  input: {
    label: string
    gapIndex: number
    insertAfterPaperTrack?: PaperTrackName
    kind?: StackGuideLabel['kind']
    displayRole?: StackGuideLabel['displayRole']
    exportAsStaticCell?: boolean
    cspCellName?: string
    correctionLayerId?: string
    placement?: StackGuideLabel['placement']
    stackBand?: StackGuideLabel['stackBand']
    viewSnapIndex?: number
  },
): { project: CutProject; label: StackGuideLabel } {
  const labelText = input.label.trim()
  if (!labelText) throw new Error('stack guide label must not be empty')
  const kind = input.kind ?? inferStackGuideLabelKind(labelText)
  const placement = input.placement ?? defaultStackGuidePlacementForKind(kind)
  const stackBand = input.stackBand ?? defaultStackGuideStackBandForKind(kind)
  const gapIndex = clampStackGuideGapIndex(project, input.gapIndex)
  const insertAfterPaperTrack = input.insertAfterPaperTrack ?? paperTrackBeforeGap(project, gapIndex)
  const orderInGap = nextStackGuideOrderInGap(project, gapIndex, insertAfterPaperTrack)
  const correctionLayerId = input.correctionLayerId ?? defaultCorrectionLayerId(project)
  const registrations = correctionLayerId
    ? [{
        registrationId: 'stack_reg_0001',
        correctionLayerId,
        cspCellName: input.cspCellName?.trim() || undefined,
        assetIds: [],
      }]
    : []
  const label: StackGuideLabel = {
    labelId: nextId('stack_label', project.stackGuideLabels.map(item => item.labelId)),
    label: labelText,
    kind,
    placement,
    stackBand,
    displayRole: input.displayRole ?? 'action',
    viewSnapIndex: normalizeOptionalStackGuideViewSnapIndex(input.viewSnapIndex),
    insertAfterPaperTrack,
    gapIndex,
    orderInGap,
    exportAsStaticCell: input.exportAsStaticCell ?? true,
    cspCellName: input.cspCellName?.trim() || undefined,
    assetIds: [],
    registrations,
  }
  return {
    project: {
      ...project,
      stackGuideLabels: [...project.stackGuideLabels, label].sort(compareStackGuideLabelsForProject(project)),
    },
    label,
  }
}

export function updateStackGuideLabel(
  project: CutProject,
  labelId: string,
  updates: Partial<Pick<StackGuideLabel, 'label' | 'kind' | 'placement' | 'stackBand' | 'displayRole' | 'viewSnapIndex' | 'insertAfterPaperTrack' | 'gapIndex' | 'orderInGap' | 'exportAsStaticCell' | 'cspCellName'>>,
): CutProject {
  const existing = project.stackGuideLabels.find(label => label.labelId === labelId)
  if (!existing) throw new Error(`stack guide label not found: ${labelId}`)
  const nextGapIndex = updates.gapIndex === undefined
    ? existing.gapIndex
    : clampStackGuideGapIndex(project, updates.gapIndex)
  const nextInsertAfterPaperTrack = updates.insertAfterPaperTrack === undefined
    ? existing.insertAfterPaperTrack
    : updates.insertAfterPaperTrack || undefined
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels
      .map(label => label.labelId === labelId
        ? {
            ...label,
            ...withoutUndefined({
              label: updates.label?.trim() || undefined,
              kind: updates.kind,
              placement: updates.placement,
              stackBand: updates.stackBand,
              displayRole: updates.displayRole,
              viewSnapIndex: updates.viewSnapIndex === undefined ? undefined : normalizeOptionalStackGuideViewSnapIndex(updates.viewSnapIndex),
              insertAfterPaperTrack: nextInsertAfterPaperTrack,
              gapIndex: nextGapIndex,
              orderInGap: updates.orderInGap,
              exportAsStaticCell: updates.exportAsStaticCell,
              cspCellName: updates.cspCellName?.trim() || undefined,
            }),
          }
        : label)
      .sort(compareStackGuideLabelsForProject(project)),
  }
}

export function deleteStackGuideLabel(project: CutProject, labelId: string): CutProject {
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.filter(label => label.labelId !== labelId),
  }
}

export function updateStackGuideRegistration(
  project: CutProject,
  labelId: string,
  correctionLayerId: string,
  updates: Partial<Pick<StackGuideRegistration, 'cspCellName' | 'assetIds'>>,
): CutProject {
  const label = project.stackGuideLabels.find(item => item.labelId === labelId)
  if (!label) throw new Error(`stack guide label not found: ${labelId}`)
  const registration = stackGuideRegistrationForLayer(label, correctionLayerId)
  const nextRegistration: StackGuideRegistration = {
    registrationId: registration?.registrationId ?? nextStackGuideRegistrationId(label),
    correctionLayerId,
    cspCellName: updates.cspCellName === undefined
      ? registration?.cspCellName
      : updates.cspCellName.trim() || undefined,
    assetIds: updates.assetIds ?? registration?.assetIds ?? [],
  }
  const registrations = [
    ...stackGuideRegistrations(label).filter(item => item.correctionLayerId !== correctionLayerId),
    nextRegistration,
  ].sort(compareStackGuideRegistrationsForProject(project))
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(item => item.labelId === labelId
      ? { ...item, registrations }
      : item),
  }
}

export function assignAssetToStackGuideLabel(project: CutProject, labelId: string, assetId: string, correctionLayerId = defaultCorrectionLayerId(project) ?? ''): CutProject {
  if (!project.assets.some(asset => asset.assetId === assetId)) throw new Error(`asset not found: ${assetId}`)
  const label = project.stackGuideLabels.find(item => item.labelId === labelId)
  if (!label) throw new Error(`stack guide label not found: ${labelId}`)
  if (!correctionLayerId) throw new Error('stack guide correction layer is required')
  const registration = stackGuideRegistrationForLayer(label, correctionLayerId)
  const asset = project.assets.find(item => item.assetId === assetId)
  const nextRegistration: StackGuideRegistration = {
    registrationId: registration?.registrationId ?? nextStackGuideRegistrationId(label),
    correctionLayerId,
    cspCellName: registration?.cspCellName ?? (asset ? assetFileBaseName(asset) : undefined),
    assetIds: registration?.assetIds.includes(assetId)
      ? registration.assetIds
      : [...(registration?.assetIds ?? []), assetId],
  }
  const registrations = [
    ...stackGuideRegistrations(label).filter(item => item.correctionLayerId !== correctionLayerId),
    nextRegistration,
  ].sort(compareStackGuideRegistrationsForProject(project))
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(item => item.labelId === labelId
      ? {
          ...item,
          registrations,
          assetIds: item.assetIds.includes(assetId) ? item.assetIds : [...item.assetIds, assetId],
        }
      : item),
  }
}

export function removeAssetFromStackGuideLabel(project: CutProject, labelId: string, assetId: string, correctionLayerId?: string): CutProject {
  return {
    ...project,
    stackGuideLabels: project.stackGuideLabels.map(label => label.labelId === labelId
      ? {
          ...label,
          registrations: stackGuideRegistrations(label).map(registration => {
            if (correctionLayerId && registration.correctionLayerId !== correctionLayerId) return registration
            return { ...registration, assetIds: registration.assetIds.filter(id => id !== assetId) }
          }),
          assetIds: label.assetIds.filter(id => id !== assetId),
        }
      : label),
  }
}
