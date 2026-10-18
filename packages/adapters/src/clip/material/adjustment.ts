// Adapted from csp-paperback 2809271 (MIT, Copyright (c) 2025 stechdrive).
// See THIRD_PARTY_NOTICES.md. Preview decoding only; export policies are not imported.
// FilterLayerInfo framing: Aodaruma/clipfile-rs; equations: wamsoft/clipparse (MIT).
import { check, Reader } from './binary'
import type { MaterialAdjustment } from './rendering'

export function readAdjustment(bytes: Uint8Array): MaterialAdjustment {
  const r = new Reader(bytes), kind = r.u32(), length = r.u32()
  check(length === bytes.length - 8, '色調補正のデータ長が不正です')
  if (kind === 6 && length === 0) return { kind: 'invert' }
  if (kind === 8 && length === 4) {
    const threshold = r.u32()
    check(threshold <= 255, '2値化のしきい値が範囲外です')
    return { kind: 'threshold', threshold }
  }
  throw new Error(`色調補正 ${kind} の画素演算は未対応です。ほかのレイヤーは引き続き確認できます`)
}
