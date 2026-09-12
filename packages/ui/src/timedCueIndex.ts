import type { TimedRangeCue } from '@xsheet-remap/core'
import { createSheetIntervalCache } from './sheetIntervalIndex'

export const timedCueIndex = createSheetIntervalCache<TimedRangeCue>(cue => ({ start: cue.frameStart, end: cue.frameEnd }))
