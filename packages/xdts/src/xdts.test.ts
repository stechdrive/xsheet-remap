import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { buildExportPlan, createDefaultProject, createOrSetEvent, createTimedRangeCue, setTimingSpecialEvent, sheetTimingRoleForEvent, standardA3SheetTemplate, upsertBinding } from '@xsheet-remap/core'
import { DEFAULT_XDTS_IMPORT_OPTIONS, exportProjectXdts, exportXdts, importXdtsIntoProject, parseXdts, patchXdtsValue, resolveCellsAtFrameByTrackNo } from './index'

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
    const text = exportXdts(buildExportPlan(project, { profileId: 'direct' }))
    const parsed = parseXdts(text)
    expect(parsed.tracks[0]).toMatchObject({ name: 'A', trackNo: 0 })
    expect(parsed.tracks[0].frames[0]).toEqual({ frameIndex: 0, cellName: 'A1', valueKind: 'cell' })
  })

  it('writes project cut identity into the XDTS header and time table name', () => {
    const project = {
      ...createDefaultProject(),
      cut: { scene: '12', cut: '034' },
    }
    const text = exportXdts(buildExportPlan(project, {
      sheetTemplate: {
        ...standardA3SheetTemplate,
        naming: { cutNumberPrefix: 'C' },
      },
    }))
    const payload = JSON.parse(text.slice(text.indexOf('\n') + 1)) as {
      header: { cut: string; scene: string }
      timeTables: Array<{ name: string }>
    }

    expect(payload.header).toEqual({ cut: '034', scene: '12' })
    expect(payload.timeTables[0]?.name).toBe('12-C034')
    expect(parseXdts(text).timeTableName).toBe('12-C034')
  })

  it('patches a target frame', () => {
    const created = createOrSetEvent(createDefaultProject(), 'A', 1, 'action')
    const project = withDirectExportProfile(upsertBinding(created.project, { slotId: 'slot_A', keyId: created.key.keyId, cspCellName: 'A1', materialState: 'missing-ok' }))
    const patched = patchXdtsValue(exportXdts(buildExportPlan(project, { profileId: 'direct' })), 'A', 4, 'A2')
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

  it('ignores derived continuation symbols while preserving explicit timing symbols', () => {
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
                { "frame": 3, "data": [{ "values": ["SYMBOL_NULL_CELL"] }] },
                { "frame": 4, "data": [{ "values": ["SYMBOL_TICK_2"] }] }
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
      { frameIndex: 0, cellName: 'A1', valueKind: 'cell' },
      { frameIndex: 2, cellName: null, valueKind: 'inbetween' },
      { frameIndex: 3, cellName: null, valueKind: 'blank' },
      { frameIndex: 4, cellName: null, valueKind: 'reverse' },
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
          slotIds: ['slot_A'],
        },
      ],
    }
    const text = exportXdts(buildExportPlan(project, { profileId: 'single-a' }))
    const golden = readFixture('export-single-a.xdts')
    expect(text).toBe(golden)
  })

  it('keeps multiple tables and parses dialogue/camera ranges without flattening them', () => {
    const parsed = parseXdts(fullFieldFixture())
    expect(parsed.timeTables).toHaveLength(2)
    expect(parsed.timeTables[0]).toMatchObject({ name: 'main', duration: 24, fps: 24 })
    expect(parsed.timeTables[0]?.dialogueCues[0]).toMatchObject({
      fieldId: 3, trackNo: 0, frameStart: 2, frameEnd: 4, values: ['アキ', 'テストです'],
    })
    expect(parsed.timeTables[0]?.cameraCues[0]).toMatchObject({
      fieldId: 5, trackNo: 0, frameStart: 8, frameEnd: 9, values: ['OL', '0.5'],
    })
    expect(parsed.timeTables[1]?.tracks[0]?.frames[0]).toEqual({ frameIndex: 0, cellName: 'B1', valueKind: 'cell' })
  })

  it('round-trips null, inbetween, and reverse-sheet events without creating cell keys', () => {
    let project = createDefaultProject()
    project = setTimingSpecialEvent(project, 'A', 1, 'blank', 'action')
    project = setTimingSpecialEvent(project, 'A', 2, 'inbetween', 'action')
    project = setTimingSpecialEvent(project, 'A', 3, 'reverse', 'action')
    const parsed = parseXdts(exportXdts(buildExportPlan(withDirectExportProfile(project))))
    expect(parsed.tracks[0]?.frames.slice(0, 3)).toEqual([
      { frameIndex: 0, cellName: null, valueKind: 'blank' },
      { frameIndex: 1, cellName: null, valueKind: 'inbetween' },
      { frameIndex: 2, cellName: null, valueKind: 'reverse' },
    ])
    const imported = importXdtsIntoProject(createDefaultProject(), parsed, DEFAULT_XDTS_IMPORT_OPTIONS).project
    expect(imported.logicalSheet.events.slice(0, 3).map(event => event.valueKind)).toEqual(['blank', 'inbetween', 'reverse'])
    expect(imported.logicalSheet.keys).toHaveLength(0)
  })

  it('imports keys, SOUND and CAMERA as one complete project value', () => {
    const source = createDefaultProject()
    const parsed = parseXdts(fullFieldFixture())
    const result = importXdtsIntoProject(source, parsed, {
      ...DEFAULT_XDTS_IMPORT_OPTIONS,
      targetRole: 'cell',
      applyCutIdentity: true,
    })
    const importedEvent = result.project.logicalSheet.events.find(event => event.frame === source.logicalSheet.frameOrigin)
    const importedKey = result.project.logicalSheet.keys.find(key => key.keyId === importedEvent?.keyId)
    expect(importedKey?.displayLabel).toBe('A1')
    expect(importedEvent && sheetTimingRoleForEvent(importedEvent)).toBe('cell')
    expect(result.project.timedRangeCues).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'sound', label: 'アキ', text: 'テストです', source: 'import' }),
      expect.objectContaining({ role: 'camera', label: 'OL', camera: expect.objectContaining({ shape: 'overlap' }), source: 'import' }),
    ]))
    expect(result.project.cut).toMatchObject({ scene: '7', cut: '12' })
    expect(result.warnings.some(message => message.includes('CAMERA座標'))).toBe(true)
  })

  it('exports standalone SOUND/CAMERA fields while keeping cell-only export version 5', () => {
    let project = createDefaultProject()
    const soundLane = project.logicalSheet.timelineSections.find(section => section.role === 'sound')?.lanes?.[0]
    const cameraLane = project.logicalSheet.timelineSections.find(section => section.role === 'camera')?.lanes?.[0]
    expect(soundLane && cameraLane).toBeTruthy()
    project = createTimedRangeCue(project, {
      role: 'sound', laneId: soundLane!.laneId, frameStart: 1, frameEnd: 3, label: 'アキ', text: '台詞',
    }).project
    project = createTimedRangeCue(project, {
      role: 'camera', laneId: cameraLane!.laneId, frameStart: 4, frameEnd: 7, label: 'FI', camera: { shape: 'fade-in' },
    }).project
    const plan = buildExportPlan(project)
    expect(JSON.parse(exportXdts(plan).split('\n').slice(1).join('\n')).version).toBe(5)
    const defaultParsed = parseXdts(exportProjectXdts(plan, project))
    expect(defaultParsed.version).toBe(5)
    expect(defaultParsed.timeTables[0]?.dialogueCues).toEqual([])
    expect(defaultParsed.timeTables[0]?.cameraCues).toEqual([])
    const parsed = parseXdts(exportProjectXdts(plan, project, { includeSound: true, includeCamera: true }))
    expect(parsed.version).toBe(10)
    expect(parsed.timeTables[0]?.dialogueCues[0]).toMatchObject({ frameStart: 0, frameEnd: 2, values: ['アキ', '台詞'] })
    expect(parsed.timeTables[0]?.cameraCues[0]).toMatchObject({ frameStart: 3, frameEnd: 6, values: ['FI'] })
  })
})

