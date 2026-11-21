import {
  createProjectFromTrackLabels, createSheetPages, digitalStandardSheetTemplate, standardA3SheetTemplate,
  timingSpecialMarkerKeyId, withSheetTemplatePaperTracks, type CutProject, type SheetTemplate,
} from '@xsheet-remap/core'
import { invalid, MAX_LINK_EVENTS } from './bytes'
import type { SheetLinkPage } from './model'
import { decodeSheetLink } from './packet'
import { restoreTextNote } from './textNotes'

export interface OpenedSheetLink { workspace?: { project: CutProject; template: SheetTemplate }; message: string; error?: boolean }

function header(packet: SheetLinkPage) {
  const s = packet.sheet
  return JSON.stringify([s.group, packet.pages, s.title, s.episode, s.scene, s.cut, s.fps, s.origin, s.duration,
  s.pre, s.post, s.digital, s.names, s.vacant])
}

export function restoreSheetLink(current: SheetLinkPage, others: SheetLinkPage[] = []): OpenedSheetLink {
  const s = current.sheet, identity = header(current)
  const template = withSheetTemplatePaperTracks(s.digital ? digitalStandardSheetTemplate : standardA3SheetTemplate, s.names)
  const pages = createSheetPages(template, s.duration + s.pre + s.post, s.origin - s.pre)
  const packets = [...others.filter(p => header(p) === identity), current]
  const seenPages = new Set<number>(), all = packets.some(p => p.whole)
  const project = createProjectFromTrackLabels(s.names, {
    template, projectId: 'sheet-qr-' + Array.from(s.group).join('-'),
    cut: { title: s.title, episode: s.episode, scene: s.scene, cut: s.cut }
  })
  if (project.logicalSheet.paperTracks.length !== s.names.length || pages.length !== current.pages) invalid()
  const sheet = project.logicalSheet
  sheet.fps = s.fps
  sheet.frameOrigin = s.origin
  sheet.durationFrames = s.duration
  sheet.workRange = { preRollFrames: s.pre, postRollFrames: s.post, showPreRoll: !!s.pre, showPostRoll: !!s.post }
  sheet.vacantPaperColumns = s.vacant
  project.sheetView.activePageId = 'page_' + current.page
  if (pages.length > 1) project.sheetView.viewMode = 'single-page'
  const keys = new Map<string, string>(), events = new Set<string>(), marks = new Set<string>(), cues = new Set<number>()
  const notes = new Map<string, [string, string, string]>()
  const missingCues = new Set<number>(), missingFields = new Set<number>()
  let count = 0
  for (const p of packets) {
    const bounds = pages[p.page - 1]
    if (!bounds || bounds.frameStart !== p.from || bounds.frameEnd !== p.to) invalid()
    seenPages.add(p.page)
    for (let i = p.whole ? 1 : p.page; i <= (p.whole ? p.pages : p.page); i++) {
      if (p.omitted & 1) missingCues.add(i)
      if (p.omitted & 2) missingFields.add(i)
    }
    for (const col of p.sheet.columns) {
      const paperTrack = s.names[col.index >> 1]!, sheetRole = col.index % 2 ? 'cell' : 'action'
      for (const [frame, value] of col.points) {
        const address = col.index + '/' + frame
        if (events.has(address)) continue
        events.add(address)
        if (++count > MAX_LINK_EVENTS) invalid()
        const valueKind = typeof value !== 'number' ? 'cell' : (['blank', 'inbetween', 'reverse'] as const)[value]
        let keyId: string
        if (valueKind === 'cell') {
          const key = JSON.stringify([col.index, value])
          keyId = keys.get(key) ?? 'qr-key-' + keys.size
          if (!keys.has(key)) {
            const [displayLabel, paperToken] = Array.isArray(value) ? value : [String(value), String(value)]
            sheet.keys.push({ keyId, paperTrack, sheetRole, displayLabel, paperToken, createdFrom: 'import' })
            keys.set(key, keyId)
          }
        } else keyId = timingSpecialMarkerKeyId(valueKind)
        sheet.events.push({ eventId: 'qr-event-' + address, paperTrack, sheetRole, frame, valueKind, keyId, source: 'import' })
      }
      for (const [frame, shape] of col.marks) {
        const key = col.index + '/' + frame + '/' + shape
        if (marks.has(key)) continue
        marks.add(key)
        if (++count > MAX_LINK_EVENTS) invalid()
        sheet.referenceMarks!.push({ paperTrack, sheetRole, frame, shape })
      }
    }
    for (const cue of p.sheet.cues) {
      const key = cue.id
      if (cues.has(key)) continue
      cues.add(key)
      const lanes = sheet.timelineSections.find(section => section.role === cue.role)!.lanes!
      while (lanes.length <= cue.lane) lanes.push({ laneId: 'qr-' + cue.role + '-' + lanes.length, order: lanes.length, label: String(lanes.length + 1) })
      const lane = lanes[cue.lane]!
      if (cue.laneName) lane.label = cue.laneName
      project.timedRangeCues.push({
        cueId: 'qr-cue-' + key, role: cue.role, frameStart: cue.frameStart, frameEnd: cue.frameEnd,
        laneId: lane.laneId, label: cue.label, text: cue.text, camera: cue.camera, source: 'import'
      })
    }
    const form = project.sheetFormData
    for (const [scope, key, value, kind = 'text'] of p.sheet.fields) {
      if (scope === 'worker') project.cut.worker = value
      else if (scope === 'custom') (project.cut.custom ??= {})[key] = value
      else if (scope.startsWith('note')) notes.set(scope + '/' + key, [scope, key, value])
      else {
        const fields = scope === 'cut' || scope === 'production' || scope === 'revision' ? form[scope] : (form.pages[scope] ??= {})
        if (kind === 'number') fields[key] = { kind, value: Number(value) }
        else if (kind === 'duration') fields[key] = { kind, frames: Number(value) }
        else if (kind === 'boolean') fields[key] = { kind, value: value === 'true' }
        else fields[key] = { kind, value }
      }
    }
  }
  for (const [scope, key, value] of notes.values()) project.memos.push(restoreTextNote(scope, key, value, project))
  for (const p of packets) {
    if (!(p.omitted & 1)) { if (p.whole) missingCues.clear(); else missingCues.delete(p.page) }
    if (!(p.omitted & 2)) { if (p.whole) missingFields.clear(); else missingFields.delete(p.page) }
  }
  sheet.events.sort((a, b) => a.frame - b.frame)
  const done = all || seenPages.size === pages.length
  const progress = done ? '全' + pages.length + 'ページを復元しました。' :
    '全' + pages.length + 'ページ中' + seenPages.size + 'ページを復元しました。残りのシートのQRも同じブラウザで読み取ってください。'
  const missing = [missingCues.size && 'SOUND・CAMERA', missingFields.size && 'MEMOなどの補足文字'].filter(Boolean).join('、')
  return { workspace: { project, template }, message: progress + (missing ? ' 容量のため一部の' + missing + 'は省略されています。' : '') }
}

