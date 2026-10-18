import type { CutGroupProjectDocument, CutProject, ExportTrackFrame, PaperTrack, SheetTimingRole } from './types'
import { NULL_CELL_KEY_ID } from './types'
import { reconcileCspTrackSlots, defaultCorrectionLayerId } from './project-shared'
import { updateLogicalSheetSettings } from './project-export'
import { alphabeticTrackLabel } from './sheet-template'
import { normalizeClipName } from './clip-export'
import { logicalSheetWorkRange } from './logical-sheet'
import { activeCutProjectFromDocument, addBlankSharedCutToProjectDocument, updateActiveCutProjectInDocument } from './project-documents'

/** Layer order is CSP's palette order (top to bottom), independent of SQL row IDs. */
export interface ClipImportNode {
  id: string
  name: string
  path: string[]
  animation: boolean
  visible: boolean
  expanded?: boolean
  children: ClipImportNode[]
}
export interface ClipImportTimeline {
  id: string
  name: string
  fps: number
  startFrame: number
  endFrame: number
  /** Frames are relative to startFrame, including negative and post-playback keys. */
  tracks: { layerId: string; frames: ExportTrackFrame[]; error?: string }[]
}
export interface ClipImportData {
  layers?: import('./clip-document').ClipLayerNode[]
  canvas?: import('./clip-export').ClipCanvasSettings
  fileName: string
  fileHash: string
  nodes: ClipImportNode[]
  timelines: ClipImportTimeline[]
  currentTimelineId: string
}
export interface ClipImportColumn { layerId: string; name: string; process?: string }
export interface ClipImportOptions { timelineId: string; role: SheetTimingRole; columns: ClipImportColumn[] }

export function clipImportFolders(nodes: ClipImportNode[]): ClipImportNode[] {
  return [...nodes].reverse().flatMap(node => node.animation ? [node] : clipImportFolders(node.children))
}
export function clipImportTrackUsed(project: CutProject, track: PaperTrack): boolean {
  return Boolean(track.clipSource)
    || project.logicalSheet.keys.some(key => key.paperTrack === track.paperTrack)
    || project.logicalSheet.events.some(event => event.paperTrack === track.paperTrack)
    || project.bindings.some(binding => project.cspTrackSlots.some(slot => slot.slotId === binding.slotId && slot.paperTrack === track.paperTrack))
}
export function suggestClipImportColumns(project: CutProject, nodes: ClipImportNode[], selectedIds: string[]): ClipImportColumn[] {
  const selected = new Set(selectedIds)
  const folders = clipImportFolders(nodes).filter(node => selected.has(node.id))
  const used = new Set(project.logicalSheet.paperTracks.filter(track => clipImportTrackUsed(project, track)).flatMap(track => [normalizeClipName(track.paperTrack), normalizeClipName(track.label)]))
  // Reserve usable original names first, so an alias cannot steal a later folder's A/B.
  const preferred = new Set(folders.filter(node => /^[A-Za-z]{1,2}$/.test(node.name)).map(node => normalizeClipName(node.name)))
  return folders.map(node => {
    let name = /^[A-Za-z]{1,2}$/.test(node.name) && !used.has(normalizeClipName(node.name)) ? node.name : ''
    for (let index = 0; !name; index++) {
      const candidate = alphabeticTrackLabel(index)
      if (!used.has(normalizeClipName(candidate)) && !preferred.has(normalizeClipName(candidate))) name = candidate
    }
    used.add(normalizeClipName(name))
    return { layerId: node.id, name }
  })
}

export function clipImportSettings(project: CutProject, timeline: ClipImportTimeline) {
  const duration = timeline.endFrame - timeline.startFrame
  const populated = project.logicalSheet.events.length > 0 || project.timedRangeCues.length > 0 || project.memos.length > 0
  return { fps: timeline.fps, durationFrames: populated ? Math.max(project.logicalSheet.durationFrames, duration) : duration }
}

