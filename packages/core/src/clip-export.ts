import { activeCutProjectFromDocument, buildExportPlan, stackGuideRegistrations } from './project'
import { NULL_CELL_CSP_CELL_NAME, type CutGroupProjectDocument, type ExportTrackFrame, type SheetTimingRole } from './types'

export interface ClipCanvasSettings {
  width: number
  height: number
  dpi: number
  basisWidth: number
  basisHeight: number
  offsetX: number
  offsetY: number
}
export type ClipImageFit = 'expand' | 'crop'
export interface ClipCel { name: string; assetId?: string }
export interface ClipFolder {
  id: string
  path: string[]
  name: string
  cels: ClipCel[]
}
export interface ClipTimeline {
  id: string
  name: string
  fps: number
  duration: number
  tracks: { folderId: string; frames: ExportTrackFrame[] }[]
}
export interface ClipRegistrationPlan {
  projectId: string
  folders: ClipFolder[]
  timelines: ClipTimeline[]
}

/** Comparison only: original display names are retained in the document. */
export function normalizeClipName(value: string): string {
  return value.normalize('NFKC').replace(/[\s\u200B-\u200D\u2060\uFEFF]/gu, '')
}

export function clipImagePlacement(canvas: { width: number; height: number }, image: { width: number; height: number }, policy: ClipImageFit) {
  const width = policy === 'expand' ? Math.max(canvas.width, image.width) : canvas.width
  const height = policy === 'expand' ? Math.max(canvas.height, image.height) : canvas.height
  // Keep integer pixels. An odd excess pixel is removed at the right/bottom.
  const x = Math.ceil((width - image.width) / 2)
  const y = Math.ceil((height - image.height) / 2)
  return { width, height, x, y, cropLeft: Math.max(0, -x), cropTop: Math.max(0, -y),
    cropRight: Math.max(0, image.width + x - width), cropBottom: Math.max(0, image.height + y - height) }
}

export function validateClipCanvas(settings: ClipCanvasSettings): void {
  for (const name of ['width', 'height', 'basisWidth', 'basisHeight'] as const) {
    if (!Number.isInteger(settings[name]) || settings[name] < 1 || settings[name] > 30000) throw new Error(`${name}: 1〜30000の整数を指定してください。`)
  }
  if (settings.width * settings.height > 100_000_000) throw new Error('キャンバスは1億ピクセル以内にしてください。')
  if (!Number.isFinite(settings.dpi) || settings.dpi < 1 || settings.dpi > 1200) throw new Error('DPIは1〜1200で指定してください。')
  if (![settings.offsetX, settings.offsetY].every(value => Number.isInteger(value) && Math.abs(value) <= 30000)) throw new Error('基準フレームのオフセットが範囲外です。')
}

/** Complete events, not the legacy XCI first-use summary. Assets are optional. */
export function buildClipRegistrationPlan(document: CutGroupProjectDocument, role: SheetTimingRole, cutIds?: string[]): ClipRegistrationPlan {
  const folders = new Map<string, ClipFolder>()
  const pathOwners = new Map<string, string>()
  const timelines: ClipTimeline[] = []
  for (const cut of [...document.cuts].sort((a, b) => a.order - b.order)) {
    if (cutIds && !cutIds.includes(cut.cutId)) continue
    const project = activeCutProjectFromDocument({ ...document, activeCutId: cut.cutId })
    const exported = buildExportPlan(project, { profileId: 'import-stack', timingSourceRole: role, sheetTemplate: document.sheetTemplate, fallbackCutId: cut.cutId })
    const timeline: ClipTimeline = { id: cut.cutId, name: exported.metadata.timeTableName, fps: exported.fps, duration: exported.durationFrames, tracks: [] }
    for (const track of exported.tracks.filter(item => !item.dummy)) {
      const slot = project.cspTrackSlots.find(item => item.slotId === track.slotId)
      const guide = project.stackGuideLabels.find(item => item.labelId === track.stackGuideLabelId)
      const registration = guide && stackGuideRegistrations(guide).find(item => item.registrationId === track.stackGuideRegistrationId)
      const layer = project.correctionLayers.find(item => item.layerId === (slot?.correctionLayerId ?? registration?.correctionLayerId))
      const stage = project.productionStages.find(item => item.stageId === layer?.stageId)
      const path = [stage?.label, layer?.label].filter((name): name is string => Boolean(name?.trim()))
      const name = (slot ? project.logicalSheet.paperTracks.find(item => item.paperTrack === slot.paperTrack)?.label : guide?.label) || track.name
      const id = slot ? `slot:${layer?.layerId ?? ''}:${slot.paperTrack}` : `guide:${guide?.labelId}:${registration?.registrationId}`
      const pathKey = JSON.stringify([...path, name].map(normalizeClipName))
      if (!normalizeClipName(name)) throw new Error('空のアニメーションフォルダー名は使用できません。')
      if (pathOwners.has(pathKey) && pathOwners.get(pathKey) !== id) throw new Error(`空白を除くと同名になるフォルダーがあります: ${[...path, name].join(' / ')}`)
      pathOwners.set(pathKey, id)
      const folder = folders.get(id) ?? { id, path, name, cels: [] }
      const frames = track.frames.filter(frame => frame.frame >= 0 && frame.frame < timeline.duration)
        .map(frame => ({ frame: frame.frame, value: frame.value === NULL_CELL_CSP_CELL_NAME ? null : frame.value }))
      for (const frame of frames) {
        if (frame.value === null) continue
        if (!normalizeClipName(frame.value)) throw new Error(`${name}: 空白だけのセル名は使用できません。`)
        const binding = slot && project.bindings.find(item => item.slotId === slot.slotId && item.cspCellName === frame.value)
        if (registration && registration.assetIds.length > 1) throw new Error(`${name}: 登録画像は1件にしてください。`)
        const assetId = binding ? binding.assetId : registration?.assetIds[0]
        const existing = folder.cels.find(cel => normalizeClipName(cel.name) === normalizeClipName(frame.value!))
        if (existing && (existing.name !== frame.value || existing.assetId && assetId && existing.assetId !== assetId)) throw new Error(`${name}: セル名の対応が重複しています: ${frame.value}`)
        if (existing) existing.assetId ??= assetId
        else folder.cels.push({ name: frame.value, ...(assetId ? { assetId } : {}) })
      }
      folders.set(id, folder)
      timeline.tracks.push({ folderId: id, frames })
    }
    timelines.push(timeline)
  }
  if (!timelines.length) throw new Error('作成するカットを選択してください。')
  return { projectId: document.projectId, folders: [...folders.values()], timelines }
}
