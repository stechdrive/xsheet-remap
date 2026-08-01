import { describe, expect, it } from 'vitest'
import type { CutProject, PaperTrackName } from './types'
import { createDefaultProject } from './project-model'
import { createKey, setEvent, setTimingSpecialEvent, upsertBinding } from './project-timing'
import { updateLogicalSheetSettings } from './project-export'
import {
  buildAeKeyframeDataText,
  buildAeRemapJsx,
  buildAeRemapJsxConfig,
  buildAeRemapPlan,
  buildAeRemapText,
} from './ae-remap'
import AFTER_EFFECTS_TEMPLATE from './after-effects-template.generated'

describe('After Effects remap export', () => {
  it('builds one column per logical paper track instead of per CSP process slot', () => {
    const project = shortProject(24, 2)
    expect(project.cspTrackSlots.filter(slot => slot.paperTrack === 'A').length).toBeGreaterThan(1)

    const plan = buildAeRemapPlan(project, { paperTracks: ['A', 'A'] })
    expect(plan.columns.map(column => column.paperTrack)).toEqual(['A'])
  })

  it('maps one-based cel numbers and logical sheet frames to 24fps AE time', () => {
    let project = shortProject(24, 4)
    project = addCell(project, 'A', 1, '1')
    project = addCell(project, 'A', 3, '3')

    const plan = buildAeRemapPlan(project, { paperTracks: ['A'] })
    expect(plan).toMatchObject({
      compFps: 24,
      sourceFps: 24,
      frameOrigin: 1,
      durationFrames: 4,
      interpolation: 'hold',
      emptyCells: 'explicit',
      diagnostics: [],
    })
    expect(plan.columns[0].keys).toEqual([
      { sheetFrame: 1, compFrame: 0, kind: 'cell', cellNumber: 1 },
      { sheetFrame: 3, compFrame: 2, kind: 'cell', cellNumber: 3 },
    ])

    const text = buildAeKeyframeDataText(plan, 'A')
    expect(text.startsWith('Adobe After Effects 9.0 Keyframe Data\r\n')).toBe(true)
    expect(propertyRows(text, 'Time Remap')).toEqual([
      ['0', '0'],
      ['1', '0'],
      ['2', '0.0833333333'],
      ['3', '0.0833333333'],
    ])
    expect(text).not.toContain('Venetian Blinds')
  })

  it('keeps leading, middle, and trailing blanks explicit at 30fps', () => {
    let project = shortProject(30, 6)
    project = addCell(project, 'A', 2, '3')
    project = setTimingSpecialEvent(project, 'A', 4, 'blank', 'action')
    project = addCell(project, 'A', 5, '4')
    project = setTimingSpecialEvent(project, 'A', 6, 'blank', 'action')

    const plan = buildAeRemapPlan(project, { paperTracks: ['A', 'B'] })
    expect(plan.columns[0].keys).toEqual([
      { sheetFrame: 1, compFrame: 0, kind: 'empty', cellNumber: null },
      { sheetFrame: 2, compFrame: 1, kind: 'cell', cellNumber: 3 },
      { sheetFrame: 4, compFrame: 3, kind: 'empty', cellNumber: null },
      { sheetFrame: 5, compFrame: 4, kind: 'cell', cellNumber: 4 },
      { sheetFrame: 6, compFrame: 5, kind: 'empty', cellNumber: null },
    ])
    expect(plan.columns[1].keys).toEqual([
      { sheetFrame: 1, compFrame: 0, kind: 'empty', cellNumber: null },
    ])

    const aText = buildAeKeyframeDataText(plan, 'A')
    expect(aText).toContain('Effects\tブラインド #1\t変換終了 #2\t')
    expect(aText).toContain('\tFrame\tパーセント\r\n')
    expect(propertyRows(aText, 'Time Remap')).toEqual([
      ['0', '0'],
      ['1', '0.0666666667'],
      ['2', '0.0666666667'],
      ['3', '0.0666666667'],
      ['4', '0.1'],
      ['5', '0.1'],
    ])
    expect(effectRows(aText)).toEqual([
      ['0', '100'],
      ['1', '0'],
      ['2', '0'],
      ['3', '100'],
      ['4', '0'],
      ['5', '100'],
    ])

    const englishText = buildAeKeyframeDataText(plan, 'A', { locale: 'en' })
    expect(englishText).toContain('Effects\tVenetian Blinds #1\tTransition Completion #2\t')
    expect(englishText).toContain('\tFrame\tpercent\r\n')

    const emptyText = buildAeKeyframeDataText(plan, 'B')
    expect(propertyRows(emptyText, 'Time Remap')).toHaveLength(6)
    expect(effectRows(emptyText)).toEqual([
      ['0', '100'],
      ['1', '100'],
      ['2', '100'],
      ['3', '100'],
      ['4', '100'],
      ['5', '100'],
    ])
  })

  it('uses a binding trailing number only as a diagnosed fallback', () => {
    let project = shortProject(24, 2)
    const created = createKey(project, 'A', 'drawing', 'manual', undefined, 'action')
    project = setEvent(created.project, 'A', 1, created.key.keyId, 'action')
    project = upsertBinding(project, {
      slotId: 'slot_A',
      keyId: created.key.keyId,
      cspCellName: 'A_0012',
      materialState: 'assigned',
    })

    const plan = buildAeRemapPlan(project, {
      paperTracks: ['A'],
      preferredBindingSlotIdByPaperTrack: { A: 'slot_A' },
    })
    expect(plan.columns[0].keys[0]).toMatchObject({ kind: 'cell', cellNumber: 12 })
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'ae-remap.binding-number-fallback', value: 'drawing' }),
    ])
    expect(() => buildAeKeyframeDataText(plan, 'A')).not.toThrow()
    expect(buildAeRemapJsxConfig(plan).plan.columns).toHaveLength(1)
  })

  it('diagnoses non-numeric values and blocks lossy output', () => {
    let project = shortProject(24, 2)
    project = addCell(project, 'A', 1, 'not-a-cel')

    const plan = buildAeRemapPlan(project, { paperTracks: ['A'] })
    expect(plan.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'ae-remap.non-numeric-cell', value: 'not-a-cel' }),
    ])
    expect(() => buildAeKeyframeDataText(plan, 'A')).toThrow(/blocking diagnostic/)
    expect(() => buildAeRemapJsxConfig(plan)).toThrow(/no valid columns/)
  })

  it('keeps one-based cell numbers in JSX config for per-layer source frame-rate conversion', () => {
    let project = shortProject(24, 3)
    project = addCell(project, 'A', 1, '3')
    const plan = buildAeRemapPlan(project, { paperTracks: ['A'], sourceFps: 12 })
    const config = buildAeRemapJsxConfig(plan)

    expect(config.plan).toMatchObject({ compFps: 24, sourceFps: 12, durationFrames: 3 })
    expect(config.plan.columns[0].keys).toEqual([
      { frame: 0, empty: false, cellNumber: 3 },
    ])
    expect(config.plan.columns[0].keys[0]).not.toHaveProperty('value')
    expect(propertyRows(buildAeKeyframeDataText(plan, 'A'), 'Time Remap')[0]).toEqual(['0', '0.1666666667'])
  })

  it('omits only diagnostic-error columns from JSX while keeping clipboard export strict', () => {
    let project = shortProject(24, 3)
    project = addCell(project, 'A', 1, 'not-a-cel')
    project = addCell(project, 'B', 1, '2')
    const mixedPlan = buildAeRemapPlan(project, { paperTracks: ['A', 'B'] })

    expect(buildAeRemapJsxConfig(mixedPlan).plan.columns).toEqual([
      {
        id: 'B',
        name: 'B',
        keys: [{ frame: 0, empty: false, cellNumber: 2 }],
      },
    ])
    expect(() => buildAeRemapJsx(mixedPlan)).not.toThrow()
    expect(() => buildAeKeyframeDataText(mixedPlan, 'B')).toThrow(/blocking diagnostic/)

    const invalidOnlyPlan = buildAeRemapPlan(project, { paperTracks: ['A'] })
    expect(() => buildAeRemapJsxConfig(invalidOnlyPlan)).toThrow(/no valid columns/)
    expect(() => buildAeRemapJsx(invalidOnlyPlan)).toThrow(/no valid columns/)
  })

  it('uses each mapped layer source frame rate for remap values and source-duration validation', () => {
    let project = shortProject(24, 3)
    project = addCell(project, 'A', 1, '3')
    const jsx = buildAeRemapJsx(buildAeRemapPlan(project, { paperTracks: ['A'], sourceFps: 24 }))

    const twelveFps = executeAeJsx(jsx, { sourceFrameRate: 12, sourceDuration: 0.2 })
    expect(twelveFps.beginUndoGroups).toBe(1)
    expect(twelveFps.timeRemapValues[0]).toBeCloseTo(2 / 12)

    const fallbackFps = executeAeJsx(jsx, { sourceFrameRate: 0, sourceDuration: 0.1 })
    expect(fallbackFps.beginUndoGroups).toBe(1)
    expect(fallbackFps.timeRemapValues[0]).toBeCloseTo(2 / 24)

    const insufficientAtTwelveFps = executeAeJsx(jsx, { sourceFrameRate: 12, sourceDuration: 0.16 })
    expect(insufficientAtTwelveFps.beginUndoGroups).toBe(0)
    expect(insufficientAtTwelveFps.alerts.join('\n')).toContain('source duration')
    expect(insufficientAtTwelveFps.alerts.join('\n')).toContain(String(2 / 12))
  })

  it('blocks short comp/layer ranges and leaves long-comp in/out points and terminal state untouched', () => {
    let project = shortProject(24, 24)
    project = addCell(project, 'A', 1, '1')
    const plan = buildAeRemapPlan(project, { paperTracks: ['A'] })
    const jsx = buildAeRemapJsx(plan)

    const shortComp = executeAeJsx(jsx, { compDuration: 0.5, layerOutPoint: 2 })
    expect(shortComp.beginUndoGroups).toBe(0)
    expect(shortComp.alerts.join('\n')).toContain('active composition is shorter')

    const lateLayer = executeAeJsx(jsx, { compDuration: 2, layerInPoint: 0.1, layerOutPoint: 2 })
    expect(lateLayer.beginUndoGroups).toBe(0)
    expect(lateLayer.alerts.join('\n')).toContain('must already be visible from 0')

    const shortLayer = executeAeJsx(jsx, { compDuration: 2, layerOutPoint: 0.5 })
    expect(shortLayer.beginUndoGroups).toBe(0)
    expect(shortLayer.alerts.join('\n')).toContain('must already be visible from 0')

    const longComp = executeAeJsx(jsx, { compDuration: 2, layerInPoint: 0, layerOutPoint: 2 })
    expect(longComp.beginUndoGroups).toBe(1)
    expect(longComp.endUndoGroups).toBe(1)
    expect(longComp.timeRemapTimes).toEqual([0])
    expect(longComp.layerInPoint).toBe(0)
    expect(longComp.layerOutPoint).toBe(2)
    expect(longComp.dialogTexts.join('\n')).toContain('final cel/blank HOLD continues')
    expect(buildAeRemapJsxConfig(plan).plan.columns[0].keys).toEqual([
      { frame: 0, empty: false, cellNumber: 1 },
    ])
  })

  it('applies an all-blank column without requiring a time-remappable source', () => {
    const plan = buildAeRemapPlan(shortProject(24, 3), { paperTracks: ['B'] })
    const result = executeAeJsx(buildAeRemapJsx(plan), {
      layerName: 'B',
      hasSource: false,
      canSetTimeRemapEnabled: false,
    })

    expect(result.beginUndoGroups).toBe(1)
    expect(result.timeRemapValues).toEqual([])
    expect(result.blankValues).toEqual([100])
  })

  it('blocks a disabled or expression-modified managed blank effect before changing the layer', () => {
    const plan = buildAeRemapPlan(shortProject(24, 3), { paperTracks: ['B'] })
    const jsx = buildAeRemapJsx(plan)

    const disabled = executeAeJsx(jsx, {
      layerName: 'B',
      existingManagedBlankEffect: { enabled: false },
    })
    expect(disabled.beginUndoGroups).toBe(0)
    expect(disabled.alerts.join('\n')).toContain('managed blank effect is disabled')

    const expressed = executeAeJsx(jsx, {
      layerName: 'B',
      existingManagedBlankEffect: { expression: 'time > 0 ? 100 : 0' },
    })
    expect(expressed.beginUndoGroups).toBe(0)
    expect(expressed.alerts.join('\n')).toContain('completion has an expression')
  })

  it('blocks an expression-modified Time Remap before replacing its keys', () => {
    let project = shortProject(24, 3)
    project = addCell(project, 'A', 1, '1')
    const plan = buildAeRemapPlan(project, { paperTracks: ['A'] })
    const result = executeAeJsx(buildAeRemapJsx(plan), {
      existingTimeRemap: { expression: 'loopOut()' },
    })

    expect(result.beginUndoGroups).toBe(0)
    expect(result.alerts.join('\n')).toContain('existing Time Remap has an expression')
  })

  it('keeps inbetween and reverse markers as HOLD continuation with diagnostics', () => {
    let project = shortProject(24, 5)
    project = addCell(project, 'A', 1, '2')
    project = setTimingSpecialEvent(project, 'A', 2, 'inbetween', 'action')
    project = setTimingSpecialEvent(project, 'A', 3, 'reverse', 'action')
    project = setTimingSpecialEvent(project, 'A', 4, 'blank', 'action')

    const plan = buildAeRemapPlan(project, { paperTracks: ['A'] })
    expect(plan.columns[0].keys).toEqual([
      { sheetFrame: 1, compFrame: 0, kind: 'cell', cellNumber: 2 },
      { sheetFrame: 4, compFrame: 3, kind: 'empty', cellNumber: null },
    ])
    expect(plan.diagnostics.map(item => item.code)).toEqual([
      'ae-remap.special-hold',
      'ae-remap.special-hold',
    ])
  })

  it('builds one JSON-safe config and one shared interactive JSX template', () => {
    let project = shortProject(24, 3)
    project = addCell(project, 'A', 1, '1')
    const plan = buildAeRemapPlan(project, { paperTracks: ['A', 'B'] })
    const config = buildAeRemapJsxConfig(plan, { dialogTitle: 'Map\u2028Layers' })

    expect(config).toMatchObject({
      schema: 'xsheet-remap-after-effects-remap-v1',
      plan: { compFps: 24, sourceFps: 24, durationFrames: 3 },
      options: { dialogTitle: 'Map\u2028Layers' },
    })
    expect(JSON.parse(JSON.stringify(config))).toEqual(config)
    expect(AFTER_EFFECTS_TEMPLATE.split('__XSHEET_AE_CONFIG__')).toHaveLength(2)
    expect(AFTER_EFFECTS_TEMPLATE.split(/\r?\n/).slice(0, 4)).toContain('// xsheet-remap After Effects remap JSX v1')

    const jsx = buildAeRemapJsx(plan, { dialogTitle: 'Map\u2028Layers' })
    expect(jsx.split(/\r?\n/).slice(0, 4)).toContain('// xsheet-remap After Effects remap JSX v1')
    expect(jsx).not.toContain('__XSHEET_AE_CONFIG__')
    expect(jsx).toContain('Map\\u2028Layers')
    expect(jsx).toContain('comp.selectedLayers.length > 0 ? comp.selectedLayers : null')
    expect(jsx).toContain('Choose the logical sheet column for each After Effects layer.')
    expect(jsx).toContain('if (!columnHasCells(column)) return;')
    expect(jsx).toContain('if (maximumSeconds !== null)')
    expect(jsx).toContain('layer.source ? Number(layer.source.frameRate) : NaN')
    expect(jsx).toContain('return XSHEET_AE_PLAN.sourceFps;')
    expect(jsx).toContain('(cellNumber - 1) / sourceFrameRate')
    expect(jsx).toContain('sourceDuration <= maximumSeconds')
    expect(jsx).toContain('source duration (')
    expect(jsx).toContain('compDuration + VALIDATION_EPSILON_SECONDS < SHEET_DURATION_SECONDS')
    expect(jsx).toContain('layerInPoint > VALIDATION_EPSILON_SECONDS')
    expect(jsx).toContain('layerOutPoint + VALIDATION_EPSILON_SECONDS < SHEET_DURATION_SECONDS')
    expect(jsx).toContain('final cel/blank HOLD continues while the layer remains visible')
    expect(jsx).toContain('no in/out point or terminal blank is added')
    expect(jsx).toContain('return effects.property(MANAGED_BLANK_EFFECT_NAME);')
    expect(jsx).toContain('addProperty(ADBE_VENETIAN_BLINDS)')
    expect(jsx).toContain('Existing Time Remap or managed blank-effect data was found')
    expect(jsx).toContain('existingTimeRemap.expressionEnabled')
    expect(jsx).toContain('existingEffect.enabled === false')
    expect(jsx).toContain('existingBlankProperty.expressionEnabled')
    expect(jsx).toContain('property.setValueAtTime(times[i], values[i])')
    expect(jsx).not.toContain('property.setValuesAtTimes(times, values)')
    expect(jsx).toContain('KeyframeInterpolationType.HOLD')
    expect(jsx.match(/app\.beginUndoGroup/g)).toHaveLength(1)
    expect(jsx.match(/app\.endUndoGroup/g)).toHaveLength(1)
    expect(jsx).toMatch(/finally\s*\{\s*try\s*\{/)
    expect(jsx).not.toMatch(/\.enabled\s*=(?!=)/)
    expect(jsx).not.toContain('.remove()')
    expect(jsx).not.toContain('.inPoint =')
    expect(jsx).not.toContain('.outPoint =')
    expect(jsx).not.toContain('precompose')
    expect(() => new Function(jsx)).not.toThrow()

    expect(config.plan.columns[1]).toEqual({
      id: 'B',
      name: 'B',
      keys: [{ frame: 0, empty: true, cellNumber: null }],
    })
    expect(config.plan.columns[0].keys).toEqual([
      { frame: 0, empty: false, cellNumber: 1 },
    ])
  })

  it('keeps buildAeRemapText as a canonical single-slot wrapper', () => {
    let project = shortProject(24, 2)
    project = addCell(project, 'A', 1, '1')
    expect(buildAeRemapText(project, 'slot_A')).toContain('Adobe After Effects 9.0 Keyframe Data')
  })
})

