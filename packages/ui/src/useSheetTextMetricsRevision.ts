import { useEffect, useState } from 'react'
import { sharedTextMeasurementProvider } from './textMetrics'

/** Refit visible cells once webfonts replace the initial fallback measurements. */
export function useSheetTextMetricsRevision() {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const fonts = document.fonts
    if (!fonts) return
    let active = true
    const refresh = () => {
      if (!active) return
      sharedTextMeasurementProvider.clear()
      setRevision(value => value + 1)
    }
    void fonts.ready.then(refresh)
    fonts.addEventListener('loadingdone', refresh)
    return () => { active = false; fonts.removeEventListener('loadingdone', refresh) }
  }, [])
  return revision
}