/** Page data is carried by the URL. The short local history only joins separate scans. */
export function readBrowserSheetLink(hash: string): OpenedSheetLink {
  let storage: Storage | undefined
  try { storage = window.localStorage } catch { /* A single scan still works. */ }
  return openSheetLink(hash, storage)
}

export function openSheetLink(hash: string, storage?: Pick<Storage, 'getItem' | 'setItem'>): OpenedSheetLink {
  try {
    if (!hash.startsWith('#s=')) invalid()
    const digits = hash.slice(3), current = decodeSheetLink(digits)
    const id = Array.from(current.sheet.group, b => b.toString(16).padStart(2, '0')).join('')
    const prefix = 'xsheet-remap:qr:1:' + id + ':', others: SheetLinkPage[] = []
    let saved = true, tooLarge = false, digitsRead = digits.length, eventsRead = 0
    if (current.pages > 1 && !(current.whole && !current.omitted)) {
      for (let i = 1; i <= current.pages; i++) {
        try {
          const data = storage?.getItem(prefix + i)
          if (data && data !== digits && data.length <= 5481) {
            digitsRead += data.length
            if (digitsRead > 2_000_000) {
              tooLarge = true
              break
            }
            const part = decodeSheetLink(data)
            if (part.page === i && header(part) === header(current)) {
              eventsRead += part.sheet.columns.reduce((n, c) => n + c.points.length + c.marks.length, 0)
              if (eventsRead > MAX_LINK_EVENTS * 2) {
                tooLarge = true
                break
              }
              others.push(part)
            }
          }
        } catch { /* Ignore a damaged or inaccessible cached scan. */ }
      }
    }
    const result = restoreSheetLink(current, tooLarge ? [] : others)
    if (tooLarge) result.message += ' 記憶済みのシートが結合上限を超えたため、今回はこのQRの内容を表示しています。'
    if (current.pages > 1) {
      try { if (storage) storage.setItem(prefix + current.page, digits); else saved = false } catch { saved = false }
      if (!current.whole && !saved) result.message += ' このブラウザでは読み取り済みページを記憶できません。'
    }
    return result
  } catch { return { error: true, message: 'シートQRを復元できませんでした。印刷されたQRをもう一度読み取ってください。' } }
}
