import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react'
import type { NormalizedPoint, SheetCalibrationPointPair, SheetTemplate } from '@xsheet-remap/core'
import type { SheetPrecisionWarp } from './appTypes'
import { uiText } from './i18n'
import { clampNumber } from './sheetInteraction'
import { Tooltip, TooltipTarget } from './Tooltip'

const CALIBRATION_LOUPE_PANEL_PX = 220
const CALIBRATION_LOUPE_DEFAULT_ZOOM: CalibrationLoupeZoom = '2x'
const CALIBRATION_LOUPE_DISPLAY_ORDER = [0, 1, 3, 2] as const

type CalibrationLoupeZoom = '2x' | '4x'

export function CalibrationLoupeDialog({
  imageUrl,
  template,
  points,
  autoCalibrationRunning,
  autoCalibrationMessage,
  onPoints,
  onAutoDetect,
  onApply,
  onClose,
  autoDetectLabel = uiText.actions.autoCalibration,
  autoDetectOnOpen = false,
  closeOnApply = false,
  commitOnPointChange = true,
  precisionCorrection,
}: {
  imageUrl: string
  template: SheetTemplate
  points: SheetCalibrationPointPair[]
  autoCalibrationRunning: boolean
  autoCalibrationMessage: string | null
  onPoints?: (points: SheetCalibrationPointPair[], enabled?: boolean) => void
  onAutoDetect: () => void | SheetCalibrationPointPair[] | Promise<void | SheetCalibrationPointPair[]>
  onApply: (pointsOverride?: SheetCalibrationPointPair[]) => void
  onClose: () => void
  autoDetectLabel?: string
  autoDetectOnOpen?: boolean
  closeOnApply?: boolean
  commitOnPointChange?: boolean
  precisionCorrection?: {
    basicApplied: boolean
    appliedWarp?: SheetPrecisionWarp
    onAnalyze: (points: SheetCalibrationPointPair[]) => Promise<SheetPrecisionWarp | null>
    onApply: (points: SheetCalibrationPointPair[], warp: SheetPrecisionWarp) => void
    closeOnApply?: boolean
  }
}) {
  const [draftPoints, setDraftPoints] = useState(points)
  const draftPointsRef = useRef(points)
  const [sourceSize, setSourceSize] = useState({ width: template.page.widthPx, height: template.page.heightPx })
  const [zoom, setZoom] = useState<CalibrationLoupeZoom>(CALIBRATION_LOUPE_DEFAULT_ZOOM)
  const [basicApplied, setBasicApplied] = useState(precisionCorrection?.basicApplied ?? false)
  const [precisionWarp, setPrecisionWarp] = useState<SheetPrecisionWarp | null>(precisionCorrection?.appliedWarp ?? null)
  const [precisionApplied, setPrecisionApplied] = useState(Boolean(precisionCorrection?.appliedWarp))
  const [precisionRunning, setPrecisionRunning] = useState(false)
  const [precisionMessage, setPrecisionMessage] = useState<string | null>(
    precisionCorrection?.appliedWarp ? '高精度補正を適用済みです。' : null,
  )
  const didAutoDetectOnOpen = useRef(false)

  const invalidatePrecisionCorrection = useCallback(() => {
    if (!precisionCorrection) return
    setBasicApplied(false)
    setPrecisionWarp(null)
    setPrecisionApplied(false)
    setPrecisionMessage('四隅を変更しました。基本補正をもう一度適用してください。')
  }, [precisionCorrection])

  const runAutoDetect = useCallback(async () => {
    const detectedPoints = await onAutoDetect()
    if (!detectedPoints) return
    draftPointsRef.current = detectedPoints
    setDraftPoints(detectedPoints)
    invalidatePrecisionCorrection()
    if (commitOnPointChange) onPoints?.(detectedPoints, false)
  }, [commitOnPointChange, invalidatePrecisionCorrection, onAutoDetect, onPoints])

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.onload = () => {
      if (cancelled) return
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      if (width > 0 && height > 0) setSourceSize({ width, height })
    }
    image.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  useEffect(() => {
    if (!autoDetectOnOpen || didAutoDetectOnOpen.current) return
    didAutoDetectOnOpen.current = true
    void runAutoDetect()
  }, [autoDetectOnOpen, runAutoDetect])

  function updateSource(index: number, source: NormalizedPoint, commit = false) {
    const next = draftPointsRef.current.map((point, pointIndex) => (
      pointIndex === index ? { ...point, source } : point
    ))
    draftPointsRef.current = next
    setDraftPoints(next)
    invalidatePrecisionCorrection()
    if (commit && commitOnPointChange) onPoints?.(next, false)
  }

  function applyCurrentPoints() {
    setBasicApplied(true)
    setPrecisionWarp(null)
    setPrecisionApplied(false)
    setPrecisionMessage('基本補正を適用しました。格子を解析できます。')
    onApply(draftPointsRef.current)
    if (closeOnApply) onClose()
  }

  async function analyzePrecisionCorrection() {
    if (!precisionCorrection || !basicApplied || precisionRunning) return
    setPrecisionRunning(true)
    setPrecisionMessage('格子を解析して局所的なゆがみを計算しています...')
    try {
      const warp = await precisionCorrection.onAnalyze(draftPointsRef.current)
      if (!warp) {
        setPrecisionWarp(null)
        setPrecisionApplied(false)
        setPrecisionMessage('安定した格子対応を検出できませんでした。基本補正のまま使用できます。')
        return
      }
      setPrecisionWarp(warp)
      setPrecisionApplied(false)
      setPrecisionMessage(precisionCorrectionSummary(warp))
    } catch (error) {
      setPrecisionWarp(null)
      setPrecisionApplied(false)
      setPrecisionMessage(`高精度補正エラー: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setPrecisionRunning(false)
    }
  }

  function applyPrecisionCorrection() {
    if (!precisionCorrection || !precisionWarp || precisionRunning) return
    precisionCorrection.onApply(draftPointsRef.current, precisionWarp)
    setPrecisionApplied(true)
    setPrecisionMessage(`高精度補正を適用しました。${precisionCorrectionSummary(precisionWarp)}`)
    if (precisionCorrection.closeOnApply ?? true) onClose()
  }

  return (
    <div className="assetQuickPreviewBackdrop calibrationLoupeBackdrop" role="dialog" aria-modal="true" aria-label={uiText.sheet.calibrationLoupeTitle}>
      <section className={`calibrationLoupeDialog${precisionCorrection ? ' precisionEnabled' : ''}`}>
        <header className="calibrationLoupeHeader">
          <div>
            <strong>{uiText.sheet.calibrationLoupeTitle}</strong>
            <span>{uiText.sheet.calibrationLoupeHint}</span>
          </div>
        </header>
        <div className="calibrationLoupeGrid">
          {CALIBRATION_LOUPE_DISPLAY_ORDER.map(index => {
            const point = draftPoints[index]
            if (!point) return null
            return (
              <CalibrationLoupePanel
                key={point.pointId}
                index={index}
                label={uiText.sheet.calibrationCornerLabels[index] ?? point.label}
                imageUrl={imageUrl}
                source={point.source}
                sourceSize={sourceSize}
                zoom={zoom}
                onSourceChange={updateSource}
              />
            )
          })}
        </div>
        {precisionCorrection && (
          <section className="calibrationPrecisionPanel" aria-label="高精度補正">
            <div className="calibrationPrecisionDescription">
              <strong>高精度補正</strong>
              <span>{precisionMessage ?? (basicApplied
                ? '格子罫線の残差を解析し、紙の局所的なゆがみを補正します。'
                : '基本補正を適用すると使用できます。')}</span>
            </div>
            {precisionWarp && (
              <dl className="calibrationPrecisionMetrics">
                <div><dt>対応点</dt><dd>{precisionWarp.diagnostics.inlierCount}</dd></div>
                <div><dt>補正量</dt><dd>{precisionWarp.diagnostics.maxDisplacementPx.toFixed(1)} px</dd></div>
                <div><dt>残差</dt><dd>{precisionWarp.diagnostics.rmsAfterPx.toFixed(2)} px</dd></div>
                <div><dt>信頼度</dt><dd>{Math.round(precisionWarp.diagnostics.confidence * 100)}%</dd></div>
              </dl>
            )}
            <div className="calibrationPrecisionActions">
              <Tooltip label={basicApplied ? '補正後の画像とテンプレート格子を照合します。' : '先に基本補正を適用してください。'}>
                <button type="button" disabled={!basicApplied || precisionRunning} onClick={() => void analyzePrecisionCorrection()}>
                  {precisionRunning ? '格子解析中...' : precisionWarp ? '再解析' : '格子を解析'}
                </button>
              </Tooltip>
              <Tooltip label={precisionWarp ? '解析した局所ワープを画像に適用します。' : '格子解析後に適用できます。'}>
                <button type="button" disabled={!precisionWarp || precisionRunning || precisionApplied} onClick={applyPrecisionCorrection}>
                  {precisionApplied ? '高精度補正済み' : '高精度補正を適用'}
                </button>
              </Tooltip>
            </div>
          </section>
        )}
        <footer className="calibrationLoupeFooter">
          <CalibrationLoupeSegmented<CalibrationLoupeZoom>
            value={zoom}
            options={[
              ['2x', uiText.sheet.calibrationLoupeZoom(200)],
              ['4x', uiText.sheet.calibrationLoupeZoom(400)],
            ]}
            onChange={setZoom}
          />
          {autoCalibrationMessage && <span className="muted">{autoCalibrationMessage}</span>}
          <span className="processSettingsFooterSpacer" />
          <Tooltip label="四隅合わせを閉じます。">
            <button type="button" onClick={onClose}>{precisionCorrection ? '閉じる' : uiText.actions.cancel}</button>
          </Tooltip>
          <Tooltip label="選択中のシート画像から四隅を再検出します。">
            <button type="button" disabled={autoCalibrationRunning} onClick={() => void runAutoDetect()}>
              {autoCalibrationRunning ? uiText.actions.autoCalibrationRunning : autoDetectLabel}
            </button>
          </Tooltip>
          <Tooltip label={precisionCorrection ? '現在の四隅で基本補正を適用し、高精度補正を有効にします。' : '現在の四隅で補正を適用します。'}>
            <button type="button" onClick={applyCurrentPoints}>{precisionCorrection ? '基本補正を適用' : uiText.actions.applyWarp}</button>
          </Tooltip>
        </footer>
      </section>
    </div>
  )
}

function precisionCorrectionSummary(warp: SheetPrecisionWarp): string {
  const diagnostics = warp.diagnostics
  return `対応点 ${diagnostics.inlierCount}点 / 最大補正 ${diagnostics.maxDisplacementPx.toFixed(1)}px / 残差 ${diagnostics.rmsAfterPx.toFixed(2)}px`
}

function CalibrationLoupePanel({
  index,
  label,
  imageUrl,
  source,
  sourceSize,
  zoom,
  onSourceChange,
}: {
  index: number
  label: string
  imageUrl: string
  source: NormalizedPoint
  sourceSize: { width: number; height: number }
  zoom: CalibrationLoupeZoom
  onSourceChange: (index: number, source: NormalizedPoint, commit?: boolean) => void
}) {
  const zoomFactor = calibrationLoupeZoomFactor(zoom)
  const pixelSpan = CALIBRATION_LOUPE_PANEL_PX / zoomFactor
  const viewWidth = pixelSpan / Math.max(1, sourceSize.width)
  const viewHeight = pixelSpan / Math.max(1, sourceSize.height)
  const viewX = source.x - viewWidth / 2
  const viewY = source.y - viewHeight / 2
  const viewBox = `${viewX} ${viewY} ${viewWidth} ${viewHeight}`

  function handlePointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const svg = event.currentTarget
    const pointerId = event.pointerId
    const bounds = svg.getBoundingClientRect()
    const startClient = { x: event.clientX, y: event.clientY }
    const startSource = { ...source }
    let latestSource = startSource

    function updateFromClient(clientX: number, clientY: number) {
      const dx = ((clientX - startClient.x) / Math.max(1, bounds.width)) * viewWidth
      const dy = ((clientY - startClient.y) / Math.max(1, bounds.height)) * viewHeight
      latestSource = {
        x: clampNumber(startSource.x - dx, 0, 1),
        y: clampNumber(startSource.y - dy, 0, 1),
      }
      onSourceChange(index, latestSource, false)
    }

    function handleMove(nextEvent: globalThis.PointerEvent) {
      if (nextEvent.pointerId !== pointerId) return
      nextEvent.preventDefault()
      updateFromClient(nextEvent.clientX, nextEvent.clientY)
    }

    function handleStop(nextEvent: globalThis.PointerEvent) {
      if (nextEvent.pointerId !== pointerId) return
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleStop)
      window.removeEventListener('pointercancel', handleStop)
      onSourceChange(index, latestSource, true)
    }

    svg.setPointerCapture?.(pointerId)
    updateFromClient(event.clientX, event.clientY)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleStop)
    window.addEventListener('pointercancel', handleStop)
  }

  return (
    <section className="calibrationLoupePanel">
      <header>{label}</header>
      <svg
        className="calibrationLoupeView"
        viewBox={viewBox}
        preserveAspectRatio="none"
        onPointerDown={handlePointerDown}
        aria-label={uiText.sheet.calibrationLoupePanel(label)}
      >
        <rect className="calibrationLoupeBackground" x={viewX} y={viewY} width={viewWidth} height={viewHeight} />
        <image
          className="calibrationLoupeImage"
          href={imageUrl}
          x="0"
          y="0"
          width="1"
          height="1"
          preserveAspectRatio="none"
        />
        <line className="calibrationLoupeCrosshair" x1={source.x - viewWidth / 2} y1={source.y} x2={source.x + viewWidth / 2} y2={source.y} />
        <line className="calibrationLoupeCrosshair" x1={source.x} y1={source.y - viewHeight / 2} x2={source.x} y2={source.y + viewHeight / 2} />
        <circle className="calibrationLoupeCenter" cx={source.x} cy={source.y} r={Math.min(viewWidth, viewHeight) * 0.018} />
      </svg>
    </section>
  )
}

function calibrationLoupeZoomFactor(zoom: CalibrationLoupeZoom): number {
  return zoom === '2x' ? 2 : 4
}

function CalibrationLoupeSegmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<[T, string]>
  onChange: (value: T) => void
}) {
  return (
    <div className="segmented">
      {options.map(([option, label]) => (
        <TooltipTarget key={option} label={`${label}に切り替え`}>
          {tooltipProps => (
            <button {...tooltipProps} type="button" className={option === value ? 'active' : ''} onClick={() => onChange(option)}>
              {label}
            </button>
          )}
        </TooltipTarget>
      ))}
    </div>
  )
}
