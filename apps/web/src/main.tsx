import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App, AssetPreviewWindow, SheetCorrectorApp } from '@xsheet-remap/ui'
import '@xsheet-remap/ui/src/styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('root element not found')
const params = new URLSearchParams(window.location.search)
const isAssetPreviewWindow = params.get('window') === 'asset-preview'
const isSheetCorrectorApp = params.get('app') === 'sheet-corrector'

createRoot(root).render(
  <StrictMode>
    {isAssetPreviewWindow ? <AssetPreviewWindow /> : isSheetCorrectorApp ? <SheetCorrectorApp /> : <App />}
  </StrictMode>,
)
