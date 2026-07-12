import type { CutProject } from './types'
import type { SheetTemplate } from './sheet-template-schema'
import { formatSheetTemplateCutNumber } from './sheet-template'

export interface ResolvedCutExportIdentity {
  cutNumber: string
  sceneNumber: string
  formattedCutNumber: string
  displayName: string
  timelineName: string
}

export function resolveCutExportIdentity(
  project: Pick<CutProject, 'cut' | 'projectId'>,
  template?: Pick<SheetTemplate, 'naming'>,
  fallback = project.projectId,
): ResolvedCutExportIdentity {
  const cutNumber = project.cut.cut?.trim() || fallback
  const sceneNumber = project.cut.scene?.trim() || ''
  const formattedCutNumber = formatSheetTemplateCutNumber(template, cutNumber)
  const displayName = sceneNumber ? `${sceneNumber}-${formattedCutNumber}` : formattedCutNumber
  const explicitTimelineName = project.cut.cspTimelineName?.trim() || project.cut.custom?.cspTimelineName?.trim()
  return {
    cutNumber,
    sceneNumber,
    formattedCutNumber,
    displayName,
    timelineName: explicitTimelineName || displayName,
  }
}
