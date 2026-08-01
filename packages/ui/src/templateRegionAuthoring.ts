import type {
  NormalizedRect,
  SheetTemplate,
  SheetTemplateFieldDefinition,
  SheetTemplateFormCell,
  SheetTemplateGridRole,
  SheetTemplateRegion,
} from '@xsheet-remap/core'

const REGION_OFFSET_PX = 12

const REGION_TYPE_LABELS = {
  'metadata-field': 'カット情報',
  'memo-area': 'メモ欄',
  'exposure-grid': 'タイムライン',
  'frame-guide': 'フレームガイド',
  'count-table': '集計表',
  'process-check-area': '工程チェック欄',
  'form-table': 'フォーム',
  'annotation-area': '注釈欄',
  decorative: '補助線・装飾',
} satisfies Record<SheetTemplateRegion['type'], string>

const REGION_TYPE_PURPOSES = {
  'metadata-field': 'タイトル、話数、カット番号など、カットの情報をシートに表示します。',
  'memo-area': 'シートまたはページごとのメモを入力・表示する領域です。',
  'exposure-grid': 'フレームとトラックを行列で表し、タイミングや指示を編集する領域です。',
  'frame-guide': 'フレーム位置を読み取るための目盛りやガイドを表示します。',
  'count-table': 'トラックごとの枚数や合計値を入力・表示する集計表です。',
  'process-check-area': '作業工程ごとの担当や確認状態を入力・表示する領域です。',
  'form-table': '固定の見出しや入力項目を、行列のフォームとして配置します。',
  'annotation-area': '手書き注釈や自由記入をシート上に保持する領域です。',
  decorative: '入力機能を持たない罫線、外枠、余白などを表示します。',
} satisfies Record<SheetTemplateRegion['type'], string>

const GRID_ROLE_LABELS = {
  action: '動作タイムライン',
  sound: 'セリフ・音声タイムライン',
  cell: 'セルタイムライン',
  camera: 'カメラタイムライン',
  'frame-guide': 'フレームガイド',
  'count-table': '集計グリッド',
  other: 'グリッド',
} satisfies Record<SheetTemplateGridRole, string>

const GRID_ROLE_PURPOSES = {
  action: '動作や作画指示をフレーム単位で編集するタイムラインです。',
  sound: 'セリフや音声区間をフレーム範囲として編集するタイムラインです。',
  cell: 'セル番号や作画タイミングをフレーム単位で編集するタイムラインです。',
  camera: 'カメラワークと撮影指示をフレーム範囲として編集するタイムラインです。',
  'frame-guide': 'フレーム位置を読み取るための目盛りと罫線を表示します。',
  'count-table': 'フレームまたはトラックの集計を行列で表示します。',
  other: 'フレームと列の共通グリッドを表示します。',
} satisfies Record<SheetTemplateGridRole, string>

export type TemplateRegionPlacementMode = 'free' | 'horizontal-span' | 'horizontal-flow'

export function templateRegionAuthoringName(region: SheetTemplateRegion): string {
  return region.authoringName?.trim() || region.label?.trim() || region.regionId
}

export function templateRegionKindLabel(region: SheetTemplateRegion): string {
  if (region.type === 'decorative') return REGION_TYPE_LABELS.decorative
  if (region.grid) return GRID_ROLE_LABELS[region.grid.role]
  if (region.type === 'form-table' && isFixedHeadingForm(region)) return '固定見出し'
  if (region.type === 'form-table' && region.form?.projection) return '集計表'
  if (region.type === 'form-table' && region.form?.cells?.some(cell => cell.kind === 'field')) return '入力フォーム'
  return REGION_TYPE_LABELS[region.type]
}

export function templateRegionPurposeText(region: SheetTemplateRegion): string {
  if (region.type === 'decorative') return REGION_TYPE_PURPOSES.decorative
  if (region.grid) return GRID_ROLE_PURPOSES[region.grid.role]
  if (region.type === 'form-table' && isFixedHeadingForm(region)) {
    return 'TITLEやCUTなど、シートに印刷する固定の見出し文字を配置します。'
  }
  if (region.type === 'memo-area' || region.type === 'annotation-area') {
    return REGION_TYPE_PURPOSES[region.type]
  }
  if (region.binding?.target === 'cut-metadata') {
    return 'タイトル、話数、カット番号など、プロジェクトのカット情報を表示します。'
  }
  if (region.binding?.target === 'cut-group') {
    return '複数カットの共通番号を、シート用の表記で表示します。'
  }
  if (region.binding?.target === 'timeline-section') {
    return 'プロジェクトのタイムライン区分と対応し、その入力内容を表示します。'
  }
  if (region.binding?.target === 'annotation-layer') {
    return '対応する注釈レイヤーの手書きメモや指示を表示します。'
  }
  return REGION_TYPE_PURPOSES[region.type]
}

