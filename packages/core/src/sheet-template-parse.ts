import { SHEET_TEMPLATE_SCHEMA_VERSION, type NormalizedRect, type SheetTemplate, type SheetTemplateRegion } from './sheet-template-schema'
import { isSheetTemplateTheme } from './sheet-template-theme'

/** Validates an external JSON value before it becomes an editable sheet template. */
export function parseSheetTemplate(input: unknown): SheetTemplate {
  if (!isRecord(input)) throw new Error('シートテンプレートJSONではありません。')
  if (!hasOnlyKeys(input, sheetTemplateTopLevelKeys)) {
    throw new Error('テンプレートJSONに未対応のトップレベル項目があります。')
  }
  if (input.schemaVersion !== SHEET_TEMPLATE_SCHEMA_VERSION) {
    throw new Error(`対応していないシートテンプレートバージョンです: ${String(input.schemaVersion)}`)
  }
  if (!nonEmptyString(input.templateId) || !nonEmptyString(input.name)) {
    throw new Error('テンプレートIDまたは名前がありません。')
  }
  if (input.templateKind !== undefined && !sheetTemplateKinds.has(String(input.templateKind))
    || input.layoutMode !== undefined && !sheetTemplateLayoutModes.has(String(input.layoutMode))
    || input.naming !== undefined && !validateNaming(input.naming)
    || input.defaultUnderlayUsage !== undefined && input.defaultUnderlayUsage !== 'canvas' && input.defaultUnderlayUsage !== 'reference-only') {
    throw new Error('テンプレートの基本設定が不正です。')
  }
  if (!validateThemeKeys(input.theme) || !isSheetTemplateTheme(input.theme)) {
    throw new Error('テンプレートの用紙テーマが不正です。')
  }
  if (!validatePage(input.page)) {
    throw new Error('テンプレートのページ寸法または座標系が不正です。')
  }
  if (input.defaultUnderlay !== undefined && !validateUnderlay(input.defaultUnderlay)) {
    throw new Error('テンプレートの参照画像が不正です。')
  }
  if (input.calibration !== undefined && !validateCalibration(input.calibration)) {
    throw new Error('テンプレートの補正基準が不正です。')
  }
  if (input.style !== undefined && !validateTemplateStyle(input.style)) {
    throw new Error('テンプレートの表示設定が不正です。')
  }
  if (input.viewLayout !== undefined && !validateViewLayout(input.viewLayout)) {
    throw new Error('テンプレートの表示レイアウトが不正です。')
  }
  if (input.pageModel !== undefined && !validatePageModel(input.pageModel)) {
    throw new Error('テンプレートのページモデルが不正です。')
  }
  if (!isRecord(input.defaults)
    || !hasOnlyKeys(input.defaults, ['fps', 'durationFrames', 'frameOrigin', 'paperTracks'])
    || !positiveNumber(input.defaults.fps)
    || !positiveInteger(input.defaults.durationFrames)
    || !Number.isInteger(input.defaults.frameOrigin)
    || !Array.isArray(input.defaults.paperTracks)
    || !input.defaults.paperTracks.every(nonEmptyString)) {
    throw new Error('テンプレートの既定タイムライン設定が不正です。')
  }
  if (new Set(input.defaults.paperTracks).size !== input.defaults.paperTracks.length) {
    throw new Error('テンプレートのセル列名が重複しています。')
  }
  if (input.annotationDefaults !== undefined) validateAnnotationDefaults(input.annotationDefaults)
  const fieldIds = input.fields === undefined ? new Set<string>() : validateFields(input.fields)
  if (!Array.isArray(input.regions) || input.regions.length === 0) {
    throw new Error('テンプレートに表示領域がありません。')
  }
  const regionIds = new Set<string>()
  for (const [index, region] of input.regions.entries()) {
    validateRegion(region, index, fieldIds, input.defaults.frameOrigin as number)
    if (regionIds.has(region.regionId)) throw new Error(`領域IDが重複しています: ${region.regionId}`)
    regionIds.add(region.regionId)
  }
  if (input.auxiliaryBands !== undefined) validateAuxiliaryBands(input.auxiliaryBands, regionIds)
  if (input.horizontalFlow !== undefined) validateHorizontalFlow(input.horizontalFlow, regionIds)
  return {
    ...(input as unknown as SheetTemplate),
    schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
  }
}

function validateNaming(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['cutNumberPrefix', 'cutNumberPrefixMode'])
    && (input.cutNumberPrefix === undefined || typeof input.cutNumberPrefix === 'string')
    && (input.cutNumberPrefixMode === undefined || input.cutNumberPrefixMode === 'numeric-only' || input.cutNumberPrefixMode === 'always')
}

function validatePage(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['widthPx', 'heightPx', 'dpi', 'isPhysical', 'format', 'orientation', 'coordinateSpace'])
    && positiveNumber(input.widthPx)
    && positiveNumber(input.heightPx)
    && input.coordinateSpace === 'normalized'
    && (input.dpi === undefined || positiveNumber(input.dpi))
    && (input.isPhysical === undefined || typeof input.isPhysical === 'boolean')
    && (input.format === undefined || nonEmptyString(input.format))
    && (input.orientation === undefined || input.orientation === 'portrait' || input.orientation === 'landscape')
}

function validateThemeKeys(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['presetId', 'paper', 'ink', 'timedRangeCues'])
    || !isRecord(input.paper)
    || !hasOnlyKeys(input.paper, ['color', 'secondBands'])
    || !isRecord(input.paper.secondBands)
    || !hasOnlyKeys(input.paper.secondBands, ['enabled', 'color', 'opacity'])
    || !isRecord(input.ink)
    || !hasOnlyKeys(input.ink, ['text', 'reference', 'lines'])
    || !isRecord(input.ink.lines)
    || !hasOnlyKeys(input.ink.lines, ['thin', 'regular', 'medium', 'strong', 'outer'])
    || !isRecord(input.timedRangeCues)
    || !hasOnlyKeys(input.timedRangeCues, ['sound', 'camera'])) return false
  return validateTimedRangeCueThemeKeys(input.timedRangeCues.sound)
    && validateTimedRangeCueThemeKeys(input.timedRangeCues.camera)
}

