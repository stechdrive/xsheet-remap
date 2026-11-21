import { describe, expect, it } from 'vitest'
import { createProjectFromTrackLabels, standardA3SheetTemplate as base, withSheetTemplatePaperTracks, type CutProject } from '@xsheet-remap/core'
import { openSheetLink } from '@xsheet-remap/adapters'
import { withProjectSheetQr } from './projectSheetQr'
import { createSheetRenderModelContext } from './sheetRenderModel'
import { buildTemplateChromeRenderModel } from './templateEditorGeometry'

const names = Array.from('ABCDEFGHI'), template = withSheetTemplatePaperTracks(base, names)
function model(p: CutProject) {
  const ctx = createSheetRenderModelContext(p, template)
  const chrome = buildTemplateChromeRenderModel(template, ctx.paperTracks, ctx.displayDurationFrames, { timelineLanes: ctx.timelineLanes })
  return {
    top: chrome.branding!.qrRect, memo: chrome.formFields.find(f => f.fieldId === 'memo.body')!.rect,
    qr: (i: number) => withProjectSheetQr(chrome, ctx, p, ctx.pages[i]!).branding!
  }
}
function populated(from: number, to: number, randomText = false) {
  const p = createProjectFromTrackLabels(names, { template })
  p.logicalSheet.durationFrames = 288
  let state = 913852
  function next() {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state >>> 22
  }
  for (const paperTrack of names) for (const sheetRole of ['action', 'cell'] as const) {
    for (let frame = from; frame <= to; frame++) {
      const id = String(p.logicalSheet.keys.length)
      const label = randomText ? Array.from({ length: 12 }, () => String.fromCharCode(0x3400 + next())).join('') : String(next() % 64)
      p.logicalSheet.keys.push({ paperTrack, sheetRole, keyId: id, displayLabel: label, createdFrom: 'manual' })
      p.logicalSheet.events.push({ paperTrack, sheetRole, frame, keyId: id, valueKind: 'cell', eventId: id })
    }
  }
  return p
}

describe('QR placement and recovery on standard sheets', () => {
  it('only moves the crowded page, clears penned corners and never covers a filled memo', () => {
    const p = populated(145, 288), page = model(p)
    const small = page.qr(0), dense = page.qr(1)
    expect(small.qrRect.x).toBeGreaterThan(.92)
    expect(small.qrRect.y + small.qrRect.h).toBeLessThan(page.memo.y)
    expect(dense.qrRect.x).toBeGreaterThan(page.memo.x + page.memo.w / 2)
    expect(dense.qrRect.y).toBeGreaterThan(page.memo.y)
    expect(dense.qrRect.y + dense.qrRect.h).toBeLessThan(page.memo.y + page.memo.h)
    expect(openSheetLink(new URL(dense.url).hash).workspace!.project.logicalSheet.events).toHaveLength(144 * 18)
    const hit = { x: dense.qrRect.x + dense.qrRect.w / 2, y: dense.qrRect.y + dense.qrRect.h / 2 }
    p.memos = [{
      kind: 'page', target: { kind: 'page', pageId: 'page_2' }, memoId: 'p', order: 0, texts: [],
      strokes: [{ tool: 'pen', pageId: 'page_2', annotationId: 'p1', color: '#000', width: .001, points: [{ ...hit }] }]
    }]
    expect(model({ ...p }).qr(1).qrRect.x).toBeLessThan(dense.qrRect.x)
    if (p.memos[0]?.kind !== 'page') throw new Error('expected a page memo')
    p.memos[0].strokes[0]!.width = 2
    expect(model({ ...p }).qr(1)).toMatchObject({ url: '', warning: 'QR空き不足' })
  })

  it('reassembles two dense A–I ACTION/CEL pages in reverse order and retains every label', () => {
    const p = populated(1, 288), page = model(p), qr = [page.qr(0), page.qr(1)]
    const data = new Map<string, string>(), storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) } }
    expect(openSheetLink(new URL(qr[1]!.url).hash, storage).message).toContain('全2ページ中1ページ')
    const copy = openSheetLink(new URL(qr[0]!.url).hash, storage).workspace!.project
    const values = (project: CutProject) => {
      const keys = new Map(project.logicalSheet.keys.map(k => [k.keyId, k.displayLabel]))
      return project.logicalSheet.events.map(e => [e.frame, e.sheetRole, e.paperTrack, keys.get(e.keyId)].join('/')).sort()
    }
    expect(values(copy)).toEqual(values(p))
  })

  it('leaves a capacity notice when even the mandatory page exceeds a QR', () => {
    expect(model(populated(1, 144, true)).qr(0)).toMatchObject({ url: '', warning: 'QR容量超過' })
  })

  it('retains mandatory text and camera/sound ahead of optional MEMO text when space runs out', () => {
    const p = createProjectFromTrackLabels(names, { template })
    p.timedRangeCues = [{ cueId: 'line', role: 'sound', laneId: 'line', frameStart: 1, frameEnd: 18, label: '声', text: 'おはよう' }]
    const text = Array.from({ length: 7000 }, (_, i) => String.fromCharCode(0x3400 + (i * 7331) % 20011)).join('')
    p.cut.custom = { '補足': text }
    p.sheetFormData.pages.page_1 = { 'memo.body': { kind: 'text', value: '登場時の声' } }
    const qr = model(p).qr(0), opened = openSheetLink(new URL(qr.url).hash)
    expect(opened.workspace!.project.timedRangeCues[0]?.text).toBe('おはよう')
    expect(opened.message).toContain('補足文字')
  })
})
