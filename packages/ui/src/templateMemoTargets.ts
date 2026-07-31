import type {
  SheetTemplate,
  SheetTemplateFieldDefinition,
  SheetTemplateFormCell,
  SheetTemplateRegion,
} from '@xsheet-remap/core'

export type TemplateMemoTargetRef = {
  regionId: string
  targetId?: string
  logicalTargetId: string
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
  definition?: SheetTemplateFieldDefinition,
): TemplateMemoTargetRef | null {
  const defaultScope = cell.kind === 'field' || cell.kind === 'annotation' ? 'cell' : 'none'
  const declaration = cell.memoTarget ?? { scope: defaultScope }
  const label = declaration.label?.trim() || fallbackLabel
  const logicalTargetId = declaration.logicalTargetId?.trim()
    || templateFormCellLogicalTargetId(region, cell, definition)
  switch (declaration.scope) {
    case 'none':
      return null
    case 'region':
      return {
        regionId: region.regionId,
        logicalTargetId: declaration.logicalTargetId?.trim() || templateRegionLogicalTargetId(region),
        label: declaration.label?.trim() || region.label,
      }
    case 'group': {
      const groupId = declaration.targetId?.trim()
      return groupId ? {
        regionId: region.regionId,
        targetId: `group:${groupId}`,
        logicalTargetId,
        label,
      } : null
    }
    case 'cell':
    default:
      return {
        regionId: region.regionId,
        targetId: `cell:${cell.cellId}`,
        logicalTargetId,
        label,
      }
  }
}

export function resolveTemplateRegionMemoTarget(
  region: SheetTemplateRegion,
): TemplateMemoTargetRef {
  return {
    regionId: region.regionId,
    logicalTargetId: templateRegionLogicalTargetId(region),
    label: region.label,
  }
}

export function templateRegionLogicalTargetId(region: SheetTemplateRegion): string {
  if (region.type === 'memo-area') return 'memo:main'
  const binding = region.binding
  if (binding?.target === 'cut-metadata') {
    return `metadata:${binding.field}${binding.customKey ? `:${binding.customKey}` : ''}`
  }
  if (binding?.target === 'cut-group') return `cut-group:${binding.field}`
  if (binding?.target === 'timeline-section') {
    return `timeline:${binding.role}${binding.sectionId ? `:${binding.sectionId}` : ''}`
  }
  if (binding?.target === 'annotation-layer') {
    if (binding.intent === 'memo') return 'memo:main'
    return `annotation:${binding.intent ?? binding.layerId}`
  }
  return `region:${region.regionId}`
}

function templateFormCellLogicalTargetId(
  region: SheetTemplateRegion,
  cell: SheetTemplateFormCell,
  definition?: SheetTemplateFieldDefinition,
): string {
  if (region.type === 'memo-area' || cell.fieldId === 'memo.body') return 'memo:main'
  const binding = definition?.builtinBinding
  if (binding?.target === 'cut-metadata') {
    return `metadata:${binding.field}${binding.customKey ? `:${binding.customKey}` : ''}`
  }
  const regionIdentity = templateRegionLogicalTargetId(region)
  const declaration = cell.memoTarget
  if (declaration?.scope === 'group' && declaration.targetId) {
    return `${regionIdentity}:group:${declaration.targetId}`
  }
  return `${regionIdentity}:cell:${cell.fieldId ?? cell.cellId}`
}

export function sameTemplateMemoTarget(
  left: Pick<TemplateMemoTargetRef, 'regionId' | 'targetId'> & Partial<Pick<TemplateMemoTargetRef, 'logicalTargetId'>> | null | undefined,
  right: Pick<TemplateMemoTargetRef, 'regionId' | 'targetId'> & Partial<Pick<TemplateMemoTargetRef, 'logicalTargetId'>> | null | undefined,
): boolean {
  return Boolean(left && right && (
    left.regionId === right.regionId && left.targetId === right.targetId
    || Boolean(left.logicalTargetId && left.logicalTargetId === right.logicalTargetId)
  ))
}

export function templateMemoTargetLabel(
  template: SheetTemplate,
  target: Pick<TemplateMemoTargetRef, 'regionId' | 'targetId'> & Partial<Pick<TemplateMemoTargetRef, 'logicalTargetId'>>,
): string {
  const region = template.regions.find(item => item.regionId === target.regionId)
    ?? template.regions.find(item => target.logicalTargetId === templateRegionLogicalTargetId(item))
  if (!region) return target.logicalTargetId ?? target.regionId
  if (!target.targetId) return region.label
  for (const cell of region.form?.cells ?? []) {
    const definition = cell.fieldId
      ? template.fields?.find(field => field.fieldId === cell.fieldId)
      : undefined
    const resolved = resolveTemplateFormCellMemoTarget(
      region,
      cell,
      definition?.label ?? cell.label ?? region.label,
      definition,
    )
    if (sameTemplateMemoTarget(target, resolved)) return resolved!.label
  }
  return region.label
}
