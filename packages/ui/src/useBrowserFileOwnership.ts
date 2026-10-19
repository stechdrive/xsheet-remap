import { useCallback, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { createBrowserFileOwner } from '@xsheet-remap/adapters'

/** Bridge producer leases to committed React state, including history and dialogs. */
export function useBrowserFileOwnership(immutableRoots: unknown) {
  const [owner] = useState(createBrowserFileOwner)
  const pending = useRef<Array<() => void>>([]), mounted = useRef(false)
  const [revision, commit] = useReducer(value => value + 1, 0)
  useLayoutEffect(() => {
    mounted.current = true
    const releases = pending.current
    return () => {
      mounted.current = false
      owner.dispose()
      releases.splice(0).forEach(release => release())
    }
  }, [owner])
  useLayoutEffect(() => {
    owner.update(immutableRoots)
    pending.current.splice(0).forEach(release => release())
  }, [owner, immutableRoots, revision])
  return useCallback((release: () => void) => {
    if (!mounted.current) { release(); return }
    pending.current.push(release)
    commit()
  }, [])
}
