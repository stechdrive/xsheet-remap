import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InkDiagnosticApp } from './InkDiagnosticApp'
import {
  INK_DIAGNOSTIC_DURATION_MS,
  INK_DIAGNOSTIC_SCENARIOS,
  INK_DIAGNOSTIC_STORAGE_KEY,
  createEmptyInkDiagnosticSession,
  createInkDiagnosticReport,
  emptyInkDiagnosticMetrics,
  inkDiagnosticPointerSamples,
  loadInkDiagnosticSession,
  saveInkDiagnosticSession,
} from './ink-diagnostic'

const originalInkDescriptor = Object.getOwnPropertyDescriptor(navigator, 'ink')

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  if (originalInkDescriptor) Object.defineProperty(navigator, 'ink', originalInkDescriptor)
  else Reflect.deleteProperty(navigator, 'ink')
})

describe('ink diagnostic model', () => {
  it('keeps the six diagnostic scenarios independently identifiable', () => {
    expect(INK_DIAGNOSTIC_SCENARIOS).toHaveLength(6)
    expect(new Set(INK_DIAGNOSTIC_SCENARIOS.map(scenario => scenario.id)).size).toBe(6)
    expect(INK_DIAGNOSTIC_SCENARIOS.map(scenario => ({
      desynchronized: scenario.desynchronized,
      presenterTiming: scenario.presenterTiming,
      resizeOnPointerDown: scenario.resizeOnPointerDown,
      overlayAboveCanvas: scenario.overlayAboveCanvas,
    }))).toContainEqual({
      desynchronized: true,
      presenterTiming: 'activate',
      resizeOnPointerDown: true,
      overlayAboveCanvas: false,
    })
  })

  it('recovers from invalid locally stored diagnostic data', () => {
    window.localStorage.setItem(INK_DIAGNOSTIC_STORAGE_KEY, '{not json')
    expect(loadInkDiagnosticSession(window.localStorage)).toEqual(
      createEmptyInkDiagnosticSession(),
    )
  })

  it('retains the dispatched pointer event when coalesced samples are empty', () => {
    const event = {
      clientX: 24,
      clientY: 36,
      getCoalescedEvents: () => [],
    }
    expect(inkDiagnosticPointerSamples(event)).toEqual([event])
  })

  it('does not duplicate the dispatched point already present at the coalesced tail', () => {
    const coalesced = [
      { clientX: 20, clientY: 30 },
      { clientX: 24, clientY: 36 },
    ]
    const event = {
      clientX: 24,
      clientY: 36,
      getCoalescedEvents: () => coalesced,
    }
    expect(inkDiagnosticPointerSamples(event)).toEqual(coalesced)
  })

  it('creates a copyable report with requested and actual context values', () => {
    const scenario = INK_DIAGNOSTIC_SCENARIOS[1]!
    const metrics = {
      ...emptyInkDiagnosticMetrics(scenario),
      actualAlpha: true,
      actualDesynchronized: false,
      contextState: 'ready' as const,
    }
    const report = createInkDiagnosticReport({
      appVersion: '0.1.999',
      generatedAt: '2026-07-31T00:00:00.000Z',
      capabilities: {
        userAgent: 'test-agent',
        platform: 'Android',
        mobileClientHint: true,
        viewport: '800x1200',
        screen: '1600x2560',
        devicePixelRatio: 2,
        hardwareConcurrency: 8,
        pointerEvent: true,
        coalescedEvents: true,
        predictedEvents: true,
        pointerRawUpdate: true,
        delegatedInk: false,
      },
      results: [{
        scenarioId: scenario.id,
        startedAt: '2026-07-31T00:00:00.000Z',
        completedAt: '2026-07-31T00:00:09.000Z',
        outcome: 'normal',
        latency: 'slight-delay',
        recoveredAfterReload: false,
        metrics,
      }],
    })

    expect(report).toContain('version: 0.1.999')
    expect(report).toContain('2. 低遅延Canvasのみ: 正常 / 少し遅れる')
    expect(report).toContain('requested: alpha=true, desynchronized=true')
    expect(report).toContain('actual: alpha=true, desynchronized=false')
  })
})

describe('InkDiagnosticApp', () => {
  it('runs a safe baseline test, times out, and records the user judgment', () => {
    vi.useFakeTimers()
    const context = createCanvasContext()
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context)

    render(<InkDiagnosticApp />)
    fireEvent.click(screen.getAllByRole('button', { name: '開始' })[0]!)

    expect(screen.getByLabelText('1. 通常Canvasの描画面')).toBeTruthy()
    expect(getContext).toHaveBeenCalledWith('2d', {
      alpha: true,
      desynchronized: false,
    })

    act(() => vi.advanceTimersByTime(INK_DIAGNOSTIC_DURATION_MS))

    expect(screen.getByRole('heading', { name: '1. 通常Canvasの結果' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '正常だった' }))

    expect(screen.getByText('1 / 6 完了')).toBeTruthy()
    expect(screen.getByDisplayValue(/1\. 通常Canvas: 正常 \/ 未評価/)).toBeTruthy()
  })

  it('restores an interrupted black-screen candidate after the page is reopened', () => {
    const scenario = INK_DIAGNOSTIC_SCENARIOS[5]!
    saveInkDiagnosticSession(window.localStorage, {
      ...createEmptyInkDiagnosticSession(),
      pending: {
        scenarioId: scenario.id,
        startedAt: '2026-07-31T00:00:00.000Z',
        metrics: emptyInkDiagnosticMetrics(scenario),
      },
    })

    render(<InkDiagnosticApp />)

    expect(screen.getByRole('heading', { name: `${scenario.title}の結果` })).toBeTruthy()
    expect(screen.getByText(/黒画面から戻れず開き直した場合/)).toBeTruthy()
  })

  it('recreates the old eager-presenter timing without initializing the context early', () => {
    const requestPresenter = vi.fn().mockResolvedValue({
      updateInkTrailStartPoint: vi.fn(),
    })
    Object.defineProperty(navigator, 'ink', {
      configurable: true,
      value: { requestPresenter },
    })
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(createCanvasContext())

    render(<InkDiagnosticApp />)
    fireEvent.click(screen.getAllByRole('button', { name: '開始' })[5]!)

    expect(screen.getByLabelText('6. 旧構成に近い組み合わせの描画面')).toBeTruthy()
    expect(requestPresenter).toHaveBeenCalledTimes(1)
    expect(getContext).not.toHaveBeenCalled()

    fireEvent.pointerDown(
      screen.getByLabelText('6. 旧構成に近い組み合わせの描画面'),
      { pointerId: 1, pointerType: 'pen', clientX: 20, clientY: 30 },
    )

    expect(getContext).toHaveBeenCalledWith('2d', {
      alpha: true,
      desynchronized: true,
    })
  })
})

function createCanvasContext() {
  return {
    beginPath: vi.fn(),
    getContextAttributes: vi.fn().mockReturnValue({
      alpha: true,
      desynchronized: false,
    }),
    lineTo: vi.fn(),
    moveTo: vi.fn(),
    setTransform: vi.fn(),
    stroke: vi.fn(),
    set fillStyle(_value: string | CanvasGradient | CanvasPattern) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(_value: number) {},
    set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
  } as unknown as CanvasRenderingContext2D
}