function fullFieldFixture(): string {
  return `exchangeDigitalTimeSheet Save Data
{
  "version": 10,
  "header": { "cut": "12", "scene": "7" },
  "timeTables": [
    {
      "name": "main", "duration": 24, "frameRate": 24,
      "timeTableHeaders": [
        { "fieldId": 0, "names": ["A"] },
        { "fieldId": 3, "names": ["SOUND"] },
        { "fieldId": 5, "names": ["CAMERA"] }
      ],
      "fields": [
        { "fieldId": 0, "tracks": [{ "trackNo": 0, "frames": [{ "frame": 0, "data": [{ "values": ["A1"] }] }] }] },
        { "fieldId": 3, "tracks": [{ "trackNo": 0, "frames": [
          { "frame": 2, "data": [{ "values": ["アキ", "テストです"] }] },
          { "frame": 3, "data": [{ "values": ["SYMBOL_HYPHEN"] }] },
          { "frame": 4, "data": [{ "values": ["SYMBOL_HYPHEN"] }] }
        ] }] },
        { "fieldId": 5, "tracks": [{ "trackNo": 0, "frames": [
          { "frame": 8, "data": [{ "values": ["OL", "0.5"] }] },
          { "frame": 9, "data": [{ "values": ["SYMBOL_HYPHEN"] }] }
        ] }] }
      ]
    },
    {
      "name": "sub", "duration": 12, "frameRate": 24,
      "timeTableHeaders": [{ "fieldId": 0, "names": ["B"] }],
      "fields": [{ "fieldId": 0, "tracks": [{ "trackNo": 0, "frames": [{ "frame": 0, "data": [{ "values": ["B1"] }] }] }] }]
    }
  ]
}`
}

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
        slotIds: project.cspTrackSlots.map(slot => slot.slotId),
      },
    ],
  }
}
