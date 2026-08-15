import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, digitalStandardSheetTemplate, projectSheetLayoutOptions, resolveSheetTemplateGridLayout, resolveSheetTemplatePageSize, standardA3SheetTemplate, type RecognitionCandidate } from '@xsheet-remap/core'
import { defaultSheetImageSettings } from './sheetImages'
import { deduplicateRecognitionCandidates, normalizeRecognitionLabel, recognizeSheetPages, type SheetOcrEngine } from './sheetRecognition'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('sheet recognition labels', () => {
  it('keeps supported handwritten labels and enclosure notation', () => {
    expect(normalizeRecognitionLabel(' １２ ')).toBe('12')
    expect(normalizeRecognitionLabel('①')).toBe('○1')
    expect(normalizeRecognitionLabel('△ ア')).toBe('△ア')
    expect(normalizeRecognitionLabel('㋐')).toBe('○ア')
    expect(normalizeRecognitionLabel('あ')).toBe('あ')
  })

  it('rejects slash and enclosure-only marks', () => {
    expect(normalizeRecognitionLabel('/')).toBeNull()
    expect(normalizeRecognitionLabel('／｜')).toBeNull()
    expect(normalizeRecognitionLabel('○')).toBeNull()
    expect(normalizeRecognitionLabel('ー')).toBeNull()
  })

  it('keeps only the highest-confidence candidate for each event target', () => {
    const candidate = (candidateId: string, confidence: number, frame = 3): RecognitionCandidate => ({
      candidateId,
      provider: 'grid-crop-ocr',
      engineId: 'test',
      pageId: 'page_1',
      sheetRole: 'cell',
      paperTrack: 'A',
      frame,
      rawText: '1',
      normalizedLabel: '1',
      confidence,
      bbox: { x: 0.1, y: 0.2, w: 0.01, h: 0.01 },
    })

    expect(deduplicateRecognitionCandidates([
      candidate('low', 0.6),
      candidate('high', 0.9),
      candidate('other-frame', 0.7, 4),
    ]).map(item => item.candidateId)).toEqual(['high', 'other-frame'])
  })

  it('processes every supplied page and globalizes page-local frames', async () => {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = standardA3SheetTemplate.page.widthPx
    sourceCanvas.height = standardA3SheetTemplate.page.heightPx
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '#fff',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    } as unknown as CanvasRenderingContext2D)

    const region = standardA3SheetTemplate.regions.find(item => item.regionId === 'left_cell_grid')
    if (!region) throw new Error('left CELL region not found')
    const layout = resolveSheetTemplateGridLayout(standardA3SheetTemplate, region)
    if (!layout) throw new Error('left CELL layout not found')
    const columnMargin = Math.min(...layout.columns.map(column => column.w)) * 0.15
    const crop = {
      x: layout.rect.x - columnMargin,
      y: layout.rect.y,
      w: layout.rect.w + columnMargin * 2,
      h: layout.frames.rowHeight * 13,
    }
    let calls = 0
    const engine: SheetOcrEngine = {
      id: 'mock-ocr',
      async recognize(canvas) {
        calls += 1
        if (calls !== 1 && calls !== 13) return []
        const targetX = layout.columns[0].x + layout.columns[0].w / 2
        const targetY = layout.rect.y + layout.frames.rowHeight / 2
        const x = ((targetX - crop.x) / crop.w) * canvas.width
        const y = ((targetY - crop.y) / crop.h) * canvas.height
        return [{ text: '①', confidence: 0.9, polygon: [[x - 4, y - 4], [x + 4, y - 4], [x + 4, y + 4], [x - 4, y + 4]] }]
      },
    }
    const progress: Array<[number, number]> = []
    const candidates = await recognizeSheetPages({
      template: standardA3SheetTemplate,
      pages: [
        { page: { pageId: 'page_1', pageIndex: 0, frameStart: 1, frameEnd: 144 }, imageUrl: 'unused', imageSettings: defaultSheetImageSettings(), correctedCanvas: sourceCanvas },
        { page: { pageId: 'page_2', pageIndex: 1, frameStart: 145, frameEnd: 288 }, imageUrl: 'unused', imageSettings: defaultSheetImageSettings(), correctedCanvas: sourceCanvas },
      ],
      sheetRole: 'cell',
      durationFrames: 288,
      frameOrigin: 1,
      engine,
      onProgress: (completed, total) => progress.push([completed, total]),
    })

    expect(candidates.map(candidate => [candidate.pageId, candidate.paperTrack, candidate.frame, candidate.normalizedLabel])).toEqual([
      ['page_1', 'A', 1, '○1'],
      ['page_2', 'A', 145, '○1'],
    ])
    expect(progress.at(-1)).toEqual([24, 24])
  })

  it('crops OCR tiles from the project-resolved digital layout', async () => {
    const project = createDefaultProject()
    const options = projectSheetLayoutOptions(project, digitalStandardSheetTemplate)
    const pageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, options.durationFrames, options)
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = pageSize.widthPx
    sourceCanvas.height = pageSize.heightPx
    const drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      fillStyle: '#fff',
      fillRect: vi.fn(),
      drawImage,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    } as unknown as CanvasRenderingContext2D)
    const region = digitalStandardSheetTemplate.regions.find(item => item.regionId === 'digital_cell_grid')!
    const layout = resolveSheetTemplateGridLayout(digitalStandardSheetTemplate, region, options)!
    const columnMargin = Math.min(...layout.columns.map(column => column.w)) * 0.15
    const page = createSheetPages(
      digitalStandardSheetTemplate,
      options.durationFrames ?? digitalStandardSheetTemplate.defaults.durationFrames,
      options.frameOrigin ?? digitalStandardSheetTemplate.defaults.frameOrigin,
    )[0]!
    const engine: SheetOcrEngine = { id: 'mock-ocr', recognize: async () => [] }

    await recognizeSheetPages({
      template: digitalStandardSheetTemplate,
      pages: [{ page, imageUrl: 'unused', imageSettings: defaultSheetImageSettings(), correctedCanvas: sourceCanvas }],
      sheetRole: 'cell',
      durationFrames: options.durationFrames ?? digitalStandardSheetTemplate.defaults.durationFrames,
      frameOrigin: options.frameOrigin ?? digitalStandardSheetTemplate.defaults.frameOrigin,
      paperTracks: options.paperTracks,
      timelineLanes: options.timelineLanes,
      layoutOverrides: options.layoutOverrides,
      engine,
    })

    expect(drawImage.mock.calls[0]?.[1]).toBeCloseTo((layout.rect.x - columnMargin) * sourceCanvas.width)
  })
})
