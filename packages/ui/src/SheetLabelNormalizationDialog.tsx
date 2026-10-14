import { useMemo, useState, type ReactNode } from 'react'
import { buildSheetLabelNormalizationPlan, type SheetLabelNormalizationOptions } from '@xsheet-remap/core'
import type { NameNormalizationDialogProps } from './registered-cells-dialogs'
import { defaultNameNormalizationTarget, nameNormalizationOptionsForTarget, nameNormalizationTargetOptions, type NameNormalizationTarget } from './registered-cells-model'
import { uiText } from './i18n'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'

export function SheetLabelNormalizationDialog({ project, selectedKeyId, selectedHit, rangeSelection, onClose, onApply, modeControl }: NameNormalizationDialogProps & { modeControl: ReactNode }) {
  const [target, setTarget] = useState<NameNormalizationTarget>(defaultNameNormalizationTarget)
  const [method, setMethod] = useState<SheetLabelNormalizationOptions['method']>('strip-leading-zeros')
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState('')
  const dialog = useModalDialogKeyboardBoundary<HTMLDivElement>(onClose)
  const targets = nameNormalizationTargetOptions(project, selectedKeyId, selectedHit, rangeSelection)
  const plan = useMemo(() => {
    const { sheetRole, paperTracks, keyIds } = nameNormalizationOptionsForTarget(project, target, selectedKeyId, selectedHit, rangeSelection, '', false, undefined)
    return buildSheetLabelNormalizationPlan(project, { sheetRole, paperTracks, keyIds, method })
  }, [project, target, selectedKeyId, selectedHit, rangeSelection, method])
  const changed = plan.items.filter(item => item.currentLabel !== item.nextLabel).length
  const canApply = changed > 0 && !plan.conflicts.length && !applying
  async function apply() {
    if (!canApply) return
    setApplying(true)
    setError('')
    try { await onApply(plan) }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setApplying(false) }
  }
  return <div className="assetQuickPreviewBackdrop nameNormalizationBackdrop" role="dialog" aria-modal="true" aria-label={uiText.nameNormalization.sheetTitle} ref={dialog}>
    <section className="nameNormalizationDialog">
      <header className="nameNormalizationHeader"><strong>{uiText.nameNormalization.sheetTitle}</strong><button onClick={onClose}>{uiText.nameNormalization.cancel}</button></header>
      <div className="nameNormalizationBody">
        {modeControl}
        <p className="nameNormalizationDescription">シートに記載するセル名をまとめて変更します。CSP登録名・素材ファイル名・コマ配置は維持します。</p>
        <div className="nameNormalizationControls">
          <label>{uiText.nameNormalization.target}<select value={target} onChange={event => setTarget(event.currentTarget.value as NameNormalizationTarget)}>
            {targets.map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </select></label>
          <label>変更方法<select value={method} onChange={event => setMethod(event.currentTarget.value as SheetLabelNormalizationOptions['method'])}>
            <option value="strip-leading-zeros">数字の先頭のゼロを除く（0001 → 1）</option>
            <option value="sequence">列ごとに初出順で連番（1、2、3…）</option>
          </select></label>
        </div>
        <p className="nameNormalizationDescription">同じセルのすべての記載箇所に反映します。兼用カット・シートで共有するセルにも反映されます。空欄の素材カード、BG／BOOK、撮影指示、メモは対象外です。</p>
        {method === 'sequence' && <p className="nameNormalizationDescription">初出順は現在のカット・シートを基準にします。ここに登場しない記載済みセルは名前順で後に続きます。</p>}
        <div className="nameNormalizationSummary"><span>シート記載 {changed}件</span></div>
        {plan.conflicts.length > 0 && <div className="nameNormalizationWarnings" role="alert">
          <p>変更後の記載が重複するため適用できません。セルは統合しません。</p>
          {plan.conflicts.slice(0, 6).map(item => <p key={`${item.paperTrack}:${item.label}`}>{item.paperTrack}列：「{item.label}」が{item.keyIds.length}件</p>)}
        </div>}
        {error && <p className="nameNormalizationWarnings" role="alert">{error}</p>}
        {!plan.items.length && <p>対象に記載済みのセルがありません。</p>}
        <div className="nameNormalizationTableWrap"><table className="nameNormalizationTable sheetLabelNormalizationTable">
          <thead><tr><th>列</th><th>変更前のシート記載</th><th>変更後のシート記載</th><th>現在のシートの登場箇所</th></tr></thead>
          <tbody>{plan.items.slice(0, 160).map(item => <tr key={item.keyId}>
            <td>{item.paperTrack}</td><td>{item.currentLabel}</td><td>{item.currentLabel !== item.nextLabel ? <strong>{item.nextLabel}</strong> : item.nextLabel}</td><td>{item.occurrences}箇所</td>
          </tr>)}</tbody>
        </table></div>
        {plan.items.length > 160 && <p className="muted">{uiText.nameNormalization.moreRows(plan.items.length - 160)}</p>}
      </div>
      <footer className="nameNormalizationFooter"><button onClick={onClose}>{uiText.nameNormalization.cancel}</button>
        <button className="primary" disabled={!canApply} onClick={() => void apply()}>{applying ? uiText.nameNormalization.applying : 'この内容でシート記載を変更'}</button>
      </footer>
    </section>
  </div>
}
