import { AppShellView } from './app-shell-view'
import { useAppController, type AppControllerOptions } from './app-shell-controller'

export function EditorApp() {
  return <App appKind="editor" collapseEditorSheetPanes />
}

export function RemapApp() {
  return <App appKind="remap" />
}

export function App(options: AppControllerOptions = {}) {
  return <AppShellView controller={useAppController(options)} />
}