/** Build a complete immutable result; the UI commits this exactly once for undo. */
export function importClipTimeline(project: CutProject, data: ClipImportData, options: ClipImportOptions): CutProject {
  const timeline = data.timelines.find(item => item.id === options.timelineId)
  if (!timeline) throw new Error('読み込むタイムラインを選択してください。')
  const duration = timeline.endFrame - timeline.startFrame
  if (!Number.isInteger(duration) || duration < 1 || duration > 1_000_000 || !Number.isFinite(timeline.fps) || timeline.fps < 1 || timeline.fps > 120) throw new Error('タイムラインのFPSまたは尺が範囲外です。')
  if (!options.columns.length) throw new Error('読み込むアニメーションフォルダーを選択してください。')
  const folders = clipImportFolders(data.nodes)
  const columns = new Map(options.columns.map(column => [column.layerId, column]))
  if (columns.size !== options.columns.length || [...columns.keys()].some(id => !folders.some(folder => folder.id === id))) throw new Error('読み込み対象のフォルダーが不正です。')
  const usedTracks = project.logicalSheet.paperTracks.filter(track => clipImportTrackUsed(project, track))
  const names = new Set(usedTracks.flatMap(track => [normalizeClipName(track.paperTrack), normalizeClipName(track.label)]))
  const ordered = folders.flatMap(folder => {
    const column = columns.get(folder.id)
    if (!column) return []
    const name = column.name.trim(), normalized = normalizeClipName(name)
    if (!normalized) throw new Error('セル列名を入力してください。')
    if (names.has(normalized)) throw new Error(`セル列名「${name}」は重複しているか、既存データで使用中です。`)
    names.add(normalized)
    const source = timeline.tracks.find(track => track.layerId === folder.id)
    if (source?.error) throw new Error(`${folder.path.join(' / ')}: ${source.error}`)
    return [{ folder, name, frames: source?.frames ?? [] }]
  })
  const available = project.logicalSheet.paperTracks.filter(track => !clipImportTrackUsed(project, track)).sort((a, b) => a.order - b.order)
  const targetNames = new Set(ordered.map(item => item.name))
  const remaining = [...available]
  const replacements = new Map<string, PaperTrack>()
  const added: PaperTrack[] = []
  // Reuse empty columns at their existing positions. Names on unused columns can
  // be exchanged without transient name collisions or rewriting existing events.
  const targets = ordered.map(item => {
    const match = remaining.findIndex(track => track.paperTrack === item.name)
    const index = match >= 0 ? match : remaining.findIndex(track => !targetNames.has(track.paperTrack))
    return index >= 0 ? remaining.splice(index, 1)[0] : undefined
  })
  const orders = targets.flatMap(track => track ? [track.order] : []).sort((a, b) => a - b)
  let extraOrder = Math.max(-1, ...project.logicalSheet.paperTracks.map(track => track.order)) + 1
  ordered.forEach((item, index) => {
    const target = targets[index]
    const track: PaperTrack = {
      ...(target ?? { source: 'template' as const }),
      paperTrack: item.name, label: item.name, order: orders[index] ?? extraOrder++,
      clipSource: { fileName: data.fileName, fileHash: data.fileHash, timelineId: timeline.id, timelineName: timeline.name, layerId: item.folder.id, path: [...item.folder.path], fps: timeline.fps, startFrame: timeline.startFrame, endFrame: timeline.endFrame, sheetRole: options.role },
    }
    if (target) replacements.set(target.paperTrack, track)
    else added.push(track)
  })
  const paperTracks = [...project.logicalSheet.paperTracks.map(track => replacements.get(track.paperTrack) ?? track), ...added].sort((a, b) => a.order - b.order).map((track, order) => ({ ...track, order }))
  if (new Set(paperTracks.map(track => normalizeClipName(track.paperTrack))).size !== paperTracks.length) throw new Error('未使用の列と名前が重複しています。別のセル列名を指定してください。')
  const cspTrackSlots = reconcileCspTrackSlots(paperTracks, project.productionStages, project.correctionLayers, project.cspTrackSlots)
  const stage = defaultCorrectionLayerId(project)
  if (!stage) throw new Error('デフォルトの作画工程がありません。')
  let next = updateLogicalSheetSettings({ ...project, logicalSheet: { ...project.logicalSheet, paperTracks }, cspTrackSlots }, clipImportSettings(project, timeline))
  next = { ...next, logicalSheet: { ...next.logicalSheet, fps: timeline.fps } }
  next = { ...next, exportProfiles: next.exportProfiles.map(profile => ({ ...profile, slotIds: cspTrackSlots.map(slot => slot.slotId) })) }
  return applyClipFrames(next, data, timeline, options)
}

