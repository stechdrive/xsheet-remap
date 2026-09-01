import type { CspCellNamePolicy, CutProject, PaperTrackName, SheetTimingRole, TimelineEvent } from './types'
import { DEFAULT_CSP_CELL_NAME_POLICY, DEFAULT_EXPORT_TIMING_ROLE } from './project-constants'
import { isNullLabel, sheetTimingRoleForEvent, timingEventValueKind } from './project-shared'
import AFTER_EFFECTS_TEMPLATE from './after-effects-template.generated'

export type AeRemapDiagnosticCode =
  | 'ae-remap.binding-number-fallback'
  | 'ae-remap.ambiguous-binding-cell-number'
  | 'ae-remap.missing-timing-key'
  | 'ae-remap.non-numeric-cell'
  | 'ae-remap.special-hold'

export interface AeRemapDiagnostic {
  severity: 'warning' | 'error'
  code: AeRemapDiagnosticCode
  message: string
  paperTrack: PaperTrackName
  sheetFrame: number
  keyId: string
  value?: string
}

export interface AeRemapKey {
  /** Logical sheet frame number, including the sheet frame origin. */
  sheetFrame: number
  /** Zero-based frame in the target After Effects composition. */
  compFrame: number
  kind: 'cell' | 'empty'
  /** One-based source cel number. Null when kind is empty. */
  cellNumber: number | null
}

export interface AeRemapColumn {
  columnId: string
  paperTrack: PaperTrackName
  name: string
  keys: AeRemapKey[]
}

export interface AeRemapPlan {
  compFps: number
  sourceFps: number
  frameOrigin: number
  durationFrames: number
  interpolation: 'hold'
  emptyCells: 'explicit'
  columns: AeRemapColumn[]
  diagnostics: AeRemapDiagnostic[]
}

export interface BuildAeRemapPlanOptions {
  paperTracks?: readonly PaperTrackName[]
  sheetRole?: SheetTimingRole
  sourceFps?: number
  /**
   * When a TimingKey display label is not numeric, the selected slot's binding
   * is checked first for a trailing cel number before the remaining bindings.
   */
  preferredBindingSlotIdByPaperTrack?: Readonly<Partial<Record<PaperTrackName, string>>>
}

export interface AeKeyframeDataOptions {
  afterEffectsVersion?: string
  /** Display-language-dependent property names used by AE Keyframe Data. */
  locale?: 'ja' | 'en'
  sourceWidth?: number
  sourceHeight?: number
  sourcePixelAspectRatio?: number
  compPixelAspectRatio?: number
}

export interface AeRemapJsxOptions {
  dialogTitle?: string
  undoGroupName?: string
  managedBlankEffectName?: string
}

export interface AeRemapJsxConfig {
  schema: 'xsheet-remap-after-effects-remap-v1'
  plan: {
    compFps: number
    /** Fallback when the mapped AE source does not expose a valid frame rate. */
    sourceFps: number
    /**
     * Covered sheet frames. JSX extends mapped footage layers to cover this
     * interval but emits no terminal key that would shorten a longer range.
     */
    durationFrames: number
    columns: Array<{
      id: string
      name: string
      keys: Array<
        | { frame: number; empty: true; cellNumber: null }
        | { frame: number; empty: false; cellNumber: number }
      >
    }>
  }
  options: {
    dialogTitle: string
    undoGroupName: string
    managedBlankEffectName: string
  }
}

interface ResolvedCellState {
  kind: 'cell' | 'empty'
  cellNumber: number | null
}

interface ResolveEventResult {
  state: ResolvedCellState | null
  diagnostics: AeRemapDiagnostic[]
}

const EMPTY_STATE: ResolvedCellState = {
  kind: 'empty',
  cellNumber: null,
}

