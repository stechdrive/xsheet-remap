import { TextSizeNumberInput } from './TextSizeNumberInput'
import type { TextSizeOperation } from './sheetTextSizing'

export type SheetTextSizeControlModel = {
  label: string; value: number | null; secondary?: number | null; primaryLabel: string; secondaryLabel: string
  mode: string; disabled: boolean; count: number; onApply: (operation: TextSizeOperation) => void
  targetKey: string
  notice?: string
}

export function SheetTextSizeControl({ model }: { model: SheetTextSizeControlModel }) {
  return <SheetTextSizeInputs key={model.targetKey} model={model} />
}

function SheetTextSizeInputs({ model }: { model: SheetTextSizeControlModel }) {
  return <div className="sheetTextSizeSettings">
    <div className="sheetTextSizeTarget">{model.label}</div>
    <div className="sheetTextSizeRow">
      <span>文字サイズ</span>
      <button type="button" aria-label="選択文字を小さく" disabled={model.disabled} onClick={() => model.onApply({ kind: 'step', direction: -1 })}>−</button>
      <TextSizeNumberInput value={model.value} label="入力文字" disabled={model.disabled} onChange={value => model.onApply({ kind: 'set', value })} />
      <span>px</span>
      <button type="button" aria-label="選択文字を大きく" disabled={model.disabled} onClick={() => model.onApply({ kind: 'step', direction: 1 })}>＋</button>
    </div>
    <div className="sheetTextSizeActions">
      <span>{model.mode}</span>
      <button type="button" disabled={model.disabled} onClick={() => model.onApply({ kind: 'reset' })}>標準に戻す</button>
      <button type="button" disabled={model.disabled || model.count === 0} onClick={() => model.onApply({ kind: 'fit' })}>枠に収める</button>
    </div>
    {model.secondary !== undefined && <details><summary>文字ごとに調整</summary>
      <label className="sheetTextSizeRow">{model.primaryLabel}<TextSizeNumberInput value={model.value} label={`${model.primaryLabel}の文字サイズ`} disabled={model.disabled}
        onChange={value => model.onApply({ kind: 'set', part: 'primary', value })} /><span>px</span></label>
      <label className="sheetTextSizeRow">{model.secondaryLabel}<TextSizeNumberInput value={model.secondary} label={`${model.secondaryLabel}の文字サイズ`} disabled={model.disabled}
        onChange={value => model.onApply({ kind: 'set', part: 'secondary', value })} /><span>px</span></label>
    </details>}
    {model.notice && <p role="status" className="sheetTextSizeNotice">{model.notice}</p>}
  </div>
}
