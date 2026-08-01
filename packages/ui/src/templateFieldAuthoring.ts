import type { SheetFormData, SheetTemplate, SheetTemplateFieldDefinition } from '@xsheet-remap/core'

export function sheetFormFieldHasStoredValue(data: SheetFormData, fieldId: string): boolean {
  if (Object.hasOwn(data.production, fieldId)
    || Object.hasOwn(data.cut, fieldId)
    || Object.hasOwn(data.revision, fieldId)) return true
  return Object.values(data.pages).some(page => Object.hasOwn(page, fieldId))
}

export function templateFieldSemanticsLockReason(
  definition: SheetTemplateFieldDefinition,
  projectData: SheetFormData | null,
): string | null {
  if (definition.builtinBinding) {
    return '標準のカット情報と連動する項目なので、値の種類と共有範囲は固定です。'
  }
  if (projectData && sheetFormFieldHasStoredValue(projectData, definition.fieldId)) {
    return 'このプロジェクトに入力済みの値があります。保存場所や値の形式を失わないよう、種類と共有範囲は変更できません。テンプレートEXEで別名の新しい項目として作成してください。'
  }
  return null
}

export function templateFieldChoicesFromText(value: string): string[] {
  return value.split(/\r?\n/).map(choice => choice.trim()).filter(Boolean)
}

export function templateFieldReferenceCount(template: SheetTemplate, fieldId: string): number {
  return template.regions.reduce((count, region) => count + (region.form?.cells ?? [])
    .filter(cell => cell.kind === 'field' && cell.fieldId === fieldId).length, 0)
}