function validateTimedRangeCueThemeKeys(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['columnColors', 'fillOpacity', 'hoverOpacity', 'strokeColor', 'textColor'])
}

function validateUnderlay(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['sourceId', 'label', 'assetPath', 'imageRef', 'alignment', 'placement'])
    && nonEmptyString(input.sourceId)
    && nonEmptyString(input.label)
    && nonEmptyString(input.assetPath)
    && validateImageRef(input.imageRef)
    && (input.alignment === undefined || validateImageAlignment(input.alignment))
    && (input.placement === undefined || validateUnderlayPlacement(input.placement))
}

function validateImageRef(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['name', 'size', 'lastModified', 'path', 'assetPath', 'contentHash', 'pixelWidth', 'pixelHeight', 'ppiX', 'ppiY'])
    || !nonEmptyString(input.name)) return false
  for (const key of ['path', 'assetPath', 'contentHash']) {
    if (input[key] !== undefined && !nonEmptyString(input[key])) return false
  }
  for (const key of ['size', 'lastModified']) {
    if (input[key] !== undefined && !nonNegativeNumber(input[key])) return false
  }
  for (const key of ['pixelWidth', 'pixelHeight', 'ppiX', 'ppiY']) {
    if (input[key] !== undefined && !positiveNumber(input[key])) return false
  }
  return true
}

function validateImageAlignment(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['opacity', 'x', 'y', 'scale', 'corners', 'calibration', 'levelCorrection'])) return false
  if (input.opacity !== undefined && !unitInterval(input.opacity)) return false
  if (input.x !== undefined && !finiteNumber(input.x) || input.y !== undefined && !finiteNumber(input.y)) return false
  if (input.scale !== undefined && !positiveNumber(input.scale)) return false
  if (input.corners !== undefined && !validateImageCorners(input.corners)) return false
  if (input.calibration !== undefined && !validateImageCalibration(input.calibration)) return false
  return input.levelCorrection === undefined || validateImageLevelCorrection(input.levelCorrection)
}

function validatePoint(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['x', 'y'])
    && finiteNumber(input.x)
    && finiteNumber(input.y)
}

function validateImageCorners(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['tl', 'tr', 'br', 'bl'])
    && ['tl', 'tr', 'br', 'bl'].every(key => validatePoint(input[key]))
}

function validateImageCalibration(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['enabled', 'points'])
    || typeof input.enabled !== 'boolean'
    || !Array.isArray(input.points)) return false
  const pointIds = new Set<string>()
  for (const point of input.points) {
    if (!isRecord(point)
      || !hasOnlyKeys(point, ['pointId', 'label', 'source', 'target'])
      || !nonEmptyString(point.pointId)
      || typeof point.label !== 'string'
      || !validatePoint(point.source)
      || !validatePoint(point.target)
      || pointIds.has(point.pointId)) return false
    pointIds.add(point.pointId)
  }
  return true
}

function validateImageLevelCorrection(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['enabled', 'inputBlack', 'inputWhite', 'gamma'])
    && typeof input.enabled === 'boolean'
    && finiteNumber(input.inputBlack)
    && finiteNumber(input.inputWhite)
    && positiveNumber(input.gamma)
}

function validateUnderlayPlacement(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['mode', 'sourceWidthPx', 'sourceHeightPx', 'offsetXPx', 'offsetYPx', 'renderedWidthPx', 'renderedHeightPx', 'ppiX', 'ppiY'])
    && (input.mode === 'pixel-exact' || input.mode === 'fit')
    && positiveNumber(input.sourceWidthPx)
    && positiveNumber(input.sourceHeightPx)
    && finiteNumber(input.offsetXPx)
    && finiteNumber(input.offsetYPx)
    && positiveNumber(input.renderedWidthPx)
    && positiveNumber(input.renderedHeightPx)
    && (input.ppiX === undefined || positiveNumber(input.ppiX))
    && (input.ppiY === undefined || positiveNumber(input.ppiY))
}

function validateCalibration(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['targetRect'])
    && (input.targetRect === undefined || isNormalizedRect(input.targetRect))
}

function validateTemplateStyle(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['outerFrame', 'bgBookLabel', 'bottomTrackLabels', 'gridHeader', 'secondCounter'])) return false
  if (input.outerFrame !== undefined && !validateVisibility(input.outerFrame)) return false
  if (input.bottomTrackLabels !== undefined && !validateVisibility(input.bottomTrackLabels)) return false
  if (input.secondCounter !== undefined && !validateVisibility(input.secondCounter)) return false
  if (input.gridHeader !== undefined && !validateGridHeaderStyle(input.gridHeader)) return false
  return input.bgBookLabel === undefined || validateBgBookLabelStyle(input.bgBookLabel)
}

function validateVisibility(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['visible'])
    && typeof input.visible === 'boolean'
}

function validateGridHeaderStyle(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['labelOverrides'])
    && (input.labelOverrides === undefined
      || isRecord(input.labelOverrides)
        && hasOnlyKeys(input.labelOverrides, [...sheetTemplateGridRoles])
        && Object.values(input.labelOverrides).every(value => typeof value === 'string'))
}

