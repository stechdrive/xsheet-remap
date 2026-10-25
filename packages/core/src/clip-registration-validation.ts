import type { CutProject, SheetTimingRole } from './types'
import { allProcessEvents } from './process-timing'
import { sheetTimingRoleForEvent } from './project-shared'

/** Keep legacy placeholder cels, but never infer a transferred drawing's image. */
export function assertExplicitClipRegistrations(project: CutProject, role: SheetTimingRole): void {
  const keys = new Map(project.logicalSheet.keys.map(key => [key.keyId, key]))
  const state = project.clipDocument
  for (const event of allProcessEvents(project.logicalSheet)) {
    if (sheetTimingRoleForEvent(event) !== role) continue
    const key = keys.get(event.keyId)
    if (!key?.requiresExplicitBinding) continue
    const slots = project.cspTrackSlots.filter(slot => slot.paperTrack === key.paperTrack && (!key.processId || slot.correctionLayerId === key.processId))
    if (state && slots.length && slots.every(slot => state.deletedTargetSlotIds?.includes(slot.slotId))) continue
    const registered = project.bindings.some(binding => binding.keyId === key.keyId && slots.some(slot => slot.slotId === binding.slotId)
      && (!state || state.targets.some(target => target.slotId === binding.slotId && (!binding.clipLayerId || state.nodes.some(node => node.id === binding.clipLayerId && node.parentId === target.folderId)))))
    if (!registered) throw new Error(`「${event.paperTrack}」${event.frame}コマ目の転記セル「${key.displayLabel}」は素材未登録です。レイヤーツリーからセルを登録してください。`)
  }
}
