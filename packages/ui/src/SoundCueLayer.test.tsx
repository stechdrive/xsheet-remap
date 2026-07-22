import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { SoundCueLayer } from './SoundCueLayer'

describe('SoundCueLayer', () => {
  it('alternates by frame order and renders content when the label is empty', () => {
    const cues: TimedRangeCue[] = [
      soundCue('cue_later', 20, 24, '二行目'),
      soundCue('cue_first', 1, 6, 'SE', ''),
      soundCue('cue_middle', 10, 14, '一行目'),
    ]
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg><SoundCueLayer
        cues={cues}
        template={standardA3SheetTemplate}
        page={page}
        paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
        pageSize={{ widthPx: 1754, heightPx: 2481 }}
        surface={{ widthPx: 1000, heightPx: 1000 }}
        selectedCueId={null}
        onPointerDown={vi.fn()} onPointerMove={vi.fn()} onPointerUp={vi.fn()} onPointerCancel={vi.fn()}
        onDoubleClick={vi.fn()} onPointerEnter={vi.fn()} onPointerLeave={vi.fn()}
      /></svg>,
    )

    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"]')?.getAttribute('data-cue-tone')).toBe('primary')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_middle"]')?.getAttribute('data-cue-tone')).toBe('alternate')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_later"]')?.getAttribute('data-cue-tone')).toBe('primary')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"]')?.getAttribute('aria-label')).toContain('SE')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"] .soundCueLabel')).toBeNull()
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"] .soundCueDialogue')?.textContent).toContain('S')
  })
})

function soundCue(cueId: string, frameStart: number, frameEnd: number, text: string, label = cueId): TimedRangeCue {
  return { cueId, role: 'sound', laneId: 'sound_lane_1', frameStart, frameEnd, label, text, source: 'manual' }
}
