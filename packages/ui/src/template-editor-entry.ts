import { invokeDesktopCommand, isTauriHost } from '@xsheet-remap/adapters'

/** Opens an independent draft; the caller's sheet and correction settings stay local. */
export async function openTemplateEditor(): Promise<void> {
  if (isTauriHost()) {
    await invokeDesktopCommand('open_template_editor')
    return
  }
  const url = new URL(window.location.href)
  url.search = '?app=template-editor'
  url.hash = ''
  window.open(url.href, '_blank', 'noopener')
}

export function requestTemplateEditor(): void {
  void openTemplateEditor().catch(error => {
    window.alert(`テンプレート編集を開けませんでした。${error instanceof Error ? error.message : String(error)}`)
  })
}