function validateBgBookLabelStyle(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, [
      'designDpi', 'baseOffsetMm', 'lanePitchMm', 'laneGapMm', 'labelHeightMm',
      'fontSizePt', 'minFontSizePt', 'fontFamily', 'fontWeight', 'shrinkToFit',
      'minWidthMm', 'maxWidthMm', 'pageMarginMm', 'poleGapMm', 'textPaddingMm',
      'connectorStrokeMm', 'estimatedCharWidthMm', 'radiusMm',
    ])) return false
  if (input.designDpi !== undefined && !positiveNumber(input.designDpi)) return false
  for (const key of ['baseOffsetMm', 'lanePitchMm', 'laneGapMm', 'labelHeightMm', 'fontSizePt', 'minFontSizePt', 'minWidthMm', 'maxWidthMm', 'pageMarginMm', 'poleGapMm', 'textPaddingMm', 'connectorStrokeMm', 'estimatedCharWidthMm', 'radiusMm']) {
    if (input[key] !== undefined && !nonNegativeNumber(input[key])) return false
  }
  if (input.fontFamily !== undefined && !nonEmptyString(input.fontFamily)) return false
  if (input.fontWeight !== undefined && (!finiteNumber(input.fontWeight) || input.fontWeight < 100 || input.fontWeight > 900)) return false
  return input.shrinkToFit === undefined || typeof input.shrinkToFit === 'boolean'
}

function validateViewLayout(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['type', 'framesPerPage', 'defaultViewMode', 'frameAxis', 'trackAxis', 'surface', 'workRange'])
    || !sheetViewLayoutTypes.has(String(input.type))) return false
  if (input.framesPerPage !== undefined && !positiveInteger(input.framesPerPage)) return false
  if (input.defaultViewMode !== undefined && !sheetViewModes.has(String(input.defaultViewMode))) return false
  if (input.frameAxis !== undefined && !validateFrameAxis(input.frameAxis)) return false
  if (input.trackAxis !== undefined && !validateTrackAxis(input.trackAxis)) return false
  if (input.surface !== undefined && (!isRecord(input.surface)
    || !hasOnlyKeys(input.surface, ['type'])
    || !sheetViewSurfaceTypes.has(String(input.surface.type)))) return false
  return input.workRange === undefined || validateWorkRange(input.workRange)
}

function validateFrameAxis(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['type', 'framesPerPage', 'overflow'])
    && sheetViewLayoutTypes.has(String(input.type))
    && (input.framesPerPage === undefined || positiveInteger(input.framesPerPage))
    && (input.overflow === undefined || input.overflow === 'paginate' || input.overflow === 'scroll')
}

function validateTrackAxis(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['type', 'overflow'])
    && (input.type === 'fixed-slots' || input.type === 'logical-width')
    && (input.overflow === undefined || input.overflow === 'hidden' || input.overflow === 'scroll' || input.overflow === 'paginate')
}

function validateWorkRange(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['supportsPreRoll', 'supportsPostRoll', 'preRollFrames', 'postRollFrames', 'showPreRoll', 'showPostRoll'])) return false
  for (const key of ['supportsPreRoll', 'supportsPostRoll', 'showPreRoll', 'showPostRoll']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') return false
  }
  return (input.preRollFrames === undefined || nonNegativeInteger(input.preRollFrames))
    && (input.postRollFrames === undefined || nonNegativeInteger(input.postRollFrames))
}

function validatePageModel(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['type', 'framesPerPage', 'defaultViewMode'])
    && ['paged-repeat', 'continuous', 'spread', 'infinite'].includes(String(input.type))
    && (input.framesPerPage === undefined || positiveInteger(input.framesPerPage))
    && (input.defaultViewMode === undefined || sheetViewModes.has(String(input.defaultViewMode)))
}

function validateAnnotationDefaults(input: unknown): void {
  if (!isRecord(input) || !hasOnlyKeys(input, ['timelineMemo'])) throw new Error('テンプレートのメモ既定値が不正です。')
  if (input.timelineMemo === undefined) return
  if (!isRecord(input.timelineMemo)
    || !hasOnlyKeys(input.timelineMemo, ['defaultWidthMm', 'defaultWidthPx', 'singleFrameHeightFrames'])
    || input.timelineMemo.defaultWidthMm !== undefined && !positiveNumber(input.timelineMemo.defaultWidthMm)
    || input.timelineMemo.defaultWidthPx !== undefined && !positiveNumber(input.timelineMemo.defaultWidthPx)
    || input.timelineMemo.singleFrameHeightFrames !== undefined && !positiveNumber(input.timelineMemo.singleFrameHeightFrames)) {
    throw new Error('テンプレートのメモ既定値が不正です。')
  }
}

function validateHorizontalFlow(input: unknown, regionIds: Set<string>): void {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['regionIds', 'leftPx', 'rightPx', 'gapPx'])
    || !Array.isArray(input.regionIds)
    || input.regionIds.length === 0
    || !input.regionIds.every(nonEmptyString)
    || !nonNegativeNumber(input.leftPx)
    || !nonNegativeNumber(input.rightPx)
    || (input.gapPx !== undefined && !nonNegativeNumber(input.gapPx))) {
    throw new Error('横方向フローの定義が不正です。')
  }
  if (new Set(input.regionIds).size !== input.regionIds.length) throw new Error('横方向フローの領域が重複しています。')
  for (const regionId of input.regionIds) {
    if (!regionIds.has(regionId)) throw new Error(`横方向フローが存在しない領域を参照しています: ${regionId}`)
  }
}