export function templateRegionUsageText(region: SheetTemplateRegion): string {
  if (region.usage === 'ignored') return '現在はシートで使わない領域'
  if (region.grid && region.type !== 'decorative') return 'タイムライン上で入力・選択する領域'
  if (region.usage === 'input') return 'プロジェクトで入力・編集する領域'
  if (region.usage === 'reference') return '注釈や参照内容を表示・選択する領域'
  return 'シートへ描画する領域（直接入力なし）'
}

export function templateRegionManagementNameHint(region: SheetTemplateRegion): string {
  if (region.grid) {
    return '領域一覧で見分けるための管理名です。空欄では既存の領域ラベルを使います。シート上のグリッド見出しは「表示する見出し」で別に編集できます。'
  }
  if (isFixedHeadingForm(region)) {
    return '領域一覧で見分けるための管理名です。空欄では既存の領域ラベルを使います。TITLEなどシート上の文字は「表示文字」で別に編集できます。'
  }
  if (region.usage === 'input' || region.binding) {
    return '領域一覧で見分けるための管理名です。空欄では既存の領域ラベルを使います。領域ラベルは種類によって入力画面やメモ対象の名前にも使われます。'
  }
  return '領域一覧で見分けるための管理名です。空欄では既存の領域ラベルまたはIDを表示します。'
}

export function editableTemplateRegionLabelCells(region: SheetTemplateRegion): SheetTemplateFormCell[] {
  return (region.form?.cells ?? [])
    .filter(cell => cell.kind === 'label')
    .sort((left, right) => left.row - right.row || left.column - right.column || left.cellId.localeCompare(right.cellId))
}

export function updateTemplateRegionFormCell(
  region: SheetTemplateRegion,
  cellId: string,
  updates: Partial<Omit<SheetTemplateFormCell, 'cellId'>>,
): SheetTemplateRegion {
  const form = region.form
  const cells = form?.cells
  const cellIndex = cells?.findIndex(cell => cell.cellId === cellId) ?? -1
  if (!form || !cells || cellIndex < 0) return region
  const nextCells = [...cells]
  nextCells[cellIndex] = { ...cells[cellIndex], ...updates }
  return { ...region, form: { ...form, cells: nextCells } }
}

export function updateTemplateFieldDefinition(
  template: SheetTemplate,
  fieldId: string,
  updates: Partial<Omit<SheetTemplateFieldDefinition, 'fieldId'>>,
): SheetTemplate {
  const fields = template.fields
  const fieldIndex = fields?.findIndex(field => field.fieldId === fieldId) ?? -1
  if (!fields || fieldIndex < 0) return template
  const nextFields = [...fields]
  nextFields[fieldIndex] = { ...fields[fieldIndex], ...updates }
  return { ...template, fields: nextFields }
}

export function updateTemplateRegionGridFrameRange(
  region: SheetTemplateRegion,
  updates: { frameStart?: number; frameEnd?: number; rowCount?: number },
  fallbackFrameStart = 1,
): SheetTemplateRegion {
  if (!region.grid) return region
  const frameStart = finiteRoundedInteger(updates.frameStart ?? region.grid.frameStart ?? fallbackFrameStart, fallbackFrameStart)
  const rowCount = updates.rowCount !== undefined
    ? positiveRoundedInteger(updates.rowCount)
    : updates.frameEnd !== undefined
      ? Math.max(1, finiteRoundedInteger(updates.frameEnd, frameStart) - frameStart + 1)
      : positiveRoundedInteger(region.grid.rowCount)
  const frameEnd = frameStart + rowCount - 1
  return {
    ...region,
    grid: { ...region.grid, frameStart, rowCount, frameEnd },
  }
}

export function templateRegionPlacementMode(
  template: SheetTemplate,
  region: SheetTemplateRegion,
): TemplateRegionPlacementMode {
  if (region.horizontalSpan?.source === 'resolved-page-content') return 'horizontal-span'
  if (template.horizontalFlow?.regionIds.includes(region.regionId)) return 'horizontal-flow'
  return 'free'
}

