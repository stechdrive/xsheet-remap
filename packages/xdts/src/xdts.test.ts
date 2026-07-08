import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildExportPlan, createDefaultProject, createOrSetEvent, upsertBinding } from '@xsheet-remap/core'
import { exportXdts, parseXdts, patchXdtsValue, resolveCellsAtFrameByTrackNo } from './index'

describe('XDTS parse/export', () => {
  it('parses the public duplicate-name minimal fixture', () => {
    const text = readFixture('minimal.xdts')
    const parsed = parseXdts(text)
    expect(parsed.duration).toBe(24)
    expect(parsed.tracks.map(track => ({ name: track.name, trackNo: track.trackNo }))).toEqual([
      { name: 'A', trackNo: 0 },
      { name: 'A', trackNo: 1 },
    ])
    expect(resolveCellsAtFrameByTrackNo(parsed.tracks, 0).get(1)).toBeNull()
    expect(resolveCellsAtFrameByTrackNo(parsed.tracks, 4).get(1)).toBe('A1.5')
  })

  it('exports an ExportPlan and parses it back', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = withDirectExportProfile(upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' }))
    const text = exportXdts(buildExportPlan(project, 'direct'))
    const parsed = parseXdts(text)
    expect(parsed.tracks[0]).toMatchObject({ name: 'A', trackNo: 0 })
    expect(parsed.tracks[0].frames[0]).toEqual({ frameIndex: 0, cellName: 'A1' })
  })

  it('patches a target frame', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = withDirectExportProfile(upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' }))
    const patched = patchXdtsValue(exportXdts(buildExportPlan(project, 'direct')), 'A', 4, 'A2')
    const parsed = parseXdts(patched)
    const resolved = resolveCellsAtFrameByTrackNo(parsed.tracks, 4)
    expect(resolved.get(0)).toBe('A2')
  })

  it('patches duplicate track names by explicit track number', () => {
    const text = readFixture('minimal.xdts')
    const patched = patchXdtsValue(text, 1, 8, 'A2_CORR')
    const parsed = parseXdts(patched)
    expect(resolveCellsAtFrameByTrackNo(parsed.tracks, 8).get(1)).toBe('A2_CORR')
    expect(resolveCellsAtFrameByTrackNo(parsed.tracks, 8).get(0)).toBe('A1')
  })

  it('ignores XDTS continuation symbols while preserving explicit null cells', () => {
    const text = `exchangeDigitalTimeSheet Save Data
{
  "version": 5,
  "header": { "cut": "1", "scene": "1" },
  "timeTables": [
    {
      "name": "timeline",
      "duration": 12,
      "frameRate": 24,
      "timeTableHeaders": [{ "fieldId": 0, "names": ["A"] }],
      "fields": [
        {
          "fieldId": 0,
          "tracks": [
            {
              "trackNo": 0,
              "frames": [
                { "frame": 0, "data": [{ "values": ["A1"] }] },
                { "frame": 1, "data": [{ "values": ["SYMBOL_HYPHEN"] }] },
                { "frame": 2, "data": [{ "values": ["SYMBOL_TICK_1"] }] },
                { "frame": 3, "data": [{ "values": ["SYMBOL_NULL_CELL"] }] }
              ]
            }
          ]
        }
      ]
    }
  ]
}
`
    expect(parseXdts(text).tracks[0].frames).toEqual([
      { frameIndex: 0, cellName: 'A1' },
      { frameIndex: 3, cellName: null },
    ])
  })

  it('matches the direct single-track golden fixture', () => {
    const first = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const second = createOrSetEvent(first.project, 'A', 5, 'action')
    const project = {
      ...second.project,
      exportProfiles: [
        {
          profileId: 'single-a',
          name: 'Single A',
          mode: 'direct-to-visible-slots' as const,
          timingSourceRole: 'action' as const,
          slotIds: ['slot_A'],
          includeDummySeparators: false,
        },
      ],
    }
    const text = exportXdts(buildExportPlan(project, 'single-a'))
    const golden = readFixture('export-single-a.xdts')
    expect(text).toBe(golden)
  })
})

function readFixture(fileName: string): string {
  return readFileSync(join(process.cwd(), 'fixtures', 'xdts', fileName), 'utf8')
}

function withDirectExportProfile(project: ReturnType<typeof createDefaultProject>) {
  return {
    ...project,
    exportProfiles: [
      {
        profileId: 'direct',
        name: 'Direct',
        mode: 'direct-to-visible-slots' as const,
        timingSourceRole: 'action' as const,
        slotIds: project.cspTrackSlots.map(slot => slot.slotId),
        includeDummySeparators: false,
      },
    ],
  }
}