function validateAuxiliaryBands(input: unknown, regionIds: Set<string>): void {
  if (!Array.isArray(input)) throw new Error('補助列配置の定義が不正です。')
  const bandIds = new Set<string>()
  for (const band of input) {
    if (!isRecord(band)
      || !hasOnlyKeys(band, ['bandId', 'anchorRegionIds', 'slotRegionIds'])
      || !nonEmptyString(band.bandId)
      || !Array.isArray(band.anchorRegionIds)
      || band.anchorRegionIds.length === 0
      || !band.anchorRegionIds.every(nonEmptyString)
      || !Array.isArray(band.slotRegionIds)
      || band.slotRegionIds.length === 0
      || !band.slotRegionIds.every(nonEmptyString)) {
      throw new Error('補助列配置の定義が不正です。')
    }
    if (bandIds.has(band.bandId)) throw new Error(`補助列配置IDが重複しています: ${band.bandId}`)
    bandIds.add(band.bandId)
    for (const regionId of [...band.anchorRegionIds, ...band.slotRegionIds]) {
      if (!regionIds.has(regionId)) throw new Error(`補助列配置が存在しない領域を参照しています: ${regionId}`)
    }
  }
}

function validateRegion(
  input: unknown,
  index: number,
  fieldIds: ReadonlySet<string>,
  defaultFrameOrigin: number,
): asserts input is SheetTemplateRegion {
  if (!isRecord(input)
    || !hasOnlyKeys(input, [
      'regionId', 'type', 'authoringName', 'label', 'rect', 'horizontalSpan', 'usage',
      'inputKind', 'inputMode', 'flowGroupId', 'binding', 'grid', 'textStyle',
      'textStyleVariants', 'form',
    ])
    || !nonEmptyString(input.regionId)
    || !nonEmptyString(input.label)) {
    throw new Error(`領域 ${index + 1} のIDまたはラベルが不正です。`)
  }
  if (input.authoringName !== undefined && !nonEmptyString(input.authoringName)) {
    throw new Error(`領域 ${input.regionId} の管理名が不正です。`)
  }
  if (!sheetTemplateRegionTypes.has(String(input.type)) || !sheetTemplateRegionUsages.has(String(input.usage))) {
    throw new Error(`領域 ${input.regionId} の種類または用途が不正です。`)
  }
  if (input.inputKind !== undefined && !sheetTemplateInputKinds.has(String(input.inputKind))
    || input.inputMode !== undefined && !sheetTemplateInputModes.has(String(input.inputMode))
    || input.flowGroupId !== undefined && !nonEmptyString(input.flowGroupId)) {
    throw new Error(`領域 ${input.regionId} の入力設定が不正です。`)
  }
  if (input.binding !== undefined && !validateRegionBinding(input.binding)) {
    throw new Error(`領域 ${input.regionId} のデータ割当が不正です。`)
  }
  if (input.type === 'decorative' && input.usage !== 'render-only') {
    throw new Error(`補助罫線領域 ${input.regionId} は描画専用である必要があります。`)
  }
  if (!isNormalizedRect(input.rect)) throw new Error(`領域 ${input.regionId} の矩形が不正です。`)
  if (input.grid !== undefined) {
    if (!isRecord(input.grid)
      || !hasOnlyKeys(input.grid, [
        'role', 'frameStart', 'frameEnd', 'rowCount', 'majorLineEvery', 'pageBreakEvery',
        'rowLineRules', 'rowLabelRules', 'lineRules', 'header', 'trackProjection',
        'frameProjection', 'columnSizing', 'rowSizing', 'typography', 'columns',
      ])
      || !sheetTemplateGridRoles.has(String(input.grid.role))
      || !positiveInteger(input.grid.rowCount)
      || !Array.isArray(input.grid.columns)
      || input.grid.columns.length === 0
      || !input.grid.columns.every(validateGridColumn)) {
      throw new Error(`領域 ${input.regionId} の格子定義が不正です。`)
    }
    const columnIds = input.grid.columns.map(column => column.columnId as string)
    if (new Set(columnIds).size !== columnIds.length) {
      throw new Error(`領域 ${input.regionId} の列IDが重複しています。`)
    }
    if (input.grid.frameStart !== undefined && !Number.isInteger(input.grid.frameStart)
      || input.grid.frameEnd !== undefined && !Number.isInteger(input.grid.frameEnd)) {
      throw new Error(`領域 ${input.regionId} のフレーム範囲が不正です。`)
    }
    const frameStart = input.grid.frameStart === undefined ? defaultFrameOrigin : input.grid.frameStart as number
    if (input.grid.frameProjection === undefined
      && input.grid.frameEnd !== undefined
      && input.grid.frameEnd !== frameStart + input.grid.rowCount - 1) {
      throw new Error(`領域 ${input.regionId} の開始フレーム、行数、終了フレームが一致していません。`)
    }
    if (input.grid.majorLineEvery !== undefined && !positiveInteger(input.grid.majorLineEvery)
      || input.grid.pageBreakEvery !== undefined && !positiveInteger(input.grid.pageBreakEvery)
      || input.grid.rowLineRules !== undefined && (!Array.isArray(input.grid.rowLineRules) || !input.grid.rowLineRules.every(validateGridRowLineRule))
      || input.grid.rowLabelRules !== undefined && (!Array.isArray(input.grid.rowLabelRules) || !input.grid.rowLabelRules.every(validateGridRowLabelRule))) {
      throw new Error(`領域 ${input.regionId} の格子定義が不正です。`)
    }
    if (input.grid.header !== undefined && !validateGridHeader(input.grid.header)) {
      throw new Error(`領域 ${input.regionId} の格子見出しが不正です。`)
    }
    if (input.grid.trackProjection !== undefined && !validateTrackProjection(input.grid.trackProjection)
      || input.grid.frameProjection !== undefined && !validateFrameProjection(input.grid.frameProjection)
      || input.grid.columnSizing !== undefined && !validateGridColumnSizing(input.grid.columnSizing)
      || input.grid.rowSizing !== undefined && !validateGridRowSizing(input.grid.rowSizing)) {
      throw new Error(`領域 ${input.regionId} の格子投影または寸法設定が不正です。`)
    }
    if (input.grid.lineRules !== undefined
      && (!Array.isArray(input.grid.lineRules) || !input.grid.lineRules.every(validateGridLineRule))) {
      throw new Error(`領域 ${input.regionId} の罫線ルールが不正です。`)
    }
    if (input.grid.typography !== undefined && !validateGridTypography(input.grid.typography)) {
      throw new Error(`領域 ${input.regionId} の文字設定が不正です。`)
    }
  }
  if (input.textStyle !== undefined && !validateTextStyle(input.textStyle)) {
    throw new Error(`領域 ${input.regionId} の文字設定が不正です。`)
  }
  if (input.textStyleVariants !== undefined && (!isRecord(input.textStyleVariants)
    || !hasOnlyKeys(input.textStyleVariants, ['sharedCutNumbersVisible'])
    || !Object.values(input.textStyleVariants).every(validateTextStyle))) {
    throw new Error(`領域 ${input.regionId} の文字設定が不正です。`)
  }
  if (input.horizontalSpan !== undefined
    && (!isRecord(input.horizontalSpan)
      || !hasOnlyKeys(input.horizontalSpan, ['source'])
      || input.horizontalSpan.source !== 'resolved-page-content')) {
    throw new Error(`領域 ${input.regionId} の横幅追従設定が不正です。`)
  }
  if (input.form !== undefined) {
    validateForm(input.form, input.regionId, fieldIds)
  }
}

