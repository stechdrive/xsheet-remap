import { useEffect, useLayoutEffect, useRef, type DragEvent } from 'react'
import { flushSync } from 'react-dom'
import { documentFileKind, isTauriHost, openNativeDocumentFile, readNativeDocumentFile, type DocumentFileKind, type DocumentFileSource } from '@xsheet-remap/adapters'
import { isCompositionKey } from './compositionKeyboard'
import { errorMessage } from './app-foundation'

export function useProjectFileCommands(options: {
  run: (operation: () => Promise<void>) => Promise<void>
  initialDirectory?: string
  enabled: boolean
  loadProject: (source: DocumentFileSource) => Promise<void>
  loadClip: (source: DocumentFileSource) => void
  saveProject: (input?: { saveAs?: boolean }) => Promise<void>
  newProject: () => Promise<void>
}) {
  const projectInputRef = useRef<HTMLInputElement | null>(null)
  const latest = useRef(options)
  useLayoutEffect(() => { latest.current = options })
  const run = (operation: () => Promise<void>) => options.run(async () => {
    try {
      const editor = document.activeElement
      if (editor instanceof HTMLElement && editor.matches('input, textarea, [contenteditable="true"]') && !editor.closest('[role="dialog"]')) {
        // Inline editors commit on blur, before taking the save/dirty snapshot.
        flushSync(() => editor.blur())
      }
      await operation()
    } catch (error) { window.alert(errorMessage(error)) }
  })
  const blocked = () => !latest.current.enabled || Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'))
  async function loadDocument(source: DocumentFileSource, kind: DocumentFileKind) {
    if (kind === 'clip') latest.current.loadClip(source)
    else await latest.current.loadProject(source)
  }

  function handleOpenProject() {
    if (!isTauriHost()) { projectInputRef.current?.click(); return }
    void run(async () => {
      const source = await openNativeDocumentFile('xsr', options.initialDirectory)
      if (source) await loadDocument(source, 'xsr')
    })
  }
  function handleOpenClip() {
    void run(async () => {
      const source = await openNativeDocumentFile('clip', options.initialDirectory)
      if (source) await loadDocument(source, 'clip')
    })
  }
  function handleLoadProject(files: FileList | null) {
    const file = files?.[0]
    if (file) void run(() => loadDocument({ file, nativePath: null }, 'xsr'))
  }
  function handleLoadClip(files: FileList | null) {
    const file = files?.[0]
    if (file) void run(() => loadDocument({ file, nativePath: null }, 'clip'))
  }
  function handleSaveProjectFile(input?: { saveAs?: boolean }) { return run(() => latest.current.saveProject(input)) }
  function handleResetApp() { return run(() => latest.current.newProject()) }

  function acceptDocumentDrop(names: string[]): boolean {
    if (blocked()) return false
    if (names.length !== 1) {
      window.alert('開くXSRプロジェクトまたはCLIPを1件だけドロップしてください。')
      return false
    }
    return true
  }
  function handleNativeDocumentDrop(paths: string[]): boolean {
    const kind = paths.map(documentFileKind).find(Boolean)
    if (!kind) return false
    if (acceptDocumentDrop(paths)) void run(async () => {
      const source = await readNativeDocumentFile(paths[0], kind)
      if (!blocked()) await loadDocument(source, kind)
    })
    return true
  }
  function handleDocumentDrop(event: DragEvent) {
    const files = Array.from(event.dataTransfer.files ?? [])
    const kind = files.map(file => documentFileKind(file.name)).find(Boolean)
    if (!kind) return
    event.preventDefault()
    event.stopPropagation()
    // Native drops must keep the OS path and are handled through Tauri only.
    if (!isTauriHost() && acceptDocumentDrop(files.map(file => file.name))) {
      void run(() => loadDocument({ file: files[0], nativePath: null }, kind))
    }
  }

  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || isCompositionKey(event) || event.altKey || !(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (!['s', 'o', 'n'].includes(key) || (event.shiftKey && key !== 's')) return
      // Consume file keys even when a modal owns the document, preventing browser Save Page.
      event.preventDefault()
      if (event.repeat || blocked()) return
      if (key === 's') void handleSaveProjectFile({ saveAs: event.shiftKey })
      if (key === 'o') handleOpenProject()
      if (key === 'n') void handleResetApp()
    }
    window.addEventListener('keydown', keyDown, true)
    return () => window.removeEventListener('keydown', keyDown, true)
  })

  return { projectInputRef, handleOpenProject, handleOpenClip, handleLoadProject, handleLoadClip,
    handleSaveProjectFile, handleResetApp, handleNativeDocumentDrop, handleDocumentDrop }
}
