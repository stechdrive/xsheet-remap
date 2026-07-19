import type { SheetTemplate, SheetTemplateFormCell, SheetTemplateRegion } from '@xsheet-remap/core'

export type TemplateMemoTargetRef = {
  regionId: string
  targetId?: string
  label: string
}

/**
 * Resolves template declarations into the stable identity used by selection,
 * persistence and annotation editing. This deliberately contains no preset or
 * A3-specific knowledge.
 */
export function resolveTemplateFormCellMemoTarget(
  region: SheetTemplateRegion,
  cell: SheetTemplateFormCell,
  fallbackLabel: string,
): TemplateMemoTargetRef | null {
  const defaultScope = cell.kind === 'field' || cell.kind === 'annotation' ? 'cell' : 'none'
  const declaration = cell.memoTarget ?? { scope: defaultScope }
  const label = declaration.label?.trim() || fallbackLabel
  switch (declaration.scope) {
    case 'none':
      return null
    case 'region':
      return { regionId: region.regionId, label: declaration.label?.trim() || region.label }
    case 'group': {
      const groupId = declaration.targetId?.trim()
      return groupId ? { regionId: region.regionId, targetId: `group:${groupId}`, label } : null
    }
    case 'cell':
    default:
      return { regionId: region.regionId, targetId: `cell:${cell.cellId}`, label }
  }
}

export function sameTemplateMemoTarget(
  left: Pick<TemplateMemoTargetRef, 'regionId' | 'targetId'> | null | undefined,
  right: Pick<TemplateMemoTargetRef, 'regionId' | 'targetId'> | null | undefined,
): boolean {
  return Boolean(left && right && left.regionId === right.regionId && left.targetId === right.targetId)
}

export function templateMemoTargetLabel(
  template: SheetTemplate,
  target: Pick<TemplateMemoTargetRef, 'regionId' | 'targetId'>,
): string {
  const region = template.regions.find(item => item.regionId === target.regionId)
  if (!region) return target.regionId
  if (!target.targetId) return region.label
  for (const cell of region.form?.cells ?? []) {
    const fieldLabel = cell.fieldId
      ? template.fields?.find(field => field.fieldId === cell.fieldId)?.label
      : undefined
    const resolved = resolveTemplateFormCellMemoTarget(region, cell, fieldLabel ?? cell.label ?? region.label)
    if (sameTemplateMemoTarget(target, resolved)) return resolved!.label
  }
  return region.label
}
