import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  buildLevelHistogram,
  defaultLevelCorrectionSettings,
  gammaForMiddleInputLevel,
  middleInputLevelForGamma,
  noLevelCorrectionSettings,
  normalizeLevelCorrectionSettings,
  updateLevelGamma,
  updateLevelInputBlack,
  updateLevelInputWhite,
  type LevelCorrectionSettings,
} from './levelCorrection'
import { loadImage } from './sheetImages'

type LevelCorrectionHandle = 'black' | 'gamma' | 'white'

type LevelCorrectionDialogProps = {
  title?: string
  settings: LevelCorrectionSettings
  imageUrl: string | null
  onChange: (settings: LevelCorrectionSettings) => void
  onClose: () => void
}

type HistogramState = {
  imageUrl: string
  values: number[]
}

type DialogPosition = {
  x: number
  y: number
}

type DialogDragState = {
  pointerId: number
  offsetX: number
  offsetY: number
  width: number
  height: number
}

export function LevelCorrectionDialog({
  title = 'レベル補正',
  settings: settingsInput,
  imageUrl,
  onChange,
  onClose,
}: LevelCorrectionDialogProps) {
  const settings = normalizeLevelCorrectionSettings(settingsInput)
  const dialogRef = useRef<HTMLElement | null>(null)
  const dragRef = useRef<DialogDragState | null>(null)
  const [dialogPosition, setDialogPosition] = useState<DialogPosition | null>(null)
  const [histogramState, setHistogramState] = useState<HistogramState | null>(null)
  const histogram = imageUrl && histogramState?.imageUrl === imageUrl ? histogramState.values : null
  const applyAdjustedSettings = (nextSettings: LevelCorrectionSettings) => onChange({ ...nextSettings, enabled: true })

  useEffect(() => {
    let cancelled = false
    if (!imageUrl) return undefined
    void histogramForImageUrl(imageUrl)
      .then(nextHistogram => {
        if (!cancelled) setHistogramState({ imageUrl, values: nextHistogram })
      })
      .catch(() => {
        if (!cancelled) setHistogramState({ imageUrl, values: [] })
      })
    return () => {
      cancelled = true
    }
  }, [imageUrl])

  function beginDialogDrag(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || isInteractiveDialogDragTarget(event.target)) return
    const dialog = dialogRef.current
    if (!dialog) return
    const rect = dialog.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    }
    setDialogPosition({ x: rect.left, y: rect.top })
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  function moveDialog(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    event.preventDefault()
    const margin = 8
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || drag.width + margin * 2
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || drag.height + margin * 2
    setDialogPosition({
      x: clampDialogPosition(event.clientX - drag.offsetX, margin, Math.max(margin, viewportWidth - drag.width - margin)),
      y: clampDialogPosition(event.clientY - drag.offsetY, margin, Math.max(margin, viewportHeight - drag.height - margin)),
    })
  }

  function endDialogDrag(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  return (
    <div className="levelCorrectionBackdrop">
      <section
        ref={dialogRef}
        className="levelCorrectionDialog"
        role="dialog"
        aria-label={title}
        style={dialogPosition ? { left: `${dialogPosition.x}px`, top: `${dialogPosition.y}px`, right: 'auto' } : undefined}
      >
        <header
          className="levelCorrectionHeader"
          onPointerDown={beginDialogDrag}
          onPointerMove={moveDialog}
          onPointerUp={endDialogDrag}
          onPointerCancel={endDialogDrag}
        >
          <strong>{title}</strong>
          <button type="button" className="levelCorrectionCloseButton" aria-label="閉じる" onClick={onClose}>×</button>
        </header>
        <div className="levelCorrectionBody">
          <fieldset className="levelCorrectionInputLevels">
            <legend>入力レベル</legend>
            <LevelInputSlider histogram={histogram} settings={settings} onChange={applyAdjustedSettings} />
            <div className="levelCorrectionInputs">
              <NumberField
                label="黒点"
                value={settings.inputBlack}
                min={0}
                max={settings.inputWhite - 2}
                step={1}
                onChange={value => applyAdjustedSettings(updateLevelInputBlack(settings, value))}
              />
              <NumberField
                label="ガンマ"
                value={settings.gamma}
                min={0.1}
                max={9.99}
                step={0.01}
                decimals={2}
                onChange={value => applyAdjustedSettings(updateLevelGamma(settings, value))}
              />
              <NumberField
                label="白点"
                value={settings.inputWhite}
                min={settings.inputBlack + 2}
                max={255}
                step={1}
                onChange={value => applyAdjustedSettings(updateLevelInputWhite(settings, value))}
              />
            </div>
          </fieldset>
        </div>
        <footer className="levelCorrectionFooter">
          <button type="button" onClick={() => onChange(defaultLevelCorrectionSettings())}>初期補正値</button>
          <button type="button" onClick={() => onChange(noLevelCorrectionSettings())}>補正なし</button>
          <button type="button" onClick={onClose}>閉じる</button>
        </footer>
      </section>
    </div>
  )
}

