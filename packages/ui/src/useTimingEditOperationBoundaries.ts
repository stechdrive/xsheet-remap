import { useEffect, type MutableRefObject } from 'react'
import type { TimingEditSession } from './appTypes'
import { isTimingEditInteractionBoundary } from './workspaceInteractionPolicy'

export function useTimingEditOperationBoundaries(options: {
  sessionRef: MutableRefObject<TimingEditSession | null>
  commitActiveEdit: () => void
  hasUnsavedChanges: boolean
}) {
  useEffect(() => {
    const commitOnInteractionBoundary = (event: Event) => {
      if (!isTimingEditInteractionBoundary(event.target, event.type as 'pointerdown' | 'focusin')) return
      if (options.sessionRef.current) options.commitActiveEdit()
    }
    window.addEventListener('pointerdown', commitOnInteractionBoundary)
    window.addEventListener('focusin', commitOnInteractionBoundary)
    return () => {
      window.removeEventListener('pointerdown', commitOnInteractionBoundary)
      window.removeEventListener('focusin', commitOnInteractionBoundary)
    }
  })

  useEffect(() => {
    const warnBeforeDiscard = (event: BeforeUnloadEvent) => {
      if (!options.hasUnsavedChanges) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeDiscard)
    return () => window.removeEventListener('beforeunload', warnBeforeDiscard)
  }, [options.hasUnsavedChanges])
}
