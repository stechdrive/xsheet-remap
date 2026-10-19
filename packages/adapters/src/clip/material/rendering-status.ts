// Adapted from csp-paperback a454748 (MIT, Copyright (c) 2025 stechdrive).
// Preview diagnostics only; no PSD pairing or transparent-export policies.
import type { ClipCompatibility, ClipDiagnostic, ClipLayer } from './types'

export function compatibilityAdvice(compatibility?: ClipCompatibility): string {
  return compatibility === 'saved'
    ? '互換情報は保存されていますが、このレイヤーの描画画像を取得できませんでした。'
    : 'クリスタの［環境設定］→［ファイル］で［バージョン互換情報の保存］を［保存する］に設定し、［別名で保存］からCLIPを保存し直して、再度読み込んでください。同じ名前・同じ場所への上書きもできます。'
}

/** Diagnose the final material route, never a failed candidate that was recovered. */
export function layerRenderingDiagnostics(layer: ClipLayer, compatibility?: ClipCompatibility): ClipDiagnostic[] {
  const result: ClipDiagnostic[] = []
  const add = (message: string, part: ClipDiagnostic['part'], outcome: ClipDiagnostic['outcome'], materialKind?: ClipDiagnostic['materialKind']) => result.push({
    scope: 'raster', layerId: layer.id, message: `「${layer.name}」: ${message}`, rendering: true, part, outcome, materialKind,
  })
  const advice = compatibilityAdvice(compatibility)
  if (layer.unsupported3D || layer.vectorRendering === 'unavailable') {
    const kind = layer.unsupported3D ? '3d' : 'vector'
    add(`${kind === '3d' ? '3D' : 'ベクター'}レイヤーの描画画像を取得できないため、プレビューを表示できません。\n${advice}`, 'material', 'missing-content', kind)
  } else if (layer.vectorRendering === 'approximate') {
    add(`ベクターレイヤーを近似描画しています。線幅・濃さ・ブラシ形状に差が生じる場合があります。\n${advice}`, 'material', 'approximate', 'vector')
  } else if (layer.materialSource === 'text') {
    add(`文字情報から描画しています。フォント・縦書き・組版に差が生じる場合があります。\n${advice}`, 'material', 'approximate', 'text')
  }
  if (layer.effects?.watercolor) {
    if (layer.effects.watercolor.style) add('この種類の水彩境界には未対応です。効果を除いた元の描画を表示します。', 'effect', 'missing-effect')
    else if (layer.effects.watercolor.range > 0 && layer.effects.watercolor.opacity > 0) add('水彩境界を近似描画しています。縁の濃さやぼかしに差が生じる場合があります。', 'effect', 'approximate')
  }
  if (layer.effects?.tone) add('トーンには未対応です。トーン化前の描画を表示します。', 'effect', 'missing-effect')
  return result
}
