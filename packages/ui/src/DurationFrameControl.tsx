import { useId } from 'react'
import { uiText } from './i18n'
import { clampNumber } from './sheetInteraction'

export function DurationFrameControl({
  frames,
  fps,
  onChange,
  showLabel = true,
  autoFocus = false,
  maxFrames,
}: {
  frames: number
  fps: number
  onChange: (frames: number) => void
  showLabel?: boolean
  autoFocus?: boolean
  maxFrames?: number
}) {
  const labelId = useId()
  const safeFps = Math.max(1, Math.round(fps))
  const maximum = Math.max(1, Math.round(maxFrames ?? (999 * safeFps + safeFps - 1)))
  const { seconds, frameRemainder } = durationParts(frames, safeFps)

  function setDurationParts(nextSeconds: number, nextFrameRemainder: number) {
    const clampedSeconds = clampNumber(Math.round(nextSeconds), 0, 999)
    const clampedRemainder = clampNumber(Math.round(nextFrameRemainder), 0, safeFps - 1)
    onChange(clampNumber(Math.max(1, clampedSeconds * safeFps + clampedRemainder), 1, maximum))
  }

  function step(delta: number) {
    onChange(clampNumber(Math.round(frames) + delta, 1, maximum))
  }

  return (
    <div className={`compactControl durationControl${showLabel ? '' : ' durationControlWithoutLabel'}`}>
      {showLabel && <span id={labelId}>{uiText.sheet.duration}</span>}
      <span
        className="durationStepper"
        role="group"
        aria-label={showLabel ? undefined : uiText.sheet.duration}
        aria-labelledby={showLabel ? labelId : undefined}
      >
        <DurationStepperUnit
          displayValue={formatDurationPart(seconds, 2)}
          max={999}
          autoFocus={autoFocus}
          inputLabel={uiText.sheet.durationSeconds}
          upLabel={uiText.sheet.durationSecondsUp}
          downLabel={uiText.sheet.durationSecondsDown}
          onInput={value => setDurationParts(value, frameRemainder)}
          onStep={delta => step(delta * safeFps)}
        />
        <span className="durationSeparator" aria-hidden="true">+</span>
        <DurationStepperUnit
          displayValue={formatDurationPart(frameRemainder, 2)}
          max={safeFps - 1}
          inputLabel={uiText.sheet.durationFrames}
          upLabel={uiText.sheet.durationFramesUp}
          downLabel={uiText.sheet.durationFramesDown}
          onInput={value => setDurationParts(seconds, value)}
          onStep={step}
        />
      </span>
    </div>
  )
}

function DurationStepperUnit({
  displayValue,
  autoFocus = false,
  inputLabel,
  upLabel,
  downLabel,
  max,
  onInput,
  onStep,
}: {
  displayValue: string
  autoFocus?: boolean
  inputLabel: string
  upLabel: string
  downLabel: string
  max: number
  onInput: (value: number) => void
  onStep: (delta: number) => void
}) {
  function handleInput(rawValue: string) {
    const normalized = rawValue
      .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
      .replace(/\D/g, '')
    const value = normalized ? Number(normalized) : 0
    onInput(clampNumber(value, 0, max))
  }

  return (
    <span className="durationUnitStepper">
      <input
        autoFocus={autoFocus}
        className="durationInput"
        value={displayValue}
        inputMode="numeric"
        aria-label={inputLabel}
        onChange={event => handleInput(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            onStep(1)
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            onStep(-1)
          }
        }}
      />
      <span className="durationArrowStack">
        <button type="button" className="durationArrowButton" aria-label={upLabel} onClick={() => onStep(1)}>▲</button>
        <button type="button" className="durationArrowButton" aria-label={downLabel} onClick={() => onStep(-1)}>▼</button>
      </span>
    </span>
  )
}

function durationParts(frames: number, fps: number): { seconds: number; frameRemainder: number } {
  const safeFrames = Math.max(1, Math.round(frames))
  return {
    seconds: Math.floor(safeFrames / fps),
    frameRemainder: safeFrames % fps,
  }
}

function formatDurationPart(value: number, minDigits: number): string {
  return String(Math.max(0, Math.round(value))).padStart(minDigits, '0')
}
