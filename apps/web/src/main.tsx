import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xsheet-remap/ui/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')
const params = new URLSearchParams(window.location.search)
const isAssetPreviewWindow = params.get('window') === 'asset-preview'
const appKind = params.get('app')
const applicationTitle = isAssetPreviewWindow
  ? '素材プレビュー'
  : appKind === 'remap'
    ? 'xsheet-remap'
    : appKind === 'template-editor'
      ? 'xsheet-template-editor'
      : appKind === 'sheet-corrector'
        ? 'シート画像補正'
        : 'xsheet-editor'

document.title = applicationTitle

async function resolveApplication() {
  if (isAssetPreviewWindow) {
    const { AssetPreviewWindow } = await import('@xsheet-remap/ui')
    return <AssetPreviewWindow />
  }
  if (appKind === 'sheet-corrector') {
    const { SheetCorrectorApp } = await import('@xsheet-remap/ui')
    return <SheetCorrectorApp />
  }
  if (appKind === 'template-editor') {
    const { TemplateEditorApp } = await import('@xsheet-remap/ui')
    return <TemplateEditorApp />
  }
  const { EditorApp, RemapApp } = await import('@xsheet-remap/ui')
  return appKind === 'remap' ? <RemapApp /> : <EditorApp />
}

createRoot(root).render(
  <StrictMode>
    {await resolveApplication()}
  </StrictMode>,
)