function shortProject(fps: number, durationFrames: number): CutProject {
  return updateLogicalSheetSettings(createDefaultProject(), { fps, durationFrames })
}

function addCell(project: CutProject, paperTrack: PaperTrackName, frame: number, displayLabel: string): CutProject {
  const created = createKey(project, paperTrack, displayLabel, 'manual', undefined, 'action')
  return setEvent(created.project, paperTrack, frame, created.key.keyId, 'action')
}

function propertyRows(text: string, propertyName: string): string[][] {
  const lines = text.split('\r\n')
  const start = lines.indexOf(propertyName)
  if (start < 0) return []
  const result: string[][] = []
  for (let index = start + 2; index < lines.length && lines[index] !== ''; index += 1) {
    result.push(lines[index].split('\t').filter(Boolean))
  }
  return result
}

function effectRows(text: string): string[][] {
  const lines = text.split('\r\n')
  const start = lines.findIndex(line => line.startsWith('Effects\t'))
  if (start < 0) return []
  const result: string[][] = []
  for (let index = start + 2; index < lines.length && lines[index] !== ''; index += 1) {
    result.push(lines[index].split('\t').filter(Boolean))
  }
  return result
}

interface ExecuteAeJsxOptions {
  compDuration?: number
  compFrameRate?: number
  layerName?: string
  layerInPoint?: number
  layerOutPoint?: number
  hasSource?: boolean
  sourceFrameRate?: number
  sourceDuration?: number
  canSetTimeRemapEnabled?: boolean
  existingTimeRemap?: {
    expression?: string
    expressionEnabled?: boolean
  }
  existingManagedBlankEffect?: {
    enabled?: boolean
    expression?: string
    expressionEnabled?: boolean
  }
}