function clampDialogPosition(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isInteractiveDialogDragTarget(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  return Boolean(element?.closest('button,input,select,textarea,a,[role="button"]'))
}

function LevelInputSlider({
  histogram,
  settings,
  onChange,
}: {
  histogram: number[] | null
  settings: LevelCorrectionSettings
  onChange: (settings: LevelCorrectionSettings) => void
}) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const blackPosition = (settings.inputBlack / 255) * 100
  const whitePosition = (settings.inputWhite / 255) * 100
  const gammaLevel = middleInputLevelForGamma(settings)
  const gammaPosition = (gammaLevel / 255) * 100
  const histogramPath = useMemo(() => histogramSvgPath(histogram), [histogram])

  function levelFromClientX(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.min(255, Math.max(0, Math.round(((clientX - rect.left) / rect.width) * 255)))
  }

  function updateHandle(handle: LevelCorrectionHandle, clientX: number) {
    const level = levelFromClientX(clientX)
    if (handle === 'black') {
      onChange(updateLevelInputBlack(settings, Math.min(level, settings.inputWhite - 2)))
      return
    }
    if (handle === 'white') {
      onChange(updateLevelInputWhite(settings, Math.max(level, settings.inputBlack + 2)))
      return
    }
    onChange(updateLevelGamma(settings, gammaForMiddleInputLevel(settings, Math.min(settings.inputWhite - 1, Math.max(settings.inputBlack + 1, level)))))
  }

  function beginDrag(handle: LevelCorrectionHandle, event: PointerEvent<HTMLButtonElement>) {
    event.currentTarget.setPointerCapture(event.pointerId)
    updateHandle(handle, event.clientX)
  }

  function continueDrag(handle: LevelCorrectionHandle, event: PointerEvent<HTMLButtonElement>) {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    updateHandle(handle, event.clientX)
  }

  function handleKeyDown(handle: LevelCorrectionHandle, event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.shiftKey ? 10 : 1
    const direction = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : 0
    if (direction === 0) return
    event.preventDefault()
    if (handle === 'black') onChange(updateLevelInputBlack(settings, settings.inputBlack + direction * step))
    if (handle === 'white') onChange(updateLevelInputWhite(settings, settings.inputWhite + direction * step))
    if (handle === 'gamma') onChange(updateLevelGamma(settings, gammaForMiddleInputLevel(settings, gammaLevel + direction * step)))
  }

  return (
    <div ref={trackRef} className="levelCorrectionSlider">
      <svg className="levelCorrectionHistogram" viewBox="0 0 255 80" preserveAspectRatio="none" aria-hidden="true">
        <path d={histogramPath} />
      </svg>
      <div className="levelCorrectionGradient" aria-hidden="true" />
      <LevelHandle
        kind="black"
        label="黒点"
        value={settings.inputBlack}
        min={0}
        max={settings.inputWhite - 2}
        position={blackPosition}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onKeyDown={handleKeyDown}
      />
      <LevelHandle
        kind="gamma"
        label="ガンマ"
        value={settings.gamma}
        min={0.1}
        max={9.99}
        position={gammaPosition}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onKeyDown={handleKeyDown}
      />
      <LevelHandle
        kind="white"
        label="白点"
        value={settings.inputWhite}
        min={settings.inputBlack + 2}
        max={255}
        position={whitePosition}
        onPointerDown={beginDrag}
        onPointerMove={continueDrag}
        onKeyDown={handleKeyDown}
      />
    </div>
  )
}

function LevelHandle({
  kind,
  label,
  value,
  min,
  max,
  position,
  onPointerDown,
  onPointerMove,
  onKeyDown,
}: {
  kind: LevelCorrectionHandle
  label: string
  value: number
  min: number
  max: number
  position: number
  onPointerDown: (kind: LevelCorrectionHandle, event: PointerEvent<HTMLButtonElement>) => void
  onPointerMove: (kind: LevelCorrectionHandle, event: PointerEvent<HTMLButtonElement>) => void
  onKeyDown: (kind: LevelCorrectionHandle, event: KeyboardEvent<HTMLButtonElement>) => void
}) {
  return (
    <button
      type="button"
      className={`levelCorrectionHandle ${kind}`}
      style={{ left: `${position}%` }}
      role="slider"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toFixed(kind === 'gamma' ? 2 : 0))}
      onPointerDown={event => onPointerDown(kind, event)}
      onPointerMove={event => onPointerMove(kind, event)}
      onKeyDown={event => onKeyDown(kind, event)}
    />
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  decimals = 0,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  decimals?: number
  onChange: (value: number) => void
}) {
  const id = useId()
  return (
    <label className="levelCorrectionNumberField" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={decimals > 0 ? value.toFixed(decimals) : String(Math.round(value))}
        onChange={event => onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function histogramSvgPath(histogram: number[] | null): string {
  if (!histogram || histogram.length === 0) return ''
  const max = Math.max(...histogram)
  if (max <= 0) return ''
  const width = 255
  const height = 80
  const scaleX = width / Math.max(1, histogram.length - 1)
  const points = histogram.map((count, index) => {
    const x = index * scaleX
    const y = height - Math.max(1, (Math.sqrt(count) / Math.sqrt(max)) * height)
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })
  return `M0,${height} L${points.join(' L')} L${width},${height} Z`
}

async function histogramForImageUrl(imageUrl: string): Promise<number[]> {
  const image = await loadImage(imageUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (sourceWidth <= 0 || sourceHeight <= 0) return []
  const maxSide = 640
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight))
  const width = Math.max(1, Math.round(sourceWidth * scale))
  const height = Math.max(1, Math.round(sourceHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return []
  context.drawImage(image, 0, 0, width, height)
  return buildLevelHistogram(context.getImageData(0, 0, width, height))
}
