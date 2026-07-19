import { useId, useState } from 'react'
import { uiText } from './i18n'
import { clampNumber } from './sheetInteraction'

export function DurationFrameControl({
  frames,
  fps,
  onChange,
  showLabel = true,
  autoFocus = false,
  maxFrames,
  label = uiText.sheet.duration,
}: {
  frames: number
  fps: number
  onChange: (frames: number) => void
  showLabel?: boolean
  autoFocus?: boolean
  maxFrames?: number
  label?: string
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
      {showLabel && <span id={labelId}>{label}</span>}
      <span
        className="durationStepper"
        role="group"
        aria-label={showLabel ? undefined : label}
        aria-labelledby={showLabel ? labelId : undefined}
      >
        <DurationStepperUnit
          displayValue={formatDurationPart(seconds, 2)}
          max={999}
          autoFocus={autoFocus}
          inputLabel={`${label} 秒`}
          upLabel={`${label}を1秒増やす`}
          downLabel={`${label}を1秒減らす`}
          onInput={value => setDurationParts(value, frameRemainder)}
          onStep={delta => step(delta * safeFps)}
        />
        <span className="durationSeparator" aria-hidden="true">+</span>
        <DurationStepperUnit
          displayValue={formatDurationPart(frameRemainder, 2)}
          max={safeFps - 1}
          inputLabel={`${label} コマ`}
          upLabel={`${label}を1コマ増やす`}
          downLabel={`${label}を1コマ減らす`}
          onInput={value => setDurationParts(seconds, value)}
          onStep={step}
        />
      </span>
    </div>
  )
}

export function CompactDurationFrameControl({
  frames,
  fps,
  onChange,
  minFrames = 1,
  maxFrames,
  label,
}: {
  frames: number
  fps: number
  onChange: (frames: number) => void
  minFrames?: number
  maxFrames?: number
  label: string
}) {
  const safeFps = Math.max(1, Math.round(fps))
  const minimum = Math.max(0, Math.round(minFrames))
  const maximum = Math.max(minimum, Math.round(maxFrames ?? (999 * safeFps + safeFps - 1)))
  const normalizedFrames = clampNumber(Math.round(frames), minimum, maximum)
  const [draft, setDraft] = useState<string | null>(null)

  function commit(rawValue: string) {
    const parsed = parseCompactDuration(rawValue, safeFps)
    const next = clampNumber(parsed ?? normalizedFrames, minimum, maximum)
    onChange(next)
    setDraft(null)
  }

  function updateDraft(rawValue: string) {
    setDraft(rawValue)
    const parsed = parseCompactDuration(rawValue, safeFps)
    if (parsed === null) return
    onChange(clampNumber(parsed, minimum, maximum))
  }

  function step(delta: number) {
    const next = clampNumber(normalizedFrames + delta, minimum, maximum)
    onChange(next)
    setDraft(null)
  }

  return (
    <span className="compactDurationFrameControl" role="group" aria-label={`${label}ステッパー`}>
      <input
        value={draft ?? formatCompactDuration(normalizedFrames, safeFps)}
        inputMode="numeric"
        aria-label={label}
        onFocus={() => setDraft(formatCompactDuration(normalizedFrames, safeFps))}
        onChange={event => updateDraft(event.currentTarget.value)}
        onBlur={event => commit(event.currentTarget.value)}
        onKeyDown={event => {
          if (event.key === 'ArrowUp') {
            event.preventDefault()
            step(1)
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault()
            step(-1)
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            commit(event.currentTarget.value)
            event.currentTarget.select()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setDraft(formatCompactDuration(normalizedFrames, safeFps))
            event.currentTarget.select()
          }
        }}
      />
      <span className="compactDurationArrowStack">
        <button type="button" aria-label={`${label}を1コマ増やす`} onClick={() => step(1)}>▲</button>
        <button type="button" aria-label={`${label}を1コマ減らす`} onClick={() => step(-1)}>▼</button>
      </span>
    </span>
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

export function formatCompactDuration(frames: number, fps: number): string {
  const safeFps = Math.max(1, Math.round(fps))
  const safeFrames = Math.max(0, Math.round(frames))
  return `${Math.floor(safeFrames / safeFps)}+${safeFrames % safeFps}`
}

export function parseCompactDuration(value: string, fps: number): number | null {
  const normalized = value
    .trim()
    .replace(/[０-９]/g, character => String.fromCharCode(character.charCodeAt(0) - 0xfee0))
    .replace(/[＋]/g, '+')
  const safeFps = Math.max(1, Math.round(fps))
  const timecode = normalized.match(/^(\d+)\s*\+\s*(\d*)$/)
  if (timecode) return Number(timecode[1]) * safeFps + Number(timecode[2] || 0)
  if (/^\d+$/.test(normalized)) return Number(normalized)
  return null
}
