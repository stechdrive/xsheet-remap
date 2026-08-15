import { isRenderableSheetTemplateGridRegion, parseSheetTemplate, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'
import { detectPaperTimelineStructure, paperTimelineColumnWidthMm, paperTimelineRoleRegion } from './paperTimelineAuthoring'

export type TemplateAuthoringIssueSeverity = 'error' | 'warning'

export type TemplateAuthoringIssueCode =
  | 'template-id-missing'
  | 'template-name-missing'
  | 'template-schema-invalid'
  | 'region-id-missing'
  | 'region-label-missing'
  | 'region-authoring-name-invalid'
  | 'region-id-duplicate'
  | 'region-fixed-label-missing'
  | 'field-label-missing'
  | 'field-choice-missing'
  | 'region-binding-id-missing'
  | 'region-grid-row-count-invalid'
  | 'region-rect-non-positive'
  | 'region-rect-outside-page'
  | 'input-region-missing'
  | 'reference-image-ppi-mismatch'
  | 'calibration-target-invalid'
  | 'calibration-target-fallback'
  | 'calibration-target-missing'
  | 'paper-timeline-required'
  | 'paper-timeline-row-alignment-invalid'
  | 'paper-timeline-time-contract-invalid'
  | 'paper-timeline-column-narrow'
  | 'infinite-page-binding-invalid'

export type TemplateAuthoringIssueField =
  | 'templateId'
  | 'name'
  | 'regions'
  | 'regionId'
  | 'rect'
  | 'referenceImage'
  | 'calibration'
  | 'schema'

export interface TemplateAuthoringIssue {
  code: TemplateAuthoringIssueCode
  severity: TemplateAuthoringIssueSeverity
  field: TemplateAuthoringIssueField
  message: string
  regionId?: string
  regionIndex?: number
}

export type TemplateAuthoringCalibrationSource = 'explicit' | 'grid-bounds' | 'none'

export interface TemplateAuthoringValidationResult {
  canComplete: boolean
  issues: readonly TemplateAuthoringIssue[]
  errors: readonly TemplateAuthoringIssue[]
  warnings: readonly TemplateAuthoringIssue[]
  calibrationTargetSource: TemplateAuthoringCalibrationSource
}

const PAGE_EDGE_EPSILON = 0.000001
const IMAGE_PPI_TOLERANCE = 0.002
const CALIBRATION_GRID_ROLES = new Set(['action', 'sound', 'cell', 'camera'])

/**
 * Checks whether an in-memory template draft is ready to save and test.
 * This intentionally avoids schema parsing, cloning, and serialization so it
 * can run after ordinary authoring edits without adding noticeable UI work.
 */
export function validateTemplateAuthoring(
  template: SheetTemplate,
  options: { deep?: boolean } = {},
): TemplateAuthoringValidationResult {
  const issues: TemplateAuthoringIssue[] = []
  const errors: TemplateAuthoringIssue[] = []
  const warnings: TemplateAuthoringIssue[] = []
  const addIssue = (issue: TemplateAuthoringIssue) => {
    issues.push(issue)
    if (issue.severity === 'error') errors.push(issue)
    else warnings.push(issue)
  }

  if (!template.templateId.trim()) {
    addIssue({
      code: 'template-id-missing',
      severity: 'error',
      field: 'templateId',
      message: 'テンプレートIDが空です。他のテンプレートと重複しないIDを入力してください。',
    })
  }
  if (!template.name.trim()) {
    addIssue({
      code: 'template-name-missing',
      severity: 'error',
      field: 'name',
      message: 'テンプレート名が空です。一覧で用途が分かる名前を入力してください。',
    })
  }

  const seenRegionIds = new Set<string>()
  const duplicateRegionIds = new Set<string>()
  const reportedFieldIds = new Set<string>()
  const reportedChoiceFieldIds = new Set<string>()
  const reportedInfinitePageBindings = new Set<string>()
  const infiniteTemplate = template.layoutMode === 'infinite-digital' || template.viewLayout?.type === 'infinite'
  const pageFieldIds = new Set(template.fields
    ?.filter(field => field.builtinBinding?.target === 'cut-metadata' && field.builtinBinding.field === 'page')
    .map(field => field.fieldId) ?? [])
  let hasInputRegion = false
  let calibrationGridCount = 0
  let calibrationLeft = Number.POSITIVE_INFINITY
  let calibrationTop = Number.POSITIVE_INFINITY
  let calibrationRight = Number.NEGATIVE_INFINITY
  let calibrationBottom = Number.NEGATIVE_INFINITY

  for (const [regionIndex, region] of template.regions.entries()) {
    const regionId = region.regionId.trim()
    const regionName = region.authoringName?.trim() || region.label.trim() || regionId || `領域 ${regionIndex + 1}`
    if (region.authoringName !== undefined && !region.authoringName.trim()) {
      addIssue({
        code: 'region-authoring-name-invalid',
        severity: 'error',
        field: 'regions',
        regionId: region.regionId,
        regionIndex,
        message: `領域「${regionName}」の編集画面での名前が空白だけになっています。名前を入力するか、空欄へ戻してください。`,
      })
    }
    if (!regionId) {
      addIssue({
        code: 'region-id-missing',
        severity: 'error',
        field: 'regionId',
        regionIndex,
        message: `領域 ${regionIndex + 1} のIDが空です。領域を作り直すか、有効なIDを設定してください。`,
      })
    } else {
      if (seenRegionIds.has(regionId) && !duplicateRegionIds.has(regionId)) {
        duplicateRegionIds.add(regionId)
        addIssue({
          code: 'region-id-duplicate',
          severity: 'error',
          field: 'regionId',
          regionId,
          regionIndex,
          message: `領域ID「${regionId}」が重複しています。各領域へ異なるIDを割り当ててください。`,
        })
      }
      seenRegionIds.add(regionId)
    }
    if (!region.label.trim()) {
      addIssue({
        code: 'region-label-missing',
        severity: 'error',
        field: 'regions',
        regionId: region.regionId,
        regionIndex,
        message: `領域「${regionName}」の機能上の領域ラベルが空です。詳細設定で入力してください。`,
      })
    }

    for (const cell of region.form?.cells ?? []) {
      if (cell.kind === 'label' && !cell.label?.trim()) {
        addIssue({
          code: 'region-fixed-label-missing',
          severity: 'error',
          field: 'regions',
          regionId: region.regionId,
          regionIndex,
          message: `領域「${regionName}」のシート上の表示文字が空です。不要な欄でなければ表示文字を入力してください。`,
        })
      }
      if (cell.kind === 'field' && cell.fieldId && !reportedFieldIds.has(cell.fieldId)) {
        const definition = template.fields?.find(field => field.fieldId === cell.fieldId)
        if (definition && !definition.label.trim()) {
          reportedFieldIds.add(cell.fieldId)
          addIssue({
            code: 'field-label-missing',
            severity: 'error',
            field: 'regions',
            regionId: region.regionId,
            regionIndex,
            message: `領域「${regionName}」の入力画面での項目名が空です。項目名を入力してください。`,
          })
        }
        if (definition?.valueType === 'choice'
          && (!definition.choices?.length || new Set(definition.choices).size !== definition.choices.length)
          && !reportedChoiceFieldIds.has(cell.fieldId)) {
          reportedChoiceFieldIds.add(cell.fieldId)
          addIssue({
            code: 'field-choice-missing',
            severity: 'error',
            field: 'regions',
            regionId: region.regionId,
            regionIndex,
            message: `領域「${regionName}」の選択項目には、重複しない選択肢を1つ以上入力してください。`,
          })
        }
      }
      if (infiniteTemplate && cell.kind === 'field' && cell.fieldId && pageFieldIds.has(cell.fieldId)) {
        const issueKey = `${region.regionId}:${cell.fieldId}`
        if (!reportedInfinitePageBindings.has(issueKey)) {
          reportedInfinitePageBindings.add(issueKey)
          addIssue({
            code: 'infinite-page-binding-invalid',
            severity: 'error',
            field: 'regions',
            regionId: region.regionId,
            regionIndex,
            message: `無限スクロール型の領域「${regionName}」にはページ番号項目を配置できません。ページ番号欄を削除してください。`,
          })
        }
      }
    }

    if (infiniteTemplate && region.binding?.target === 'cut-metadata' && region.binding.field === 'page') {
      addIssue({
        code: 'infinite-page-binding-invalid',
        severity: 'error',
        field: 'regions',
        regionId: region.regionId,
        regionIndex,
        message: `無限スクロール型の領域「${regionName}」にはページ番号を割り当てられません。ページ番号領域を削除してください。`,
      })
    }

    const bindingIdMissing = region.binding?.target === 'annotation-layer' && !region.binding.layerId.trim()
      || region.binding?.target === 'cut-metadata' && region.binding.field === 'custom' && !region.binding.customKey?.trim()
    if (bindingIdMissing) {
      addIssue({
        code: 'region-binding-id-missing',
        severity: 'error',
        field: 'regions',
        regionId: region.regionId,
        regionIndex,
        message: `領域「${regionName}」のデータ割当に必要なIDが空です。領域の詳細で保存先またはカスタム項目IDを入力してください。`,
      })
    }

    if (region.grid && (!Number.isInteger(region.grid.rowCount) || region.grid.rowCount <= 0)) {
      addIssue({
        code: 'region-grid-row-count-invalid',
        severity: 'error',
        field: 'regions',
        regionId: region.regionId,
        regionIndex,
        message: `領域「${regionName}」の行数が不正です。1以上の整数を入力してください。`,
      })
    }

    const hasFiniteRect = rectValues(region.rect).every(Number.isFinite)
    const hasPositiveSize = hasFiniteRect && region.rect.w > 0 && region.rect.h > 0
    if (!hasPositiveSize) {
      addIssue({
        code: 'region-rect-non-positive',
        severity: 'error',
        field: 'rect',
        regionId: region.regionId,
        regionIndex,
        message: `領域「${regionName}」の矩形が不正です。幅と高さを0より大きい有限値にしてください。`,
      })
    }
    if (hasFiniteRect && !rectIsInsidePage(region.rect)) {
      addIssue({
        code: 'region-rect-outside-page',
        severity: 'error',
        field: 'rect',
        regionId: region.regionId,
        regionIndex,
        message: `領域「${regionName}」がページ外にはみ出しています。X・Y・W・Hをページ内へ収めてください。`,
      })
    }

    if (region.usage === 'input') hasInputRegion = true

    if (hasPositiveSize
      && isRenderableSheetTemplateGridRegion(region)
      && CALIBRATION_GRID_ROLES.has(region.grid.role)) {
      calibrationGridCount += 1
      calibrationLeft = Math.min(calibrationLeft, region.rect.x)
      calibrationTop = Math.min(calibrationTop, region.rect.y)
      calibrationRight = Math.max(calibrationRight, region.rect.x + region.rect.w)
      calibrationBottom = Math.max(calibrationBottom, region.rect.y + region.rect.h)
    }
  }

  if (!hasInputRegion) {
    addIssue({
      code: 'input-region-missing',
      severity: 'error',
      field: 'regions',
      message: '入力可能な領域がありません。情報欄、入力表、ACTION・SOUND・CELL・CAMERAなどを1つ以上追加してください。',
    })
  }

  const paperTimeline = detectPaperTimelineStructure(template)
  if (paperTimeline) {
    if (paperTimeline.status === 'incomplete') {
      addIssue({
        code: 'paper-timeline-required',
        severity: 'error',
        field: 'regions',
        message: `紙テンプレートに必須の6秒表が不足しています。${paperTimeline.missingLabels.join(' / ')}をそろえてください。`,
      })
    } else {
      if (paperTimeline.status === 'misaligned') {
        addIssue({
          code: 'paper-timeline-row-alignment-invalid',
          severity: 'error',
          field: 'regions',
          message: '紙タイムシートの横罫線が領域間でずれています。「用紙レイアウト」で全領域を共通の72行へ揃えてください。',
        })
      }
      if (template.defaults.fps !== 24 || template.defaults.durationFrames !== 144 || template.defaults.frameOrigin !== 1) {
        addIssue({
          code: 'paper-timeline-time-contract-invalid',
          severity: 'error',
          field: 'regions',
          message: '紙タイムシートは24fps、左3秒72行、右3秒72行、合計144フレームで使用します。',
        })
      }
      for (const role of ['action', 'sound', 'cell', 'camera'] as const) {
        const region = paperTimelineRoleRegion(template, paperTimeline, role)
        if (!region || paperTimelineColumnWidthMm(region, template) >= 2.5) continue
        addIssue({
          code: 'paper-timeline-column-narrow',
          severity: 'warning',
          field: 'rect',
          regionId: region.regionId,
          message: `${role.toUpperCase()}の1列幅が2.5mm未満です。印刷後に読み書きしづらくなる可能性があります。`,
        })
      }
    }
  }

  if (template.page.isPhysical) {
    addReferenceImageDensityIssue(template, addIssue)
  }

  const explicitCalibrationTarget = template.calibration?.targetRect
  const gridCalibrationTarget = calibrationGridCount > 0
    ? {
        x: calibrationLeft,
        y: calibrationTop,
        w: calibrationRight - calibrationLeft,
        h: calibrationBottom - calibrationTop,
      }
    : null
  const calibrationTargetSource: TemplateAuthoringCalibrationSource = explicitCalibrationTarget
    ? 'explicit'
    : gridCalibrationTarget
      ? 'grid-bounds'
      : 'none'
  const calibrationTarget = explicitCalibrationTarget ?? gridCalibrationTarget

  if (calibrationTarget && (!rectHasPositiveFiniteSize(calibrationTarget) || !rectIsInsidePage(calibrationTarget))) {
    addIssue({
      code: 'calibration-target-invalid',
      severity: 'error',
      field: 'calibration',
      message: '補正基準枠がページ内の正の矩形ではありません。補正基準枠のX・Y・W・Hを確認してください。',
    })
  } else if (template.page.isPhysical && calibrationTargetSource === 'grid-bounds') {
    addIssue({
      code: 'calibration-target-fallback',
      severity: 'warning',
      field: 'calibration',
      message: '補正基準枠が未指定のため、ACTION・SOUND・CELL・CAMERA領域の外接矩形を使います。実際の用紙罫線に合うか確認してください。',
    })
  } else if (template.page.isPhysical && calibrationTargetSource === 'none') {
    addIssue({
      code: 'calibration-target-missing',
      severity: 'warning',
      field: 'calibration',
      message: '紙テンプレートの補正基準枠を決められません。補正基準枠を設定するか、ACTION・SOUND・CELL・CAMERA領域を追加してください。',
    })
  }

  if (errors.length === 0 && options.deep !== false) {
    try {
      parseSheetTemplate(template)
    } catch (error) {
      addIssue({
        code: 'template-schema-invalid',
        severity: 'error',
        field: 'schema',
        message: `保存形式として不正な設定があります。${error instanceof Error ? error.message : String(error)}`,
      })
    }
  }

  return {
    canComplete: errors.length === 0,
    issues,
    errors,
    warnings,
    calibrationTargetSource,
  }
}

function addReferenceImageDensityIssue(
  template: SheetTemplate,
  addIssue: (issue: TemplateAuthoringIssue) => void,
): void {
  const templatePpi = template.page.dpi
  const imagePpiX = template.defaultUnderlay?.imageRef.ppiX ?? template.defaultUnderlay?.placement?.ppiX
  const imagePpiY = template.defaultUnderlay?.imageRef.ppiY ?? template.defaultUnderlay?.placement?.ppiY
  if (!isPositiveFinite(templatePpi) || !isPositiveFinite(imagePpiX) || !isPositiveFinite(imagePpiY)) return
  if (relativeDifference(templatePpi, imagePpiX) <= IMAGE_PPI_TOLERANCE
    && relativeDifference(templatePpi, imagePpiY) <= IMAGE_PPI_TOLERANCE) return

  addIssue({
    code: 'reference-image-ppi-mismatch',
    severity: 'warning',
    field: 'referenceImage',
    message: `参照画像のPPI（${formatPpi(imagePpiX)} × ${formatPpi(imagePpiY)}）がテンプレートのPPI（${formatPpi(templatePpi)}）と一致しません。画像またはテンプレートのPPIを揃えてください。`,
  })
}

function rectValues(rect: NormalizedRect): number[] {
  return [rect.x, rect.y, rect.w, rect.h]
}

function rectHasPositiveFiniteSize(rect: NormalizedRect): boolean {
  return rectValues(rect).every(Number.isFinite) && rect.w > 0 && rect.h > 0
}

function rectIsInsidePage(rect: NormalizedRect): boolean {
  return rect.x >= 0
    && rect.y >= 0
    && rect.x + rect.w <= 1 + PAGE_EDGE_EPSILON
    && rect.y + rect.h <= 1 + PAGE_EDGE_EPSILON
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function relativeDifference(expected: number, actual: number): number {
  return Math.abs(actual - expected) / Math.max(1, Math.abs(expected))
}

function formatPpi(value: number): string {
  return Number(value.toFixed(2)).toString()
}
