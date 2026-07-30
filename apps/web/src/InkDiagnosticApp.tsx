import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { APP_VERSION } from '@xsheet-remap/ui'
import {
  INK_DIAGNOSTIC_DURATION_MS,
  INK_DIAGNOSTIC_SCENARIOS,
  createEmptyInkDiagnosticSession,
  createInkDiagnosticReport,
  emptyInkDiagnosticMetrics,
  loadInkDiagnosticSession,
  readInkDiagnosticCapabilities,
  saveInkDiagnosticSession,
  type InkDiagnosticLatency,
  type InkDiagnosticMetrics,
  type InkDiagnosticOutcome,
  type InkDiagnosticPendingTest,
  type InkDiagnosticScenario,
  type InkDiagnosticSession,
} from './ink-diagnostic'
import './ink-diagnostic.css'

type InkPresenter = {
  updateInkTrailStartPoint: (
    event: globalThis.PointerEvent,
    style: { color: string; diameter: number },
  ) => void
}

type NavigatorWithInk = Navigator & {
  ink?: {
    requestPresenter(options: { presentationArea: Element }): Promise<InkPresenter>
  }
}

type DiagnosticPhase =
  | { kind: 'overview' }
  | { kind: 'testing'; scenario: InkDiagnosticScenario }
  | { kind: 'evaluate'; pending: InkDiagnosticPendingTest; recoveredAfterReload: boolean }

const TEST_COLOR = '#0f766e'
const TEST_LINE_WIDTH = 4

