import { useId } from 'react'
import { normalizeLevelCorrectionSettings, type LevelCorrectionSettings } from './levelCorrection'

export function useLevelCorrectionFilterId(prefix = 'levelCorrectionFilter'): string {
  const id = useId()
  return `${prefix}-${id.replace(/[^A-Za-z0-9_-]/g, '')}`
}

export function levelCorrectionFilterUrl(id: string, settings?: LevelCorrectionSettings | null): string | undefined {
  return levelCorrectionPreviewEnabled(settings) ? `url(#${id})` : undefined
}

function levelCorrectionPreviewEnabled(settings?: LevelCorrectionSettings | null): boolean {
  return Boolean(settings && normalizeLevelCorrectionSettings(settings).enabled)
}
