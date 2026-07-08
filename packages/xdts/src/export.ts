import type { ExportPlan } from '@xsheet-remap/core'
import { SYMBOL_NULL_CELL, XDTS_TEXT_HEADER } from './types'

interface RawXdtsFrame {
  frame: number
  data: Array<{ id: number; values: string[] }>
}

export function exportXdts(plan: ExportPlan): string {
  const sortedTracks = [...plan.tracks].sort((a, b) => a.trackNo - b.trackNo)
  const names = sortedTracks.map(track => track.name)
  const raw = {
    version: 5,
    header: {
      cut: '1',
      scene: '1',
    },
    timeTables: [
      {
        name: 'タイムライン1',
        duration: plan.durationFrames,
        frameRate: plan.fps,
        timeTableHeaders: [
          {
            fieldId: 0,
            names,
          },
        ],
        fields: [
          {
            fieldId: 0,
            tracks: sortedTracks.map((track, index) => ({
              trackNo: index,
              frames: compactFrames(
                track.frames.map(frame => ({
                  frame: frame.frame,
                  data: [{ id: 0, values: [frame.value ?? SYMBOL_NULL_CELL] }],
                })),
              ),
            })),
          },
        ],
      },
    ],
  }
  return `${XDTS_TEXT_HEADER}\n${JSON.stringify(raw, null, 2)}\n`
}

function compactFrames(frames: RawXdtsFrame[]): RawXdtsFrame[] {
  const sorted = [...frames].sort((a, b) => a.frame - b.frame)
  const result: RawXdtsFrame[] = []
  let previous: string | undefined
  for (const frame of sorted) {
    const value = frame.data[0]?.values[0]
    if (value === previous) continue
    previous = value
    result.push(frame)
  }
  return result
}
