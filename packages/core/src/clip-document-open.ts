import { activeCutProjectFromDocument, createDefaultProjectDocument } from './project-documents'
import { clipEffectiveCel, clipTrackSignature, DEFAULT_CLIP_CANVAS, type ClipDocumentState } from './clip-document'
import { buildClipDocumentPlan } from './clip-document-plan'
import { type ClipImportData, type ClipImportOptions } from './clip-import'
import { clipProcessName, importClipProcessTimelines } from './clip-process-import'
import type { CutGroupProjectDocument } from './types'
import { baseTimingProject } from './process-timing'
import { updateActiveCutProjectInDocument } from './project-documents'

export function openClipDocument(data: ClipImportData, dataUrl: string, options: Omit<ClipImportOptions, 'timelineId'> & { timelineIds: string[]; baseProcess?: string }): CutGroupProjectDocument {
  let document = createDefaultProjectDocument()
  document = { ...document, projectId: `clip_${crypto.randomUUID()}` }
  if (options.columns.length) document = importClipProcessTimelines(document, data, options)
  if (options.baseProcess !== undefined) {
    const base = document.correctionLayers.find(process => process.label === options.baseProcess)
    if (!base) throw new Error('基準にする工程が見つかりません。')
    document = { ...document, cuts: document.cuts.map(cut => ({ ...cut, revisions: cut.revisions.map(revision => ({ ...revision, logicalSheet: { ...revision.logicalSheet, baseProcessId: base.layerId } })) })) }
    for (const cut of document.cuts) {
      const active = { ...document, activeCutId: cut.cutId }
      document = { ...updateActiveCutProjectInDocument(active, baseTimingProject(activeCutProjectFromDocument(active))), activeCutId: document.activeCutId }
    }
  }
  const project = activeCutProjectFromDocument(document)
  const selectedTimelines = data.timelines.filter(timeline => options.timelineIds.includes(timeline.id))
  const targets = options.columns.flatMap(column => {
    const process = project.correctionLayers.find(process => process.label === clipProcessName(column))
    const slot = project.cspTrackSlots.find(item => item.paperTrack === column.name.trim() && item.correctionLayerId === process?.layerId)
    return slot ? [{ slotId: slot.slotId, folderId: column.layerId }] : []
  })
  const state: ClipDocumentState = { version: 1, nodes: data.layers ?? [], targets, canvas: data.canvas ?? { ...DEFAULT_CLIP_CANVAS },
    source: { fileName: data.fileName, fileHash: data.fileHash, dataUrl }, sourceTimelines: data.timelines,
    timelineIds: Object.fromEntries(document.cuts.flatMap((cut, index) => options.columns.length && selectedTimelines[index] ? [[cut.cutId, selectedTimelines[index].id]] : [])) }
  document = { ...document, clipDocument: state, registeredCells: { ...document.registeredCells, bindings: document.registeredCells.bindings.map(binding => {
    const target = targets.find(item => item.slotId === binding.slotId)
    const cel = target && clipEffectiveCel(state, target.folderId, binding.cspCellName)
    return cel ? { ...binding, clipLayerId: cel.id, materialState: 'assigned' as const } : binding
  }) } }
  const plan = buildClipDocumentPlan(document, options.role)
  return { ...document, clipDocument: { ...state, baselineTracks: Object.fromEntries(plan.timelines.flatMap(timeline => timeline.tracks.map(track => [`${timeline.id}:${track.folderId}`, clipTrackSignature(timeline, track.frames, track.labels)]))) } }
}
