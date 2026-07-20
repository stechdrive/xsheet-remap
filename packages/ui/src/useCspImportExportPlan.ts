import { useCallback, useEffect, useRef, useState } from 'react'
import type { CutGroupProjectDocument, SheetTimingRole } from '@xsheet-remap/core'
import { createCspImportExportPlan, type CspImportExportPlan } from './cspImportExportPlan'

export type CspImportExportState =
  | { phase: 'idle'; plan: null; error: null }
  | { phase: 'preparing'; plan: null; error: null }
  | { phase: 'ready'; plan: CspImportExportPlan; error: null }
  | { phase: 'writing'; plan: CspImportExportPlan; error: null }
  | { phase: 'error'; plan: CspImportExportPlan | null; error: string }

export function useCspImportExportPlan({
  enabled,
  projectDocument,
  exportProfileId,
  timingSourceRole,
  appVersion,
}: {
  enabled: boolean
  projectDocument: CutGroupProjectDocument
  exportProfileId: string
  timingSourceRole: SheetTimingRole
  appVersion: string
}) {
  const [state, setState] = useState<CspImportExportState>({ phase: 'idle', plan: null, error: null })
  const requestIdRef = useRef(0)

  const prepare = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setState({ phase: 'preparing', plan: null, error: null })
    try {
      const plan = await createCspImportExportPlan(projectDocument, {
        exportProfileId,
        timingSourceRole,
        appVersion,
      })
      if (requestId === requestIdRef.current) setState({ phase: 'ready', plan, error: null })
      return plan
    } catch (error) {
      if (requestId === requestIdRef.current) {
        setState({ phase: 'error', plan: null, error: error instanceof Error ? error.message : String(error) })
      }
      return null
    }
  }, [appVersion, exportProfileId, projectDocument, timingSourceRole])

  useEffect(() => {
    if (enabled) {
      const task = window.setTimeout(() => {
        void prepare()
      }, 0)
      return () => window.clearTimeout(task)
    }
    const task = window.setTimeout(() => {
      requestIdRef.current += 1
      setState({ phase: 'idle', plan: null, error: null })
    }, 0)
    return () => {
      window.clearTimeout(task)
      requestIdRef.current += 1
    }
  }, [enabled, prepare])

  const markWriting = useCallback((plan: CspImportExportPlan) => {
    setState({ phase: 'writing', plan, error: null })
  }, [])
  const markError = useCallback((error: string, plan: CspImportExportPlan | null) => {
    setState({ phase: 'error', plan, error })
  }, [])

  return { state, prepare, markWriting, markError }
}
