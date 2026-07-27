import { describe, expect, it } from 'vitest'
import {
  addOverlayPaperTrack,
  createDefaultProject,
  createOrSetEvent,
  createSheetPages,
  registerAsset,
  standardA3SheetTemplate,
  updateLogicalSheetSettings,
  upsertBinding,
} from '@xsheet-remap/core'
import { eventRectsForPage, eventRectsForPages, shouldSuppressRectUnderActiveOverlay } from './sheet-layers-hit-geometry'

describe('sheet event rectangle index', () => {
  it('routes standard events to their pages once while preserving labels and asset cues', () => {
    let project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 288 })
    const first = createOrSetEvent(project, 'A', 1, 'cell')
    const second = createOrSetEvent(first.project, 'B', 145, 'cell')
    const registered = registerAsset(
      second.project,
      { name: 'B145.png', path: 'B145.png' },
      { role: 'cell-material' },
    )
    project = upsertBinding(registered.project, {
      slotId: 'slot_B',
      keyId: second.key.keyId,
      cspCellName: 'B145',
      materialState: 'assigned',
      assetId: registered.asset.assetId,
    })
    const pages = createSheetPages(standardA3SheetTemplate, 288, 1)

    const indexed = eventRectsForPages(project, standardA3SheetTemplate, pages)

    expect(indexed.get('page_1')?.map(item => [item.event.frame, item.displayLabel, item.hasAssetBinding])).toEqual([
      [1, first.key.displayLabel, false],
    ])
    expect(indexed.get('page_2')?.map(item => [item.event.frame, item.displayLabel, item.hasAssetBinding])).toEqual([
      [145, second.key.displayLabel, true],
    ])
    expect(eventRectsForPage(project, standardA3SheetTemplate, pages[1]!)).toEqual(indexed.get('page_2'))
  })

  it('keeps overlay events visible when an overlay track is active', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      label: 'J',
      insertAfterPaperTrack: 'A',
      snapIndex: 0,
      sheetRole: 'cell',
    })
    const withStandardEvents = overlay.project.logicalSheet.paperTracks
      .filter(track => track.source !== 'overlay')
      .reduce((project, track) => createOrSetEvent(project, track.paperTrack, 1, 'cell').project, overlay.project)
    const overlaid = createOrSetEvent(withStandardEvents, 'J', 1, 'cell')
    const pages = createSheetPages(standardA3SheetTemplate, 144, 1)

    const indexed = eventRectsForPages(overlaid.project, standardA3SheetTemplate, pages, {
      activeOverlayPaperTrack: 'J',
    })

    expect(indexed.get('page_1')?.some(item => item.event.paperTrack === 'J')).toBe(true)
  })

  it('suppresses a covered standard cell without suppressing an overlay cell', () => {
    const overlay = addOverlayPaperTrack(createDefaultProject(), {
      paperTrack: 'J',
      label: 'J',
      insertAfterPaperTrack: 'A',
      snapIndex: 0,
      sheetRole: 'cell',
    })
    const standardTrack = overlay.project.logicalSheet.paperTracks.find(track => track.paperTrack === 'A')!
    const overlayTrack = overlay.project.logicalSheet.paperTracks.find(track => track.paperTrack === 'J')!
    const activeColumn = {
      regionId: 'test',
      rect: { x: 0.2, y: 0.1, w: 0.1, h: 0.8 },
      frames: { frameStart: 1, frameEnd: 144, rowCount: 144 },
      globalFrameStart: 1,
      globalFrameEnd: 144,
      slots: [],
      minX: 0.2,
      columnWidth: 0.1,
      snapCount: 0,
    }

    expect(shouldSuppressRectUnderActiveOverlay(
      standardTrack,
      { x: 0.25, y: 0.2, w: 0.05, h: 0.05 },
      activeColumn,
    )).toBe(true)
    expect(shouldSuppressRectUnderActiveOverlay(
      overlayTrack,
      { x: 0.25, y: 0.2, w: 0.05, h: 0.05 },
      activeColumn,
    )).toBe(false)
  })

  it('returns stable empty page buckets when a visible page has no events', () => {
    const project = updateLogicalSheetSettings(createDefaultProject(), { durationFrames: 288 })
    const pages = createSheetPages(standardA3SheetTemplate, 288, 1)

    const indexed = eventRectsForPages(project, standardA3SheetTemplate, pages)

    expect(Array.from(indexed.keys())).toEqual(['page_1', 'page_2'])
    expect(indexed.get('page_1')).toEqual([])
    expect(indexed.get('page_2')).toEqual([])
  })
})
