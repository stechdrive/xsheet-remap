import { standardA3SheetTemplate, type CutMetadataFieldId, type NormalizedRect, type SheetTemplate, type SheetTemplateRegionBinding } from '@xsheet-remap/core'

export const TEMPLATE_CALIBRATION_TARGET_ID = '__template_calibration_target__'
export const CUT_METADATA_FIELD_IDS: CutMetadataFieldId[] = ['title', 'episode', 'scene', 'cut', 'duration', 'worker', 'page']
export type MetadataBindingOptionId = `cut:${CutMetadataFieldId}` | 'group:shared-cut-numbers'
export const METADATA_BINDING_OPTION_IDS: MetadataBindingOptionId[] = [
  ...CUT_METADATA_FIELD_IDS.map(field => `cut:${field}` as const),
  'group:shared-cut-numbers',
]

function metadataFieldLabel(field: CutMetadataFieldId): string {
  return {
    title: 'タイトル',
    episode: '話数',
    scene: 'シーン',
    cut: 'カット',
    duration: '尺',
    worker: '作業者',
    page: 'ページ',
    custom: 'カスタム',
  }[field]
}

export function metadataBindingOptionId(binding: SheetTemplateRegionBinding | undefined): MetadataBindingOptionId | null {
  if (binding?.target === 'cut-metadata') return `cut:${binding.field}`
  if (binding?.target === 'cut-group' && binding.field === 'shared-cut-numbers') return 'group:shared-cut-numbers'
  return null
}

export function metadataBindingFromOptionId(optionId: MetadataBindingOptionId): SheetTemplateRegionBinding {
  if (optionId === 'group:shared-cut-numbers') {
    return { target: 'cut-group', field: 'shared-cut-numbers', opening: '[', closing: ']', separator: '・' }
  }
  return { target: 'cut-metadata', field: optionId.slice(4) as CutMetadataFieldId }
}

export function metadataBindingOptionLabel(optionId: MetadataBindingOptionId): string {
  return optionId === 'group:shared-cut-numbers'
    ? '兼用カット'
    : metadataFieldLabel(optionId.slice(4) as CutMetadataFieldId)
}

export function standardCalibrationTargetRectForTemplate(template: SheetTemplate): NormalizedRect | null {
  if (template.templateKind !== standardA3SheetTemplate.templateKind || template.layoutMode !== standardA3SheetTemplate.layoutMode) return null
  const rect = standardA3SheetTemplate.calibration?.targetRect
  return rect ? { ...rect } : null
}

export function sameNormalizedRect(a: NormalizedRect, b: NormalizedRect): boolean {
  const epsilon = 0.000001
  return Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.w - b.w) <= epsilon
    && Math.abs(a.h - b.h) <= epsilon
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
