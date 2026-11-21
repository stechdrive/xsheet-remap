import {
  resolveCameraInstructionPoints, sheetTimingRoleForEvent, timingEventValueKind, type CutProject, type SheetPage, type SheetTemplate,
  type SheetFormFieldValue, type TimedRangeCue, type TimingEnclosure,
} from '@xsheet-remap/core'
import { type LinkPoint } from './timing'
import { noteFields } from './textNotes'

export interface LinkColumn { index: number; points: LinkPoint[]; marks: [number, TimingEnclosure][] }
export type LinkCue = Pick<TimedRangeCue, 'role' | 'frameStart' | 'frameEnd' | 'label' | 'text'> & {
  id: number; lane: number; laneName: string; camera?: Pick<NonNullable<TimedRangeCue['camera']>, 'shape' | 'points'>
}
export type TextField = [scope: string, key: string, value: string, kind?: SheetFormFieldValue['kind']]
export interface LinkSheet {
  group: Uint8Array
  title: string; episode: string; scene: string; cut: string
  fps: number; origin: number; duration: number; pre: number; post: number
  digital: boolean; names: string[]; vacant: number[]
  columns: LinkColumn[]; cues: LinkCue[]; fields: TextField[]
}
export interface SheetLinkPage {
  sheet: LinkSheet; page: number; pages: number; from: number; to: number
  whole: boolean; omitted: number
}

// An edition key is shared by independently scanned pages. Include content, not just
// the user-visible cut number, since both revisions and reprints may have that number.
function edition(parts: unknown[]): Uint8Array {
  let a = 2166136261, b = 5381
  for (const part of parts) {
    const text = JSON.stringify(part) ?? ''
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i)
      a = Math.imul(a ^ c, 16777619)
      b = Math.imul(b, 33) ^ c
    }
    a = Math.imul(a ^ 255, 16777619)
    b = Math.imul(b, 33) ^ 255
  }
  const out = new Uint8Array(8), view = new DataView(out.buffer)
  view.setUint32(0, a)
  view.setUint32(4, b)
  return out
}

export function collectLinkSheet(project: CutProject, template: SheetTemplate, scope = ''): LinkSheet {
  const sheet = project.logicalSheet
  const names = [...sheet.paperTracks].sort((a, b) => a.order - b.order).map(t => t.paperTrack)
  const indices = new Map(names.map((name, i) => [name, i]))
  const keys = new Map(sheet.keys.map(k => [k.keyId, k]))
  const columns = new Map<number, LinkColumn>()
  const column = (name: string, cell: boolean) => {
    const i = indices.get(name)
    if (i === undefined) throw new Error('シートQRの列名を解決できません。')
    const index = i * 2 + Number(cell)
    let col = columns.get(index)
    if (!col) {
      col = { index, points: [], marks: [] }
      columns.set(index, col)
    }
    return col
  }
  for (const event of sheet.events) {
    const kind = timingEventValueKind(event), key = keys.get(event.keyId)
    const value = kind === 'cell' ? key?.displayLabel ?? '' : kind === 'blank' ? 0 : kind === 'inbetween' ? 1 : 2
    column(event.paperTrack, sheetTimingRoleForEvent(event) === 'cell').points.push([event.frame,
    typeof value === 'string' && key?.paperToken !== undefined && key.paperToken !== value ? [value, key.paperToken] : value])
  }
  for (const mark of sheet.referenceMarks ?? []) column(mark.paperTrack, mark.sheetRole === 'cell').marks.push([mark.frame, mark.shape ?? 'triangle'])
  const ordered = [...columns.values()].sort((a, b) => a.index - b.index)
  for (const col of ordered) {
    col.points.sort((a, b) => a[0] - b[0])
    col.marks.sort((a, b) => a[0] - b[0])
  }
  const cues: LinkCue[] = []
  for (const [id, cue] of project.timedRangeCues.entries()) {
    if (cue.role !== 'sound' && cue.role !== 'camera') continue
    const lanes = sheet.timelineSections.find(s => s.role === cue.role)?.lanes ?? []
    const lane = Math.max(0, lanes.findIndex(l => l.laneId === cue.laneId))
    cues.push({
      id, role: cue.role, frameStart: cue.frameStart, frameEnd: cue.frameEnd, label: cue.label, text: cue.text,
      lane, laneName: lanes[lane]?.label ?? '', camera: cue.camera && {
        shape: cue.camera.shape,
        points: cue.camera.points ?? resolveCameraInstructionPoints(cue.camera, cue.frameStart, cue.frameEnd)
      }
    })
  }
  const fields: TextField[] = noteFields(project)
  for (const [key, value] of Object.entries(project.cut.custom ?? {})) if (value) fields.push(['custom', key, value])
  if (project.cut.worker) fields.push(['worker', '', project.cut.worker])
  const form = project.sheetFormData
  for (const [scope, values] of Object.entries({ ...form.pages, production: form.production, cut: form.cut, revision: form.revision })) {
    for (const [key, field] of Object.entries(values)) {
      const value = field.kind === 'duration' ? field.frames : field.value
      if (value !== null && value !== '') fields.push([scope, key, String(value), field.kind])
    }
  }
  const result: LinkSheet = {
    group: new Uint8Array(8), title: project.cut.title ?? '', episode: project.cut.episode ?? '',
    scene: project.cut.scene ?? '', cut: project.cut.cut ?? '', fps: sheet.fps, origin: sheet.frameOrigin, duration: sheet.durationFrames,
    pre: sheet.workRange.showPreRoll ? sheet.workRange.preRollFrames : 0, post: sheet.workRange.showPostRoll ? sheet.workRange.postRollFrames : 0,
    digital: template.layoutMode === 'infinite-digital', names, vacant: sheet.vacantPaperColumns ?? [], columns: ordered, cues, fields
  }
  result.group = edition([project.projectId, scope, template.templateId, project.cut, result.fps, result.origin, result.duration, result.pre, result.post, names, result.vacant, ...ordered, ...cues, ...fields])
  return result
}

export function selectLinkPage(source: LinkSheet, page: SheetPage, count: number, whole: boolean, tier: number): SheetLinkPage {
  const { frameStart: from, frameEnd: to } = page
  const columns = whole ? source.columns : source.columns.map(col => {
    const points: LinkPoint[] = []
    let preceding: LinkPoint | undefined
    for (const p of col.points) {
      if (p[0] < from) preceding = p
      else if (p[0] <= to) points.push(p)
      else break
    }
    // Keep the real preceding key at its original frame; the first blank is still blank.
    if (preceding && points[0]?.[0] !== from) points.unshift(preceding)
    return { index: col.index, points, marks: col.marks.filter(m => m[0] >= from && m[0] <= to) }
  }).filter(col => col.points.length || col.marks.length)
  const cues = whole ? source.cues : source.cues.filter(c => c.frameStart <= to && c.frameEnd >= from)
  const fields = whole ? source.fields : source.fields.filter(([scope]) => {
    if (scope.startsWith('note@')) {
      const frame = Number(scope.slice(5))
      return frame >= from && frame <= to
    }
    if (scope.startsWith('note.')) return scope.slice(5) === page.pageId
    return !scope.startsWith('page_') || scope === page.pageId
  })
  return {
    page: page.pageIndex + 1, pages: count, from, to, whole,
    omitted: (tier < 2 && cues.length ? 1 : 0) | (tier < 3 && fields.length ? 2 : 0),
    sheet: { ...source, columns, cues: tier >= 2 ? cues : [], fields: tier >= 3 ? fields : [] }
  }
}
