import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate, type TimedRangeCue } from '@xsheet-remap/core'
import { CameraCueLayer } from './CameraCueLayer'

describe('CameraCueLayer', () => {
  it('renders all four semantic instruction shapes and an editable overlap pivot', () => {
    const cues: TimedRangeCue[] = [
      cameraCue('cue_1', 'camera_lane_1', 1, 12, 'range'),
      cameraCue('cue_2', 'camera_lane_2', 13, 24, 'fade-in'),
      cameraCue('cue_3', 'camera_lane_3', 25, 36, 'fade-out'),
      cameraCue('cue_4', 'camera_lane_4', 37, 48, 'overlap', 43),
    ]
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg>
        <CameraCueLayer
          cues={cues}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
          pageSize={{ widthPx: 1754, heightPx: 2481 }}
          surface={{ widthPx: 1000, heightPx: 1000 }}
          selectedCueId="cue_4"
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onPointerCancel={vi.fn()}
          onDoubleClick={vi.fn()}
          onPointerEnter={vi.fn()}
          onPointerLeave={vi.fn()}
        />
      </svg>,
    )
    expect(container.querySelectorAll('.cameraCue.range .cameraCueStroke')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.fade-in .cameraCueFade')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.fade-out .cameraCueFade')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.overlap .cameraCueStroke')).toHaveLength(2)
    expect(container.querySelectorAll('.cameraCueShapeHit')).toHaveLength(5)
    expect(container.querySelector('.cameraCueHitBody')).toBeNull()
    expect(container.querySelector('.cameraCuePivotHandle')).toBeTruthy()
    expect(container.querySelectorAll('.cameraCue.range .cameraCueMarker.start')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.range .cameraCueMarker.end')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCue.fade-in .cameraCueMarker, .cameraCue.fade-out .cameraCueMarker, .cameraCue.overlap .cameraCueMarker')).toHaveLength(0)
    expect(container.querySelectorAll('.cameraCueLabelHit')).toHaveLength(4)
    expect(container.querySelectorAll('.cameraCueLabelBody')).toHaveLength(1)
    expect(container.querySelectorAll('.cameraCueLabel defs rect')).toHaveLength(4)
    expect(container.querySelectorAll('.cameraCueLabel[data-camera-label-overflow="false"]')).toHaveLength(4)
    expect(container.querySelectorAll('.cameraCueLabelText[clip-path]')).toHaveLength(0)
    expect(container.querySelectorAll('.cameraCueLabel [clip-path] .cameraCueLabelText')).toHaveLength(4)
  })

  it('marks an unavoidably overflowing label while clipping it to the CAMERA region', () => {
    const cue = cameraCue('cue_overflow', 'camera_lane_1', 1, 24, 'range')
    cue.label = '非常に長いCAMERA指示'.repeat(100)
    const page = createSheetPages(standardA3SheetTemplate, 144, 1)[0]!
    const { container } = render(
      <svg>
        <CameraCueLayer
          cues={[cue]}
          template={standardA3SheetTemplate}
          page={page}
          paperTracks={createDefaultProject().logicalSheet.paperTracks.map(track => track.paperTrack)}
          pageSize={{ widthPx: 1754, heightPx: 2481 }}
          surface={{ widthPx: 1000, heightPx: 1000 }}
          selectedCueId="cue_overflow"
          onPointerDown={vi.fn()}
          onPointerMove={vi.fn()}
          onPointerUp={vi.fn()}
          onPointerCancel={vi.fn()}
          onDoubleClick={vi.fn()}
          onPointerEnter={vi.fn()}
          onPointerLeave={vi.fn()}
        />
      </svg>,
    )
    const label = container.querySelector('.cameraCueLabel[data-camera-label-overflow="true"]')
    expect(label?.classList.contains('overflow')).toBe(true)
    expect(label?.querySelector('title')?.textContent).toContain('アンカー付きメモ')
    expect(label?.querySelector('[clip-path]')).toBeTruthy()
  })
})

function cameraCue(cueId: string, laneId: string, frameStart: number, frameEnd: number, shape: 'range' | 'fade-in' | 'fade-out' | 'overlap', pivotFrame?: number): TimedRangeCue {
  return { cueId, role: 'camera', laneId, frameStart, frameEnd, label: shape, text: '', source: 'manual', camera: { shape, startLabel: 'A', endLabel: 'B', pivotFrame } }
}