export function buildAeRemapPlan(
  project: CutProject,
  options: BuildAeRemapPlanOptions = {},
): AeRemapPlan {
  const compFps = positiveFiniteNumber(project.logicalSheet.fps, 'composition fps')
  const sourceFps = positiveFiniteNumber(options.sourceFps ?? compFps, 'source fps')
  const sheetRole = options.sheetRole ?? DEFAULT_EXPORT_TIMING_ROLE
  const frameOrigin = project.logicalSheet.frameOrigin
  const durationFrames = Math.max(1, Math.trunc(project.logicalSheet.durationFrames))
  const requestedPaperTracks = uniquePaperTracks(
    options.paperTracks ?? project.logicalSheet.paperTracks.map(track => track.paperTrack),
  )
  if (requestedPaperTracks.length === 0) throw new Error('at least one paper track is required for AE remap export')

  const knownPaperTracks = new Set(project.logicalSheet.paperTracks.map(track => track.paperTrack))
  for (const paperTrack of requestedPaperTracks) {
    if (!knownPaperTracks.has(paperTrack)) throw new Error(`paperTrack not found: ${paperTrack}`)
  }

  const diagnostics: AeRemapDiagnostic[] = []
  const columns = requestedPaperTracks.map<AeRemapColumn>(paperTrack => {
    const columnDiagnostics: AeRemapDiagnostic[] = []
    const keys: AeRemapKey[] = [aeRemapKey(frameOrigin, 0, EMPTY_STATE)]
    const events = effectiveEventsForAeColumn(project, paperTrack, sheetRole, frameOrigin, durationFrames)

    for (const event of events) {
      const compFrame = event.frame - frameOrigin
      const resolved = resolveAeEvent(
        project,
        event,
        options.preferredBindingSlotIdByPaperTrack?.[paperTrack],
      )
      columnDiagnostics.push(...resolved.diagnostics)
      if (!resolved.state) continue
      appendAeRemapKey(keys, aeRemapKey(event.frame, compFrame, resolved.state))
    }

    diagnostics.push(...columnDiagnostics)
    const track = project.logicalSheet.paperTracks.find(item => item.paperTrack === paperTrack)
    return {
      columnId: paperTrack,
      paperTrack,
      name: track?.label.trim() || paperTrack,
      keys,
    }
  })

  return {
    compFps,
    sourceFps,
    frameOrigin,
    durationFrames,
    interpolation: 'hold',
    emptyCells: 'explicit',
    columns,
    diagnostics,
  }
}

/**
 * Builds Adobe After Effects Keyframe Data for one logical sheet column.
 * A key is emitted for every composition frame so integer-frame playback keeps
 * HOLD timing even though the clipboard format cannot encode interpolation.
 */
export function buildAeKeyframeDataText(
  plan: AeRemapPlan,
  columnId: string,
  options: AeKeyframeDataOptions = {},
): string {
  assertAeRemapPlanCanExport(plan)
  const column = plan.columns.find(item => item.columnId === columnId)
  if (!column) throw new Error(`AE remap column not found: ${columnId}`)

  const frames = expandAeRemapColumn(plan, column)
  const blankEffectLabels = aeBlankEffectLabels(options.locale ?? 'ja')
  const lines = [
    `Adobe After Effects ${options.afterEffectsVersion ?? '9.0'} Keyframe Data`,
    '',
    `\tUnits Per Second\t${formatAeNumber(plan.compFps)}`,
    `\tSource Width\t${positiveInteger(options.sourceWidth ?? 1920, 'source width')}`,
    `\tSource Height\t${positiveInteger(options.sourceHeight ?? 1080, 'source height')}`,
    `\tSource Pixel Aspect Ratio\t${formatAeNumber(positiveFiniteNumber(options.sourcePixelAspectRatio ?? 1, 'source pixel aspect ratio'))}`,
    `\tComp Pixel Aspect Ratio\t${formatAeNumber(positiveFiniteNumber(options.compPixelAspectRatio ?? 1, 'composition pixel aspect ratio'))}`,
    '',
    'Layer',
    'Time Remap',
    '\tFrame\tseconds\t',
  ]

  for (const frame of frames) {
    lines.push(`\t${frame.compFrame}\t${formatAeNumber(frame.sourceSeconds)}\t`)
  }
  lines.push('')

  if (frames.some(frame => frame.empty)) {
    lines.push(`Effects\t${blankEffectLabels.effect} #1\t${blankEffectLabels.completion} #2\t`)
    lines.push(`\tFrame\t${blankEffectLabels.unit}`)
    for (const frame of frames) {
      lines.push(`\t${frame.compFrame}\t${frame.empty ? 100 : 0}\t`)
    }
    lines.push('')
  }

  lines.push('End of Keyframe Data', '')
  return lines.join('\r\n')
}

