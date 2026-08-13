import type { SheetTemplate } from '@xsheet-remap/core'
import { PaperTimelineLayoutPanel } from './PaperTimelineLayoutPanel'
import { PAPER_TIMELINE_TARGET_ID, type PaperTimelineAlignment, type PaperTimelineStructure } from './paperTimelineAuthoring'
import { TemplateRegionCollectionEditor } from './TemplateRegionCollectionEditor'

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

export function TemplateRegionCollectionControls({
  template,
  selectedRegionId,
  structure,
  onOpenDetails,
  onOpenTimeline,
}: {
  template: SheetTemplate
  selectedRegionId: string | null
  structure: PaperTimelineStructure | null
  onOpenDetails: (regionId: string) => void
  onOpenTimeline: () => void
}) {
  return <TemplateRegionCollectionEditor
    template={template}
    selectedRegionId={selectedRegionId}
    onOpenDetails={onOpenDetails}
    paperTimeline={structure ? {
      targetId: PAPER_TIMELINE_TARGET_ID,
      managedRegionIds: structure.managedRegionIds,
      onOpen: onOpenTimeline,
    } : undefined}
  />
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

export function PaperReferenceWorkflow({ hasReference, onOpenLayout }: { hasReference: boolean; onOpenLayout: () => void }) {
  return (
    <section className="paperReferenceWorkflow" aria-label="用紙画像から作成する手順">
      <header><span>用紙画像から作成</span><h2>画像に表を合わせる</h2></header>
      <ol>
        <li className={hasReference ? 'complete' : 'active'}><strong>1. 用紙画像</strong><span>{hasReference ? '読込済み' : '画像を読み込みます'}</span></li>
        <li><strong>2. 6秒表の外周</strong><span>表全体の位置と大きさを合わせます</span></li>
        <li><strong>3. 列境界</strong><span>ACTION・SOUND・CELL・CAMERAを合わせます</span></li>
        <li><strong>4. シート情報</strong><span>必要な情報欄を個別要素で調整します</span></li>
      </ol>
      <button type="button" onClick={onOpenLayout}>6秒タイムライン表を調整</button>
    </section>
  )
}
