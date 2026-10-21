import { useEffect, useLayoutEffect, useRef, type DragEvent } from 'react'
import { flushSync } from 'react-dom'
import { isTauriHost, isXsrProjectFileName, openNativeDocumentFile, readNativeDocumentFile, type DocumentFileSource } from '@xsheet-remap/adapters'
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

  function handleOpenProject() {
    if (!isTauriHost()) { projectInputRef.current?.click(); return }
    void run(async () => {
      const source = await openNativeDocumentFile('xsr', options.initialDirectory)
      if (source) await latest.current.loadProject(source)
    })
  }
  function handleOpenClip() {
    void run(async () => {
      const source = await openNativeDocumentFile('clip', options.initialDirectory)
      if (source) latest.current.loadClip(source)
    })
  }
  function handleLoadProject(files: FileList | null) {
    const file = files?.[0]
    if (file) void run(() => latest.current.loadProject({ file, nativePath: null }))
  }
  function handleLoadClip(files: FileList | null) {
    const file = files?.[0]
    if (file) options.loadClip({ file, nativePath: null })
  }
  function handleSaveProjectFile(input?: { saveAs?: boolean }) { return run(() => latest.current.saveProject(input)) }
  function handleResetApp() { return run(() => latest.current.newProject()) }

  function acceptProjectDrop(names: string[]): boolean {
    if (!names.some(isXsrProjectFileName)) return false
    if (names.length !== 1) {
      window.alert('開くXSRプロジェクトを1件だけドロップしてください。')
      return false
    }
    return !blocked()
  }
  function handleNativeProjectDrop(paths: string[]): boolean {
    if (!paths.some(isXsrProjectFileName)) return false
    if (acceptProjectDrop(paths)) void run(async () => {
      const source = await readNativeDocumentFile(paths[0], 'xsr')
      await latest.current.loadProject(source)
    })
    return true
  }
  function handleProjectDrop(event: DragEvent) {
    const files = Array.from(event.dataTransfer.files ?? [])
    if (!files.some(file => isXsrProjectFileName(file.name))) return
    event.preventDefault()
    event.stopPropagation()
    // Native drops must keep the OS path and are handled through Tauri only.
    if (!isTauriHost() && acceptProjectDrop(files.map(file => file.name))) {
      void run(() => latest.current.loadProject({ file: files[0], nativePath: null }))
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
    handleSaveProjectFile, handleResetApp, handleNativeProjectDrop, handleProjectDrop }
}