export function InkDiagnosticApp() {
  const [session, setSession] = useState<InkDiagnosticSession>(() => (
    loadInkDiagnosticSession(window.localStorage)
  ))
  const [phase, setPhase] = useState<DiagnosticPhase>(() => {
    const restored = loadInkDiagnosticSession(window.localStorage)
    return restored.pending
      ? { kind: 'evaluate', pending: restored.pending, recoveredAfterReload: true }
      : { kind: 'overview' }
  })
  const [latency, setLatency] = useState<InkDiagnosticLatency>('not-rated')
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const sessionRef = useRef(session)
  const capabilities = useMemo(
    () => readInkDiagnosticCapabilities(window, navigator),
    [],
  )
  const completedIds = useMemo(
    () => new Set(session.results.map(result => result.scenarioId)),
    [session.results],
  )

  const persistSession = useCallback((next: InkDiagnosticSession) => {
    saveInkDiagnosticSession(window.localStorage, next)
    sessionRef.current = next
    setSession(next)
  }, [])

  const updatePendingMetrics = useCallback((
    scenario: InkDiagnosticScenario,
    metrics: InkDiagnosticMetrics,
  ) => {
    const current = sessionRef.current
    const pending = current.pending
    if (!pending || pending.scenarioId !== scenario.id) return
    persistSession({
      ...current,
      pending: { ...pending, metrics },
    })
  }, [persistSession])

  const startScenario = useCallback((scenario: InkDiagnosticScenario) => {
    const pending: InkDiagnosticPendingTest = {
      scenarioId: scenario.id,
      startedAt: new Date().toISOString(),
      metrics: emptyInkDiagnosticMetrics(scenario),
    }
    const next = { ...sessionRef.current, pending }
    persistSession(next)
    setLatency('not-rated')
    setPhase({ kind: 'testing', scenario })
  }, [persistSession])

  const finishScenario = useCallback((
    scenario: InkDiagnosticScenario,
    metrics: InkDiagnosticMetrics,
  ) => {
    const current = sessionRef.current
    const pending = {
      scenarioId: scenario.id,
      startedAt: current.pending?.scenarioId === scenario.id
        ? current.pending.startedAt
        : new Date().toISOString(),
      metrics,
    }
    const next = { ...current, pending }
    persistSession(next)
    setPhase({ kind: 'evaluate', pending, recoveredAfterReload: false })
  }, [persistSession])

  const recordOutcome = useCallback((outcome: InkDiagnosticOutcome) => {
    if (phase.kind !== 'evaluate') return
    const result = {
      scenarioId: phase.pending.scenarioId,
      startedAt: phase.pending.startedAt,
      completedAt: new Date().toISOString(),
      outcome,
      latency,
      recoveredAfterReload: phase.recoveredAfterReload,
      metrics: phase.pending.metrics,
    }
    const current = sessionRef.current
    const results = current.results
      .filter(existing => existing.scenarioId !== result.scenarioId)
      .concat(result)
    const next = { ...current, pending: null, results }
    persistSession(next)
    setLatency('not-rated')
    setPhase({ kind: 'overview' })
  }, [latency, persistSession, phase])

  const reset = useCallback(() => {
    const next = createEmptyInkDiagnosticSession()
    persistSession(next)
    setCopyState('idle')
    setLatency('not-rated')
    setPhase({ kind: 'overview' })
  }, [persistSession])

  const report = useMemo(() => createInkDiagnosticReport({
    appVersion: APP_VERSION,
    generatedAt: new Date().toISOString(),
    capabilities,
    results: session.results,
  }), [capabilities, session.results])

  const copyReport = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(report)
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }, [report])

  if (phase.kind === 'testing') {
    return <InkDiagnosticSurface
      scenario={phase.scenario}
      onProgress={updatePendingMetrics}
      onComplete={finishScenario}
    />
  }

  if (phase.kind === 'evaluate') {
    const scenario = INK_DIAGNOSTIC_SCENARIOS.find(
      candidate => candidate.id === phase.pending.scenarioId,
    )
    return (
      <main className="inkDiagnosticApp inkDiagnosticEvaluation">
        <section className="inkDiagnosticPanel">
          <p className="inkDiagnosticEyebrow">手描き診断</p>
          <h1>{scenario?.title ?? phase.pending.scenarioId}の結果</h1>
          {phase.recoveredAfterReload && (
            <p className="inkDiagnosticWarning">
              試験中にページが閉じられたか再読込されました。黒画面から戻れず開き直した場合は
              「画面が黒くなった」を選んでください。
            </p>
          )}
          <label className="inkDiagnosticField">
            ペン先への追従
            <select
              value={latency}
              onChange={event => setLatency(event.target.value as InkDiagnosticLatency)}
            >
              <option value="not-rated">判定しない</option>
              <option value="good">追従が良い</option>
              <option value="slight-delay">少し遅れる</option>
              <option value="slow">かなり遅れる</option>
            </select>
          </label>
          <p className="inkDiagnosticQuestion">画面表示はどうなりましたか？</p>
          <div className="inkDiagnosticOutcomeGrid">
            <button className="inkDiagnosticPrimary" onClick={() => recordOutcome('normal')}>
              正常だった
            </button>
            <button onClick={() => recordOutcome('black')}>
              画面が黒くなった
            </button>
            <button onClick={() => recordOutcome('flicker')}>
              黒くちらついた
            </button>
            <button onClick={() => recordOutcome('unusable')}>
              描画できなかった
            </button>
          </div>
        </section>
      </main>
    )
  }

  const allCompleted = session.results.length === INK_DIAGNOSTIC_SCENARIOS.length
  return (
    <main className="inkDiagnosticApp">
      <header className="inkDiagnosticHeader">
        <p className="inkDiagnosticEyebrow">xsheet-remap v{APP_VERSION}</p>
        <h1>手描き表示の安全診断</h1>
        <p>
          各試験は9秒で自動終了します。画面が戻らない場合はタブを閉じて同じURLを開き直してください。
          結果と端末情報は、この端末内にだけ保存されます。
        </p>
      </header>

      <section className="inkDiagnosticPanel">
        <h2>端末の対応状況</h2>
        <dl className="inkDiagnosticCapabilities">
          <div><dt>画面</dt><dd>{capabilities.viewport} / DPR {capabilities.devicePixelRatio}</dd></div>
          <div><dt>PointerEvent</dt><dd>{yesNo(capabilities.pointerEvent)}</dd></div>
          <div><dt>Coalesced</dt><dd>{yesNo(capabilities.coalescedEvents)}</dd></div>
          <div><dt>Predicted</dt><dd>{yesNo(capabilities.predictedEvents)}</dd></div>
          <div><dt>Raw update</dt><dd>{yesNo(capabilities.pointerRawUpdate)}</dd></div>
          <div><dt>Delegated Ink</dt><dd>{yesNo(capabilities.delegatedInk)}</dd></div>
        </dl>
      </section>

      <section className="inkDiagnosticPanel">
        <div className="inkDiagnosticSectionHeading">
          <h2>試験項目</h2>
          <span>{session.results.length} / {INK_DIAGNOSTIC_SCENARIOS.length} 完了</span>
        </div>
        <ol className="inkDiagnosticScenarioList">
          {INK_DIAGNOSTIC_SCENARIOS.map(scenario => {
            const completed = completedIds.has(scenario.id)
            return (
              <li key={scenario.id}>
                <div>
                  <strong>{scenario.title}</strong>
                  <p>{scenario.description}</p>
                </div>
                <button
                  className={completed ? '' : 'inkDiagnosticPrimary'}
                  onClick={() => startScenario(scenario)}
                >
                  {completed ? '再試験' : '開始'}
                </button>
              </li>
            )
          })}
        </ol>
      </section>

      {session.results.length > 0 && (
        <section className="inkDiagnosticPanel">
          <div className="inkDiagnosticSectionHeading">
            <h2>{allCompleted ? '診断完了' : '途中結果'}</h2>
            <button className="inkDiagnosticPrimary" onClick={copyReport}>
              結果をコピー
            </button>
          </div>
          {copyState === 'copied' && <p className="inkDiagnosticSuccess">コピーしました。この会話へ貼り付けてください。</p>}
          {copyState === 'failed' && <p className="inkDiagnosticWarning">自動コピーできません。下の内容を長押ししてコピーしてください。</p>}
          <textarea className="inkDiagnosticReport" value={report} readOnly rows={12} />
        </section>
      )}

      <footer className="inkDiagnosticFooter">
        <button onClick={reset}>診断結果を消去</button>
      </footer>
    </main>
  )
}

