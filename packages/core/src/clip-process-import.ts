import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, updateActiveCutProjectInDocument } from './project-documents'
import { clipImportFolders, type ClipImportColumn, type ClipImportData, type ClipImportOptions } from './clip-import'
import { createDefaultCspTrackSlots } from './project-shared'
import { alphabeticTrackLabel } from './sheet-template'
import { selectTimingProcess } from './process-timing'
import { MAX_CORRECTION_LAYERS } from './project-constants'
import { NULL_CELL_KEY_ID, type CorrectionLayer, type CutGroupProjectDocument } from './types'

export const clipProcessName = (column: ClipImportColumn) => column.process?.trim() || '作画'
export function clipImportProcesses(columns: ClipImportColumn[]): CorrectionLayer[] {
  const names = [...new Set(columns.map(clipProcessName))]
  if (names.length > MAX_CORRECTION_LAYERS) throw new Error(`表示グループは${MAX_CORRECTION_LAYERS}件以内にしてください。`)
  return names.map((label, index) => ({ layerId: index ? `clip_process_${index + 1}` : 'layer_sakuga', stageId: 'clip_groups', label, order: index, role: index ? 'other' : 'base', defaultVisible: true, fileNameSuffix: '' }))
}

/** Full ancestry is only a suggested display group, never a fixed production taxonomy. */
export function suggestClipProcessColumns(data: ClipImportData, selectedIds: string[]): ClipImportColumn[] {
  const selected = new Set(selectedIds), folders = clipImportFolders(data.nodes).filter(node => selected.has(node.id))
  const aliases = new Map<string, string>(), used = new Set<string>()
  const preferred = new Set(folders.filter(node => /^[A-Za-z]{1,2}$/.test(node.name)).map(node => node.name.toUpperCase()))
  return folders.map(folder => {
    let name = aliases.get(folder.name)
    if (!name) {
      name = /^[A-Za-z]{1,2}$/.test(folder.name) ? folder.name.toUpperCase() : ''
      for (let i = 0; !name; i++) { const candidate = alphabeticTrackLabel(i); if (!used.has(candidate) && !preferred.has(candidate)) name = candidate }
      aliases.set(folder.name, name); used.add(name)
    }
    return { layerId: folder.id, name, process: folder.path.slice(0, -1).join('／') || '最上位' }
  })
}