export function templateRegionPlacementDescription(
  template: SheetTemplate,
  region: SheetTemplateRegion,
): string {
  const mode = templateRegionPlacementMode(template, region)
  if (mode === 'horizontal-span') {
    return '左右の余白を保ったまま、キャンバスの幅に合わせて横幅が自動調整されます。'
  }
  if (mode === 'horizontal-flow') {
    return '同じ横並びグループ内の順番と間隔から、X位置と幅が自動調整されます。'
  }
  return 'X・Y・幅・高さを直接指定して配置します。'
}

export function duplicateTemplateRegion(
  template: SheetTemplate,
  regionId: string,
): { template: SheetTemplate; regionId: string } | null {
  const sourceIndex = template.regions.findIndex(region => region.regionId === regionId)
  const source = template.regions[sourceIndex]
  if (!source) return null

  const nextRegionId = uniqueTemplateRegionId(template, `${source.regionId}_copy`)
  const copy = structuredClone(source)
  copy.regionId = nextRegionId
  copy.authoringName = uniqueTemplateRegionAuthoringName(template, `${templateRegionAuthoringName(source)} コピー`)
  copy.rect = offsetRegionRect(source.rect, template, sourceIndex + 1)

  const regions = [...template.regions]
  regions.splice(sourceIndex + 1, 0, copy)
  return { template: { ...template, regions }, regionId: nextRegionId }
}

export function moveTemplateRegion(
  template: SheetTemplate,
  regionId: string,
  direction: -1 | 1,
): SheetTemplate {
  const sourceIndex = template.regions.findIndex(region => region.regionId === regionId)
  const targetIndex = sourceIndex + direction
  if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= template.regions.length) return template
  const regions = [...template.regions]
  const [region] = regions.splice(sourceIndex, 1)
  regions.splice(targetIndex, 0, region)
  return { ...template, regions }
}

export function placeNewTemplateRegion(
  template: SheetTemplate,
  rect: NormalizedRect,
): NormalizedRect {
  const offsetX = REGION_OFFSET_PX / Math.max(1, template.page.widthPx)
  const offsetY = REGION_OFFSET_PX / Math.max(1, template.page.heightPx)
  let candidate = clampRect(rect)

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!template.regions.some(region => substantiallyOverlaps(candidate, region.rect))) return candidate
    candidate = clampRect({ ...candidate, x: candidate.x + offsetX, y: candidate.y + offsetY })
  }
  return candidate
}

function offsetRegionRect(rect: NormalizedRect, template: SheetTemplate, salt: number): NormalizedRect {
  const offsetX = (REGION_OFFSET_PX * Math.max(1, salt % 4)) / Math.max(1, template.page.widthPx)
  const offsetY = (REGION_OFFSET_PX * Math.max(1, salt % 4)) / Math.max(1, template.page.heightPx)
  return clampRect({ ...rect, x: rect.x + offsetX, y: rect.y + offsetY })
}

export function uniqueTemplateRegionId(template: SheetTemplate, base: string): string {
  const ids = new Set(template.regions.map(region => region.regionId))
  if (!ids.has(base)) return base
  let suffix = 2
  while (ids.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

function uniqueTemplateRegionAuthoringName(template: SheetTemplate, base: string): string {
  const names = new Set(template.regions.map(templateRegionAuthoringName))
  if (!names.has(base)) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`)) suffix += 1
  return `${base} ${suffix}`
}

function isFixedHeadingForm(region: SheetTemplateRegion): boolean {
  const cells = region.form?.cells ?? []
  return cells.some(cell => cell.kind === 'label')
    && !cells.some(cell => cell.kind === 'field' || cell.kind === 'annotation')
    && !region.form?.projection
}

function finiteRoundedInteger(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.round(value) : Math.round(fallback)
}

function positiveRoundedInteger(value: number): number {
  return Math.max(1, finiteRoundedInteger(value, 1))
}

function substantiallyOverlaps(a: NormalizedRect, b: NormalizedRect): boolean {
  const intersectionWidth = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const intersectionHeight = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  if (intersectionWidth === 0 || intersectionHeight === 0) return false
  const smallerArea = Math.min(a.w * a.h, b.w * b.h)
  return smallerArea > 0 && (intersectionWidth * intersectionHeight) / smallerArea >= 0.85
}

function clampRect(rect: NormalizedRect): NormalizedRect {
  const w = Math.min(1, Math.max(0.0001, rect.w))
  const h = Math.min(1, Math.max(0.0001, rect.h))
  return {
    x: Math.min(1 - w, Math.max(0, rect.x)),
    y: Math.min(1 - h, Math.max(0, rect.y)),
    w,
    h,
  }
}
