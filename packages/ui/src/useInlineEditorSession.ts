import { useCallback, useEffect, useRef } from 'react'

export function useInlineEditorSession<T extends HTMLElement>({
  active,
  sessionKey,
  onCommit,
  onCancel,
  selectOnFocus = false,
}: {
  active: boolean
  sessionKey: string | null
  onCommit: (editor: T | null) => void
  onCancel: () => void
  selectOnFocus?: boolean
}) {
  const editorRef = useRef<T | null>(null)
  const completedRef = useRef(false)

  useEffect(() => {
    if (!active) return undefined
    completedRef.current = false
    const frame = window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor || document.activeElement === editor) return
      editor.focus()
      if (selectOnFocus && (editor instanceof HTMLInputElement || editor instanceof HTMLTextAreaElement)) {
        editor.select()
      }
    })
    return () => window.cancelAnimationFrame(frame)
  }, [active, selectOnFocus, sessionKey])

  const commit = useCallback(() => {
    if (completedRef.current) return false
    completedRef.current = true
    onCommit(editorRef.current)
    return true
  }, [onCommit])

  const cancel = useCallback(() => {
    if (completedRef.current) return false
    completedRef.current = true
    onCancel()
    return true
  }, [onCancel])

  const markCompleted = useCallback(() => {
    completedRef.current = true
  }, [])

  return { editorRef, commit, cancel, markCompleted }
}