export function importClipProcessTimelines(document: CutGroupProjectDocument, data: ClipImportData, options: Omit<ClipImportOptions, 'timelineId'> & { timelineIds: string[] }): CutGroupProjectDocument {
  const folders = new Map(clipImportFolders(data.nodes).map(folder => [folder.id, folder]))
  const layers = new Set<string>(), occupied = new Set<string>(), names = new Map<string, string>()
  const columns = options.columns.map(column => ({ ...column, name: column.name.trim(), process: clipProcessName(column) }))
  if (options.columns.some(column => column.process !== undefined && !column.process.trim())) throw new Error('表示グループ名を入力してください。')
  for (const column of columns) {
    const normalized = column.name.normalize('NFKC').toUpperCase().replace(/[\s\u200b]/g, '')
    const identity = JSON.stringify([column.process, normalized])
    if (!normalized || occupied.has(identity)) throw new Error(`「${column.process}／${column.name}」の対応が重複しています。セル列または表示グループを変更してください。`)
    if (!folders.has(column.layerId) || layers.has(column.layerId)) throw new Error('読み込み対象のフォルダーが不正です。')
    if (names.has(normalized) && names.get(normalized) !== column.name) throw new Error('同じセル列には同じ表記を指定してください。')
    layers.add(column.layerId); occupied.add(identity); names.set(normalized, column.name)
  }
  const timelines = data.timelines.filter(timeline => options.timelineIds.includes(timeline.id))
  if (timelines.length !== new Set(options.timelineIds).size) throw new Error('読み込むタイムラインが見つかりません。')
  let project = activeCutProjectFromDocument(document)
  const correctionLayers = clipImportProcesses(columns)
  if (!correctionLayers.length) return document
  const trackNames = [...new Set(columns.map(column => column.name))]
  const paperTracks = [...trackNames, ...project.logicalSheet.paperTracks.map(track => track.paperTrack).filter(name => !trackNames.includes(name))].map((paperTrack, order) => ({ paperTrack, label: paperTrack, order, source: 'template' as const }))
  project = { ...project, productionStages: [{ stageId: 'clip_groups', label: 'CLIP', order: 0 }], correctionLayers,
    logicalSheet: { ...project.logicalSheet, paperTracks, keys: [], events: [], processTimings: { activeProcessId: correctionLayers[0]!.layerId, inactive: {} } } }
  project = { ...project, cspTrackSlots: createDefaultCspTrackSlots(paperTracks, project.productionStages, correctionLayers) }
  project = { ...project, exportProfiles: project.exportProfiles.map(profile => ({ ...profile, slotIds: project.cspTrackSlots.map(slot => slot.slotId) })) }
  let next = updateActiveCutProjectInDocument(document, project)
  const firstCutId = next.activeCutId
  for (const [index, timeline] of timelines.entries()) {
    if (!Number.isFinite(timeline.fps) || timeline.fps < 1 || timeline.fps > 120 || !Number.isSafeInteger(timeline.endFrame - timeline.startFrame) || timeline.endFrame <= timeline.startFrame) throw new Error('タイムラインのFPSまたは尺が不正です。')
    if (index) { next = addBlankSharedCutToProjectDocument(next, project, { cut: { cut: timeline.name, cspTimelineName: timeline.name } }); project = activeCutProjectFromDocument(next) }
    project = { ...project, cut: { ...project.cut, cspTimelineName: timeline.name, ...(timelines.length > 1 ? { cut: timeline.name } : {}) }, logicalSheet: { ...project.logicalSheet, fps: timeline.fps, durationFrames: timeline.endFrame - timeline.startFrame } }
    let minimum = 0, maximum = timeline.endFrame - timeline.startFrame - 1
    for (const column of columns) {
      const process = correctionLayers.find(process => process.label === column.process)!
      project = selectTimingProcess(project, process.layerId)
      const slot = project.cspTrackSlots.find(slot => slot.paperTrack === column.name && slot.correctionLayerId === process.layerId)!
      const source = timeline.tracks.find(track => track.layerId === column.layerId)
      if (source?.error) throw new Error(`${folders.get(column.layerId)!.path.join(' / ')}: ${source.error}`)
      const keys = [...project.logicalSheet.keys], bindings = [...project.bindings], events = [...project.logicalSheet.events]
      const boundByName = new Map(bindings.filter(binding => binding.slotId === slot.slotId).map(binding => [binding.cspCellName, binding.keyId]))
      let previous = -Infinity
      for (const frame of source?.frames ?? []) {
        if (!Number.isSafeInteger(frame.frame) || frame.frame <= previous) throw new Error('セル指定の順序が不正です。')
        previous = frame.frame; minimum = Math.min(minimum, frame.frame); maximum = Math.max(maximum, frame.frame)
        if (maximum - minimum + 1 > 1_000_000) throw new Error('セル指定の範囲が広すぎます。')
        let keyId = NULL_CELL_KEY_ID
        if (frame.value !== null) {
          const bound = boundByName.get(frame.value)
          if (bound) keyId = bound
          else {
            // Literal CLIP names can differ only by whitespace; keep separate identities.
            const key = { keyId: `clip_key_${crypto.randomUUID()}`, processId: process.layerId, paperTrack: column.name, sheetRole: options.role, displayLabel: frame.value, paperToken: frame.value, createdFrom: 'import' as const }
            keys.push(key)
            bindings.push({ bindingId: `clip_binding_${crypto.randomUUID()}`, slotId: slot.slotId, keyId: key.keyId, cspCellName: frame.value, materialState: 'unassigned' })
            boundByName.set(frame.value, key.keyId)
            keyId = key.keyId
          }
        }
        events.push({ eventId: `clip_event_${crypto.randomUUID()}`, paperTrack: column.name, sheetRole: options.role, frame: project.logicalSheet.frameOrigin + frame.frame, keyId, valueKind: frame.value === null ? 'blank' : 'cell', source: 'import' })
      }
      project = { ...project, logicalSheet: { ...project.logicalSheet, keys, events }, bindings }
    }
    project = selectTimingProcess(project, correctionLayers[0]!.layerId)
    project = { ...project, logicalSheet: { ...project.logicalSheet, allowNegativeFrames: minimum < 0, workRange: { ...project.logicalSheet.workRange, preRollFrames: Math.max(0, -minimum), postRollFrames: Math.max(0, maximum - project.logicalSheet.durationFrames + 1), showPreRoll: minimum < 0, showPostRoll: maximum >= project.logicalSheet.durationFrames } } }
    next = updateActiveCutProjectInDocument(next, project)
  }
  return { ...next, activeCutId: firstCutId }
}
