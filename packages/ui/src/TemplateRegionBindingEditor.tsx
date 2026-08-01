import type { SheetTemplateRegion, SheetTemplateRegionBinding } from '@xsheet-remap/core'
import {
  METADATA_BINDING_OPTION_IDS,
  metadataBindingFromOptionId,
  metadataBindingOptionId,
  metadataBindingOptionLabel,
  type MetadataBindingOptionId,
} from './template-workspace-model'
import { templateRegionAuthoringName } from './templateRegionAuthoring'

export function TemplateRegionBindingEditor({
  region,
  onChange,
}: {
  region: SheetTemplateRegion
  onChange: (binding: SheetTemplateRegionBinding) => void
}) {
  const binding = region.binding
  if (!binding) return null
  const name = templateRegionAuthoringName(region)

  if (binding.target === 'cut-metadata' || binding.target === 'cut-group') {
    const optionId = metadataBindingOptionId(binding)
    return (
      <section className="templateRegionDetailSection" aria-labelledby="template-region-data-heading">
        <h3 id="template-region-data-heading">表示する情報</h3>
        <label className="templateInspectorField templateInspectorFieldWide">
          <span>プロジェクトから表示する値</span>
          <select
            aria-label={`${name}の表示する情報`}
            value={optionId ?? 'cut:title'}
            onChange={event => onChange(metadataBindingFromOptionId(event.currentTarget.value as MetadataBindingOptionId))}
          >
            {METADATA_BINDING_OPTION_IDS.map(candidate => (
              <option key={candidate} value={candidate}>{metadataBindingOptionLabel(candidate)}</option>
            ))}
          </select>
          <small>プロジェクトごとに変わる実データです。TITLEやCUTなど、固定の表示文字とは別です。</small>
        </label>
        {binding.target === 'cut-metadata' && binding.field === 'custom' && (
          <label className="templateInspectorField templateInspectorFieldWide">
            <span>カスタム項目ID</span>
            <input
              aria-label={`${name}のカスタム項目ID`}
              value={binding.customKey ?? ''}
              onChange={event => onChange({ ...binding, customKey: event.currentTarget.value })}
            />
            <small>同じIDを使う入力欄と値を共有します。空欄にはできません。</small>
          </label>
        )}
        {binding.target === 'cut-group' && (
          <fieldset className="templateRegionFieldGroup">
            <legend>兼用カットの表記</legend>
            <div className="templateRegionInputDefinitionFields">
              <label className="templateInspectorField"><span>先頭</span><input aria-label={`${name}の兼用カット先頭文字`} value={binding.opening ?? ''} onChange={event => onChange({ ...binding, opening: event.currentTarget.value })} /></label>
              <label className="templateInspectorField"><span>区切り</span><input aria-label={`${name}の兼用カット区切り文字`} value={binding.separator ?? ''} onChange={event => onChange({ ...binding, separator: event.currentTarget.value })} /></label>
              <label className="templateInspectorField"><span>末尾</span><input aria-label={`${name}の兼用カット末尾文字`} value={binding.closing ?? ''} onChange={event => onChange({ ...binding, closing: event.currentTarget.value })} /></label>
            </div>
          </fieldset>
        )}
      </section>
    )
  }

  if (binding.target === 'annotation-layer') {
    return (
      <section className="templateRegionDetailSection" aria-labelledby="template-region-annotation-binding-heading">
        <h3 id="template-region-annotation-binding-heading">注釈の保存先</h3>
        <div className="templateRegionInputDefinitionFields">
          <label className="templateInspectorField templateInspectorFieldWide">
            <span>注釈レイヤーID</span>
            <input aria-label={`${name}の注釈レイヤーID`} value={binding.layerId} onChange={event => onChange({ ...binding, layerId: event.currentTarget.value })} />
            <small>同じIDの領域は同じ注釈データを参照します。配置上の領域IDとは別です。</small>
          </label>
          <label className="templateInspectorField">
            <span>注釈の用途</span>
            <select
              aria-label={`${name}の注釈用途`}
              value={binding.intent ?? ''}
              onChange={event => {
                const intent = event.currentTarget.value as NonNullable<Extract<SheetTemplateRegionBinding, { target: 'annotation-layer' }>['intent']> | ''
                onChange(intent ? { ...binding, intent } : withoutProperty(binding, 'intent'))
              }}
            >
              <option value="">指定なし</option>
              <option value="memo">メモ</option>
              <option value="camera-note">撮影・カメラ指示</option>
              <option value="process-note">工程メモ</option>
              <option value="free">自由注釈</option>
            </select>
          </label>
        </div>
      </section>
    )
  }

  return (
    <section className="templateRegionDetailSection" aria-labelledby="template-region-timeline-binding-heading">
      <h3 id="template-region-timeline-binding-heading">タイムライン割当</h3>
      <div className="templateRegionInputDefinitionFields">
        <label className="templateInspectorField">
          <span>タイムラインの役割</span>
          <select
            aria-label={`${name}のタイムライン役割`}
            value={binding.role}
            onChange={event => onChange({ ...binding, role: event.currentTarget.value as typeof binding.role })}
          >
            <option value="action">ACTION</option>
            <option value="sound">SOUND</option>
            <option value="cell">CELL</option>
            <option value="camera">CAMERA</option>
          </select>
        </label>
        <label className="templateInspectorField">
          <span>区分ID（任意）</span>
          <input
            aria-label={`${name}のタイムライン区分ID`}
            value={binding.sectionId ?? ''}
            onChange={event => onChange(event.currentTarget.value ? { ...binding, sectionId: event.currentTarget.value } : withoutProperty(binding, 'sectionId'))}
          />
        </label>
      </div>
    </section>
  )
}

function withoutProperty<Source extends object, Key extends keyof Source>(source: Source, key: Key): Omit<Source, Key> {
  const copy = { ...source }
  delete copy[key]
  return copy
}