function InkDiagnosticSurface({
  scenario,
  onProgress,
  onComplete,
}: {
  scenario: InkDiagnosticScenario
  onProgress: (scenario: InkDiagnosticScenario, metrics: InkDiagnosticMetrics) => void
  onComplete: (scenario: InkDiagnosticScenario, metrics: InkDiagnosticMetrics) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const contextRef = useRef<CanvasRenderingContext2D | null>(null)
  const presenterRef = useRef<InkPresenter | null>(null)
  const drawingRef = useRef(false)
  const lastPointRef = useRef({ x: 0, y: 0 })
  const metricsRef = useRef(emptyInkDiagnosticMetrics(scenario))
  const completeRef = useRef(false)

  const publishMetrics = useCallback(() => {
    onProgress(scenario, { ...metricsRef.current })
  }, [onProgress, scenario])

  const sizeCanvas = useCallback((canvas: HTMLCanvasElement) => {
    const cssWidth = Math.max(1, window.innerWidth)
    const cssHeight = Math.max(1, window.innerHeight)
    const maxRatio = Math.sqrt(4_000_000 / (cssWidth * cssHeight))
    const ratio = Math.max(0.5, Math.min(2, window.devicePixelRatio || 1, maxRatio))
    canvas.width = Math.max(1, Math.round(cssWidth * ratio))
    canvas.height = Math.max(1, Math.round(cssHeight * ratio))
    const metrics = metricsRef.current
    metrics.canvasCssWidth = cssWidth
    metrics.canvasCssHeight = cssHeight
    metrics.canvasWidth = canvas.width
    metrics.canvasHeight = canvas.height
    return ratio
  }, [])

  const initializeContext = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const ratio = sizeCanvas(canvas)
    try {
      const context = canvas.getContext('2d', {
        alpha: true,
        desynchronized: scenario.desynchronized,
      })
      contextRef.current = context
      if (!context) {
        metricsRef.current.contextState = 'unavailable'
        publishMetrics()
        return null
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.strokeStyle = TEST_COLOR
      context.lineWidth = TEST_LINE_WIDTH
      context.lineCap = 'round'
      context.lineJoin = 'round'
      const attributes = typeof context.getContextAttributes === 'function'
        ? context.getContextAttributes()
        : null
      metricsRef.current.contextState = 'ready'
      metricsRef.current.actualAlpha = attributes?.alpha ?? null
      metricsRef.current.actualDesynchronized = attributes?.desynchronized ?? null
      publishMetrics()
      return context
    } catch (error) {
      metricsRef.current.contextState = 'error'
      metricsRef.current.contextError = errorMessage(error)
      publishMetrics()
      return null
    }
  }, [publishMetrics, scenario.desynchronized, sizeCanvas])

  const requestPresenter = useCallback(() => {
    const canvas = canvasRef.current
    const ink = (navigator as NavigatorWithInk).ink
    if (!canvas || !ink?.requestPresenter) {
      metricsRef.current.presenterState = 'unsupported'
      publishMetrics()
      return
    }
    metricsRef.current.presenterState = 'pending'
    publishMetrics()
    try {
      void ink.requestPresenter({ presentationArea: canvas }).then(presenter => {
        presenterRef.current = presenter
        metricsRef.current.presenterState = 'ready'
        publishMetrics()
      }).catch(error => {
        metricsRef.current.presenterState = 'error'
        metricsRef.current.presenterError = errorMessage(error)
        publishMetrics()
      })
    } catch (error) {
      metricsRef.current.presenterState = 'error'
      metricsRef.current.presenterError = errorMessage(error)
      publishMetrics()
    }
  }, [publishMetrics])

  useEffect(() => {
    if (scenario.contextTiming === 'activate') initializeContext()
    if (scenario.presenterTiming === 'activate') requestPresenter()
    const timeout = window.setTimeout(() => {
      if (completeRef.current) return
      completeRef.current = true
      onComplete(scenario, { ...metricsRef.current })
    }, INK_DIAGNOSTIC_DURATION_MS)
    return () => window.clearTimeout(timeout)
  }, [
    initializeContext,
    onComplete,
    requestPresenter,
    scenario.contextTiming,
    scenario.presenterTiming,
    scenario,
  ])

  const drawEvent = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return
    const started = performance.now()
    const nativeEvent = event.nativeEvent
    const samples = typeof nativeEvent.getCoalescedEvents === 'function'
      ? nativeEvent.getCoalescedEvents()
      : [nativeEvent]
    const context = contextRef.current
    if (context) {
      context.beginPath()
      context.moveTo(lastPointRef.current.x, lastPointRef.current.y)
      for (const sample of samples) {
        context.lineTo(sample.clientX, sample.clientY)
        lastPointRef.current = { x: sample.clientX, y: sample.clientY }
      }
      context.stroke()
    }
    if (presenterRef.current && nativeEvent.isTrusted && nativeEvent.pointerType === 'pen') {
      try {
        presenterRef.current.updateInkTrailStartPoint(nativeEvent, {
          color: TEST_COLOR,
          diameter: TEST_LINE_WIDTH,
        })
      } catch (error) {
        metricsRef.current.presenterState = 'error'
        metricsRef.current.presenterError = errorMessage(error)
      }
    }
    const elapsed = performance.now() - started
    const metrics = metricsRef.current
    metrics.pointerEvents += 1
    metrics.samples += samples.length
    metrics.pointerType = nativeEvent.pointerType || metrics.pointerType
    metrics.totalHandlerMs += elapsed
    metrics.maxHandlerMs = Math.max(metrics.maxHandlerMs, elapsed)
    if (metrics.firstInputToDrawMs === null) {
      metrics.firstInputToDrawMs = Math.max(0, performance.now() - nativeEvent.timeStamp)
    }
  }, [])

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget
    if (scenario.resizeOnPointerDown || !contextRef.current) {
      initializeContext()
    }
    if (scenario.presenterTiming === 'pen' && metricsRef.current.presenterState !== 'ready') {
      requestPresenter()
    }
    drawingRef.current = true
    lastPointRef.current = { x: event.clientX, y: event.clientY }
    metricsRef.current.pointerType = event.pointerType
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // Pointer capture is a convenience; window-level recovery is handled by the timeout.
    }
    const context = contextRef.current
    if (context) {
      context.beginPath()
      context.moveTo(event.clientX, event.clientY)
      context.lineTo(event.clientX + 0.01, event.clientY)
      context.stroke()
    }
  }, [
    initializeContext,
    requestPresenter,
    scenario.presenterTiming,
    scenario.resizeOnPointerDown,
  ])

  const handlePointerEnd = useCallback(() => {
    drawingRef.current = false
    publishMetrics()
  }, [publishMetrics])

  return (
    <main className="inkDiagnosticTestScreen">
      <div className="inkDiagnosticTestBackdrop" aria-hidden="true">
        <strong>{scenario.title}</strong>
        <span>この画面へペンで線を描いてください。9秒後に自動で戻ります。</span>
      </div>
      <canvas
        ref={canvasRef}
        className="inkDiagnosticTestCanvas"
        data-scenario-id={scenario.id}
        onPointerDown={handlePointerDown}
        onPointerMove={drawEvent}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onLostPointerCapture={handlePointerEnd}
        aria-label={`${scenario.title}の描画面`}
      />
      {scenario.overlayAboveCanvas && (
        <div className="inkDiagnosticAboveCanvas" aria-hidden="true">
          Canvasより上のDOM表示
        </div>
      )}
    </main>
  )
}

function yesNo(value: boolean) {
  return value ? '対応' : '非対応'
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