function executeAeJsx(script: string, options: ExecuteAeJsxOptions = {}) {
  class FakeAnimatedProperty {
    numKeys = 0
    times: number[] = []
    values: number[] = []
    expression = ''
    expressionEnabled = false

    constructor(private readonly requiresExistingKey = false) {}

    seed(times: number[], values: number[]) {
      this.times = times.slice()
      this.values = values.slice()
      this.numKeys = this.times.length
    }

    removeKey(index: number) {
      this.times.splice(index - 1, 1)
      this.values.splice(index - 1, 1)
      this.numKeys = this.times.length
    }

    setValueAtTime(time: number, value: number) {
      if (this.requiresExistingKey && this.numKeys === 0) {
        throw new Error('hidden property')
      }
      const existingIndex = this.times.findIndex(existingTime => Math.abs(existingTime - time) < 0.000001)
      if (existingIndex >= 0) {
        this.values[existingIndex] = value
      } else {
        this.times.push(time)
        this.values.push(value)
        const pairs = this.times.map((keyTime, index) => ({ time: keyTime, value: this.values[index] }))
          .sort((left, right) => left.time - right.time)
        this.times = pairs.map(pair => pair.time)
        this.values = pairs.map(pair => pair.value)
      }
      this.numKeys = this.times.length
    }

    keyTime(index: number) {
      return this.times[index - 1]
    }

    setInterpolationTypeAtKey() {
      // The template only needs this method to exist in the AE test double.
    }
  }

  class FakeEffect {
    name = ''
    enabled = true
    readonly completion = new FakeAnimatedProperty()

    constructor(readonly matchName: string) {}

    property() {
      return this.completion
    }
  }

  class FakeEffectParade {
    effect: FakeEffect | null = null

    property(name: string) {
      return this.effect?.name === name ? this.effect : null
    }

    addProperty(matchName: string) {
      this.effect = new FakeEffect(matchName)
      return this.effect
    }
  }

  class FakeAVLayer {
    name = options.layerName ?? 'A'
    locked = false
    canSetTimeRemapEnabled = options.canSetTimeRemapEnabled ?? true
    private timeRemapEnabledValue = false
    selected = true
    inPoint = options.layerInPoint ?? 0
    outPoint = options.layerOutPoint ?? 1
    source = options.hasSource === false
      ? null
      : { frameRate: options.sourceFrameRate ?? 24, duration: options.sourceDuration ?? 1 }
    readonly timeRemap = new FakeAnimatedProperty(true)
    readonly effects = new FakeEffectParade()

    get timeRemapEnabled() {
      return this.timeRemapEnabledValue
    }

    set timeRemapEnabled(value: boolean) {
      if (value === this.timeRemapEnabledValue) return
      this.timeRemapEnabledValue = value
      if (value) {
        const sourceFrameRate = this.source?.frameRate ?? 24
        this.timeRemap.seed(
          [0, Math.max(0, this.outPoint - 1 / sourceFrameRate)],
          [0, Math.max(0, this.outPoint - 1 / sourceFrameRate)],
        )
      } else {
        this.timeRemap.seed([], [])
      }
    }

    property(matchName: string) {
      if (matchName === 'ADBE Time Remapping') return this.timeRemap
      if (matchName === 'ADBE Effect Parade') return this.effects
      return null
    }
  }

  const layer = new FakeAVLayer()
  if (options.existingTimeRemap) {
    layer.timeRemapEnabled = true
    layer.timeRemap.expression = options.existingTimeRemap.expression ?? ''
    layer.timeRemap.expressionEnabled = options.existingTimeRemap.expressionEnabled ?? false
  }
  if (options.existingManagedBlankEffect) {
    const effect = layer.effects.addProperty('ADBE Venetian Blinds')
    effect.name = 'XSHEET Remap Blank'
    effect.enabled = options.existingManagedBlankEffect.enabled ?? true
    effect.completion.expression = options.existingManagedBlankEffect.expression ?? ''
    effect.completion.expressionEnabled = options.existingManagedBlankEffect.expressionEnabled ?? false
  }

  class FakeCompItem {
    duration = options.compDuration ?? 1
    frameRate = options.compFrameRate ?? 24
    selectedLayers = [layer]
    numLayers = 1

    layer() {
      return layer
    }
  }

  const dialogTexts: string[] = []

  class FakeDropdown {
    private selectedItem: { index: number } | null = null

    get selection() {
      return this.selectedItem
    }

    set selection(value: number | { index: number } | null) {
      this.selectedItem = typeof value === 'number' ? { index: value } : value
    }
  }

  class FakeWindow {
    add(kind: string, _bounds?: unknown, value?: unknown): FakeWindow | FakeDropdown | Record<string, never> {
      if (kind === 'statictext' && typeof value === 'string') dialogTexts.push(value)
      if (kind === 'group') return new FakeWindow()
      if (kind === 'dropdownlist') return new FakeDropdown()
      return {}
    }

    show() {
      return 1
    }
  }

  const comp = new FakeCompItem()
  const alerts: string[] = []
  let beginUndoGroups = 0
  let endUndoGroups = 0
  const app = {
    project: { activeItem: comp },
    beginUndoGroup: () => { beginUndoGroups += 1 },
    endUndoGroup: () => { endUndoGroups += 1 },
  }
  const run = new Function(
    'app',
    'CompItem',
    'AVLayer',
    'Window',
    'KeyframeInterpolationType',
    'alert',
    'confirm',
    script,
  )
  run(
    app,
    FakeCompItem,
    FakeAVLayer,
    FakeWindow,
    { HOLD: 'hold' },
    (message: unknown) => alerts.push(String(message)),
    () => true,
  )

  return {
    alerts,
    beginUndoGroups,
    endUndoGroups,
    timeRemapTimes: layer.timeRemap.times,
    timeRemapValues: layer.timeRemap.values,
    blankValues: layer.effects.effect?.completion.values ?? [],
    layerInPoint: layer.inPoint,
    layerOutPoint: layer.outPoint,
    dialogTexts,
  }
}