function validateGridColumn(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['columnId', 'label', 'paperTrack', 'timelineLaneId', 'xdtsEligible'])
    && nonEmptyString(input.columnId)
    && typeof input.label === 'string'
    && (input.paperTrack === undefined || nonEmptyString(input.paperTrack))
    && (input.timelineLaneId === undefined || nonEmptyString(input.timelineLaneId))
    && (input.xdtsEligible === undefined || typeof input.xdtsEligible === 'boolean')
}

function validateGridRowLineRule(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['every', 'weight', 'offset'])
    && positiveInteger(input.every)
    && sheetTemplateLineWeights.has(String(input.weight))
    && (input.offset === undefined || Number.isInteger(input.offset))
}

function validateGridRowLabelRule(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['every', 'format', 'offset', 'skipRowZero', 'xAnchor', 'xOffsetPx', 'yOffsetPx', 'fontSizePx'])
    && positiveInteger(input.every)
    && input.format === 'elapsed-seconds'
    && (input.offset === undefined || Number.isInteger(input.offset))
    && (input.skipRowZero === undefined || typeof input.skipRowZero === 'boolean')
    && (input.xAnchor === undefined || input.xAnchor === 'start' || input.xAnchor === 'end')
    && (input.xOffsetPx === undefined || finiteNumber(input.xOffsetPx))
    && (input.yOffsetPx === undefined || finiteNumber(input.yOffsetPx))
    && (input.fontSizePx === undefined || positiveNumber(input.fontSizePx))
}

function validateGridHeader(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['label', 'topOffsetPx', 'heightPx', 'columnHeightPx', 'showLabel', 'showColumnLabels'])
    && (input.label === undefined || nonEmptyString(input.label))
    && (input.topOffsetPx === undefined || nonNegativeNumber(input.topOffsetPx))
    && (input.heightPx === undefined || nonNegativeNumber(input.heightPx))
    && (input.columnHeightPx === undefined || nonNegativeNumber(input.columnHeightPx))
    && (input.showLabel === undefined || typeof input.showLabel === 'boolean')
    && (input.showColumnLabels === undefined || typeof input.showColumnLabels === 'boolean')
}

function validateTrackProjection(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['source', 'startIndex', 'overflow'])
    && (input.source === 'logical-paper-tracks' || input.source === 'logical-timeline-lanes')
    && (input.startIndex === undefined || nonNegativeInteger(input.startIndex))
    && (input.overflow === undefined || input.overflow === 'hidden' || input.overflow === 'scroll' || input.overflow === 'paginate')
}

function validateFrameProjection(input: unknown): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['source', 'startFrame', 'overflow'])
    && input.source === 'logical-frames'
    && (input.startFrame === undefined || Number.isInteger(input.startFrame))
    && (input.overflow === undefined || input.overflow === 'hidden' || input.overflow === 'scroll' || input.overflow === 'paginate')
}

function validateGridColumnSizing(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['mode', 'defaultWidthPx', 'minWidthPx', 'maxWidthPx', 'columns'])) return false
  if (input.mode !== undefined && input.mode !== 'fit-region' && input.mode !== 'fixed-content') return false
  for (const key of ['defaultWidthPx', 'minWidthPx', 'maxWidthPx']) {
    if (input[key] !== undefined && !positiveNumber(input[key])) return false
  }
  if (input.columns === undefined) return true
  if (!isRecord(input.columns)) return false
  return Object.values(input.columns).every(validateGridColumnSize)
}

function validateGridColumnSize(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['widthPx', 'minWidthPx', 'maxWidthPx', 'weight'])) return false
  for (const key of ['widthPx', 'minWidthPx', 'maxWidthPx', 'weight']) {
    if (input[key] !== undefined && !positiveNumber(input[key])) return false
  }
  return true
}

function validateGridRowSizing(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['mode', 'rowHeightPx', 'minRowHeightPx', 'maxRowHeightPx'])) return false
  if (input.mode !== undefined && input.mode !== 'fit-region' && input.mode !== 'fixed-height') return false
  for (const key of ['rowHeightPx', 'minRowHeightPx', 'maxRowHeightPx']) {
    if (input[key] !== undefined && !positiveNumber(input[key])) return false
  }
  return true
}

