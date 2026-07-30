export const INK_DIAGNOSTIC_STORAGE_KEY = 'xsheet-remap.ink-diagnostic.v1'
export const INK_DIAGNOSTIC_SCHEMA_VERSION = 1
export const INK_DIAGNOSTIC_DURATION_MS = 9_000

export type InkDiagnosticOutcome = 'normal' | 'black' | 'flicker' | 'unusable'
export type InkDiagnosticLatency = 'good' | 'slight-delay' | 'slow' | 'not-rated'
export type InkDiagnosticPresenterTiming = 'none' | 'activate' | 'pen'
export type InkDiagnosticContextTiming = 'activate' | 'pointerdown'

export type InkDiagnosticScenario = {
  id: string
  title: string
  description: string
  desynchronized: boolean
  contextTiming: InkDiagnosticContextTiming
  presenterTiming: InkDiagnosticPresenterTiming
  resizeOnPointerDown: boolean
  overlayAboveCanvas: boolean
}

export type InkDiagnosticMetrics = {
  requestedAlpha: true
  requestedDesynchronized: boolean
  actualAlpha: boolean | null
  actualDesynchronized: boolean | null
  contextState: 'pending' | 'ready' | 'unavailable' | 'error'
  contextError?: string
  presenterState: 'not-requested' | 'unsupported' | 'pending' | 'ready' | 'error'
  presenterError?: string
  pointerType?: string
  pointerEvents: number
  samples: number
  firstInputToDrawMs: number | null
  totalHandlerMs: number
  maxHandlerMs: number
  canvasCssWidth: number
  canvasCssHeight: number
  canvasWidth: number
  canvasHeight: number
}

export type InkDiagnosticPendingTest = {
  scenarioId: string
  startedAt: string
  metrics: InkDiagnosticMetrics
}

export type InkDiagnosticResult = {
  scenarioId: string
  startedAt: string
  completedAt: string
  outcome: InkDiagnosticOutcome
  latency: InkDiagnosticLatency
  recoveredAfterReload: boolean
  metrics: InkDiagnosticMetrics
}

export type InkDiagnosticSession = {
  schemaVersion: typeof INK_DIAGNOSTIC_SCHEMA_VERSION
  pending: InkDiagnosticPendingTest | null
  results: InkDiagnosticResult[]
}

export type InkDiagnosticCapabilities = {
  userAgent: string
  platform: string
  mobileClientHint: boolean | null
  viewport: string
  screen: string
  devicePixelRatio: number
  hardwareConcurrency: number | null
  pointerEvent: boolean
  coalescedEvents: boolean
  predictedEvents: boolean
  pointerRawUpdate: boolean
  delegatedInk: boolean
}

export const INK_DIAGNOSTIC_SCENARIOS: readonly InkDiagnosticScenario[] = [
  {
    id: 'baseline-fixed',
    title: '1. 通常Canvas',
    description: '現在の安全側に近い構成です。低遅延指定とDelegated Inkを使いません。',
    desynchronized: false,
    contextTiming: 'activate',
    presenterTiming: 'none',
    resizeOnPointerDown: false,
    overlayAboveCanvas: false,
  },
  {
    id: 'desynchronized-fixed',
    title: '2. 低遅延Canvasのみ',
    description: '透明Canvasでdesynchronizedだけを要求し、Canvasサイズは固定します。',
    desynchronized: true,
    contextTiming: 'activate',
    presenterTiming: 'none',
    resizeOnPointerDown: false,
    overlayAboveCanvas: false,
  },
  {
    id: 'desynchronized-overlay',
    title: '3. 低遅延Canvas＋上位表示',
    description: '予測線などのDOM表示がCanvasより上にある構成を再現します。',
    desynchronized: true,
    contextTiming: 'activate',
    presenterTiming: 'none',
    resizeOnPointerDown: false,
    overlayAboveCanvas: true,
  },
  {
    id: 'delegated-ink',
    title: '4. Delegated Inkのみ',
    description: '通常Canvasのまま、対応していればOS側のインク表示だけを要求します。',
    desynchronized: false,
    contextTiming: 'activate',
    presenterTiming: 'pen',
    resizeOnPointerDown: false,
    overlayAboveCanvas: false,
  },
  {
    id: 'desynchronized-resize',
    title: '5. 低遅延Canvas＋毎回再確保',
    description: 'ペンを置くたびに全面Canvasを再確保する条件を確認します。',
    desynchronized: true,
    contextTiming: 'pointerdown',
    presenterTiming: 'none',
    resizeOnPointerDown: true,
    overlayAboveCanvas: false,
  },
  {
    id: 'original-combination',
    title: '6. 旧構成に近い組み合わせ',
    description: '低遅延Canvas、早期Delegated Ink要求、ペン開始時の全面再確保を組み合わせます。',
    desynchronized: true,
    contextTiming: 'pointerdown',
    presenterTiming: 'activate',
    resizeOnPointerDown: true,
    overlayAboveCanvas: false,
  },
] as const

export function emptyInkDiagnosticMetrics(
  scenario: InkDiagnosticScenario,
): InkDiagnosticMetrics {
  return {
    requestedAlpha: true,
    requestedDesynchronized: scenario.desynchronized,
    actualAlpha: null,
    actualDesynchronized: null,
    contextState: 'pending',
    presenterState: scenario.presenterTiming === 'none' ? 'not-requested' : 'pending',
    pointerEvents: 0,
    samples: 0,
    firstInputToDrawMs: null,
    totalHandlerMs: 0,
    maxHandlerMs: 0,
    canvasCssWidth: 0,
    canvasCssHeight: 0,
    canvasWidth: 0,
    canvasHeight: 0,
  }
}