/**
 * Backward-compatible project/slot wrapper. The old implementation returned a
 * private TSV; this now returns pasteable Adobe After Effects Keyframe Data.
 */
export function buildAeRemapText(
  project: CutProject,
  slotId: string,
  sheetRole: SheetTimingRole = DEFAULT_EXPORT_TIMING_ROLE,
  cspCellNamePolicy: CspCellNamePolicy = DEFAULT_CSP_CELL_NAME_POLICY,
): string {
  void cspCellNamePolicy
  const slot = project.cspTrackSlots.find(item => item.slotId === slotId)
  if (!slot) throw new Error(`slot not found: ${slotId}`)
  const plan = buildAeRemapPlan(project, {
    paperTracks: [slot.paperTrack],
    sheetRole,
    preferredBindingSlotIdByPaperTrack: { [slot.paperTrack]: slot.slotId },
  })
  return buildAeKeyframeDataText(plan, slot.paperTrack)
}

/**
 * Generates a self-contained ExtendScript with an interactive AE-layer to
 * logical-sheet-column mapper. It never pre-composes. Mapped footage layers
 * are time-remapped and extended to the covered sheet range when needed.
 * Existing managed Time Remap or blank-effect data is replaced only after a
 * single confirmation.
 */
export function buildAeRemapJsxConfig(
  plan: AeRemapPlan,
  options: AeRemapJsxOptions = {},
): AeRemapJsxConfig {
  const errorDiagnostics = plan.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  const invalidPaperTracks = new Set(errorDiagnostics.map(diagnostic => diagnostic.paperTrack))
  const validColumns = plan.columns.filter(column => !invalidPaperTracks.has(column.paperTrack))
  if (validColumns.length === 0) {
    const details = errorDiagnostics.map(diagnostic => diagnostic.message).join(' | ')
    throw new Error(`AE remap JSX has no valid columns${details ? `: ${details}` : ''}`)
  }
  return {
    schema: 'xsheet-remap-after-effects-remap-v1',
    plan: {
      compFps: plan.compFps,
      sourceFps: plan.sourceFps,
      durationFrames: plan.durationFrames,
      columns: validColumns.map(column => ({
        id: column.columnId,
        name: column.name,
        keys: column.keys.map(aeRemapJsxConfigKey),
      })),
    },
    options: {
      dialogTitle: options.dialogTitle ?? 'XSHEET Remap - Map Layers',
      undoGroupName: options.undoGroupName ?? 'Apply XSHEET Time Remap',
      managedBlankEffectName: options.managedBlankEffectName ?? 'XSHEET Remap Blank',
    },
  }
}

/**
 * Generates a self-contained ExtendScript with an interactive AE-layer to
 * logical-sheet-column mapper. It never pre-composes. Mapped footage layers
 * are time-remapped and extended to the covered sheet range when needed.
 * Existing managed Time Remap or blank-effect data is replaced only after a
 * single confirmation.
 */
export function buildAeRemapJsx(
  plan: AeRemapPlan,
  options: AeRemapJsxOptions = {},
): string {
  const placeholder = '__XSHEET_AE_CONFIG__'
  if (AFTER_EFFECTS_TEMPLATE.split(placeholder).length !== 2) {
    throw new Error('After Effects template must contain exactly one XSHEET config placeholder')
  }
  return AFTER_EFFECTS_TEMPLATE.replace(
    placeholder,
    safeJsLiteral(buildAeRemapJsxConfig(plan, options)),
  )
}

function effectiveEventsForAeColumn(
  project: CutProject,
  paperTrack: PaperTrackName,
  sheetRole: SheetTimingRole,
  frameOrigin: number,
  durationFrames: number,
): TimelineEvent[] {
  const frameEnd = frameOrigin + durationFrames - 1
  const matching = project.logicalSheet.events
    .filter(event => event.paperTrack === paperTrack && sheetTimingRoleForEvent(event) === sheetRole && event.frame <= frameEnd)
    .sort((a, b) => a.frame - b.frame || a.eventId.localeCompare(b.eventId))
  const official = matching.filter(event => event.frame >= frameOrigin)
  if (official[0]?.frame === frameOrigin) return official
  const carry = matching.filter(event => event.frame < frameOrigin).at(-1)
  return carry ? [{ ...carry, frame: frameOrigin }, ...official] : official
}