function applyClipFrames(project: CutProject, data: ClipImportData, timeline: ClipImportTimeline, options: ClipImportOptions): CutProject {
  const duration = timeline.endFrame - timeline.startFrame
  if (!Number.isInteger(duration) || duration < 1 || duration > 1_000_000 || !Number.isFinite(timeline.fps) || timeline.fps < 1 || timeline.fps > 120) throw new Error('タイムラインのFPSまたは尺が範囲外です。')
  const nextKeys = [...project.logicalSheet.keys], events = [...project.logicalSheet.events], bindings = [...project.bindings]
  let firstFrame = 0, lastFrame = duration - 1
  const keyIdFor = idSequence('key', nextKeys.map(key => key.keyId)), eventIdFor = idSequence('event', events.map(event => event.eventId)), bindingIdFor = idSequence('binding', bindings.map(binding => binding.bindingId))
  for (const column of options.columns) {
    const item = { name: column.name.trim(), frames: timeline.tracks.find(track => track.layerId === column.layerId)?.frames ?? [] }
    const source = timeline.tracks.find(track => track.layerId === column.layerId)
    if (source?.error) throw new Error(`${item.name}: ${source.error}`)
    const slot = project.cspTrackSlots.find(slot => slot.paperTrack === item.name && slot.correctionLayerId === defaultCorrectionLayerId(project))!
    const keys = new Map(bindings.filter(binding => binding.slotId === slot.slotId).map(binding => [binding.cspCellName, binding.keyId]))
    let previousFrame = -Infinity
    for (const frame of item.frames) {
      if (!Number.isSafeInteger(frame.frame) || frame.frame <= previousFrame) throw new Error('セル指定の順序または読み込み範囲が不正です。')
      previousFrame = frame.frame
      firstFrame = Math.min(firstFrame, frame.frame)
      lastFrame = Math.max(lastFrame, frame.frame)
      if (lastFrame - firstFrame + 1 > 1_000_000) throw new Error('ダミーコマを含むセル指定の範囲が広すぎます。')
      const targetFrame = project.logicalSheet.frameOrigin + frame.frame
      if (!Number.isSafeInteger(targetFrame)) throw new Error('セル指定の読み込み位置が範囲外です。')
      let keyId = frame.value === null ? NULL_CELL_KEY_ID : keys.get(frame.value)
      if (!keyId) {
        keyId = keyIdFor()
        keys.set(frame.value!, keyId)
        nextKeys.push({ keyId, paperTrack: item.name, sheetRole: options.role, displayLabel: frame.value!, paperToken: frame.value!, createdFrom: 'import' })
        bindings.push({ bindingId: bindingIdFor(), slotId: slot.slotId, keyId, cspCellName: frame.value!, materialState: 'unassigned' })
      }
      events.push({ eventId: eventIdFor(), paperTrack: item.name, frame: targetFrame, keyId, sheetRole: options.role, source: 'import', valueKind: frame.value === null ? 'blank' : 'cell' })
    }
  }
  const workRange = logicalSheetWorkRange(project.logicalSheet)
  const preRollFrames = Math.max(workRange.preRollFrames, -firstFrame)
  const postRollFrames = Math.max(workRange.postRollFrames, lastFrame - project.logicalSheet.durationFrames + 1)
  return { ...project, bindings, logicalSheet: { ...project.logicalSheet, keys: nextKeys, events,
    allowNegativeFrames: project.logicalSheet.allowNegativeFrames || firstFrame < 0,
    workRange: { ...workRange, preRollFrames, postRollFrames,
      showPreRoll: workRange.showPreRoll || firstFrame < 0,
      showPostRoll: workRange.showPostRoll || lastFrame >= project.logicalSheet.durationFrames },
    paperTracks: project.logicalSheet.paperTracks.map(track => {
    if (!options.columns.some(column => column.name.trim() === track.paperTrack) || !track.clipSource) return track
    return { ...track, clipSource: { ...track.clipSource, fileHash: data.fileHash, timelineId: timeline.id, timelineName: timeline.name, fps: timeline.fps, startFrame: timeline.startFrame, endFrame: timeline.endFrame } }
  }) } }
}

// Allocate once per batch; scanning the full catalog for every exposure is quadratic.
function idSequence(prefix: string, existing: string[]): () => string {
  const used = new Set(existing)
  let index = existing.length
  return () => { let id: string; do { id = `${prefix}_${String(++index).padStart(4, '0')}` } while (used.has(id)); used.add(id); return id }
}

/** Multiple CSP timelines share one cell catalog, but retain individual timing. */
export function importClipTimelines(document: CutGroupProjectDocument, data: ClipImportData, options: Omit<ClipImportOptions, 'timelineId'> & { timelineIds: string[] }): CutGroupProjectDocument {
  const timelines = data.timelines.filter(timeline => options.timelineIds.includes(timeline.id))
  if (!timelines.length || timelines.length !== new Set(options.timelineIds).size) throw new Error('読み込むタイムラインを選択してください。')
  let project = activeCutProjectFromDocument(document), next = document
  if (timelines.length === 1) return updateActiveCutProjectInDocument(next, importClipTimeline(project, data, { ...options, timelineId: timelines[0].id }))
  const populated = project.logicalSheet.events.length > 0 || project.assets.length > 0 || project.timedRangeCues.length > 0 || project.memos.length > 0
  let firstCutId = ''
  const names = new Set(document.cuts.map(cut => cut.metadata.cut))
  timelines.forEach((timeline, index) => {
    let name = timeline.name.trim() || `タイムライン${index + 1}`
    const baseName = name
    for (let suffix = 2; names.has(name); suffix++) name = `${baseName} (${suffix})`
    names.add(name)
    if (index > 0 || populated) {
      next = addBlankSharedCutToProjectDocument(next, project, { cut: { cut: name, cspTimelineName: timeline.name } })
      project = activeCutProjectFromDocument(next)
    }
    if (index === 0) {
      project = importClipTimeline(project, data, { ...options, timelineId: timeline.id })
      firstCutId = next.activeCutId
    } else {
      project = { ...project, logicalSheet: { ...project.logicalSheet, fps: timeline.fps, durationFrames: timeline.endFrame - timeline.startFrame } }
      project = applyClipFrames(project, data, timeline, { ...options, timelineId: timeline.id })
    }
    project = { ...project, cut: { ...project.cut, cut: name, cspTimelineName: timeline.name } }
    next = updateActiveCutProjectInDocument(next, project)
  })
  return { ...next, activeCutId: firstCutId }
}
