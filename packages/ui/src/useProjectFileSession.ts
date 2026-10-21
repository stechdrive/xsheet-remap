import { useCallback, useRef, useState } from 'react'
import { emptyProjectFileLocation, type ProjectFileLocation } from './projectFileLocation'

export function useProjectFileSession() {
  const [location, setLocation] = useState<ProjectFileLocation>(emptyProjectFileLocation)
  const inFlight = useRef(false)
  const run = useCallback(async (operation: () => Promise<void>) => {
    if (inFlight.current) return
    inFlight.current = true
    try { await operation() } finally { inFlight.current = false }
  }, [])
  return { location, setLocation, run }
}
