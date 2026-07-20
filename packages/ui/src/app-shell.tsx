import { AppShellView } from './app-shell-view'
import { useAppController, type AppControllerOptions } from './app-shell-controller'
import { useMainWindowState } from './mainWindowState'

export function EditorApp() {
  return <App appKind="editor" collapseEditorSheetPanes />
}

export function RemapApp() {
  return <App appKind="remap" />
}

export function App(options: AppControllerOptions = {}) {
  useMainWindowState(options.appKind ?? 'editor')
  return <AppShellView controller={useAppController(options)} />
}
