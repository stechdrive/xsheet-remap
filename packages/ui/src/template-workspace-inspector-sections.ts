import type { SheetTemplate, SheetTemplateRegion } from '@xsheet-remap/core'
import type { TemplateInspectorSection } from './TemplateInspectorNavigation'
import { templateRegionAuthoringName, templateRegionKindLabel } from './templateRegionAuthoring'

export function templateWorkspaceNavigationItems(template: SheetTemplate, managedRegionIds?: ReadonlySet<string>) {
  return template.regions
    .filter(region => !managedRegionIds?.has(region.regionId))
    .map(region => ({ regionId: region.regionId, label: templateRegionAuthoringName(region), kind: templateRegionKindLabel(region) }))
}

export function templateWorkspaceInspectorSections({
  hasPaperTimeline,
  isDigitalTemplate,
  selectedRegion,
}: {
  hasPaperTimeline: boolean
  isDigitalTemplate: boolean
  selectedRegion: SheetTemplateRegion | null
}): TemplateInspectorSection[] {
  return [
    ...(hasPaperTimeline ? [{
      id: 'layout' as const,
      label: '用紙レイアウト',
      description: '左右3秒・72行を共有する6秒タイムライン表として、位置、サイズ、列幅、列数を調整します。',
      group: 'edit' as const,
    }] : []),
    {
      id: 'template',
      label: '基本設定',
      description: '名前、用紙、初期フレームなどテンプレート全体を設定します。',
      group: 'edit',
    },
    {
      id: 'table',
      label: hasPaperTimeline ? '要素を個別調整' : '領域',
      navigationLabel: hasPaperTimeline ? '個別要素' : undefined,
      description: hasPaperTimeline
        ? 'シート情報、文字列、補助枠など、6秒タイムライン表以外の要素を編集します。'
        : '領域ごとの役割、表示文字、データ割当、配置を確認して編集します。',
      group: 'edit',
    },
    {
      id: 'region',
      label: selectedRegion ? selectedRegion.authoringName ?? selectedRegion.label : '選択領域',
      description: selectedRegion
        ? `「${(selectedRegion.authoringName ?? selectedRegion.label) || selectedRegion.regionId}」の内容、割当、位置、見た目を設定します。`
        : 'キャンバスまたは左の一覧で領域を選んで設定します。',
      group: 'edit',
      parentId: 'table',
    },
    {
      id: 'display',
      label: '見た目',
      description: '色、罫線、見出し、初期列名など表示を整えます。',
      group: 'edit',
    },
    ...(!isDigitalTemplate ? [{
      id: 'reference' as const,
      label: '用紙画像から作成',
      navigationLabel: '参照画像',
      description: '元の紙シート画像を読み込み、用紙、6秒表、列境界、シート情報の順に合わせます。',
      group: 'edit' as const,
    }] : []),
    {
      id: 'review',
      label: '確認・保存',
      description: '不足や配置ミスを確認してからテンプレートを保存します。',
      group: 'manage',
    },
    {
      id: 'json',
      label: 'JSON',
      description: '完成データを確認します。通常の作成では編集する必要はありません。',
      group: 'manage',
    },
  ]
}
