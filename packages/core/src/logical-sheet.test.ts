import { describe, expect, it } from 'vitest'
import {
  buildExportPlan, createDefaultProject, createOrSetEvent, createTimedRangeCue,
  logicalSheetDisplayDurationFrames, logicalSheetDisplayFrameEnd, logicalSheetDisplayFrameStart,
  migrateProject, normalizeLogicalSheetWorkRange, updateLogicalSheetSettings, upsertBinding, validateProject,
} from './index'

describe('dummy frame visibility', () => {
  it.each([
    [false, false, 73, 216, 144], [true, false, 49, 216, 168],
    [false, true, 73, 240, 168], [true, true, 49, 240, 192],
  ])('keeps pre-roll %s and post-roll %s independent', (showPreRoll, showPostRoll, start, end, duration) => {
    const project = updateLogicalSheetSettings(createDefaultProject(), {
      frameOrigin: 73,
      workRange: { preRollFrames: 24, postRollFrames: 24, showPreRoll, showPostRoll },
    })
    expect(logicalSheetDisplayFrameStart(project.logicalSheet)).toBe(start)
    expect(logicalSheetDisplayFrameEnd(project.logicalSheet)).toBe(end)
    expect(logicalSheetDisplayDurationFrames(project.logicalSheet)).toBe(duration)
    expect(project.logicalSheet.durationFrames).toBe(144)
  })

  it('keeps legacy pushed-out frames visible when no visibility flag was stored', () => {
    expect(normalizeLogicalSheetWorkRange({ postRollFrames: 12 })).toMatchObject({ postRollFrames: 12, showPostRoll: true })
  })

  it('retains hidden dummy timing and cues through serialization without invalidating export', () => {
    let project = updateLogicalSheetSettings(createDefaultProject(), {
      workRange: { preRollFrames: 24, postRollFrames: 24, showPreRoll: true, showPostRoll: true },
    })
    for (const frame of [-23, 1, 144, 168]) {
      const created = createOrSetEvent(project, 'A', frame, 'cell')
      project = upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: `A${frame}`, materialState: 'missing-ok' })
    }
    project = createTimedRangeCue(project, { role: 'sound', laneId: 'sound_lane_1', frameStart: 145, frameEnd: 168, label: 'tail' }).project
    project = updateLogicalSheetSettings(project, { workRange: { ...project.logicalSheet.workRange, showPreRoll: false, showPostRoll: false } })
    const restored = migrateProject(JSON.parse(JSON.stringify(project)))
    expect(restored.logicalSheet.workRange).toEqual(project.logicalSheet.workRange)
    expect(restored.logicalSheet.events).toEqual(project.logicalSheet.events)
    expect(restored.timedRangeCues).toEqual(project.timedRangeCues)
    expect(validateProject(restored).filter(issue => /(?:event|cue)\.frame\./.test(issue.code))).toEqual([])
    const direct = { ...restored, exportProfiles: [{ ...restored.exportProfiles[0]!, profileId: 'direct', mode: 'direct-to-visible-slots' as const }] }
    const plan = buildExportPlan(direct, { profileId: 'direct', timingSourceRole: 'cell' })
    expect(plan.durationFrames).toBe(144)
    expect(plan.tracks.find(track => track.slotId === 'slot_A')?.frames).toEqual([{ frame: 0, value: 'A1' }, { frame: 143, value: 'A144' }])
    const outside = createOrSetEvent(restored, 'B', 169, 'cell').project
    expect(validateProject(outside).some(issue => issue.code === 'event.frame.afterDuration')).toBe(true)
  })
})
