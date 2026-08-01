import { parseSheetTemplate, type NormalizedRect, type SheetTemplate } from '@xsheet-remap/core'

export type TemplateAuthoringIssueSeverity = 'error' | 'warning'

export type TemplateAuthoringIssueCode =
  | 'template-id-missing'
  | 'template-name-missing'
  | 'template-schema-invalid'
  | 'region-id-missing'
  | 'region-label-missing'
  | 'region-id-duplicate'
  | 'region-grid-row-count-invalid'
  | 'region-rect-non-positive'
  | 'region-rect-outside-page'
  | 'input-region-missing'
  | 'reference-image-ppi-mismatch'
  | 'calibration-target-invalid'
  | 'calibration-target-fallback'
  | 'calibration-target-missing'

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
export function validateTemplateAuthoring(template: SheetTemplate): TemplateAuthoringValidationResult {
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
  let hasInputRegion = false
  let calibrationGridCount = 0
  let calibrationLeft = Number.POSITIVE_INFINITY
  let calibrationTop = Number.POSITIVE_INFINITY
  let calibrationRight = Number.NEGATIVE_INFINITY
  let calibrationBottom = Number.NEGATIVE_INFINITY

  for (const [regionIndex, region] of template.regions.entries()) {
    const regionId = region.regionId.trim()
    const regionName = region.label.trim() || regionId || `領域 ${regionIndex + 1}`
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
        message: `領域「${regionId || regionIndex + 1}」の名前が空です。領域一覧で判別できる名前を入力してください。`,
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
      && region.type === 'exposure-grid'
      && region.grid
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

  if (errors.length === 0) {
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