function resolveAeEvent(
  project: CutProject,
  event: TimelineEvent,
  preferredBindingSlotId: string | undefined,
): ResolveEventResult {
  const valueKind = timingEventValueKind(event)
  if (valueKind === 'blank') return { state: EMPTY_STATE, diagnostics: [] }
  if (valueKind === 'inbetween' || valueKind === 'reverse') {
    return {
      state: null,
      diagnostics: [{
        severity: 'warning',
        code: 'ae-remap.special-hold',
        message: `${event.paperTrack} F${event.frame}: ${valueKind} is not a source cel and keeps the previous AE remap value.`,
        paperTrack: event.paperTrack,
        sheetFrame: event.frame,
        keyId: event.keyId,
        value: valueKind,
      }],
    }
  }

  const key = project.logicalSheet.keys.find(item => item.keyId === event.keyId)
  if (!key) {
    return {
      state: null,
      diagnostics: [{
        severity: 'error',
        code: 'ae-remap.missing-timing-key',
        message: `${event.paperTrack} F${event.frame}: TimingKey ${event.keyId} was not found.`,
        paperTrack: event.paperTrack,
        sheetFrame: event.frame,
        keyId: event.keyId,
      }],
    }
  }

  const displayLabel = key.displayLabel.trim()
  if (isNullLabel(displayLabel)) return { state: EMPTY_STATE, diagnostics: [] }
  const displayCellNumber = positiveCellNumber(displayLabel)
  if (displayCellNumber !== null) {
    return { state: cellState(displayCellNumber), diagnostics: [] }
  }

  const bindingCandidates = bindingCellNumberCandidates(project, event.paperTrack, event.keyId, preferredBindingSlotId)
  const preferredCandidates = bindingCandidates.filter(candidate => candidate.preferred)
  const activeCandidates = preferredCandidates.length > 0 ? preferredCandidates : bindingCandidates
  const distinctNumbers = [...new Set(activeCandidates.map(candidate => candidate.cellNumber))]
  if (distinctNumbers.length === 1) {
    const fallback = activeCandidates[0]
    return {
      state: cellState(distinctNumbers[0]),
      diagnostics: [{
        severity: 'warning',
        code: 'ae-remap.binding-number-fallback',
        message: `${event.paperTrack} F${event.frame}: display label "${displayLabel}" is not numeric; cel ${distinctNumbers[0]} was read from binding "${fallback?.bindingName ?? ''}".`,
        paperTrack: event.paperTrack,
        sheetFrame: event.frame,
        keyId: event.keyId,
        value: displayLabel,
      }],
    }
  }
  if (distinctNumbers.length > 1) {
    return {
      state: null,
      diagnostics: [{
        severity: 'error',
        code: 'ae-remap.ambiguous-binding-cell-number',
        message: `${event.paperTrack} F${event.frame}: display label "${displayLabel}" is not numeric and bindings end in conflicting cel numbers (${distinctNumbers.join(', ')}).`,
        paperTrack: event.paperTrack,
        sheetFrame: event.frame,
        keyId: event.keyId,
        value: displayLabel,
      }],
    }
  }

  return {
    state: null,
    diagnostics: [{
      severity: 'error',
      code: 'ae-remap.non-numeric-cell',
      message: `${event.paperTrack} F${event.frame}: "${displayLabel}" is not a positive, one-based cel number.`,
      paperTrack: event.paperTrack,
      sheetFrame: event.frame,
      keyId: event.keyId,
      value: displayLabel,
    }],
  }
}

function bindingCellNumberCandidates(
  project: CutProject,
  paperTrack: PaperTrackName,
  keyId: string,
  preferredBindingSlotId: string | undefined,
): Array<{ bindingName: string; cellNumber: number; preferred: boolean }> {
  return project.bindings
    .flatMap(binding => {
      if (binding.keyId !== keyId) return []
      const slot = project.cspTrackSlots.find(item => item.slotId === binding.slotId)
      if (!slot || slot.paperTrack !== paperTrack) return []
      const match = binding.cspCellName.trim().match(/([1-9]\d*)$/)
      if (!match) return []
      const cellNumber = Number(match[1])
      if (!Number.isSafeInteger(cellNumber) || cellNumber <= 0) return []
      return [{
        bindingName: binding.cspCellName,
        cellNumber,
        preferred: binding.slotId === preferredBindingSlotId,
      }]
    })
    .sort((a, b) => Number(b.preferred) - Number(a.preferred) || a.bindingName.localeCompare(b.bindingName, 'ja'))
}

