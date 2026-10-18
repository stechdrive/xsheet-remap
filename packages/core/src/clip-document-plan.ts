import { activeCutProjectFromDocument } from './project-documents'
import { buildExportPlan } from './project-export'
import { clipChildren, clipTrackSignature } from './clip-document'
import type { ClipRegistrationPlan, ClipTimeline } from './clip-export'
import { type CutGroupProjectDocument, type SheetTimingRole } from './types'
import { sheetTimingRoleForEvent, timingEventValueKind } from './project-shared'
import { timingForProcess } from './process-timing'

export function buildClipDocumentPlan(document: CutGroupProjectDocument, role: SheetTimingRole, cutIds?: string[]): ClipRegistrationPlan {
  const state = document.clipDocument!
  const folders = state.nodes.filter(node => node.kind === 'animation').map(node => ({ id: node.id, name: node.name, path: [], cels: clipChildren(state, node.id).map(cel => ({ name: cel.name, assetId: cel.assetId })) }))
  const timelines: ClipTimeline[] = document.cuts.filter(cut => !cutIds || cutIds.includes(cut.cutId)).map(cut => {
    const project = activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId })
    if (project.logicalSheet.processTimings) for (const process of project.correctionLayers) {
      for (const event of timingForProcess(project.logicalSheet, process.layerId).events.filter(event => sheetTimingRoleForEvent(event) === role)) {
        const slot = project.cspTrackSlots.find(slot => slot.paperTrack === event.paperTrack && slot.correctionLayerId === process.layerId)
        if (slot && state.deletedTargetSlotIds?.includes(slot.slotId)) continue
        if (!state.targets.some(target => target.slotId === slot?.slotId)) throw new Error(`「${process.label}／${event.paperTrack}」の登録先が未設定です。レイヤーツリーでアニメーションフォルダーを対応づけてください。`)
        if (timingEventValueKind(event) === 'cell' && !project.bindings.some(binding => binding.slotId === slot?.slotId && binding.keyId === event.keyId)) throw new Error(`「${process.label}／${event.paperTrack}」${event.frame}コマ目のセルが未登録です。レイヤーツリーからセルを登録してください。`)
      }
    }
    const exported = buildExportPlan(project, { profileId: 'import-stack', timingSourceRole: role, sheetTemplate: document.sheetTemplate, fallbackCutId: cut.cutId })
    const timeline: ClipTimeline = { id: cut.cutId, sourceTimelineId: state.timelineIds?.[cut.cutId], name: exported.metadata.timeTableName, fps: exported.fps, duration: exported.durationFrames, tracks: [] }
    for (const target of state.targets) {
      const slot = project.cspTrackSlots.find(item => item.slotId === target.slotId)
      if (!slot) continue
      const events = timingForProcess(project.logicalSheet, slot.correctionLayerId ?? '').events
      const markers = events.filter(event => sheetTimingRoleForEvent(event) === role && ['inbetween', 'reverse'].includes(timingEventValueKind(event)))
      const frames = events.filter(event => event.paperTrack === slot.paperTrack && sheetTimingRoleForEvent(event) === role && !['inbetween', 'reverse'].includes(timingEventValueKind(event)))
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
