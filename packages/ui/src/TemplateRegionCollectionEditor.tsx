import type { SheetTemplate, SheetTemplateRegion } from '@xsheet-remap/core'
import { metadataBindingOptionId, metadataBindingOptionLabel } from './template-workspace-model'
import {
  editableTemplateRegionLabelCells,
  templateRegionAuthoringName,
  templateRegionKindLabel,
  templateRegionPurposeText,
} from './templateRegionAuthoring'

export function TemplateRegionCollectionEditor({
  template,
  selectedRegionId,
  onOpenDetails,
}: {
  template: SheetTemplate
  selectedRegionId: string | null
  onOpenDetails: (regionId: string) => void
}) {
  return (
    <section className="templateRegionCollection" aria-label="すべての領域">
      <header className="templateRegionCollectionHeader">
        <div>
          <strong>編集する領域を選ぶ</strong>
          <span>{template.regions.length}件</span>
        </div>
        <p>役割とシート上の内容を確認してから、1件ずつ編集します。</p>
      </header>
      <div className="templateRegionCollectionList">
        {template.regions.map(region => {
          const selected = region.regionId === selectedRegionId
          const name = templateRegionAuthoringName(region)
          return (
            <article key={region.regionId} className={`templateRegionCollectionCard ${selected ? 'selected' : ''}`.trim()}>
              <button
                type="button"
                className="templateRegionCollectionSummary"
                aria-label={`${name}を編集`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onOpenDetails(region.regionId)}
              >
                <span className="templateRegionCollectionIdentity">
                  <strong>{name}</strong>
                  <span>{templateRegionKindLabel(region)}</span>
                </span>
                <span className="templateRegionCollectionPurpose">{templateRegionPurposeText(region)}</span>
                <span className="templateRegionCollectionContent">{templateRegionContentSummary(region)}</span>
                <span className="templateRegionCollectionSelection" aria-hidden="true">{selected ? '選択中・編集する' : '編集する'}</span>
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function templateRegionContentSummary(region: SheetTemplateRegion): string {
  const labelCells = editableTemplateRegionLabelCells(region)
  if (labelCells.length > 0) {
    const visibleLabels = labelCells.flatMap(cell => cell.label?.trim() ? [cell.label.trim()] : [])
    const preview = visibleLabels.slice(0, 6).join(' / ')
    return preview ? `シート上の表示文字: ${preview}${visibleLabels.length > 6 ? ' …' : ''}` : 'シート上の表示文字を設定できます'
  }
  const bindingId = metadataBindingOptionId(region.binding)
  if (bindingId) return `表示する情報: ${metadataBindingOptionLabel(bindingId)}`
  if (region.grid) {
    const start = region.grid.frameStart ?? 1
    const end = start + region.grid.rowCount - 1
    return `${start}–${end}F / ${region.grid.rowCount}行 / ${region.grid.columns.length}列`
  }
  if (region.form?.projection) {
    return `投影項目: ${region.form.projection.columns.map(column => column.label).join(' / ')}`
  }
  const inputCellCount = region.form?.cells?.filter(cell => cell.kind === 'field' || cell.kind === 'annotation').length ?? 0
  if (inputCellCount > 0) return `入力・注釈欄: ${inputCellCount}件`
  return region.usage === 'render-only' ? 'シートへ表示する描画領域' : 'シート上で使う入力領域'
}
