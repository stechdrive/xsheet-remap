import { parseSheetTemplate, type SheetTemplate } from '@xsheet-remap/core'
import { confirmUserAction, readJsonFile } from '@xsheet-remap/adapters'
import { errorMessage } from './app-foundation'

export async function loadSheetTemplate(files: FileList | null): Promise<SheetTemplate | null> {
  const file = files?.[0]
  return file ? parseSheetTemplate(await readJsonFile<unknown>(file)) : null
}

export async function confirmSheetTemplateImport(files: FileList | null): Promise<SheetTemplate | null> {
  try {
    const template = await loadSheetTemplate(files)
    if (!template) return null
    const confirmed = await confirmUserAction(
      `「${template.name}」を表示テンプレートとして適用します。\n現在のセル列とSOUND/CAMERAレーンはテンプレート定義に合わせて再構成されます。`,
      { title: 'シートテンプレートを読み込む', okLabel: '適用' },
    )
    return confirmed ? template : null
  } catch (error) {
    window.alert(`シートテンプレートを読み込めませんでした。\n${errorMessage(error)}`)
    return null
  }
}
