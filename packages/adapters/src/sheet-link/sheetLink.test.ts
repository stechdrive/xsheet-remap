import { describe, expect, it } from 'vitest'
import jsQR from 'jsqr'
import { createProjectFromTemplate, createSheetPages, standardA3SheetTemplate as template, timingSpecialMarkerKeyId } from '@xsheet-remap/core'
import { bytesFromDigits, digitsFromBytes, Reader, Writer } from './bytes'
import { sheetQrCandidates, sheetQrRuns, SHEET_LINK_PREFIX } from './index'
import { collectLinkSheet, selectLinkPage } from './model'
import { decodeSheetLink, encodeSheetLink } from './packet'
import { openSheetLink } from './restore'
import { readPoints, writePoints, type LinkPoint } from './timing'

describe('printed sheet links', () => {
  it('round-trips decimal blocks, incompressible values, holds and exact exceptions', () => {
    for (let n = 1; n < 50; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => i === 0 ? 0 : 255 - i)
      expect(bytesFromDigits(digitsFromBytes(bytes))).toEqual(bytes)
    }
    const groups: LinkPoint[][] = [
      [[-4, '001'], [1, 0], [7, 'x'], [12, 1], [14, '○'], [19, 2], [25, '●'], [40, ['中割✎', 'A-04']]],
      Array.from({ length: 144 }, (_, i) => [i * 2 + 3, String(i + 1)] as LinkPoint).filter((_, i) => i !== 19),
      Array.from({ length: 144 }, (_, i) => [i * 2 + Math.floor(i / 3), String(i + 1)]),
      Array.from({ length: 144 }, (_, i) => [1 + i, String((i * 31 + i * i) % 64)]),
    ]
    groups[1]![22]![1] = '例外'
    for (const [i, points] of groups.entries()) {
      const writer = new Writer()
      writePoints(writer, points, -4)
      expect(writer.bytes[0]).toBe(i)
      const reader = new Reader(writer.finish())
      expect(readPoints(reader, -4)).toEqual(points)
      reader.end()
    }
    expect(() => bytesFromDigits('999')).toThrow()
  })

  it('opens a populated cut from one independently decoded QR and focuses the scanned page', () => {
    const project = createProjectFromTemplate(template)
    Object.assign(project.cut, { title: '星空', episode: '03', scene: 'S7', cut: '002B' })
    Object.assign(project.logicalSheet, { fps: 30, durationFrames: 180, frameOrigin: -2 })
    project.logicalSheet.keys.push({ keyId: 'a', paperTrack: 'A', sheetRole: 'action', displayLabel: '原画①', paperToken: '001', createdFrom: 'manual' })
    project.logicalSheet.events.push({ eventId: 'a1', paperTrack: 'A', sheetRole: 'action', frame: -2, keyId: 'a', valueKind: 'cell' },
      { eventId: 'b2', paperTrack: 'B', sheetRole: 'cell', frame: 148, keyId: timingSpecialMarkerKeyId('blank'), valueKind: 'blank' })
    project.logicalSheet.referenceMarks = [{ paperTrack: 'A', sheetRole: 'action', frame: -2, shape: 'circle' }]
    project.timedRangeCues = [{
      cueId: 'c', role: 'camera', label: '寄り', text: '一気に', frameStart: 139, frameEnd: 155, laneId: 'camera-1',
      camera: { shape: 'range', startLabel: '引き', endLabel: '止め' }
    }]
    project.sheetFormData.pages.page_2 = { 'memo.body': { kind: 'text', value: '雲をゆっくり\n奥から' } }
    project.sheetFormData.production = { 'output.dpi': { kind: 'number', value: 150 }, 'checked': { kind: 'boolean', value: false } }
    project.memos.push({
      kind: 'page', memoId: 'memo', target: { kind: 'page', pageId: 'page_2' }, order: 0, strokes: [],
      texts: [{ annotationId: 'label', kind: 'text', pageId: 'page_2', text: '指示', fontSizePx: 18, color: '#101010', x: .1, y: .2 }]
    })
    const pages = createSheetPages(template, 180, -2), candidate = [...sheetQrCandidates(project, template, pages[1]!, 2)][0]![0]!
    const size = candidate.modules * 3, pixels = new Uint8ClampedArray(size * size * 4).fill(255)
    for (const run of sheetQrRuns(candidate)) for (let y = run.y * 3; y < (run.y + 1) * 3; y++) {
      for (let x = run.x * 3; x < (run.x + run.width) * 3; x++) pixels.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3)
    }
    const link = jsQR(pixels, size, size)!.data
    expect(link).toBe(SHEET_LINK_PREFIX + candidate.digits)
    const opened = openSheetLink(new URL(link).hash), copy = opened.workspace!.project
    expect(opened.message).toContain('全2ページ')
    expect(copy.cut).toMatchObject(project.cut)
    expect(copy.sheetView.activePageId).toBe('page_2')
    expect(copy.logicalSheet).toMatchObject({ fps: 30, frameOrigin: -2, durationFrames: 180, referenceMarks: project.logicalSheet.referenceMarks })
    expect(copy.logicalSheet.keys[0]).toMatchObject({ displayLabel: '原画①', paperToken: '001' })
    expect(copy.logicalSheet.events.map(e => [e.frame, e.sheetRole, e.valueKind])).toEqual([[-2, 'action', 'cell'], [148, 'cell', 'blank']])
    expect(copy.timedRangeCues[0]?.camera?.points?.map(p => p.label)).toEqual(['引き', '止め'])
    expect(copy.sheetFormData.pages).toEqual(project.sheetFormData.pages)
    expect(copy.sheetFormData.production).toEqual(project.sheetFormData.production)
    expect(copy.memos[0]?.texts?.[0]?.text).toBe('指示')
  })

  it('joins out-of-order page scans once, including a hold crossing a page, and isolates later editions', () => {
    const project = createProjectFromTemplate(template)
    project.logicalSheet.durationFrames = 300
    const source = collectLinkSheet(project, template)
    source.columns = [{ index: 0, points: [[8, 'A'], [146, 'B'], [299, 'C']], marks: [] }]
    const pages = createSheetPages(template, 300, 1)
    const scan = (n: number) => '#s=' + encodeSheetLink(selectLinkPage(source, pages[n]!, 3, false, 3))
    const cache = new Map<string, string>(), storage = { getItem: (k: string) => cache.get(k) ?? null, setItem: (k: string, v: string) => { cache.set(k, v) } }
    const fromSheet = (s: string) => openSheetLink(s, storage)
    expect(fromSheet(scan(1)).workspace!.project.logicalSheet.events.map(e => e.frame)).toEqual([8, 146])
    expect(fromSheet(scan(0)).message).toContain('全3ページ中2ページ')
    expect(fromSheet(scan(1)).message).toContain('全3ページ中2ページ')
    const done = fromSheet(scan(2))
    expect(done.message).toContain('全3ページを復元')
    expect(done.workspace!.project.logicalSheet.events.map(e => e.frame)).toEqual([8, 146, 299])
    source.group[0]! ^= 1
    expect(fromSheet(scan(2)).message).toContain('全3ページ中1ページ')
    const raw = bytesFromDigits(scan(0).slice(3))
    raw[4]! ^= 8
    expect(openSheetLink('#s=' + digitsFromBytes(raw)).workspace).toBeUndefined()
    expect(() => decodeSheetLink('0'.repeat(5482))).toThrow()
  })
})
