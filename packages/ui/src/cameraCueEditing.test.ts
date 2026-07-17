import { describe, expect, it } from 'vitest'
import { createDefaultProject, createTimedRangeCue, standardA3SheetTemplate } from '@xsheet-remap/core'
import { buildCameraCueClipboard, cameraLaneIdForHit, pasteCameraCueClipboard } from './cameraCueEditing'

describe('CAMERA cue editing helpers', () => {
  it('maps both A3 CAMERA halves to the same stable logical lane', () => {
    expect(cameraLaneIdForHit(standardA3SheetTemplate, { regionId: 'left_camera_grid', columnId: 'camera_1', columnIndex: 0 })).toBe('camera_lane_1')
    expect(cameraLaneIdForHit(standardA3SheetTemplate, { regionId: 'right_camera_grid', columnId: 'camera_1', columnIndex: 0 })).toBe('camera_lane_1')
  })

  it('copies semantic geometry and moves the overlap pivot with the pasted interval', () => {
    const created = createTimedRangeCue(createDefaultProject(), {
      role: 'camera',
      laneId: 'camera_lane_1',
      frameStart: 10,
      frameEnd: 20,
      label: 'OL',
      camera: { shape: 'overlap', startLabel: 'A', endLabel: 'B', pivotAnchorFrame: 14 },
    })
    const clipboard = buildCameraCueClipboard(created.project, {
      laneId: 'camera_lane_1', frameStart: 10, frameEnd: 20, mode: 'copy', cueId: created.cue.cueId,
    })
    expect(clipboard?.items[0]?.camera?.shape).toBe('overlap')
    const pasted = pasteCameraCueClipboard(created.project, clipboard!, { laneId: 'camera_lane_2', frameStart: 30 }, 'overwrite')
    expect(pasted.project.timedRangeCues.at(-1)).toMatchObject({
      role: 'camera', laneId: 'camera_lane_2', frameStart: 30, frameEnd: 40,
      camera: { shape: 'overlap', pivotAnchorFrame: 34 },
    })
  })
})
