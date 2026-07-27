import { render } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { SoundCueLayer } from './SoundCueLayer'
import * as soundCueGeometry from './soundCueGeometry'

describe('SoundCueLayer', () => {
  it('reuses sound layout geometry when only interaction callbacks change', () => {
    const layoutSpy = vi.spyOn(soundCueGeometry, 'buildSoundCuePageTextLayouts')
    const cue = soundCue('cue_cached', 1, 12, 'cached')
    const cues = [cue]
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const pages = [page]
    const paperTracks = createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)
    const pageSize = { widthPx: 1754, heightPx: 2481 }
    const surface = { widthPx: 1000, heightPx: 1000 }
    const renderLayer = (onPointerDown: ComponentProps<typeof SoundCueLayer>['onPointerDown']) => (
      <svg><SoundCueLayer
        cues={cues}
        template={standardA3SheetTemplate}
        page={page}
        pages={pages}
        paperTracks={paperTracks}
        pageSize={pageSize}
        surface={surface}
        selectedCueId={null}
        onPointerDown={onPointerDown}
        onPointerMove={vi.fn()}
        onPointerUp={vi.fn()}
        onPointerCancel={vi.fn()}
        onDoubleClick={vi.fn()}
        onPointerEnter={vi.fn()}
        onPointerLeave={vi.fn()}
      /></svg>
    )
    const { rerender } = render(renderLayer(vi.fn()))
    expect(layoutSpy).toHaveBeenCalledTimes(1)

    rerender(renderLayer(vi.fn()))

    expect(layoutSpy).toHaveBeenCalledTimes(1)
    layoutSpy.mockRestore()
  })

  it('colors adjacent SOUND columns while keeping every cue in one column stable', () => {
    const cues: TimedRangeCue[] = [
      soundCue('cue_later', 20, 24, '二行目'),
      soundCue('cue_first', 1, 6, 'SE', ''),
      soundCue('cue_middle', 10, 14, '一行目'),
      soundCue('cue_adjacent', 1, 6, '隣接列', '隣', 'sound_lane_2'),
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

    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_middle"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_later"]')?.getAttribute('data-cue-column-index')).toBe('0')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_adjacent"]')?.getAttribute('data-cue-column-index')).toBe('1')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"]')?.getAttribute('aria-label')).toContain('SE')
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"] .soundCueLabel')).toBeNull()
    expect(container.querySelector('.soundCue[data-sound-cue-id="cue_first"] .soundCueDialogue')?.textContent).toContain('S')
  })
})

function soundCue(cueId: string, frameStart: number, frameEnd: number, text: string, label = cueId, laneId = 'sound_lane_1'): TimedRangeCue {
  return { cueId, role: 'sound', laneId, frameStart, frameEnd, label, text, source: 'manual' }
}
