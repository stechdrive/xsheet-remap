import { useMemo } from 'react'
import {
  levelCorrectionTableValues,
  normalizeLevelCorrectionSettings,
  type LevelCorrectionSettings,
} from './levelCorrection'

type LevelCorrectionFilterDefinitionProps = {
  id: string
  settings?: LevelCorrectionSettings | null
}

export function LevelCorrectionFilterDefinition({ id, settings }: LevelCorrectionFilterDefinitionProps) {
  const normalized = useMemo(() => settings ? normalizeLevelCorrectionSettings(settings) : null, [settings])
  const tableValues = useMemo(
    () => normalized?.enabled ? levelCorrectionTableValues(normalized) : '',
    [normalized],
  )

  if (!normalized?.enabled) return null

  return (
    <filter id={id} colorInterpolationFilters="sRGB">
      <feComponentTransfer>
        <feFuncR type="table" tableValues={tableValues} />
        <feFuncG type="table" tableValues={tableValues} />
        <feFuncB type="table" tableValues={tableValues} />
        <feFuncA type="identity" />
      </feComponentTransfer>
    </filter>
  )
}
