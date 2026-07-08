import { NULL_CELL_KEY_ID } from './types'
import type { CutProject, ExportProfile, ValidationIssue } from './types'

export function validateProject(project: CutProject, profile?: ExportProfile): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const keyIds = new Set(project.logicalSheet.keys.map(key => key.keyId))
  const assetIds = new Set(project.assets.map(asset => asset.assetId))
  const slotIds = new Set(project.cspTrackSlots.map(slot => slot.slotId))
  const sheetSourceIds = new Set(project.sheetView.sources.map(source => source.sourceId))
  const displayStartFrame = logicalSheetDisplayFrameStart(project.logicalSheet)
  const displayEndFrame = logicalSheetDisplayFrameEnd(project.logicalSheet)

  if (project.logicalSheet.fps <= 0) {
    issues.push(issue('error', 'sheet.fps.invalid', 'fps must be greater than zero', 'sheet', 'logicalSheet'))
  }
  if (project.logicalSheet.durationFrames <= 0) {
    issues.push(issue('error', 'sheet.duration.invalid', 'durationFrames must be greater than zero', 'sheet', 'logicalSheet'))
  }

  const pageAssignments = new Map<string, string>()
  for (const page of project.sheetView.pages) {
    if (!page.sourceId) continue
    if (!sheetSourceIds.has(page.sourceId)) {
      issues.push(issue('error', 'sheet.source.missing', `page ${page.pageId} references missing sheet source ${page.sourceId}`, 'sheet', page.pageId))
      continue
    }
    const existingPage = pageAssignments.get(page.sourceId)
    if (existingPage && existingPage !== page.pageId) {
      issues.push(issue('warning', 'sheet.source.duplicatePageAssignment', `sheet source ${page.sourceId} is assigned to both ${existingPage} and ${page.pageId}`, 'sheet', page.pageId))
    }
    pageAssignments.set(page.sourceId, page.pageId)
  }

  for (const event of project.logicalSheet.events) {
    if (event.keyId !== NULL_CELL_KEY_ID && !keyIds.has(event.keyId)) {
      issues.push(issue('error', 'event.key.missing', `event ${event.eventId} references missing key ${event.keyId}`, 'event', event.eventId))
    }
    if (event.frame > displayEndFrame) {
      issues.push(issue('error', 'event.frame.afterDuration', `event ${event.eventId} is after the cut duration`, 'event', event.eventId))
    }
    if (event.frame < displayStartFrame || (!project.logicalSheet.allowNegativeFrames && event.frame < project.logicalSheet.frameOrigin)) {
      issues.push(issue('error', 'event.frame.beforeOrigin', `event ${event.eventId} is before the sheet origin`, 'event', event.eventId))
    }
  }

  for (const cue of project.timedRangeCues ?? []) {
    if (cue.frameEnd < cue.frameStart) {
      issues.push(issue('error', 'cue.range.invalid', `cue ${cue.cueId} ends before it starts`, 'cue', cue.cueId))
    }
    if (cue.frameStart > displayEndFrame || cue.frameEnd > displayEndFrame) {
      issues.push(issue('error', 'cue.frame.afterDuration', `cue ${cue.cueId} is after the cut duration`, 'cue', cue.cueId))
    }
    if (cue.frameStart < displayStartFrame || (!project.logicalSheet.allowNegativeFrames && cue.frameStart < project.logicalSheet.frameOrigin)) {
      issues.push(issue('error', 'cue.frame.beforeOrigin', `cue ${cue.cueId} is before the sheet origin`, 'cue', cue.cueId))
    }
  }

  for (const binding of project.bindings) {
    if (!keyIds.has(binding.keyId)) {
      issues.push(issue('error', 'binding.key.missing', `binding ${binding.bindingId} references missing key ${binding.keyId}`, 'binding', binding.bindingId))
    }
    if (!slotIds.has(binding.slotId)) {
      issues.push(issue('error', 'binding.slot.missing', `binding ${binding.bindingId} references missing slot ${binding.slotId}`, 'binding', binding.bindingId))
    }
    if (!binding.cspCellName.trim()) {
      issues.push(issue('error', 'binding.cspCellName.empty', 'CSP cell name is empty', 'binding', binding.bindingId))
    }
    if (binding.materialState === 'assigned' && !binding.assetId) {
      issues.push(issue('error', 'binding.asset.required', 'assigned binding must have assetId', 'binding', binding.bindingId))
    }
    if (binding.assetId && !assetIds.has(binding.assetId)) {
      issues.push(issue('error', 'binding.asset.missing', `binding references missing asset ${binding.assetId}`, 'binding', binding.bindingId))
    }
    if (binding.materialState === 'unassigned') {
      issues.push(issue('warning', 'asset.unassigned', 'asset is not assigned yet', 'binding', binding.bindingId))
    }
    if (binding.materialState === 'missing-ok') {
      issues.push(issue('info', 'export.missingOk.present', 'missing-ok cell will be exported without requiring material', 'binding', binding.bindingId))
    }
  }

  const trackNoSeen = new Map<number, string>()
  for (const slot of project.cspTrackSlots) {
    const existing = trackNoSeen.get(slot.trackNo)
    if (existing) {
      issues.push(issue('error', 'slot.trackNo.duplicate', `trackNo ${slot.trackNo} is used by ${existing} and ${slot.slotId}`, 'slot', slot.slotId))
    }
    trackNoSeen.set(slot.trackNo, slot.slotId)
  }

  for (const slot of project.cspTrackSlots) {
    const names = new Map<string, string>()
    const bindings = project.bindings.filter(binding => binding.slotId === slot.slotId)
    for (const binding of bindings) {
      const name = binding.cspCellName.trim()
      if (!name) continue
      const existing = names.get(name)
      if (existing && existing !== binding.keyId) {
        issues.push(issue('error', 'binding.cspCellName.duplicateInSlot', `${name} is duplicated in ${slot.displayPath}`, 'binding', binding.bindingId))
      }
      names.set(name, binding.keyId)
    }
  }

  if (profile?.mode === 'direct-to-visible-slots') {
    issues.push(issue('info', 'export.cspVisibilityRequired', 'CSP visible layer state must match this export profile', 'export', profile.profileId))
  }

  return issues
}

export function hasBlockingIssues(issues: ValidationIssue[]): boolean {
  return issues.some(issue => issue.severity === 'error')
}

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  entity: NonNullable<ValidationIssue['target']>['entity'],
  id?: string,
): ValidationIssue {
  return {
    issueId: `${code}:${id ?? 'project'}`,
    severity,
    code,
    message,
    target: { entity, id },
  }
}

function logicalSheetDisplayFrameStart(sheet: CutProject['logicalSheet']): number {
  const preRollFrames = Math.max(0, Math.round(sheet.workRange?.preRollFrames ?? 0))
  return sheet.frameOrigin - (sheet.workRange?.showPreRoll ? preRollFrames : 0)
}

function logicalSheetDisplayFrameEnd(sheet: CutProject['logicalSheet']): number {
  const postRollFrames = Math.max(0, Math.round(sheet.workRange?.postRollFrames ?? 0))
  return sheet.frameOrigin + sheet.durationFrames - 1 + (sheet.workRange?.showPostRoll ? postRollFrames : 0)
}
