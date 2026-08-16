import type { TemplateAuthoringValidationResult } from './templateAuthoringValidation'

export function TemplateAuthoringReview({
  validation,
  onOpenRegion,
  onSave,
  saveLabel,
}: {
  validation: TemplateAuthoringValidationResult
  onOpenRegion: (regionId: string) => void
  onSave: () => void
  saveLabel: string
}) {
  return (
    <section className="templateAuthoringReview" aria-live="polite">
      <header className={validation.canComplete ? 'ready' : 'blocked'}>
        <strong>{validation.canComplete ? '保存できます' : '修正が必要です'}</strong>
        <span>エラー {validation.errors.length}件 / 注意 {validation.warnings.length}件</span>
      </header>
      {validation.issues.length === 0 ? (
        <p>テンプレートID、入力領域、ページ内配置、補正基準を確認しました。</p>
      ) : (
        <ol>
          {validation.issues.map((issue, index) => (
            <li key={`${issue.code}-${issue.regionId ?? 'template'}-${index}`} className={issue.severity}>
              <strong>{issue.severity === 'error' ? '修正' : '確認'}</strong>
              <span>{issue.message}</span>
              {issue.regionId && <button type="button" onClick={() => onOpenRegion(issue.regionId!)}>対象領域を開く</button>}
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="primary" disabled={!validation.canComplete} onClick={onSave}>{saveLabel}</button>
    </section>
  )
}
