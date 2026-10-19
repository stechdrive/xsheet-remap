// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
import type { MaterialAdjustment, MaterialEffects, MaterialQuad, TextObject } from './rendering'

/** Data-only representation, transferred from the CLIP worker. Children are top first. */
export interface ClipPixels {
  width: number
  height: number
  left: number
  top: number
  rgba: Uint8ClampedArray
  defaultColor?: number
  disabled?: boolean
}

export interface ClipLayer {
  id: string
  name: string
  isFolder: boolean
  isAnimationFolder: boolean
  expanded: boolean
  hidden: boolean
  opacity: number
  clipping: boolean
  children: ClipLayer[]
  pixels?: ClipPixels
  fragments?: ClipPixels[]
  mask?: ClipPixels
  kind?: 'raster' | 'folder' | 'camera' | 'text' | 'image-material' | 'vector' | '3d' | 'adjustment' | 'other'
  nativeBlendMode?: number
  materialSource?: 'render' | 'timeline-original' | 'image-original' | 'object-cache' | 'text' | 'fill' | 'gradient' | 'adjustment' | 'vector'
  vectorRendering?: 'approximate' | 'unavailable'
  unsupported3D?: boolean
  placement?: MaterialQuad
  text?: TextObject[]
  effects?: MaterialEffects
  adjustment?: MaterialAdjustment
}

export interface ClipDiagnostic {
  scope: 'raster' | 'timeline'
  message: string
  layerId?: string
  rendering?: boolean
  part?: 'material' | 'effect' | 'mask' | 'placement' | 'blend'
  outcome?: 'approximate' | 'missing-content' | 'missing-effect'
  materialKind?: 'vector' | 'text' | '3d'
}

/** A save preference does not prove that every layer has a saved image. */
export type ClipCompatibility = 'saved' | 'not-saved' | 'unknown'