function validateForm(input: unknown, regionId: string, fieldIds: ReadonlySet<string>): void {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['columns', 'columnFlex', 'rows', 'fillEmptyCells', 'cells', 'borderStyle', 'projection'])
    || !Array.isArray(input.columns)
    || input.columns.length === 0
    || !input.columns.every(positiveNumber)
    || !Array.isArray(input.rows)
    || input.rows.length === 0
    || !input.rows.every(positiveNumber)
    || input.columnFlex !== undefined && (!Array.isArray(input.columnFlex)
      || input.columnFlex.length !== input.columns.length
      || !input.columnFlex.every(nonNegativeNumber))
    || input.cells !== undefined && !Array.isArray(input.cells)) {
    throw new Error(`領域 ${regionId} のフォーム定義が不正です。`)
  }
  if (input.fillEmptyCells !== undefined && typeof input.fillEmptyCells !== 'boolean'
    || input.borderStyle !== undefined && !validateLineStyle(input.borderStyle)
    || input.projection !== undefined && !validateTrackCountProjection(input.projection)) {
    throw new Error(`領域 ${regionId} のフォーム定義が不正です。`)
  }
  if (input.cells === undefined) return

  const cellIds = new Set<string>()
  const occupiedPositions = new Set<string>()
  for (const cell of input.cells) {
    if (!isRecord(cell)
      || !hasOnlyKeys(cell, [
        'cellId', 'row', 'column', 'rowSpan', 'columnSpan', 'kind', 'label', 'fieldId',
        'border', 'borderStyle', 'textStyle', 'editPresentation', 'memoTarget',
      ])
      || !nonEmptyString(cell.cellId)
      || !sheetTemplateFormCellKinds.has(String(cell.kind))
      || !nonNegativeInteger(cell.row)
      || !nonNegativeInteger(cell.column)
      || cell.rowSpan !== undefined && !positiveInteger(cell.rowSpan)
      || cell.columnSpan !== undefined && !positiveInteger(cell.columnSpan)
      || cell.border !== undefined && typeof cell.border !== 'boolean'
      || cell.borderStyle !== undefined && !validateLineStyle(cell.borderStyle)
      || cell.textStyle !== undefined && !validateTextStyle(cell.textStyle)
      || cell.label !== undefined && typeof cell.label !== 'string'
      || cell.fieldId !== undefined && !nonEmptyString(cell.fieldId)
      || cell.editPresentation !== undefined && cell.editPresentation !== 'inline' && cell.editPresentation !== 'popover'
      || cell.memoTarget !== undefined && !validateMemoTarget(cell.memoTarget)) {
      throw new Error(`領域 ${regionId} のフォーム定義が不正です。`)
    }
    if (cellIds.has(cell.cellId)) {
      throw new Error(`領域 ${regionId} のフォームセルIDが重複しています: ${cell.cellId}`)
    }
    cellIds.add(cell.cellId)

    const rowSpan = cell.rowSpan === undefined ? 1 : cell.rowSpan as number
    const columnSpan = cell.columnSpan === undefined ? 1 : cell.columnSpan as number
    if (cell.row + rowSpan > input.rows.length || cell.column + columnSpan > input.columns.length) {
      throw new Error(`領域 ${regionId} のフォームセル ${cell.cellId} が行列の範囲外です。`)
    }
    if (cell.kind === 'label' && !nonEmptyString(cell.label)) {
      throw new Error(`領域 ${regionId} のラベルセル ${cell.cellId} に表示文字がありません。`)
    }
    if (cell.kind === 'field') {
      if (!nonEmptyString(cell.fieldId)) {
        throw new Error(`領域 ${regionId} の入力セル ${cell.cellId} にフォーム項目IDがありません。`)
      }
      if (!fieldIds.has(cell.fieldId)) {
        throw new Error(`領域 ${regionId} の入力セル ${cell.cellId} が存在しないフォーム項目を参照しています: ${cell.fieldId}`)
      }
    }

    for (let row = cell.row; row < cell.row + rowSpan; row += 1) {
      for (let column = cell.column; column < cell.column + columnSpan; column += 1) {
        const position = `${row}:${column}`
        if (occupiedPositions.has(position)) {
          throw new Error(`領域 ${regionId} のフォームセル配置が重複しています: ${position}`)
        }
        occupiedPositions.add(position)
      }
    }
  }
}

function validateMemoTarget(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['scope', 'targetId', 'logicalTargetId', 'label'])) return false
  if (input.scope !== 'cell' && input.scope !== 'region' && input.scope !== 'group' && input.scope !== 'none') return false
  if (input.targetId !== undefined && !nonEmptyString(input.targetId)) return false
  if (input.logicalTargetId !== undefined && !nonEmptyString(input.logicalTargetId)) return false
  if (input.label !== undefined && !nonEmptyString(input.label)) return false
  return input.scope !== 'group' || nonEmptyString(input.targetId)
}

function validateGridTypography(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['cellFontSize', 'cellMinFontSize', 'cellFontSizePx', 'cellMinFontSizePx', 'cellFontWeight', 'shrinkToFit'])) return false
  if (input.cellFontSize !== undefined && !validateLength(input.cellFontSize, false)) return false
  if (input.cellMinFontSize !== undefined && !validateLength(input.cellMinFontSize, false)) return false
  if (input.cellFontSizePx !== undefined && !positiveNumber(input.cellFontSizePx)) return false
  if (input.cellMinFontSizePx !== undefined && !positiveNumber(input.cellMinFontSizePx)) return false
  if (input.cellFontWeight !== undefined && (!finiteNumber(input.cellFontWeight) || input.cellFontWeight < 100 || input.cellFontWeight > 900)) return false
  return input.shrinkToFit === undefined || typeof input.shrinkToFit === 'boolean'
}

