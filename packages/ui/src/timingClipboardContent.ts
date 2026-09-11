import {
  clearEvent,
  createKey,
  findTimingKeyByDisplayLabel,
  setEvent,
  setTimingSpecialEvent,
  sheetTimingRoleForKey,
  uniqueCspCellNameForSlot,
  updateKey,
  upsertBinding,
  type CellBinding,
  type CspTrackSlot,
  type CutProject,
  type SheetTimingRole,
  type TimingKey,
} from '@xsheet-remap/core'
import type { TimingClipboard, TimingPasteContent } from './appTypes'

type ClipboardItem = TimingClipboard['items'][number]
type BindingSpec = Pick<CellBinding, 'slotId' | 'cspCellName' | 'assetId' | 'materialState'>
type BindingPolicy = 'omit' | 'preserve' | 'replace'

/** One paste owns its key mapping, including repeats and unnumbered drawings. */
export function createTimingClipboardWriter(clipboard: TimingClipboard, targetRole: SheetTimingRole, content: TimingPasteContent) {
  const bindingPolicy: BindingPolicy = content === 'with-bindings'
    ? 'replace'
    : content === 'notation' || clipboard.role !== targetRole ? 'omit' : 'preserve'
  const mappedKeys = new Map<string, Map<string | ClipboardItem, string>>()
  return (project: CutProject, paperTrack: string, frame: number, item: ClipboardItem): CutProject => {
    if (item.kind === 'empty') return clearEvent(project, paperTrack, frame, targetRole)
    const eventOptions = { fontSizePx: item.fontSizePx, source: item.source }
    if (item.kind !== 'key') return setTimingSpecialEvent(project, paperTrack, frame, item.kind, targetRole, eventOptions)

    const trackKeys = mappedKeys.get(paperTrack) ?? new Map<string | ClipboardItem, string>()
    mappedKeys.set(paperTrack, trackKeys)
    const identity = item.keyId ?? item
    const mappedKey = trackKeys.get(identity)
    if (mappedKey) return setEvent(project, paperTrack, frame, mappedKey, targetRole, eventOptions)

    const sourceKey = item.keyId ? project.logicalSheet.keys.find(key => key.keyId === item.keyId) : undefined
    const reusableSourceKey = sourceKey
      && sourceKey.paperTrack === paperTrack
      && sheetTimingRoleForKey(sourceKey) === targetRole
      && sourceKey.displayLabel === (item.displayLabel ?? '')
      ? sourceKey : null
    const existingKey = reusableSourceKey ?? reusableClipboardKey(project, targetRole, paperTrack, item, bindingPolicy)
    const created = existingKey ? { project, key: existingKey } : createClipboardKey(project, targetRole, paperTrack, item)
    const next = bindingPolicy === 'omit'
      ? created.project
      : applyClipboardBindings(created.project, created.key.keyId, paperTrack, item, bindingPolicy)
    trackKeys.set(identity, created.key.keyId)
    return setEvent(next, paperTrack, frame, created.key.keyId, targetRole, eventOptions)
  }
}

export function timingClipboardBindingSnapshots(project: CutProject, keyId: string, slotById: Map<string, CspTrackSlot>): NonNullable<ClipboardItem['bindings']> {
  return project.bindings.flatMap(binding => {
    if (binding.keyId !== keyId) return []
    const slot = slotById.get(binding.slotId)
    if (!slot) return []
    return [{
      sourceSlotId: slot.slotId,
      sourceSlotPaperTrack: slot.paperTrack,
      sourceSlotStageId: slot.stageId,
      sourceSlotCorrectionLayerId: slot.correctionLayerId,
      sourceSlotOccurrenceIndex: slot.occurrenceIndex,
      sourceSlotTrackNo: slot.trackNo,
      cspCellName: binding.cspCellName,
      assetId: binding.assetId,
      materialState: binding.materialState,
    }]
  })
}

