import type { CspTrackSlot, CutAsset, CutProject, SheetTimingRole, TimingKey } from './types'
import { assetFileBaseName, defaultCorrectionLayerFileNameSuffix, defaultCspCellName, sheetTimingRoleForKey } from './project-shared'

export function findReusableLogicalCellKeyForAsset(
  project: CutProject,
  slot: CspTrackSlot,
  asset: CutAsset,
  sheetRole: SheetTimingRole,
): { key: TimingKey; sourceBindingCspCellName?: string } | null {
  const exactAssetBinding = project.bindings.find(binding => {
    if (binding.assetId !== asset.assetId) return false
    const key = project.logicalSheet.keys.find(item => item.keyId === binding.keyId)
    return Boolean(key && key.paperTrack === slot.paperTrack && sheetTimingRoleForKey(key) === sheetRole)
  })
  if (exactAssetBinding) {
    const key = project.logicalSheet.keys.find(item => item.keyId === exactAssetBinding.keyId)
    if (key) return { key, sourceBindingCspCellName: exactAssetBinding.cspCellName }
  }

  const assetIdentity = logicalCellIdentityForSlot(project, slot, assetFileBaseName(asset))
  if (!assetIdentity) return null
  const matches = project.logicalSheet.keys.filter(key =>
    key.paperTrack === slot.paperTrack
    && sheetTimingRoleForKey(key) === sheetRole
    && logicalCellIdentitiesForKey(project, key).has(assetIdentity),
  )
  if (matches.length > 1) {
    throw new Error(`logical cell identity is ambiguous in ${slot.displayPath}: ${assetFileBaseName(asset)}`)
  }
  return matches[0] ? { key: matches[0] } : null
}

function logicalCellIdentitiesForKey(project: CutProject, key: TimingKey): Set<string> {
  const identities = new Set<string>()
  const fallbackSlot = project.cspTrackSlots.find(slot => slot.paperTrack === key.paperTrack)
  if (fallbackSlot) {
    identities.add(logicalCellIdentityForSlot(project, fallbackSlot, defaultCspCellName(key.displayLabel, key.paperTrack)))
  }
  for (const binding of project.bindings) {
    if (binding.keyId !== key.keyId) continue
    const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
    if (!slot) continue
    identities.add(logicalCellIdentityForSlot(project, slot, binding.cspCellName))
    const asset = binding.assetId ? project.assets.find(item => item.assetId === binding.assetId) : undefined
    if (asset) identities.add(logicalCellIdentityForSlot(project, slot, assetFileBaseName(asset)))
  }
  identities.delete('')
  return identities
}

function logicalCellIdentityForSlot(project: CutProject, slot: CspTrackSlot, rawName: string): string {
  let name = normalizeIdentityText(rawName)
  const layer = slot.correctionLayerId
    ? project.correctionLayers.find(item => item.layerId === slot.correctionLayerId)
    : undefined
  const suffix = normalizeIdentityText(layer?.fileNameSuffix ?? defaultCorrectionLayerFileNameSuffix(layer))
  if (suffix && name.endsWith(suffix)) name = name.slice(0, -suffix.length).trim()
  if (!name) return ''

  const paperTrack = normalizeIdentityText(slot.paperTrack)
  if (paperTrack && name.startsWith(paperTrack)) {
    const remainder = name.slice(paperTrack.length).replace(/^[\s_.-]+/, '')
    if (/^\d+$/.test(remainder)) return `track:${paperTrack}:number:${Number(remainder)}`
    return `track:${paperTrack}:label:${remainder.replace(/\s+/g, '')}`
  }
  return `name:${name.replace(/\s+/g, '')}`
}

function normalizeIdentityText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleUpperCase()
}