function appendAeRemapKey(keys: AeRemapKey[], next: AeRemapKey): void {
  const previous = keys.at(-1)
  if (previous?.compFrame === next.compFrame) {
    keys[keys.length - 1] = next
    return
  }
  if (previous && sameAeState(previous, next)) return
  keys.push(next)
}

function sameAeState(a: AeRemapKey, b: AeRemapKey): boolean {
  return a.kind === b.kind && a.cellNumber === b.cellNumber
}

function aeRemapKey(sheetFrame: number, compFrame: number, state: ResolvedCellState): AeRemapKey {
  return {
    sheetFrame,
    compFrame,
    kind: state.kind,
    cellNumber: state.cellNumber,
  }
}

function cellState(cellNumber: number): ResolvedCellState {
  return {
    kind: 'cell',
    cellNumber,
  }
}

function positiveCellNumber(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function expandAeRemapColumn(
  plan: AeRemapPlan,
  column: AeRemapColumn,
): Array<{ compFrame: number; sourceSeconds: number; empty: boolean }> {
  const result: Array<{ compFrame: number; sourceSeconds: number; empty: boolean }> = []
  let keyIndex = 0
  let state = column.keys[0] ?? aeRemapKey(plan.frameOrigin, 0, EMPTY_STATE)
  let lastSourceSeconds = 0
  for (let compFrame = 0; compFrame < plan.durationFrames; compFrame += 1) {
    while (keyIndex + 1 < column.keys.length && column.keys[keyIndex + 1].compFrame <= compFrame) {
      keyIndex += 1
      state = column.keys[keyIndex]
    }
    if (state.kind === 'cell' && state.cellNumber !== null) {
      lastSourceSeconds = (state.cellNumber - 1) / plan.sourceFps
    }
    result.push({
      compFrame,
      sourceSeconds: state.kind === 'cell' && state.cellNumber !== null
        ? (state.cellNumber - 1) / plan.sourceFps
        : lastSourceSeconds,
      empty: state.kind === 'empty',
    })
  }
  return result
}

function aeRemapJsxConfigKey(
  key: AeRemapKey,
): AeRemapJsxConfig['plan']['columns'][number]['keys'][number] {
  if (key.kind === 'empty') return { frame: key.compFrame, empty: true, cellNumber: null }
  if (!Number.isSafeInteger(key.cellNumber) || (key.cellNumber ?? 0) <= 0) {
    throw new Error(`AE remap cell key at composition frame ${key.compFrame} has no valid cell number`)
  }
  return { frame: key.compFrame, empty: false, cellNumber: key.cellNumber as number }
}

function assertAeRemapPlanCanExport(plan: AeRemapPlan): void {
  const errors = plan.diagnostics.filter(diagnostic => diagnostic.severity === 'error')
  if (errors.length === 0) return
  throw new Error(`AE remap export has ${errors.length} blocking diagnostic(s): ${errors.map(error => error.message).join(' | ')}`)
}

function uniquePaperTracks(values: readonly PaperTrackName[]): PaperTrackName[] {
  const seen = new Set<PaperTrackName>()
  const result: PaperTrackName[] = []
  for (const value of values) {
    if (seen.has(value)) continue
    seen.add(value)
    result.push(value)
  }
  return result
}

function positiveFiniteNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`)
  return value
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`)
  return value
}

function formatAeNumber(value: number): string {
  if (Object.is(value, -0) || value === 0) return '0'
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(10).replace(/0+$/, '').replace(/\.$/, '')
}

function aeBlankEffectLabels(locale: NonNullable<AeKeyframeDataOptions['locale']>): {
  effect: string
  completion: string
  unit: string
} {
  if (locale === 'ja') return { effect: 'ブラインド', completion: '変換終了', unit: 'パーセント' }
  if (locale === 'en') return { effect: 'Venetian Blinds', completion: 'Transition Completion', unit: 'percent' }
  throw new Error(`unsupported After Effects Keyframe Data locale: ${String(locale)}`)
}

function safeJsLiteral(value: unknown): string {
  const json = JSON.stringify(value)
  if (json === undefined) throw new Error('value cannot be represented as a JavaScript literal')
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
