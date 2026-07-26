import { memo, useMemo } from 'react'
import type { DialogueAudioAsset, DialogueAudioClip } from './dialogueAudioProject'

const WAVEFORM_CENTER = 24
const WAVEFORM_HALF_HEIGHT = 21
const WAVEFORM_MIN_VISIBLE_HEIGHT = 1.25

export const DialogueAudioWaveform = memo(function DialogueAudioWaveform(props: {
  asset: DialogueAudioAsset
  clip: DialogueAudioClip
  color: string
  frameOrigin: number
  durationFrames: number
}) {
  const path = useMemo(() => createDialogueAudioWaveformPath(props.asset.waveform), [props.asset.waveform])
  if (!path) return null
  const assetFrames = Math.max(1, props.asset.durationFrames)
  const viewX = props.clip.sourceOffsetFrames / assetFrames * 1000
  const viewWidth = Math.max(1, props.clip.durationFrames / assetFrames * 1000)
  return <svg
    className="dialogueWaveform"
    viewBox={`${viewX} 0 ${viewWidth} 48`}
    preserveAspectRatio="none"
    style={waveformRangeStyle(props.clip.timelineStartFrame, props.clip.timelineStartFrame + props.clip.durationFrames - 1, props.frameOrigin, props.durationFrames)}
    aria-hidden="true"
  ><path d={path} fill={props.color} /></svg>
})

export function createDialogueAudioWaveformPath(points: number[]): string {
  if (points.length === 0) return ''
  const upperPath = points.map((value, index) => {
    const x = index / Math.max(1, points.length - 1) * 1000
    const y = WAVEFORM_CENTER - dialogueAudioWaveformDisplayAmplitude(value) * WAVEFORM_HALF_HEIGHT
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(2)}`
  }).join(' ')
  const lowerPath = [...points].reverse().map((value, reverseIndex) => {
    const index = points.length - reverseIndex - 1
    const x = index / Math.max(1, points.length - 1) * 1000
    const y = WAVEFORM_CENTER + dialogueAudioWaveformDisplayAmplitude(value) * WAVEFORM_HALF_HEIGHT
    return `L${x.toFixed(1)} ${y.toFixed(2)}`
  }).join(' ')
  return `${upperPath} ${lowerPath} Z`
}

export function dialogueAudioWaveformDisplayAmplitude(valueInput: number): number {
  const value = Number.isFinite(valueInput) ? Math.min(1, Math.max(0, Math.abs(valueInput))) : 0
  if (value === 0) return 0
  return Math.max(WAVEFORM_MIN_VISIBLE_HEIGHT / WAVEFORM_HALF_HEIGHT, Math.sqrt(value))
}

function waveformRangeStyle(frameStart: number, frameEnd: number, frameOrigin: number, durationFrames: number) {
  const safeDuration = Math.max(1, durationFrames)
  return {
    left: `${(frameStart - frameOrigin) / safeDuration * 100}%`,
    width: `${Math.max(1, frameEnd - frameStart + 1) / safeDuration * 100}%`,
  }
}