function validateTextStyle(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, [
      'fontSize', 'minFontSize', 'lineHeight', 'padding', 'fontSizePx', 'minFontSizePx',
      'lineHeightPx', 'fontWeight', 'horizontalAlign', 'verticalAlign', 'paddingPx',
      'shrinkToFit', 'overflowX', 'overflowY',
    ])) return false
  if (input.fontSize !== undefined && !validateLength(input.fontSize, false)) return false
  if (input.minFontSize !== undefined && !validateLength(input.minFontSize, false)) return false
  if (input.lineHeight !== undefined && !validateLength(input.lineHeight, false)) return false
  if (input.padding !== undefined && !validateLength(input.padding, true)) return false
  if (input.fontSizePx !== undefined && !positiveNumber(input.fontSizePx)) return false
  if (input.minFontSizePx !== undefined && !positiveNumber(input.minFontSizePx)) return false
  if (input.lineHeightPx !== undefined && !positiveNumber(input.lineHeightPx)) return false
  if (input.paddingPx !== undefined && !nonNegativeNumber(input.paddingPx)) return false
  if (input.fontWeight !== undefined && (!finiteNumber(input.fontWeight) || input.fontWeight < 100 || input.fontWeight > 900)) return false
  if (input.horizontalAlign !== undefined && !['left', 'center', 'right'].includes(String(input.horizontalAlign))) return false
  if (input.verticalAlign !== undefined && !['top', 'middle', 'bottom'].includes(String(input.verticalAlign))) return false
  if (input.overflowX !== undefined && !['clip', 'visible'].includes(String(input.overflowX))) return false
  if (input.overflowY !== undefined && !['clip', 'visible'].includes(String(input.overflowY))) return false
  return input.shrinkToFit === undefined || typeof input.shrinkToFit === 'boolean'
}

function validateLength(input: unknown, allowZero: boolean): boolean {
  return isRecord(input)
    && hasOnlyKeys(input, ['value', 'unit'])
    && ['px', 'pt', 'mm'].includes(String(input.unit))
    && (allowZero ? nonNegativeNumber(input.value) : positiveNumber(input.value))
}

const sheetTemplateRegionTypes = new Set([
  'metadata-field', 'memo-area', 'exposure-grid', 'frame-guide', 'count-table',
  'process-check-area', 'form-table', 'annotation-area', 'decorative',
])

const sheetTemplateRegionUsages = new Set(['input', 'reference', 'render-only', 'ignored'])
const sheetTemplateTopLevelKeys = [
  'schemaVersion', 'templateId', 'name', 'theme', 'templateKind', 'layoutMode', 'naming',
  'defaultUnderlay', 'defaultUnderlayUsage', 'style', 'calibration', 'viewLayout', 'pageModel',
  'page', 'annotationDefaults', 'defaults', 'auxiliaryBands', 'horizontalFlow', 'fields', 'regions',
] as const
const sheetTemplateKinds = new Set(['japanese-a3-paper', 'studio-paper', 'paper-scan', 'paper-clean', 'digital-native'])
const sheetTemplateLayoutModes = new Set(['fixed-page', 'paged-digital', 'infinite-digital'])
const sheetTemplateGridRoles = new Set(['action', 'sound', 'cell', 'camera', 'frame-guide', 'count-table', 'other'])
const sheetTemplateLineWeights = new Set(['thin', 'regular', 'medium', 'strong'])
const sheetTemplateFormCellKinds = new Set(['label', 'field', 'annotation', 'spacer'])
const sheetTemplateInputKinds = new Set(['text', 'number', 'timing-event', 'camera', 'dialogue', 'annotation'])
const sheetTemplateInputModes = new Set(['point-event', 'timed-range', 'free-annotation', 'reference'])
const sheetTemplateFieldScopes = new Set(['production', 'cut', 'revision', 'page'])
const sheetTemplateFieldValueTypes = new Set(['text', 'multiline', 'number', 'boolean', 'choice', 'date', 'duration'])
const cutMetadataFields = new Set(['title', 'episode', 'scene', 'cut', 'duration', 'worker', 'page', 'custom'])
const sheetViewLayoutTypes = new Set(['paged', 'continuous', 'infinite'])
const sheetViewModes = new Set(['single-page', 'continuous', 'spread'])
const sheetViewSurfaceTypes = new Set(['fixed-page', 'continuous-canvas'])

function validateRegionBinding(input: unknown): boolean {
  if (!isRecord(input)) return false
  if (input.target === 'cut-metadata') {
    return hasOnlyKeys(input, ['target', 'field', 'customKey'])
      && cutMetadataFields.has(String(input.field))
      && (input.customKey === undefined || nonEmptyString(input.customKey))
  }
  if (input.target === 'cut-group') {
    return hasOnlyKeys(input, ['target', 'field', 'opening', 'closing', 'separator'])
      && input.field === 'shared-cut-numbers'
      && optionalString(input.opening)
      && optionalString(input.closing)
      && optionalString(input.separator)
  }
  if (input.target === 'timeline-section') {
    return hasOnlyKeys(input, ['target', 'role', 'sectionId'])
      && ['action', 'sound', 'cell', 'camera'].includes(String(input.role))
      && (input.sectionId === undefined || nonEmptyString(input.sectionId))
  }
  if (input.target === 'annotation-layer') {
    return hasOnlyKeys(input, ['target', 'layerId', 'intent'])
      && nonEmptyString(input.layerId)
      && (input.intent === undefined || ['memo', 'camera-note', 'process-note', 'free'].includes(String(input.intent)))
  }
  return false
}

function validateTrackCountProjection(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['source', 'nameLabel', 'totalLabel', 'fieldPrefix', 'scope', 'columns'])
    || input.source !== 'logical-paper-tracks'
    || !nonEmptyString(input.fieldPrefix)
    || !sheetTemplateFieldScopes.has(String(input.scope))
    || !optionalString(input.nameLabel)
    || !optionalString(input.totalLabel)
    || !Array.isArray(input.columns)
    || input.columns.length === 0) return false
  const columnIds = new Set<string>()
  for (const column of input.columns) {
    if (!isRecord(column)
      || !hasOnlyKeys(column, ['columnId', 'label', 'fieldSuffix'])
      || !nonEmptyString(column.columnId)
      || typeof column.label !== 'string'
      || !nonEmptyString(column.fieldSuffix)
      || columnIds.has(column.columnId)) return false
    columnIds.add(column.columnId)
  }
  return true
}

