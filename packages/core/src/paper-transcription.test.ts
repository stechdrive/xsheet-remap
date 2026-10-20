import { readFileSync } from 'node:fs'
import Ajv2020 from 'ajv/dist/2020'
import { describe, expect, it } from 'vitest'
import {
  createDefaultProject, createKey, setEvent, setTimingSpecialEvent, upsertBinding,
  createProjectHistory, commitHistory, undoHistory, redoHistory, standardA3SheetTemplate,
  assertPaperTranscriptionContext, createPaperTranscriptionRequest, paperTranscriptionUnreadResult,
  parsePaperTranscription, planPaperTranscriptionImport, paperTranscriptionResponseSchema,
  type CutProject, type PaperTranscriptionRequest, type PaperTranscriptionResult, type PaperTranscriptionRun,
} from './index'
import { readPaperTranscriptionJson } from './paper-transcription-json'
import { paperTranscriptionSchemaErrors } from './paper-transcription-schema'

const template = standardA3SheetTemplate
function request(project = createDefaultProject(), from = 1, to = 6, roles: ('action' | 'cell')[] = ['cell']) {
  return createPaperTranscriptionRequest(project, template, 'cut:revision', { from, to, roles, columns: ['A'] }, 'test-request')
}
function response(req: PaperTranscriptionRequest, runs: PaperTranscriptionRun[]): PaperTranscriptionResult {
  return { ...paperTranscriptionUnreadResult(req), targets: req.targets.map(target => ({ targetId: target.targetId, runs })) }
}
const mark = (frame: number, value = '001'): PaperTranscriptionRun => ({ from: frame, to: frame, kind: 'cell', value, raw: value })
const empty = (from: number, to: number): PaperTranscriptionRun => ({ from, to, kind: 'empty', raw: '' })
function apply(project: CutProject, req: PaperTranscriptionRequest, result: PaperTranscriptionResult, replaceExisting = false, targetIds = req.targets.map(target => target.targetId)) {
  return planPaperTranscriptionImport(project, template, 'cut:revision', req, result, { targetIds, replaceExisting })
}
function cell(project: CutProject, frame: number, label = '009') {
  const created = createKey(project, 'A', label, 'manual', label, 'cell')
  return { key: created.key, project: setEvent(created.project, 'A', frame, created.key.keyId, 'cell') }
}

describe('paper transcription request geometry', () => {
  it('maps both paper blocks and the next page to distinct absolute frames', () => {
    const project = createDefaultProject()
    project.logicalSheet.durationFrames = 288
    const req = request(project, 70, 148, ['action', 'cell'])
    expect(req.targets.map(({ role, pageNumber, from, to, firstRow }) => [role, pageNumber, from, to, firstRow])).toEqual([
      ['action', 1, 70, 72, 70], ['cell', 1, 70, 72, 70],
      ['action', 1, 73, 144, 1], ['cell', 1, 73, 144, 1],
      ['action', 2, 145, 148, 1], ['cell', 2, 145, 148, 1],
    ])
    for (const target of req.targets) {
      expect(target.rect.y + target.rect.h).toBeLessThanOrEqual(1)
      expect(target.rect.w).toBeGreaterThan(0)
    }
  })
  it('uses actual column width overrides and rejects stale geometry, context and image assignment', () => {
    const project = createDefaultProject(), req = request(project)
    const next = structuredClone(project)
    next.sheetView.layoutOverrides = { grids: { left_cell_grid: { columnWidthsPx: { A: 80 } } } }
    expect(request(next).targets[0]!.rect).not.toEqual(req.targets[0]!.rect)
    expect(() => assertPaperTranscriptionContext(req, next, template, 'cut:revision')).toThrow('変わって')
    expect(() => assertPaperTranscriptionContext(req, project, template, 'other:revision')).toThrow('変わって')
    next.sheetView = { ...project.sheetView, pages: [{ pageId: 'page_1', sourceId: 'other-scan', alignment: {} as never }] }
    expect(() => assertPaperTranscriptionContext(req, next, template, 'cut:revision')).toThrow('変わって')
  })
  it('fails instead of silently dropping a requested field absent from the template', () => {
    const withoutCell = { ...template, regions: template.regions.filter(region => !region.regionId.includes('cell_grid')) }
    expect(() => createPaperTranscriptionRequest(createDefaultProject(), withoutCell, 'cut:revision',
      { from: 1, to: 6, roles: ['action', 'cell'], columns: ['A'] }, 'r')).toThrow('CELL A列')
  })
  it('tells the reader the actual printed column heading independently of the destination track ID', () => {
    const named = structuredClone(template)
    const region = named.regions.find(region => region.regionId === 'left_cell_grid')!
    if (region.type !== 'exposure-grid' || !region.grid) throw new Error('expected exposure grid')
    region.grid.trackProjection = undefined
    region.grid.columns[0]!.label = '顔'
    const req = createPaperTranscriptionRequest(createDefaultProject(), named, 'cut:revision',
      { from: 1, to: 6, roles: ['cell'], columns: ['A'] }, 'r')
    expect(req.targets[0]).toMatchObject({ column: 'A', columnLabel: '顔' })
  })
})

