import { activeCutProjectFromDocument } from './project-documents'
import { buildExportPlan } from './project-export'
import { clipChildren, clipTrackSignature } from './clip-document'
import type { ClipRegistrationPlan, ClipTimeline } from './clip-export'
import { type CutGroupProjectDocument, type SheetTimingRole } from './types'
import { sheetTimingRoleForEvent, timingEventValueKind } from './project-shared'

export function buildClipDocumentPlan(document: CutGroupProjectDocument, role: SheetTimingRole, cutIds?: string[]): ClipRegistrationPlan {
  const state = document.clipDocument!
  const folders = state.nodes.filter(node => node.kind === 'animation').map(node => ({ id: node.id, name: node.name, path: [], cels: clipChildren(state, node.id).map(cel => ({ name: cel.name, assetId: cel.assetId })) }))
  const timelines: ClipTimeline[] = document.cuts.filter(cut => !cutIds || cutIds.includes(cut.cutId)).map(cut => {
    const project = activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId })
    const markers = project.logicalSheet.events.filter(event => sheetTimingRoleForEvent(event) === role && ['inbetween', 'reverse'].includes(timingEventValueKind(event)))
    const celProject = { ...project, logicalSheet: { ...project.logicalSheet, events: project.logicalSheet.events.filter(event => !['inbetween', 'reverse'].includes(timingEventValueKind(event))) } }
    const exported = buildExportPlan(celProject, { profileId: 'import-stack', timingSourceRole: role, sheetTemplate: document.sheetTemplate, fallbackCutId: cut.cutId })
    const timeline: ClipTimeline = { id: cut.cutId, sourceTimelineId: state.timelineIds?.[cut.cutId], name: exported.metadata.timeTableName, fps: exported.fps, duration: exported.durationFrames, tracks: [] }
    for (const target of state.targets) {
      const slot = project.cspTrackSlots.find(item => item.slotId === target.slotId)
      if (!slot) continue
      const frames = celProject.logicalSheet.events.filter(event => event.paperTrack === slot.paperTrack && sheetTimingRoleForEvent(event) === role)
        .sort((a, b) => a.frame - b.frame).map(event => {
          const binding = project.bindings.find(item => item.slotId === slot.slotId && item.keyId === event.keyId)
          const node = binding?.clipLayerId && state.nodes.find(item => item.id === binding.clipLayerId && item.parentId === target.folderId)
          return { frame: event.frame - project.logicalSheet.frameOrigin, value: timingEventValueKind(event) !== 'cell' ? null : node ? node.name : binding && !binding.clipLayerId ? binding.cspCellName : null }
        })
      const labels = markers.filter(event => event.paperTrack === slot.paperTrack).map(event => ({ frame: event.frame - project.logicalSheet.frameOrigin, kind: timingEventValueKind(event) as 'inbetween' | 'reverse' }))
      timeline.tracks.push({ folderId: target.folderId, frames, labels, preserve: state.baselineTracks?.[`${cut.cutId}:${target.folderId}`] === clipTrackSignature(timeline, frames, labels) })
    }
    return timeline
  })
  return { projectId: document.projectId, folders, timelines, document: state }
}