function reusableClipboardKey(project: CutProject, role: SheetTimingRole, paperTrack: string, item: ClipboardItem, bindingPolicy: BindingPolicy): TimingKey | null {
  const label = item.displayLabel ?? ''
  if (label.trim()) return findTimingKeyByDisplayLabel(project, paperTrack, label, role)
  // Removing image links must not collapse different unnumbered drawings.
  if (bindingPolicy === 'omit') return null
  const signature = bindingSignature(clipboardBindingsForTrack(project, item, paperTrack))
  return project.logicalSheet.keys.find(key =>
    key.paperTrack === paperTrack
    && sheetTimingRoleForKey(key) === role
    && key.displayLabel === label
    && (key.paperToken ?? '') === (item.paperToken ?? '')
    && bindingSignature(project.bindings.filter(binding => binding.keyId === key.keyId)) === signature,
  ) ?? null
}

function createClipboardKey(project: CutProject, role: SheetTimingRole, paperTrack: string, item: ClipboardItem): { project: CutProject; key: TimingKey } {
  const label = item.displayLabel ?? ''
  const created = createKey(project, paperTrack, label.trim() ? label : undefined, item.createdFrom ?? 'manual', item.paperToken, role)
  if (created.key.displayLabel === label && (created.key.paperToken ?? '') === (item.paperToken ?? '')) return created
  const updated = updateKey(created.project, created.key.keyId, { displayLabel: label, paperToken: item.paperToken })
  return { project: updated, key: updated.logicalSheet.keys.find(key => key.keyId === created.key.keyId) ?? created.key }
}

function applyClipboardBindings(project: CutProject, keyId: string, paperTrack: string, item: ClipboardItem, policy: Exclude<BindingPolicy, 'omit'>): CutProject {
  let next = project
  for (const spec of clipboardBindingsForTrack(project, item, paperTrack)) {
    const existing = next.bindings.find(binding => binding.slotId === spec.slotId && binding.keyId === keyId)
    // Ordinary paste never changes an existing registration. An explicit image
    // paste replaces its image only when the clipboard actually contains one.
    if (existing && (policy === 'preserve' || !spec.assetId)) continue
    next = upsertBinding(next, {
      ...spec,
      keyId,
      cspCellName: existing?.cspCellName ?? uniqueCspCellNameForSlot(next, spec.slotId, spec.cspCellName),
    })
  }
  return next
}

function clipboardBindingsForTrack(project: CutProject, item: ClipboardItem, paperTrack: string): BindingSpec[] {
  const usedSlots = new Set<string>()
  return (item.bindings ?? []).flatMap(binding => {
    const slot = correspondingSlot(project, binding, paperTrack)
    if (!slot || usedSlots.has(slot.slotId)) return []
    usedSlots.add(slot.slotId)
    return [{ slotId: slot.slotId, cspCellName: binding.cspCellName, assetId: binding.assetId, materialState: binding.materialState }]
  })
}

function correspondingSlot(project: CutProject, binding: NonNullable<ClipboardItem['bindings']>[number], paperTrack: string): CspTrackSlot | null {
  const candidates = project.cspTrackSlots.filter(slot => slot.paperTrack === paperTrack)
  return candidates.find(slot => slot.correctionLayerId === binding.sourceSlotCorrectionLayerId && slot.occurrenceIndex === binding.sourceSlotOccurrenceIndex)
    ?? candidates.find(slot => slot.correctionLayerId === binding.sourceSlotCorrectionLayerId && slot.stageId === binding.sourceSlotStageId)
    ?? candidates.find(slot => slot.correctionLayerId === binding.sourceSlotCorrectionLayerId)
    ?? candidates.find(slot => slot.occurrenceIndex === binding.sourceSlotOccurrenceIndex && slot.trackNo === binding.sourceSlotTrackNo)
    ?? candidates[0]
    ?? null
}

function bindingSignature(specs: BindingSpec[]): string {
  return specs.map(spec => `${spec.slotId}\u0000${spec.cspCellName}\u0000${spec.assetId ?? ''}\u0000${spec.materialState}`).sort().join('\u0001')
}