describe('paper transcription external JSON contract', () => {
  it('keeps the distributed schema and CSP-safe validation equivalent to standard JSON Schema', () => {
    expect(JSON.parse(readFileSync(new URL('../../../schemas/paper-transcription-v1.schema.json', import.meta.url), 'utf8'))).toEqual(paperTranscriptionResponseSchema)
    const validate = new Ajv2020({ strict: true }).compile(paperTranscriptionResponseSchema)
    const good = response(request(), [mark(1), empty(2, 6)])
    const cases: unknown[] = [good, paperTranscriptionUnreadResult(request()), null, [],
      { ...good, version: 2 }, { ...good, extra: true },
      { ...good, targets: [{ targetId: 't001', runs: [{ ...mark(1), value: 1 }] }] },
      { ...good, targets: [{ targetId: 't001', runs: [{ ...mark(1), value: '😀'.repeat(100) }] }] },
      { ...good, targets: [{ targetId: 't001', runs: [{ from: 1, to: 6, kind: 'uncertain', raw: '？' }] }] },
      { ...good, targets: [{ targetId: 't001', runs: [{ ...mark(1), from: Number.MAX_SAFE_INTEGER + 1 }] }] },
    ]
    for (const value of cases) expect(paperTranscriptionSchemaErrors(value).length === 0).toBe(Boolean(validate(value)))
  })
  it('accepts a whole fenced JSON answer and rejects duplicated keys, truncation and extra prose', () => {
    const req = request(), good = response(req, [mark(1), empty(2, 6)])
    expect(parsePaperTranscription('\uFEFF```json\n' + JSON.stringify(good) + '\n```', req)).toEqual(good)
    for (const text of ['{"a":1,"\\u0061":2}', '{"a":1,}', '{"a":', '[1,]', '回答です {}', '{} {}', '1e999']) {
      expect(() => readPaperTranscriptionJson(text)).toThrow()
    }
    expect(() => readPaperTranscriptionJson('['.repeat(40) + '0' + ']'.repeat(40))).toThrow('深すぎ')
    expect(() => readPaperTranscriptionJson(' '.repeat(2_000_001))).toThrow('2,000,000')
    expect(Object.getPrototypeOf(readPaperTranscriptionJson('{"__proto__":1}'))).toBeNull()
  })
  it('requires every requested frame and target exactly once, without coercing or inventing values', () => {
    const req = request()
    const invalidRuns = [
      [mark(1), empty(3, 6)], [mark(1), empty(1, 6)], [mark(1), empty(2, 7)],
      [mark(1)], [{ ...mark(1), to: 6 }], [{ ...empty(1, 6), raw: '縦線' }],
      [{ from: 1, to: 6, kind: 'uncertain' as const, raw: '', note: '?', frameCandidates: [7] }],
      [mark(1, 'X'), empty(2, 6)], [mark(1, ' 001'), empty(2, 6)],
    ]
    for (const runs of invalidRuns) expect(() => parsePaperTranscription(JSON.stringify(response(req, runs)), req)).toThrow()
    const good = response(req, [mark(1), empty(2, 6)])
    for (const bad of [{ ...good, requestId: 'other' }, { ...good, targets: [] },
      { ...good, targets: [...good.targets, ...good.targets] },
      { ...good, targets: [{ ...good.targets[0], targetId: 'unknown' }] }]) {
      expect(() => parsePaperTranscription(JSON.stringify(bad), req)).toThrow()
    }
  })
})

