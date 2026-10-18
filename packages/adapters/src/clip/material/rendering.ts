// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
export interface EdgeEffect { radius: number; color: [number, number, number] }
export interface MaterialEffects {
  layerColor?: { main: [number, number, number]; sub: [number, number, number] }
  edge?: EdgeEffect
}

export type MaterialAdjustment = { kind: 'invert' } | { kind: 'threshold'; threshold: number }

/** Corners in document space: top left, top right, bottom right, bottom left. */
export type MaterialQuad = [number, number, number, number, number, number, number, number]

export interface TextObject {
  text: string
  left: number
  top: number
  width: number
  height: number
  font: string
  size: number
  color: [number, number, number]
  align: 'left' | 'center' | 'right'
  runs: { start: number; length: number; font: string; size: number; color: [number, number, number] }[]
}
