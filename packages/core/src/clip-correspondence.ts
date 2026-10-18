import type { CspTrackSlot, CutGroupProjectDocument, CutSheetLogicalSheet, ProcessTiming } from './types'
import { activeCutProjectFromDocument, parseProjectDocument } from './project-documents'

export interface ClipTrackCorrespondence {
  folderId: string
  slotId: string
}

const identity = (processId: string | undefined, paperTrack: string) => JSON.stringify([processId, paperTrack])
const slotIdentity = (slot: CspTrackSlot) => identity(slot.correctionLayerId, slot.paperTrack)

/** Reassign imported tracks, never merge or synchronize their exposures. Atomic across all cuts/revisions. */
export function remapClipTracks(document: CutGroupProjectDocument, assignments: ClipTrackCorrespondence[]): CutGroupProjectDocument {
  const state = document.clipDocument, project = activeCutProjectFromDocument(document)
  if (!state || !project.logicalSheet.processTimings) throw new Error('独立したCLIPタイミングの対応設定です。')
  const slots = new Map(project.cspTrackSlots.map(slot => [slot.slotId, slot]))
  const seen = new Set<string>()
  for (const assignment of assignments) {
    if (seen.has(assignment.folderId) || !state.targets.some(target => target.folderId === assignment.folderId) || !slots.has(assignment.slotId)) throw new Error('対応先のフォルダー・セル列が不正です。')
    seen.add(assignment.folderId)
  }
  const targets = state.targets.map(target => ({ ...target, slotId: assignments.find(assignment => assignment.folderId === target.folderId)?.slotId ?? target.slotId }))
  if (new Set(targets.map(target => target.slotId)).size !== targets.length) throw new Error('同じ表示グループのセル列に複数のフォルダーは対応づけられません。別の列またはグループを選んでください。')
  const moves = state.targets.flatMap((target, index) => target.slotId === targets[index]!.slotId ? [] : [{ source: slots.get(target.slotId)!, destination: slots.get(targets[index]!.slotId)! }])
  if (!moves.length) return document
  if (moves.some(move => !move.source)) throw new Error('現在のシートに対応元のセル列がありません。')
  const byIdentity = new Map(moves.map(move => [slotIdentity(move.source), move.destination]))
  const bySlot = new Map(moves.map(move => [move.source.slotId, move.destination.slotId]))
  const destinations = new Set(moves.map(move => slotIdentity(move.destination)))
  const collides = (processId: string | undefined, paperTrack: string) => destinations.has(identity(processId, paperTrack)) && !byIdentity.has(identity(processId, paperTrack))
  for (const key of document.registeredCells.keys) {
    if (collides(key.processId, key.paperTrack)) throw new Error('対応先に既存のセル番号があります。空の列を選ぶか、対応を入れ替えてください。')
  }
  for (const binding of document.registeredCells.bindings) {
    if (moves.some(move => move.destination.slotId === binding.slotId) && !bySlot.has(binding.slotId)) throw new Error('対応先に素材が登録されています。')
  }
  const cuts = document.cuts.map(cut => ({ ...cut, revisions: cut.revisions.map(revision => {
    if (revision.protected) throw new Error('保護されたシートがあるため対応を変更できません。シート履歴の保護を解除してください。')
    for (const { source, destination } of moves) {
      if (![source, destination].every(slot => revision.cspTrackSlots.some(item => item.slotId === slot.slotId && slotIdentity(item) === slotIdentity(slot)) && revision.logicalSheet.paperTracks.some(track => track.paperTrack === slot.paperTrack))) throw new Error('カット・シート履歴でセル列の構成が異なります。共通して存在する列へ対応づけてください。')
    }
    return { ...revision, logicalSheet: remapSheet(revision.logicalSheet, byIdentity, collides) }
  }) }))
  return parseProjectDocument({ ...document, cuts,
    clipDocument: { ...state, targets, deletedTargetSlotIds: state.deletedTargetSlotIds?.filter(id => !targets.some(target => target.slotId === id)) },
    registeredCells: { ...document.registeredCells,
      keys: document.registeredCells.keys.map(key => {
        const slot = byIdentity.get(identity(key.processId, key.paperTrack))
        return slot ? { ...key, processId: slot.correctionLayerId, paperTrack: slot.paperTrack } : key
      }),
      bindings: document.registeredCells.bindings.map(binding => bySlot.has(binding.slotId) ? { ...binding, slotId: bySlot.get(binding.slotId)! } : binding),
    },
  })
}

function remapSheet(sheet: CutSheetLogicalSheet, moves: Map<string, CspTrackSlot>, collides: (processId: string, paperTrack: string) => boolean): CutSheetLogicalSheet {
  const bank = sheet.processTimings
  if (!bank) throw new Error('共通シートと独立タイミングが混在しているため対応を変更できません。')
  const timings = new Map<string, ProcessTiming>()
  const get = (id: string) => {
    if (!timings.has(id)) timings.set(id, { events: [], referenceMarks: [] })
    return timings.get(id)!
  }
  for (const [processId, timing] of [[bank.activeProcessId, sheet], ...Object.entries(bank.inactive)] as [string, ProcessTiming][]) {
    for (const event of timing.events) {
      if (collides(processId, event.paperTrack)) throw new Error('対応先にタイミングがあります。空の列を選ぶか、対応を入れ替えてください。')
      const slot = moves.get(identity(processId, event.paperTrack))
      get(slot?.correctionLayerId ?? processId).events.push(slot ? { ...event, paperTrack: slot.paperTrack } : event)
    }
    for (const mark of timing.referenceMarks ?? []) {
      if (collides(processId, mark.paperTrack)) throw new Error('対応先に参考指定があります。')
      const slot = moves.get(identity(processId, mark.paperTrack))
      get(slot?.correctionLayerId ?? processId).referenceMarks!.push(slot ? { ...mark, paperTrack: slot.paperTrack } : mark)
    }
  }
  const active = get(bank.activeProcessId)
  // Separately edited groups may both contain event_1. Once displayed together,
  // their UI identities must be unique even though their native timing is unchanged.
  for (const timing of timings.values()) {
    const ids = new Set<string>()
    timing.events = timing.events.map(event => {
      const next = ids.has(event.eventId) ? { ...event, eventId: `event_${crypto.randomUUID()}` } : event
      ids.add(next.eventId)
      return next
    })
  }
  timings.delete(bank.activeProcessId)
  return { ...sheet, ...active, processTimings: { ...bank, inactive: Object.fromEntries(timings) } }
}