function validateFields(input: unknown): Set<string> {
  if (!Array.isArray(input)) throw new Error('テンプレートのフォーム項目定義が不正です。')
  const fieldIds = new Set<string>()
  for (const field of input) {
    if (!isRecord(field)
      || !hasOnlyKeys(field, ['fieldId', 'label', 'scope', 'valueType', 'choices', 'defaultValue', 'builtinBinding'])
      || !nonEmptyString(field.fieldId)
      || !nonEmptyString(field.label)
      || !sheetTemplateFieldScopes.has(String(field.scope))
      || !sheetTemplateFieldValueTypes.has(String(field.valueType))
      || field.choices !== undefined && (!Array.isArray(field.choices) || !field.choices.every(nonEmptyString))
      || field.valueType === 'choice' && (!Array.isArray(field.choices)
        || field.choices.length === 0
        || new Set(field.choices).size !== field.choices.length)
      || field.defaultValue !== undefined && !validFieldDefaultValue(field.valueType, field.defaultValue, field.choices)
      || field.builtinBinding !== undefined && (!isRecord(field.builtinBinding)
        || !hasOnlyKeys(field.builtinBinding, ['target', 'field', 'customKey'])
        || field.builtinBinding.target !== 'cut-metadata'
        || !cutMetadataFields.has(String(field.builtinBinding.field))
        || field.builtinBinding.customKey !== undefined && !nonEmptyString(field.builtinBinding.customKey))) {
      throw new Error('テンプレートのフォーム項目定義が不正です。')
    }
    if (fieldIds.has(field.fieldId)) throw new Error(`フォーム項目IDが重複しています: ${field.fieldId}`)
    fieldIds.add(field.fieldId)
  }
  return fieldIds
}

function validFieldDefaultValue(valueType: unknown, defaultValue: unknown, choices: unknown): boolean {
  if (valueType === 'number' || valueType === 'duration') return finiteNumber(defaultValue)
  if (valueType === 'boolean') return typeof defaultValue === 'boolean'
  if (valueType === 'choice') {
    return typeof defaultValue === 'string'
      && Array.isArray(choices)
      && choices.includes(defaultValue)
  }
  return (valueType === 'text' || valueType === 'multiline' || valueType === 'date')
    && typeof defaultValue === 'string'
}

function validateGridLineRule(input: unknown): boolean {
  if (!isRecord(input)
    || !hasOnlyKeys(input, ['axis', 'target', 'indexes', 'every', 'offset', 'spans', 'style'])
    || (input.axis !== 'row' && input.axis !== 'column')
    || !['all', 'inner', 'outer', 'indexes'].includes(String(input.target))) return false
  if (input.indexes !== undefined && (!Array.isArray(input.indexes) || !input.indexes.every(nonNegativeInteger))) return false
  if (input.every !== undefined && !positiveInteger(input.every)) return false
  if (input.offset !== undefined && !Number.isInteger(input.offset)) return false
  if (input.spans !== undefined && (!Array.isArray(input.spans) || !input.spans.every(span =>
    isRecord(span)
    && hasOnlyKeys(span, ['startBoundary', 'endBoundary'])
    && nonNegativeInteger(span.startBoundary)
    && nonNegativeInteger(span.endBoundary)))) return false
  if (input.style === undefined) return true
  return validateLineStyle(input.style)
}

function validateLineStyle(input: unknown): boolean {
  if (!isRecord(input) || !hasOnlyKeys(input, ['weight', 'pattern', 'color', 'widthPx', 'dashPx'])) return false
  if (input.weight !== undefined && !['thin', 'regular', 'medium', 'strong'].includes(String(input.weight))) return false
  if (input.pattern !== undefined && !['solid', 'dotted', 'dashed'].includes(String(input.pattern))) return false
  if (input.color !== undefined && !nonEmptyString(input.color)) return false
  if (input.widthPx !== undefined && !positiveNumber(input.widthPx)) return false
  return input.dashPx === undefined || Array.isArray(input.dashPx) && input.dashPx.every(nonNegativeNumber)
}

function isNormalizedRect(input: unknown): input is NormalizedRect {
  if (!isRecord(input) || !hasOnlyKeys(input, ['x', 'y', 'w', 'h'])) return false
  return finiteNumber(input.x) && finiteNumber(input.y) && positiveNumber(input.w) && positiveNumber(input.h)
    && input.x >= 0 && input.y >= 0 && input.x + input.w <= 1.000001 && input.y + input.h <= 1.000001
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(input).every(key => allowedKeys.includes(key))
}

function nonEmptyString(input: unknown): input is string {
  return typeof input === 'string' && input.trim().length > 0
}

function optionalString(input: unknown): boolean {
  return input === undefined || typeof input === 'string'
}

function finiteNumber(input: unknown): input is number {
  return typeof input === 'number' && Number.isFinite(input)
}

function positiveNumber(input: unknown): input is number {
  return finiteNumber(input) && input > 0
}

function positiveInteger(input: unknown): input is number {
  return positiveNumber(input) && Number.isInteger(input)
}

function nonNegativeInteger(input: unknown): input is number {
  return finiteNumber(input) && input >= 0 && Number.isInteger(input)
}

function nonNegativeNumber(input: unknown): input is number {
  return finiteNumber(input) && input >= 0
}

function unitInterval(input: unknown): input is number {
  return finiteNumber(input) && input >= 0 && input <= 1
}
