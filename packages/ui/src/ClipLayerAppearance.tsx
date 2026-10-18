import { useRef, useState } from 'react'
import type { ClipLayerNode } from '@xsheet-remap/core'
import { TooltipTarget } from './Tooltip'

export const clipBlendModes: [number, string][] = [[0, '通常'], [1, '比較（暗）'], [2, '乗算'], [3, '焼き込みカラー'], [4, '焼き込み（リニア）'], [5, '減算'], [7, '比較（明）'], [8, 'スクリーン'], [9, '覆い焼きカラー'], [11, '加算'], [14, 'オーバーレイ'], [15, 'ソフトライト'], [16, 'ハードライト'], [21, '差の絶対値'], [22, '除外'], [23, '色相'], [24, '彩度'], [25, 'カラー'], [26, '輝度'], [30, '通過']]
export const clipBlendLabel = (mode: number) => clipBlendModes.find(([value]) => value === mode)?.[1] ?? `既存のモード（${mode}）`

export function ClipLayerAppearance({ node, disabled, onChange }: { node?: ClipLayerNode; disabled?: boolean; onChange: (updates: { opacity?: number; blendMode?: number }) => void }) {
  const [draft, setDraft] = useState<number | null>(null)
  const draftRef = useRef<number | null>(null)
  function change(value: number | null) { draftRef.current = value; setDraft(value) }
  function commit() {
    const value = draftRef.current
    change(null)
    if (node && value !== null && Number.isFinite(value) && value / 100 !== node.opacity) onChange({ opacity: Math.max(0, Math.min(100, value)) / 100 })
  }
  return <fieldset className="clipLayerAppearance" aria-label="レイヤープロパティ" disabled={disabled || !node || node.locked || node.kind === 'audio'}>
    <TooltipTarget label="合成モード">{tooltip => <select {...tooltip} aria-label="レイヤーの合成モード" value={node?.blendMode ?? 0} onChange={event => onChange({ blendMode: Number(event.target.value) })}>
      {node && !clipBlendModes.some(([value]) => value === node.blendMode) && <option value={node.blendMode}>{clipBlendLabel(node.blendMode)}</option>}
      {clipBlendModes.filter(([value]) => value !== 30 || node?.kind === 'folder' || node?.kind === 'animation').map(([value, name]) => <option key={value} value={value}>{name}</option>)}
    </select>}</TooltipTarget>
    <div className="clipOpacityControl" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); change(null) } }}>
      <TooltipTarget label="不透明度">{tooltip => <input {...tooltip} type="range" aria-label="レイヤーの不透明度スライダー" min={0} max={100} value={draft ?? Math.round((node?.opacity ?? 1) * 100)} onChange={event => change(Number(event.target.value))} onPointerUp={commit} onPointerCancel={() => change(null)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commit() }} onBlur={() => { tooltip.onBlur(); commit() }} />}</TooltipTarget>
      <TooltipTarget label="不透明度（%）">{tooltip => <input {...tooltip} type="number" aria-label="レイヤーの不透明度" min={0} max={100} value={draft ?? Math.round((node?.opacity ?? 1) * 100)} onChange={event => change(Number(event.target.value))} onBlur={() => { tooltip.onBlur(); commit() }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { commit(); event.currentTarget.blur() } }} />}</TooltipTarget><span>%</span>
    </div>
  </fieldset>
}