describe('paper transcription atomic import', () => {
  it('keeps literal labels, separate roles, material names, and one-step undo/redo', () => {
    const registered = cell(createDefaultProject(), 12, '001')
    const project = upsertBinding(registered.project, { slotId: 'slot_A', keyId: registered.key.keyId, cspCellName: 'A_001', materialState: 'unassigned' })
    const req = request(project, 1, 6, ['action', 'cell'])
    const result = response(req, [mark(1), { from: 2, to: 6, kind: 'hold', raw: '縦線' }])
    const plan = apply(project, req, result)
    expect(plan.recordedMarks).toBe(2)
    expect(plan.boundaryMarks).toBe(2)
    expect(plan.project.logicalSheet.keys.map(key => [key.sheetRole, key.displayLabel])).toEqual([['cell', '001'], ['action', '001']])
    expect(plan.project.bindings).toBe(project.bindings)
    expect(plan.project.assets).toBe(project.assets)
    expect(plan.project.logicalSheet.events.find(event => event.frame === 1 && event.sheetRole === 'cell')!.keyId).toBe(registered.key.keyId)
    const history = commitHistory(createProjectHistory(project), plan.project)
    expect(undoHistory(history).present).toEqual(project)
    expect(redoHistory(undoHistory(history)).present).toEqual(plan.project)
    expect(apply(plan.project, req, result).changed).toBe(false)
  })
  it('requires explicit overwrite and restores exposure immediately beyond the reviewed range', () => {
    const first = cell(createDefaultProject(), 1)
    const project = setEvent(first.project, 'A', 4, first.key.keyId, 'cell'), req = request(project, 3, 6)
    const result = response(req, [mark(3, '005'), empty(4, 6)])
    expect(() => apply(project, req, result)).toThrow('既存')
    const plan = apply(project, req, result, true)
    expect(plan.replacedMarks).toBe(1)
    expect(plan.project.logicalSheet.events.find(event => event.frame === 1)).toEqual(project.logicalSheet.events[0])
    expect(plan.project.logicalSheet.events.find(event => event.frame === 7)?.keyId).toBe(first.key.keyId)
    expect(project.logicalSheet.events.map(event => event.frame)).toEqual([1, 4])
    const blocked = setTimingSpecialEvent(project, 'A', 7, 'inbetween', 'cell')
    expect(() => apply(blocked, request(blocked, 3, 6), result, true)).toThrow('7Fの記号')
  })
  it('blocks unresolved selected targets but permits a fully reviewed subset', () => {
    const project = createDefaultProject(), req = request(project, 1, 6, ['action', 'cell'])
    const result = paperTranscriptionUnreadResult(req)
    result.targets[0]!.runs = [mark(1), empty(2, 6)]
    expect(() => apply(project, req, result)).toThrow('未読')
    const plan = apply(project, req, result, false, [req.targets[0]!.targetId])
    expect(plan.targets).toBe(1)
    expect(plan.project.logicalSheet.events.every(event => event.sheetRole === 'action')).toBe(true)
  })
  it('does not treat empty, explicit blank, or middle/reverse marks as a made-up cell', () => {
    const project = createDefaultProject(), req = request(project)
    expect(apply(project, req, response(req, [empty(1, 6)])).changed).toBe(false)
    expect(() => apply(project, req, response(req, [{ from: 1, to: 6, kind: 'hold', raw: '縦線' }]))).toThrow('継続元')
    const result = response(req, [mark(1),
      { from: 2, to: 2, kind: 'inbetween', raw: '○' },
      { from: 3, to: 3, kind: 'reverse', raw: '●' },
      { from: 4, to: 4, kind: 'blank', raw: '×' }, empty(5, 6)])
    const plan = apply(project, req, result)
    expect(plan.project.logicalSheet.keys).toHaveLength(1)
    expect(plan.project.logicalSheet.events.slice(0, 4).map(event => event.valueKind ?? 'cell')).toEqual(['cell', 'inbetween', 'reverse', 'blank'])
  })
})