export function createEmptyInkDiagnosticSession(): InkDiagnosticSession {
  return {
    schemaVersion: INK_DIAGNOSTIC_SCHEMA_VERSION,
    pending: null,
    results: [],
  }
}

export function loadInkDiagnosticSession(storage: Pick<Storage, 'getItem'>): InkDiagnosticSession {
  try {
    const serialized = storage.getItem(INK_DIAGNOSTIC_STORAGE_KEY)
    if (!serialized) return createEmptyInkDiagnosticSession()
    const candidate = JSON.parse(serialized) as Partial<InkDiagnosticSession>
    if (
      candidate.schemaVersion !== INK_DIAGNOSTIC_SCHEMA_VERSION
      || !Array.isArray(candidate.results)
    ) {
      return createEmptyInkDiagnosticSession()
    }
    return {
      schemaVersion: INK_DIAGNOSTIC_SCHEMA_VERSION,
      pending: candidate.pending ?? null,
      results: candidate.results,
    }
  } catch {
    return createEmptyInkDiagnosticSession()
  }
}

export function saveInkDiagnosticSession(
  storage: Pick<Storage, 'setItem'>,
  session: InkDiagnosticSession,
) {
  storage.setItem(INK_DIAGNOSTIC_STORAGE_KEY, JSON.stringify(session))
}

type NavigatorWithInkDiagnostics = Navigator & {
  userAgentData?: { mobile?: boolean; platform?: string }
  ink?: unknown
  deviceMemory?: number
}

export function readInkDiagnosticCapabilities(
  targetWindow: Window,
  targetNavigator: Navigator,
): InkDiagnosticCapabilities {
  const enhancedNavigator = targetNavigator as NavigatorWithInkDiagnostics
  const pointerEventConstructor = (
    targetWindow as unknown as {
      PointerEvent?: { prototype: object }
    }
  ).PointerEvent
  const pointerPrototype = pointerEventConstructor?.prototype ?? null
  return {
    userAgent: targetNavigator.userAgent,
    platform: enhancedNavigator.userAgentData?.platform
      ?? targetNavigator.platform
      ?? '',
    mobileClientHint: typeof enhancedNavigator.userAgentData?.mobile === 'boolean'
      ? enhancedNavigator.userAgentData.mobile
      : null,
    viewport: `${targetWindow.innerWidth}x${targetWindow.innerHeight}`,
    screen: `${targetWindow.screen.width}x${targetWindow.screen.height}`,
    devicePixelRatio: Math.round((targetWindow.devicePixelRatio || 1) * 1_000) / 1_000,
    hardwareConcurrency: Number.isFinite(targetNavigator.hardwareConcurrency)
      ? targetNavigator.hardwareConcurrency
      : null,
    pointerEvent: pointerPrototype !== null,
    coalescedEvents: Boolean(pointerPrototype && 'getCoalescedEvents' in pointerPrototype),
    predictedEvents: Boolean(pointerPrototype && 'getPredictedEvents' in pointerPrototype),
    pointerRawUpdate: 'onpointerrawupdate' in targetWindow,
    delegatedInk: 'ink' in enhancedNavigator,
  }
}

const OUTCOME_LABELS: Record<InkDiagnosticOutcome, string> = {
  normal: '正常',
  black: '画面が黒くなった',
  flicker: '黒いちらつき・一部黒',
  unusable: '描画できなかった',
}

const LATENCY_LABELS: Record<InkDiagnosticLatency, string> = {
  good: '追従が良い',
  'slight-delay': '少し遅れる',
  slow: 'かなり遅れる',
  'not-rated': '未評価',
}

export function createInkDiagnosticReport(options: {
  appVersion: string
  generatedAt: string
  capabilities: InkDiagnosticCapabilities
  results: readonly InkDiagnosticResult[]
}) {
  const scenarioById = new Map(INK_DIAGNOSTIC_SCENARIOS.map(scenario => [scenario.id, scenario]))
  const lines = [
    'xsheet-remap 手描き診断',
    `version: ${options.appVersion}`,
    `generatedAt: ${options.generatedAt}`,
    '',
    '[capabilities]',
    ...Object.entries(options.capabilities).map(([key, value]) => `${key}: ${String(value)}`),
    '',
    '[results]',
  ]
  for (const result of options.results) {
    const scenario = scenarioById.get(result.scenarioId)
    const metrics = result.metrics
    lines.push(
      `${scenario?.title ?? result.scenarioId}: ${OUTCOME_LABELS[result.outcome]} / ${LATENCY_LABELS[result.latency]}`,
      `  recoveredAfterReload: ${result.recoveredAfterReload}`,
      `  requested: alpha=true, desynchronized=${metrics.requestedDesynchronized}`,
      `  actual: alpha=${String(metrics.actualAlpha)}, desynchronized=${String(metrics.actualDesynchronized)}`,
      `  context: ${metrics.contextState}${metrics.contextError ? ` (${metrics.contextError})` : ''}`,
      `  presenter: ${metrics.presenterState}${metrics.presenterError ? ` (${metrics.presenterError})` : ''}`,
      `  pointer: ${metrics.pointerType ?? 'none'}, events=${metrics.pointerEvents}, samples=${metrics.samples}`,
      `  firstInputToDrawMs: ${metrics.firstInputToDrawMs?.toFixed(2) ?? 'n/a'}`,
      `  handlerMs: total=${metrics.totalHandlerMs.toFixed(2)}, max=${metrics.maxHandlerMs.toFixed(2)}`,
      `  canvas: css=${metrics.canvasCssWidth}x${metrics.canvasCssHeight}, backing=${metrics.canvasWidth}x${metrics.canvasHeight}`,
    )
  }
  return lines.join('\n')
}
