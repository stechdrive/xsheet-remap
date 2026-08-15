import type { SheetTemplate } from '@xsheet-remap/core'
import { PaperTimelineLayoutPanel } from './PaperTimelineLayoutPanel'
import { type PaperTimelineAlignment, type PaperTimelineStructure } from './paperTimelineAuthoring'

export function PaperTimelineControls({
  template,
  structure,
  onChange,
  onOpenReference,
}: {
  template: SheetTemplate
  structure: PaperTimelineStructure
  onChange: (updater: (template: SheetTemplate) => SheetTemplate) => void
  onOpenReference: () => void
}) {
  return <PaperTimelineLayoutPanel template={template} structure={structure} onChange={onChange} onOpenReference={onOpenReference} />
}

export function PaperRegionAlignmentControls({ onAlign }: { onAlign: (alignment: PaperTimelineAlignment) => void }) {
  const actions: Array<[PaperTimelineAlignment, string]> = [
    ['left', '左'],
    ['center-x', '左右中央'],
    ['right', '右'],
    ['top', '上'],
    ['center-y', '上下中央'],
    ['bottom', '下'],
  ]
  return actions.map(([alignment, label]) => (
    <button key={alignment} type="button" aria-label={`${label}へ整列`} onClick={() => onAlign(alignment)}>{label}</button>
  ))
}

export type PaperRebuildStep = 'reference' | 'outline' | 'columns' | 'information' | 'review'

export function PaperRebuildGuide({
  activeStep,
  hasReference,
  onSelectStep,
  onClose,
}: {
  activeStep: PaperRebuildStep
  hasReference: boolean
  onSelectStep: (step: PaperRebuildStep) => void
  onClose: () => void
}) {
  const steps: Array<{ id: PaperRebuildStep; label: string; description: string }> = [
    { id: 'reference', label: '1. 下絵', description: hasReference ? '読込済み' : '画像を読み込む' },
    { id: 'outline', label: '2. 6秒表', description: '外周を合わせる' },
    { id: 'columns', label: '3. 列境界', description: '4欄の幅を合わせる' },
    { id: 'information', label: '4. シート情報', description: '文字と欄を合わせる' },
    { id: 'review', label: '5. 確認', description: '不足を確認する' },
  ]
  return (
    <section className="templateRebuildGuide" aria-label="下絵から再構築">
      <header>
        <strong>下絵から再構築</strong>
        <span>画像に沿って必要な箇所だけ順番に合わせます。</span>
      </header>
      <ol>
        {steps.map(step => (
          <li key={step.id}>
            <button
              type="button"
              className={activeStep === step.id ? 'active' : undefined}
              aria-current={activeStep === step.id ? 'step' : undefined}
              onClick={() => onSelectStep(step.id)}
            >
              <strong>{step.label}</strong>
              <span>{step.description}</span>
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="templateRebuildGuideClose" onClick={onClose}>ガイドを閉じる</button>
    </section>
  )
}
