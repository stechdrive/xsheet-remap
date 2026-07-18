import {
  convertSheetTemplateLength,
  formatSheetTemplateCutNumber,
  getSheetViewLayout,
  sheetTemplateLengthForReferencePx,
  type CorrectionLayer,
  type CutProject,
  type SheetTemplate,
  type SheetTemplateLength,
  type SheetTemplateLinePattern,
  type SheetTemplateTextStyle,
} from '@xsheet-remap/core'
import { useMemo, useState } from 'react'
import { ActionMenu, PanelResizeHandle, ToolbarGroup } from './AppControls'
import type { SheetImageSettings, TemplateDetailTab, WorkspaceStyle } from './appTypes'
import { uiText } from './i18n'
import { ProcessSettingsDialog } from './ProcessSettingsDialog'
import { sortedCorrectionLayers } from './sheetAssets'
import { SHEET_ZOOM_MIN, TEMPLATE_ZOOM_MAX } from './sheetConstants'
import { calibrationGridBoundsForTemplate, calibrationTargetRectForTemplate, defaultSheetImageSettings, resolveImageRefUrl } from './sheetImages'
import { clampNumber, fitZoomForViewport } from './sheetInteraction'
import { cloneSheetTemplate, ensureEditableTemplateDraft, finalizeTemplateDraftForApply, isBuiltInSheetTemplate, isModifiedBuiltInSheetTemplate, quantizeTemplateGeometry, readFileAsDataUrl, resolvePixelExactUnderlayPlacement, templateImageDensityMatches, type TemplateDraftKind } from './templateDrafts'
import { readTemplateImageMetadata } from './templateImageMetadata'
import { gridHeaderLabelForRole, gridHeaderRolesForTemplate, templateEditorNormalizedRectValue, templateEditorRectPixelValue, type TemplateEditorRectKey } from './templateEditorGeometry'
import { buildTemplateColumns, clearTemplateCalibrationTargetRect, defaultColumnCountForRole, defaultRegionLabel, gridRoleLabel, resizePaperTrackLabels, setTemplateCalibrationTargetRect, trackProjectionForRole, type TemplateGridRole } from './templateEditing'
import { Tooltip, TooltipTarget } from './Tooltip'
import { METADATA_BINDING_OPTION_IDS, TEMPLATE_CALIBRATION_TARGET_ID, errorMessage, metadataBindingFromOptionId, metadataBindingOptionId, metadataBindingOptionLabel, sameNormalizedRect, standardCalibrationTargetRectForTemplate, type MetadataBindingOptionId } from './template-workspace-model'
import { TemplateRegionEditor } from './template-workspace-region-editor'
import { TemplateCreateDialog, type DigitalTemplateCreateOptions, type PaperTemplateCreateOptions } from './TemplateCreateDialog'
import { templatePaperPixelSize } from './templatePaper'

export function TemplateWorkspace({
  project,
  template: appliedTemplate,
  onLoadTemplate,
  onSaveTemplate,
  onApplyTemplate,
  onCreateTemplateDraft,
  onCreatePaperTemplateFromImage,
  onUpdateCorrectionLayers,
}: {
  project: CutProject
  template: SheetTemplate
  onLoadTemplate: (files: FileList | null) => Promise<SheetTemplate | null>
  onSaveTemplate: (template: SheetTemplate) => void
  onApplyTemplate: (template: SheetTemplate) => void
  onCreateTemplateDraft: (kind: TemplateDraftKind) => SheetTemplate
  onCreatePaperTemplateFromImage: (files: FileList | null) => Promise<SheetTemplate | null>
  onUpdateCorrectionLayers: (layers: CorrectionLayer[]) => boolean
}) {
  const [draftTemplate, setDraftTemplate] = useState<SheetTemplate>(() => cloneSheetTemplate(appliedTemplate))
  const template = draftTemplate
  const appliedTemplateJson = useMemo(() => JSON.stringify(appliedTemplate), [appliedTemplate])
  const draftTemplateJson = useMemo(() => JSON.stringify(draftTemplate), [draftTemplate])
  const hasTemplateDraftChanges = draftTemplateJson !== appliedTemplateJson
  const templateDraftStatus = hasTemplateDraftChanges
    ? uiText.template.draftChanged
    : isBuiltInSheetTemplate(template)
      ? uiText.template.builtInProtected
      : uiText.template.draftApplied
  const editableRegions = template.regions
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(() => editableRegions[0]?.regionId ?? null)
  const [selectedFormCellId, setSelectedFormCellId] = useState<string | null>(null)
  const [detailTab, setDetailTab] = useState<TemplateDetailTab>('region')
  const [templateZoom, setTemplateZoom] = useState(1)
  const [dockWidth, setDockWidth] = useState(380)
  const [processSettingsOpen, setProcessSettingsOpen] = useState(false)
  const [templateCreateOpen, setTemplateCreateOpen] = useState(false)
  const isDigitalTemplate = template.templateKind === 'digital-native'
  const calibrationTargetRect = calibrationTargetRectForTemplate(template)
  const calibrationGridBounds = calibrationGridBoundsForTemplate(template)
  const hasExplicitCalibrationTarget = Boolean(template.calibration?.targetRect)
  const standardCalibrationTargetRect = standardCalibrationTargetRectForTemplate(template)
  const usesStandardCalibrationTarget = Boolean(hasExplicitCalibrationTarget && calibrationTargetRect && standardCalibrationTargetRect && sameNormalizedRect(calibrationTargetRect, standardCalibrationTargetRect))
  const isCalibrationTargetSelected = selectedRegionId === TEMPLATE_CALIBRATION_TARGET_ID
  const selectedRegion = isCalibrationTargetSelected
    ? null
    : selectedRegionId
      ? editableRegions.find(region => region.regionId === selectedRegionId) ?? editableRegions[0] ?? null
      : editableRegions[0] ?? null
  const selectedDecorativeGrid = isDecorativeGridRegion(selectedRegion) ? selectedRegion : null
  const selectedFormFieldCells = selectedRegion?.form?.cells?.filter(cell => cell.kind === 'field' && cell.fieldId) ?? []
  const selectedFormFieldCell = selectedFormFieldCells.find(cell => cell.cellId === selectedFormCellId)
    ?? selectedFormFieldCells[0]
    ?? null
  const selectedFormFieldDefinition = selectedFormFieldCell?.fieldId
    ? template.fields?.find(field => field.fieldId === selectedFormFieldCell.fieldId) ?? null
    : null
  const selectedRegionHasTextStyle = Boolean(selectedRegion
    && (selectedRegion.binding?.target === 'cut-metadata' || selectedRegion.binding?.target === 'cut-group'))
  const textFontUnit = template.page.isPhysical ? 'pt' : 'px'
  const effectiveSelectedRegionId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : selectedRegion?.regionId ?? null
  const correctionLayers = sortedCorrectionLayers(project)
  const defaultCorrectionLayer = correctionLayers[0] ?? null
  const templateReferenceImageUrl = template.defaultUnderlay?.imageRef
    ? resolveImageRefUrl({ ...template.defaultUnderlay.imageRef, assetPath: template.defaultUnderlay.assetPath })
    : null
  const templateReferenceImageSettings: SheetImageSettings = template.defaultUnderlay?.alignment
    ? { ...defaultSheetImageSettings(), ...template.defaultUnderlay.alignment }
    : defaultSheetImageSettings()
  const referenceImageMetadata = template.defaultUnderlay?.imageRef.pixelWidth && template.defaultUnderlay.imageRef.pixelHeight
    ? {
        width: template.defaultUnderlay.imageRef.pixelWidth,
        height: template.defaultUnderlay.imageRef.pixelHeight,
        ppiX: template.defaultUnderlay.imageRef.ppiX,
        ppiY: template.defaultUnderlay.imageRef.ppiY,
      }
    : null
  const referenceDensityMatches = referenceImageMetadata
    ? templateImageDensityMatches(template.page.dpi, referenceImageMetadata)
    : null

  function setClampedTemplateZoom(value: number) {
    setTemplateZoom(clampNumber(value, SHEET_ZOOM_MIN, TEMPLATE_ZOOM_MAX))
  }

  function updateTemplateDraft(updater: (currentTemplate: SheetTemplate) => SheetTemplate) {
    setDraftTemplate(currentTemplate => {
      const nextTemplate = updater(ensureEditableTemplateDraft(currentTemplate))
      return isModifiedBuiltInSheetTemplate(nextTemplate) ? ensureEditableTemplateDraft(nextTemplate) : nextTemplate
    })
  }

  function replaceTemplateDraft(nextTemplate: SheetTemplate | null, nextTab: TemplateDetailTab) {
    if (!nextTemplate) return
    const sourceTemplate = isModifiedBuiltInSheetTemplate(nextTemplate) ? ensureEditableTemplateDraft(nextTemplate) : nextTemplate
    const clonedTemplate = cloneSheetTemplate(quantizeTemplateGeometry(sourceTemplate))
    setDraftTemplate(clonedTemplate)
    setSelectedRegionId(clonedTemplate.regions[0]?.regionId ?? null)
    setDetailTab(nextTab)
    setClampedTemplateZoom(1)
  }

  function applyTemplateDraftChanges() {
    if (!hasTemplateDraftChanges) return
    const nextTemplate = finalizeTemplateDraftForApply(template)
    onApplyTemplate(nextTemplate)
    setDraftTemplate(cloneSheetTemplate(nextTemplate))
  }

  function cancelTemplateDraftChanges() {
    if (!hasTemplateDraftChanges) return
    const nextTemplate = cloneSheetTemplate(appliedTemplate)
    setDraftTemplate(nextTemplate)
    setSelectedRegionId(nextTemplate.regions[0]?.regionId ?? null)
  }

  function fitTemplateToViewport() {
    const viewport = document.querySelector<HTMLElement>('.templateEditorViewport')
    if (!viewport) return
    const zoom = fitZoomForViewport(viewport, template.page, { horizontal: 24, vertical: 24 })
    if (zoom !== null) setClampedTemplateZoom(zoom)
  }

  function updateTemplateMetadata(updates: Partial<Pick<SheetTemplate, 'templateId' | 'name'>>) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      ...updates,
    }))
  }

  function updateTemplatePage(updates: Partial<SheetTemplate['page']>) {
    updateTemplateDraft(currentTemplate => ({
      ...quantizeTemplateGeometry({
        ...currentTemplate,
        page: {
          ...currentTemplate.page,
          ...updates,
        },
      }),
    }))
  }

  function updateTemplateNaming(updates: Partial<NonNullable<SheetTemplate['naming']>>) {
    updateTemplateDraft(currentTemplate => {
      const nextNaming = {
        ...(currentTemplate.naming ?? {}),
        ...updates,
      }
      const cutNumberPrefix = nextNaming.cutNumberPrefix?.trim() ?? ''
      const normalizedNaming: NonNullable<SheetTemplate['naming']> = {
        ...(cutNumberPrefix ? { cutNumberPrefix } : {}),
        ...(cutNumberPrefix && nextNaming.cutNumberPrefixMode === 'always' ? { cutNumberPrefixMode: 'always' as const } : {}),
      }
      return {
        ...currentTemplate,
        naming: Object.keys(normalizedNaming).length > 0 ? normalizedNaming : undefined,
      }
    })
  }

  function updateGridHeaderLabel(role: TemplateGridRole, value: string) {
    updateTemplateDraft(currentTemplate => {
      const defaultLabel = gridRoleLabel(role)
      const existingOverrides = currentTemplate.style?.gridHeader?.labelOverrides ?? {}
      const nextOverrides = { ...existingOverrides }
      if (value === defaultLabel) {
        delete nextOverrides[role]
      } else {
        nextOverrides[role] = value
      }
      const styleWithoutGridHeader = { ...(currentTemplate.style ?? {}) }
      delete styleWithoutGridHeader.gridHeader
      const nextStyle = Object.keys(nextOverrides).length > 0
        ? { ...styleWithoutGridHeader, gridHeader: { labelOverrides: nextOverrides } }
        : Object.keys(styleWithoutGridHeader).length > 0
          ? styleWithoutGridHeader
          : undefined
      return {
        ...currentTemplate,
        style: nextStyle,
      }
    })
  }

  function updateSecondCounterVisible(visible: boolean) {
    updateTemplateDraft(currentTemplate => {
      const nextStyle = { ...(currentTemplate.style ?? {}) }
      if (visible) {
        nextStyle.secondCounter = { visible: true }
      } else {
        delete nextStyle.secondCounter
      }
      return {
        ...currentTemplate,
        style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
      }
    })
  }

  function updateBottomTrackLabelsVisible(visible: boolean) {
    updateTemplateDraft(currentTemplate => {
      const nextStyle = { ...(currentTemplate.style ?? {}) }
      if (visible) {
        nextStyle.bottomTrackLabels = { visible: true }
      } else {
        delete nextStyle.bottomTrackLabels
      }
      return {
        ...currentTemplate,
        style: Object.keys(nextStyle).length > 0 ? nextStyle : undefined,
      }
    })
  }

  function updateRegion(regionId: string, updates: Partial<SheetTemplate['regions'][number]>) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => region.regionId === regionId ? { ...region, ...updates } : region),
    }))
  }

  function updateRegionFormCell(
    regionId: string,
    cellId: string,
    updates: Partial<NonNullable<NonNullable<SheetTemplate['regions'][number]['form']>['cells']>[number]>,
  ) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => {
        if (region.regionId !== regionId || !region.form?.cells) return region
        return {
          ...region,
          form: {
            ...region.form,
            cells: region.form.cells.map(cell => cell.cellId === cellId ? { ...cell, ...updates } : cell),
          },
        }
      }),
    }))
  }

  function updateRegionRect(regionId: string, key: 'x' | 'y' | 'w' | 'h', value: number) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => region.regionId === regionId ? { ...region, rect: { ...region.rect, [key]: value } } : region),
    }))
  }

  function updateRegionRectPixel(regionId: string, key: TemplateEditorRectKey, pixelValue: number) {
    updateRegionRect(regionId, key, templateEditorNormalizedRectValue(pixelValue, key, template.page))
  }

  function selectCalibrationTarget() {
    if (calibrationTargetRect) setSelectedRegionId(TEMPLATE_CALIBRATION_TARGET_ID)
  }

  function updateCalibrationTargetRect(key: 'x' | 'y' | 'w' | 'h', value: number) {
    if (!calibrationTargetRect) return
    updateTemplateDraft(currentTemplate => {
      const currentCalibrationTargetRect = calibrationTargetRectForTemplate(currentTemplate)
      return currentCalibrationTargetRect
        ? setTemplateCalibrationTargetRect(currentTemplate, { ...currentCalibrationTargetRect, [key]: value })
        : currentTemplate
    })
    setSelectedRegionId(TEMPLATE_CALIBRATION_TARGET_ID)
  }

  function updateCalibrationTargetRectPixel(key: TemplateEditorRectKey, pixelValue: number) {
    updateCalibrationTargetRect(key, templateEditorNormalizedRectValue(pixelValue, key, template.page))
  }

  function setCalibrationTargetFromGridBounds() {
    if (!calibrationGridBounds) return
    updateTemplateDraft(currentTemplate => {
      const currentCalibrationGridBounds = calibrationGridBoundsForTemplate(currentTemplate)
      return currentCalibrationGridBounds ? setTemplateCalibrationTargetRect(currentTemplate, currentCalibrationGridBounds) : currentTemplate
    })
    setSelectedRegionId(TEMPLATE_CALIBRATION_TARGET_ID)
  }

  function clearCalibrationTarget() {
    updateTemplateDraft(currentTemplate => clearTemplateCalibrationTargetRect(currentTemplate))
    if (calibrationGridBounds) {
      setSelectedRegionId(TEMPLATE_CALIBRATION_TARGET_ID)
    } else {
      setSelectedRegionId(editableRegions[0]?.regionId ?? null)
    }
  }

  function resetCalibrationTargetToStandard() {
    if (!standardCalibrationTargetRect) return
    updateTemplateDraft(currentTemplate => setTemplateCalibrationTargetRect(currentTemplate, standardCalibrationTargetRect))
    setSelectedRegionId(TEMPLATE_CALIBRATION_TARGET_ID)
  }

  function updateRegionColumnCount(regionId: string, value: number) {
    const columnCount = clampNumber(Math.round(value), 1, 64)
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => {
        if (region.regionId !== regionId || !region.grid) return region
        return {
          ...region,
          grid: {
            ...region.grid,
            columns: buildTemplateColumns(currentTemplate, region.grid.role, columnCount, region.grid.columns),
          },
        }
      }),
    }))
  }

  function updateRegionGrid(regionId: string, updates: Partial<NonNullable<SheetTemplate['regions'][number]['grid']>>) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => region.regionId === regionId && region.grid ? { ...region, grid: { ...region.grid, ...updates } } : region),
    }))
  }

  function updateDecorativeGridAxisPattern(regionId: string, axis: 'row' | 'column', pattern: SheetTemplateLinePattern | 'none') {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => {
        if (region.regionId !== regionId || region.type !== 'decorative' || !region.grid) return region
        const currentRules = region.grid.lineRules ?? []
        const existing = currentRules.find(rule => rule.axis === axis && rule.target === 'inner')
        const nextRules = currentRules.filter(rule => !(rule.axis === axis && rule.target === 'inner'))
        if (pattern !== 'none') {
          nextRules.push({
            axis,
            target: 'inner',
            style: {
              ...(existing?.style ?? decorativeGridSharedLineStyle(region)),
              pattern,
            },
          })
        }
        return { ...region, grid: { ...region.grid, lineRules: nextRules } }
      }),
    }))
  }

  function updateDecorativeGridOuterBorder(regionId: string, visible: boolean) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => {
        if (region.regionId !== regionId || region.type !== 'decorative' || !region.grid) return region
        const nextRules = (region.grid.lineRules ?? []).filter(rule => rule.target !== 'outer')
        if (visible) {
          const style = { ...decorativeGridSharedLineStyle(region), pattern: 'solid' as const }
          nextRules.push(
            { axis: 'row', target: 'outer', style },
            { axis: 'column', target: 'outer', style },
          )
        }
        return { ...region, grid: { ...region.grid, lineRules: nextRules } }
      }),
    }))
  }

  function updateDecorativeGridLineStyle(regionId: string, updates: { widthPx?: number; color?: string }) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => {
        if (region.regionId !== regionId || region.type !== 'decorative' || !region.grid) return region
        return {
          ...region,
          grid: {
            ...region.grid,
            lineRules: (region.grid.lineRules ?? []).map(rule => ({
              ...rule,
              style: { ...(rule.style ?? {}), ...updates },
            })),
          },
        }
      }),
    }))
  }

  function addGridRegion(role: NonNullable<SheetTemplate['regions'][number]['grid']>['role']) {
    const editableTemplate = ensureEditableTemplateDraft(template)
    const regionNumber = editableTemplate.regions.filter(region => region.grid?.role === role).length + 1
    const columnCount = defaultColumnCountForRole(editableTemplate, role)
    const label = defaultRegionLabel(role, regionNumber)
    const regionId = `custom_${role}_${editableTemplate.regions.length + 1}`
    const region: SheetTemplate['regions'][number] = {
      regionId,
      type: 'exposure-grid',
      label,
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.6 },
      usage: role === 'cell' || role === 'sound' ? 'input' : 'reference',
      inputKind: role === 'cell' || role === 'action' ? 'timing-event' : role === 'camera' ? 'camera' : role === 'sound' ? 'dialogue' : 'text',
      grid: {
        role,
        frameStart: 1,
        frameEnd: editableTemplate.defaults.durationFrames,
        rowCount: editableTemplate.defaults.durationFrames,
        majorLineEvery: 6,
        pageBreakEvery: 24,
        trackProjection: trackProjectionForRole(role),
        columns: buildTemplateColumns(editableTemplate, role, columnCount),
      },
    }
    setDraftTemplate({
      ...editableTemplate,
      regions: [...editableTemplate.regions, region],
    })
    setSelectedRegionId(regionId)
  }

  function addDecorativeGridRegion() {
    const editableTemplate = ensureEditableTemplateDraft(template)
    const index = editableTemplate.regions.filter(region => region.type === 'decorative' && region.grid).length + 1
    const regionId = `custom_decorative_grid_${editableTemplate.regions.length + 1}`
    const region: SheetTemplate['regions'][number] = {
      regionId,
      type: 'decorative',
      label: `補助罫線 ${index}`,
      rect: { x: 0.05, y: 0.2, w: 0.08, h: 0.6 },
      usage: 'render-only',
      grid: {
        role: 'other',
        frameStart: 1,
        rowCount: 24,
        lineRules: [
          { axis: 'row', target: 'inner', style: { pattern: 'dotted', widthPx: 1, color: '#727872' } },
          { axis: 'row', target: 'outer', style: { pattern: 'solid', widthPx: 1, color: '#2f3430' } },
          { axis: 'column', target: 'outer', style: { pattern: 'solid', widthPx: 1, color: '#2f3430' } },
        ],
        columns: [{ columnId: `decorative_${index}_1`, label: '' }],
      },
    }
    setDraftTemplate({ ...editableTemplate, regions: [...editableTemplate.regions, region] })
    setSelectedRegionId(regionId)
  }

  function addMetadataRegion() {
    const editableTemplate = ensureEditableTemplateDraft(template)
    const usedBindings = new Set(editableTemplate.regions.flatMap(region => {
      const optionId = metadataBindingOptionId(region.binding)
      return optionId ? [optionId] : []
    }))
    const optionId = METADATA_BINDING_OPTION_IDS.find(candidate => !usedBindings.has(candidate)) ?? 'cut:title'
    const binding = metadataBindingFromOptionId(optionId)
    const regionId = `metadata_${optionId.replace(/[:]/g, '_')}_${editableTemplate.regions.length + 1}`
    const region: SheetTemplate['regions'][number] = {
      regionId,
      type: 'metadata-field',
      label: metadataBindingOptionLabel(optionId),
      rect: { x: 0.1, y: 0.08, w: 0.2, h: 0.04 },
      usage: binding.target === 'cut-group' ? 'render-only' : 'input',
      inputKind: 'text',
      binding,
      textStyle: {
        fontSize: sheetTemplateLengthForReferencePx(editableTemplate, 22),
        minFontSize: sheetTemplateLengthForReferencePx(editableTemplate, 10),
        lineHeight: sheetTemplateLengthForReferencePx(editableTemplate, 22 * 1.15),
        fontWeight: 700,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        padding: sheetTemplateLengthForReferencePx(editableTemplate, 8, 'spacing'),
        shrinkToFit: true,
      },
    }
    setDraftTemplate({ ...editableTemplate, regions: [...editableTemplate.regions, region] })
    setSelectedRegionId(regionId)
  }

  function addFormRegion() {
    const editableTemplate = ensureEditableTemplateDraft(template)
    const index = editableTemplate.regions.filter(region => region.form).length + 1
    const regionId = `custom_form_${editableTemplate.regions.length + 1}`
    const fieldIds = [`custom.form.${index}.left`, `custom.form.${index}.right`]
    const region: SheetTemplate['regions'][number] = {
      regionId,
      type: 'form-table',
      label: `入力表 ${index}`,
      rect: { x: 0.1, y: 0.08, w: 0.4, h: 0.08 },
      usage: 'input',
      inputKind: 'text',
      form: {
        columns: [1, 1],
        rows: [1, 2],
        fillEmptyCells: true,
        borderStyle: { weight: 'thin', pattern: 'solid', widthPx: 1 },
        cells: [
          { cellId: 'label_left', row: 0, column: 0, kind: 'label', label: '項目1' },
          { cellId: 'label_right', row: 0, column: 1, kind: 'label', label: '項目2' },
          { cellId: 'field_left', row: 1, column: 0, kind: 'field', fieldId: fieldIds[0] },
          { cellId: 'field_right', row: 1, column: 1, kind: 'field', fieldId: fieldIds[1] },
        ],
      },
    }
    setDraftTemplate({
      ...editableTemplate,
      fields: [
        ...(editableTemplate.fields ?? []),
        { fieldId: fieldIds[0], label: '項目1', scope: 'revision', valueType: 'text' },
        { fieldId: fieldIds[1], label: '項目2', scope: 'revision', valueType: 'text' },
      ],
      regions: [...editableTemplate.regions, region],
    })
    setSelectedRegionId(regionId)
  }

  async function handleLoadReferenceImage(files: FileList | null) {
    const file = files?.[0]
    if (!file) return
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const editableTemplate = ensureEditableTemplateDraft(template)
      const sourceId = editableTemplate.defaultUnderlay?.sourceId ?? `template_reference_${Date.now()}`
      setDraftTemplate({
        ...editableTemplate,
        defaultUnderlay: {
          sourceId,
          label: file.name,
          assetPath: dataUrl,
          imageRef: {
            name: file.name,
            size: file.size,
            lastModified: file.lastModified,
            assetPath: dataUrl,
          },
        },
      })
      void readTemplateImageMetadata(file, dataUrl).then(metadata => {
        if (!metadata) return
        setDraftTemplate(currentTemplate => {
          if (currentTemplate.defaultUnderlay?.sourceId !== sourceId) return currentTemplate
          return {
            ...currentTemplate,
            defaultUnderlay: {
              ...currentTemplate.defaultUnderlay,
              imageRef: {
                ...currentTemplate.defaultUnderlay.imageRef,
                pixelWidth: metadata.width,
                pixelHeight: metadata.height,
                ppiX: metadata.ppiX,
                ppiY: metadata.ppiY,
              },
              placement: resolvePixelExactUnderlayPlacement(
                currentTemplate.page.widthPx,
                currentTemplate.page.heightPx,
                metadata,
              ),
            },
          }
        })
      })
    } catch (error) {
      window.alert(uiText.template.referenceImageLoadFailed(errorMessage(error)))
    }
  }

  function clearReferenceImage() {
    updateTemplateDraft(currentTemplate => ({ ...currentTemplate, defaultUnderlay: undefined }))
  }

  async function handleLoadTemplateDraft(files: FileList | null) {
    try {
      const loaded = await onLoadTemplate(files)
      replaceTemplateDraft(loaded, 'region')
    } catch (error) {
      window.alert(uiText.template.loadFailed(errorMessage(error)))
    }
  }

  function handleCreateTemplateDraft(kind: TemplateDraftKind, nextTab: TemplateDetailTab = 'region') {
    replaceTemplateDraft(onCreateTemplateDraft(kind), nextTab)
  }

  async function handleCreatePaperTemplateDraft(files: FileList | null) {
    const created = await onCreatePaperTemplateFromImage(files)
    replaceTemplateDraft(created, 'reference')
  }

  async function createPaperTemplateFromOptions(options: PaperTemplateCreateOptions) {
    const page = templatePaperPixelSize(options.format, options.orientation, options.ppi)
    let created = onCreateTemplateDraft('paper-standard')
    created = quantizeTemplateGeometry({
      ...created,
      templateId: `paper-template-${Date.now().toString(36)}`,
      name: options.name,
      page: {
        ...created.page,
        ...page,
        dpi: options.ppi,
        format: options.format,
        orientation: options.orientation,
        isPhysical: true,
      },
      defaultUnderlay: undefined,
    })
    if (options.file) {
      const dataUrl = await readFileAsDataUrl(options.file)
      const metadata = await readTemplateImageMetadata(options.file, dataUrl)
      if (metadata) {
        created = {
          ...created,
          defaultUnderlay: {
            sourceId: `template_reference_${Date.now().toString(36)}`,
            label: options.file.name,
            assetPath: dataUrl,
            imageRef: {
              name: options.file.name,
              size: options.file.size,
              lastModified: options.file.lastModified,
              assetPath: dataUrl,
              pixelWidth: metadata.width,
              pixelHeight: metadata.height,
              ppiX: metadata.ppiX,
              ppiY: metadata.ppiY,
            },
            placement: resolvePixelExactUnderlayPlacement(page.widthPx, page.heightPx, metadata),
          },
        }
      }
    }
    replaceTemplateDraft(created, options.file ? 'reference' : 'region')
    setTemplateCreateOpen(false)
  }

  function createDigitalTemplateFromOptions(options: DigitalTemplateCreateOptions) {
    const base = onCreateTemplateDraft('digital-standard')
    const paperTracks = resizePaperTrackLabels(base.defaults.paperTracks, options.trackCount)
    const withDefaults: SheetTemplate = {
      ...base,
      templateId: `digital-template-${Date.now().toString(36)}`,
      name: options.name,
      defaults: {
        ...base.defaults,
        fps: options.fps,
        durationFrames: options.durationFrames,
        paperTracks,
      },
    }
    const created = {
      ...withDefaults,
      regions: withDefaults.regions.map(region => region.grid
        ? {
            ...region,
            grid: {
              ...region.grid,
              rowCount: options.durationFrames,
              frameEnd: (region.grid.frameStart ?? withDefaults.defaults.frameOrigin) + options.durationFrames - 1,
              columns: region.grid.role === 'action' || region.grid.role === 'cell'
                ? buildTemplateColumns(withDefaults, region.grid.role, options.trackCount, region.grid.columns)
                : region.grid.columns,
            },
          }
        : region),
    }
    replaceTemplateDraft(created, 'region')
    setTemplateCreateOpen(false)
  }

  const detailTabs: Array<[TemplateDetailTab, string]> = [
    ['region', uiText.template.detailTabs.region],
    ['display', uiText.template.detailTabs.display],
    ...(!isDigitalTemplate ? [['reference', uiText.template.detailTabs.reference] as [TemplateDetailTab, string]] : []),
    ['table', uiText.template.detailTabs.table],
    ['json', uiText.template.detailTabs.json],
  ]
  const gridHeaderRoles = gridHeaderRolesForTemplate(template)

  const templateViewLayout = getSheetViewLayout(template)
  const templateMeta = (
    <dl className="templateMeta">
      <dt>{uiText.template.id}</dt>
      <dd>
        <input aria-label={uiText.template.id} value={template.templateId} onChange={event => updateTemplateMetadata({ templateId: event.currentTarget.value })} />
      </dd>
      <dt>{uiText.template.name}</dt>
      <dd>
        <input aria-label={uiText.template.name} value={template.name} onChange={event => updateTemplateMetadata({ name: event.currentTarget.value })} />
      </dd>
      <dt>{uiText.template.cutNumberPrefix}</dt>
      <dd>
        <input value={template.naming?.cutNumberPrefix ?? ''} onChange={event => updateTemplateNaming({ cutNumberPrefix: event.currentTarget.value })} />
      </dd>
      <dt>{uiText.template.cutNumberPrefixMode}</dt>
      <dd>
        <label className="compactControl">
          <input
            type="checkbox"
            disabled={!template.naming?.cutNumberPrefix}
            checked={(template.naming?.cutNumberPrefixMode ?? 'numeric-only') === 'numeric-only'}
            onChange={event => updateTemplateNaming({ cutNumberPrefixMode: event.currentTarget.checked ? 'numeric-only' : 'always' })}
          />
          {uiText.template.cutNumberPrefixNumericOnly}
        </label>
      </dd>
      <dt>{uiText.template.cutNumberPrefixPreview}</dt>
      <dd className="muted">001 -&gt; {formatSheetTemplateCutNumber(template, '001')} / OP -&gt; {formatSheetTemplateCutNumber(template, 'OP')}</dd>
      <dt>{uiText.template.viewLayout}</dt>
      <dd>{templateViewLayout.type} / {templateViewLayout.defaultViewMode ?? 'continuous'}{templateViewLayout.framesPerPage ? ` / ${templateViewLayout.framesPerPage}F` : ''}</dd>
      {isDigitalTemplate ? (
        <>
          <dt>FPS</dt>
          <dd><input className="numberInput" type="number" min="1" value={template.defaults.fps} onChange={event => updateTemplateDraft(current => ({ ...current, defaults: { ...current.defaults, fps: Math.max(1, Number(event.currentTarget.value)) } }))} /></dd>
          <dt>初期フレーム数</dt>
          <dd><input className="numberInput" type="number" min="1" value={template.defaults.durationFrames} onChange={event => {
            const durationFrames = Math.max(1, Number(event.currentTarget.value))
            updateTemplateDraft(current => ({
              ...current,
              defaults: { ...current.defaults, durationFrames },
              regions: current.regions.map(region => region.grid ? { ...region, grid: { ...region.grid, rowCount: durationFrames, frameEnd: (region.grid.frameStart ?? current.defaults.frameOrigin) + durationFrames - 1 } } : region),
            }))
          }} /></dd>
          <dt>CELLトラック数</dt>
          <dd><input className="numberInput" type="number" min="1" value={template.defaults.paperTracks.length} onChange={event => {
            const count = Math.max(1, Number(event.currentTarget.value))
            updateTemplateDraft(current => {
              const paperTracks = resizePaperTrackLabels(current.defaults.paperTracks, count)
              const next = { ...current, defaults: { ...current.defaults, paperTracks } }
              return {
                ...next,
                regions: next.regions.map(region => region.grid && (region.grid.role === 'action' || region.grid.role === 'cell')
                  ? { ...region, grid: { ...region.grid, columns: buildTemplateColumns(next, region.grid.role, count, region.grid.columns) } }
                  : region),
              }
            })
          }} /></dd>
          <dt>基準キャンバス</dt>
          <dd>{template.page.widthPx} × {template.page.heightPx}px / 連続キャンバス</dd>
        </>
      ) : (
        <>
      <dt>{uiText.template.pageFormat}</dt>
      <dd>
        <input value={template.page.format ?? ''} onChange={event => updateTemplatePage({ format: event.currentTarget.value || undefined })} />
      </dd>
      <dt>{uiText.template.widthPx}</dt>
      <dd>
        <input className="numberInput" type="number" min="1" value={template.page.widthPx} onChange={event => updateTemplatePage({ widthPx: Math.max(1, Number(event.currentTarget.value)) })} />
      </dd>
      <dt>{uiText.template.heightPx}</dt>
      <dd>
        <input className="numberInput" type="number" min="1" value={template.page.heightPx} onChange={event => updateTemplatePage({ heightPx: Math.max(1, Number(event.currentTarget.value)) })} />
      </dd>
      <dt>{uiText.template.dpi}</dt>
      <dd>
        <input className="numberInput" type="number" min="1" value={template.page.dpi ?? ''} onChange={event => updateTemplatePage({ dpi: event.currentTarget.value ? Math.max(1, Number(event.currentTarget.value)) : undefined })} />
      </dd>
      <dt>{uiText.template.physicalPage}</dt>
      <dd>
        <label className="compactControl">
          <input type="checkbox" checked={template.page.isPhysical ?? false} onChange={event => updateTemplatePage({ isPhysical: event.currentTarget.checked })} />
          {template.page.isPhysical ? uiText.app.loaded : uiText.app.none}
        </label>
      </dd>
      <dt>{uiText.template.referenceImage}</dt>
      <dd>{template.defaultUnderlay?.imageRef.name ?? uiText.template.noReferenceImage}</dd>
      <dt>{uiText.template.calibrationTarget}</dt>
      <dd className="templateCalibrationTargetMeta">
        <div className="templateCalibrationTargetSummary">
          <button type="button" disabled={!calibrationTargetRect} className={isCalibrationTargetSelected ? 'active' : ''} onClick={selectCalibrationTarget}>
            {uiText.template.selectCalibrationTarget}
          </button>
          <span className="muted">
            {usesStandardCalibrationTarget
              ? uiText.template.calibrationTargetStandard
              : hasExplicitCalibrationTarget
              ? uiText.template.calibrationTargetExplicit
              : calibrationTargetRect ? uiText.template.calibrationTargetAuto : uiText.template.calibrationTargetNone}
          </span>
        </div>
        {calibrationTargetRect && (
          <div className="templateCalibrationTargetFields">
            {(['x', 'y', 'w', 'h'] as const).map(key => (
              <label key={key}>
                <span>{key} px</span>
                <input
                  aria-label={`${uiText.template.calibrationTarget} ${key} px`}
                  className="numberInput"
                  type="number"
                  step="1"
                  value={templateEditorRectPixelValue(calibrationTargetRect, key, template.page)}
                  onChange={event => updateCalibrationTargetRectPixel(key, Number(event.currentTarget.value))}
                />
              </label>
            ))}
          </div>
        )}
        <div className="toolRow dockToolRow">
          <button type="button" disabled={!calibrationGridBounds} onClick={setCalibrationTargetFromGridBounds}>{uiText.template.setCalibrationTargetFromGrid}</button>
          <button type="button" disabled={!standardCalibrationTargetRect || usesStandardCalibrationTarget} onClick={resetCalibrationTargetToStandard}>{uiText.template.resetCalibrationTargetToStandard}</button>
          <button type="button" disabled={!hasExplicitCalibrationTarget} onClick={clearCalibrationTarget}>{uiText.template.clearCalibrationTarget}</button>
        </div>
        <p className="muted">{uiText.template.calibrationTargetHint}</p>
      </dd>
        </>
      )}
      <dt>{uiText.template.regions}</dt>
      <dd>{template.regions.length}</dd>
      <dt>{uiText.template.selectedRegion}</dt>
      <dd>{isCalibrationTargetSelected ? uiText.template.calibrationTarget : selectedRegion?.label ?? '-'}</dd>
      {selectedRegion && (
        <>
          <dt>{uiText.template.selectedRegionRect}</dt>
          <dd className="templateCalibrationTargetFields templateSelectedRegionFields">
            {(['x', 'y', 'w', 'h'] as const).map(key => (
              <label key={key}>
                <span>{key} px</span>
                <input
                  aria-label={`${uiText.template.selectedRegion} ${key} px`}
                  className="numberInput"
                  type="number"
                  step="1"
                  value={templateEditorRectPixelValue(selectedRegion.rect, key, template.page)}
                  onChange={event => updateRegionRectPixel(selectedRegion.regionId, key, Number(event.currentTarget.value))}
                />
              </label>
            ))}
          </dd>
        </>
      )}
      {selectedRegion && selectedRegionHasTextStyle && (
        <>
          <dt>文字レイアウト</dt>
          <dd>
            <TemplateTextMetricControls
              template={template}
              style={selectedRegion.textStyle}
              defaults={{ fontSizePx: 22, minFontSizePx: 10, lineHeightPx: 22 * 1.15, paddingPx: 8 }}
              onChange={(_key, textStyle) => updateRegion(selectedRegion.regionId, { textStyle })}
            />
          </dd>
        </>
      )}
      {selectedRegion && selectedFormFieldCell && (
        <>
          <dt>入力欄</dt>
          <dd className="detailStack templateFormFieldControls">
            <div className="templateCalibrationTargetFields">
              <label>
                <span>欄</span>
                <select
                  value={selectedFormFieldCell.cellId}
                  onChange={event => setSelectedFormCellId(event.currentTarget.value)}
                >
                  {selectedFormFieldCells.map(cell => (
                    <option key={cell.cellId} value={cell.cellId}>
                      {template.fields?.find(field => field.fieldId === cell.fieldId)?.label ?? cell.fieldId ?? cell.cellId}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>編集方法</span>
                <select
                  value={selectedFormFieldCell.editPresentation ?? 'popover'}
                  onChange={event => updateRegionFormCell(selectedRegion.regionId, selectedFormFieldCell.cellId, {
                    editPresentation: event.currentTarget.value as 'inline' | 'popover',
                  })}
                >
                  <option value="inline">その場で入力</option>
                  <option value="popover">ポップアップ</option>
                </select>
              </label>
            </div>
            <TemplateTextMetricControls
              template={template}
              style={selectedFormFieldCell.textStyle}
              defaults={{ fontSizePx: 13, minFontSizePx: 7, lineHeightPx: 13 * 1.15, paddingPx: 2 }}
              onChange={(_key, textStyle) => updateRegionFormCell(selectedRegion.regionId, selectedFormFieldCell.cellId, { textStyle })}
            />
            {selectedFormFieldDefinition?.valueType === 'multiline' && (
              <label className="compactControl">
                <input
                  type="checkbox"
                  checked={selectedFormFieldCell.textStyle?.shrinkToFit !== false}
                  onChange={event => updateRegionFormCell(selectedRegion.regionId, selectedFormFieldCell.cellId, {
                    textStyle: { ...(selectedFormFieldCell.textStyle ?? {}), shrinkToFit: event.currentTarget.checked },
                  })}
                />
                欄内に収まる範囲で文字を自動縮小
              </label>
            )}
          </dd>
        </>
      )}
      {selectedDecorativeGrid && (
        <>
          <dt>補助罫線</dt>
          <dd className="detailStack templateDecorativeGridControls">
            <div className="templateCalibrationTargetFields">
              <label>
                <span>行数</span>
                <input
                  className="numberInput"
                  type="number"
                  min="1"
                  value={selectedDecorativeGrid.grid.rowCount}
                  onChange={event => updateRegionGrid(selectedDecorativeGrid.regionId, { rowCount: Math.max(1, Math.round(Number(event.currentTarget.value))) })}
                />
              </label>
              <label>
                <span>列数</span>
                <input
                  className="numberInput"
                  type="number"
                  min="1"
                  max="64"
                  value={selectedDecorativeGrid.grid.columns.length}
                  onChange={event => updateRegionColumnCount(selectedDecorativeGrid.regionId, Number(event.currentTarget.value))}
                />
              </label>
              <label>
                <span>横罫線</span>
                <select
                  value={decorativeGridAxisPattern(selectedDecorativeGrid, 'row')}
                  onChange={event => updateDecorativeGridAxisPattern(selectedDecorativeGrid.regionId, 'row', event.currentTarget.value as SheetTemplateLinePattern | 'none')}
                >
                  {decorativeGridPatternOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>縦罫線</span>
                <select
                  value={decorativeGridAxisPattern(selectedDecorativeGrid, 'column')}
                  onChange={event => updateDecorativeGridAxisPattern(selectedDecorativeGrid.regionId, 'column', event.currentTarget.value as SheetTemplateLinePattern | 'none')}
                >
                  {decorativeGridPatternOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>線幅 px</span>
                <input
                  className="numberInput"
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={decorativeGridSharedLineStyle(selectedDecorativeGrid).widthPx ?? 1}
                  onChange={event => updateDecorativeGridLineStyle(selectedDecorativeGrid.regionId, { widthPx: Math.max(0.1, Number(event.currentTarget.value)) })}
                />
              </label>
              <label>
                <span>線色</span>
                <input
                  type="color"
                  value={decorativeGridSharedLineStyle(selectedDecorativeGrid).color ?? '#2f3430'}
                  onChange={event => updateDecorativeGridLineStyle(selectedDecorativeGrid.regionId, { color: event.currentTarget.value })}
                />
              </label>
            </div>
            <label className="compactControl">
              <input
                type="checkbox"
                checked={decorativeGridHasOuterBorder(selectedDecorativeGrid)}
                onChange={event => updateDecorativeGridOuterBorder(selectedDecorativeGrid.regionId, event.currentTarget.checked)}
              />
              外枠を描画
            </label>
            <p className="muted">印刷・画像出力にだけ使われ、シート入力や素材ドロップは受け付けません。</p>
          </dd>
        </>
      )}
    </dl>
  )

  const referenceImageControls = (
    <div className="detailStack">
      <div className="toolRow dockToolRow">
        <TooltipTarget label={uiText.actions.loadTemplateReferenceImageTitle}>
          {tooltipProps => (
            <label className="fileButton" {...tooltipProps}>
              {uiText.actions.loadTemplateReferenceImage}
              <input
                type="file"
                accept="image/*"
                onChange={event => {
                  void handleLoadReferenceImage(event.currentTarget.files)
                  event.currentTarget.value = ''
                }}
              />
            </label>
          )}
        </TooltipTarget>
        <Tooltip label={uiText.actions.clearTemplateReferenceImageTitle}>
          <button disabled={!template.defaultUnderlay} onClick={clearReferenceImage}>{uiText.actions.clearTemplateReferenceImage}</button>
        </Tooltip>
      </div>
      <p className="muted">{uiText.template.referenceImageHint}</p>
      {template.defaultUnderlay
        ? (
          <dl className="templateMeta">
            <dt>{uiText.template.name}</dt>
            <dd>{template.defaultUnderlay.imageRef.name}</dd>
            <dt>{uiText.app.loaded}</dt>
            <dd>{template.defaultUnderlay.assetPath.startsWith('data:') ? uiText.template.referenceImageEmbedded : template.defaultUnderlay.assetPath}</dd>
            {referenceImageMetadata && (
              <>
                <dt>元画像</dt>
                <dd>{referenceImageMetadata.width} × {referenceImageMetadata.height}px</dd>
                <dt>画像PPI</dt>
                <dd>{referenceImageMetadata.ppiX && referenceImageMetadata.ppiY ? `${referenceImageMetadata.ppiX.toFixed(2)} × ${referenceImageMetadata.ppiY.toFixed(2)}` : '情報なし'}</dd>
                <dt>配置</dt>
                <dd className={referenceDensityMatches === false ? 'templateImageWarning' : ''}>
                  {template.defaultUnderlay.placement?.mode === 'pixel-exact' ? '等倍・整数px中央配置' : '従来配置'}
                  {template.defaultUnderlay.placement ? ` / X ${template.defaultUnderlay.placement.offsetXPx}px / Y ${template.defaultUnderlay.placement.offsetYPx}px` : ''}
                  {referenceDensityMatches === false ? ' / テンプレートPPIと不一致' : ''}
                </dd>
              </>
            )}
          </dl>
          )
        : <p className="muted">{uiText.template.noReferenceImage}</p>}
    </div>
  )

  const displayControls = (
    <div className="detailStack">
      {template.page.isPhysical && (
        <label className="compactControl templateBottomTrackLabelsControl">
          <input
            type="checkbox"
            checked={template.style?.bottomTrackLabels?.visible ?? false}
            onChange={event => updateBottomTrackLabelsVisible(event.currentTarget.checked)}
          />
          <span>{uiText.template.bottomTrackLabels}</span>
        </label>
      )}
      <label className="compactControl templateSecondCounterControl">
        <input
          type="checkbox"
          checked={template.style?.secondCounter?.visible ?? false}
          onChange={event => updateSecondCounterVisible(event.currentTarget.checked)}
        />
        <span>{uiText.template.secondCounter}</span>
      </label>
      <p className="muted">{uiText.template.gridHeaderHint}</p>
      <dl className="templateMeta templateHeaderLabelMeta">
        <dt>{uiText.template.gridHeaderLabels}</dt>
        <dd className="templateHeaderLabelList">
          {gridHeaderRoles.map(role => (
            <label key={role} className="templateHeaderLabelField">
              <span>{gridRoleLabel(role)}</span>
              <input
                aria-label={uiText.template.gridHeaderLabelInput(gridRoleLabel(role))}
                value={gridHeaderLabelForRole(template, role)}
                placeholder={gridRoleLabel(role)}
                onChange={event => updateGridHeaderLabel(role, event.currentTarget.value)}
              />
            </label>
          ))}
        </dd>
      </dl>
    </div>
  )

  const regionTable = (
    <div className="bindingTableWrap templateTableWrap">
      <table className="bindingTable">
        <thead>
          <tr>
            <th>{uiText.template.headers.region}</th>
            <th>{uiText.template.headers.role}</th>
            <th>{uiText.template.headers.metadataField}</th>
            <th>{uiText.template.headers.fontSize} {textFontUnit}</th>
            <th>x px</th>
            <th>y px</th>
            <th>w px</th>
            <th>h px</th>
            <th>{uiText.template.headers.frameStart}</th>
            <th>{uiText.template.headers.rows}</th>
            <th>{uiText.template.headers.columns}</th>
            <th>{uiText.template.headers.usage}</th>
          </tr>
        </thead>
        <tbody>
          {template.regions.map(region => (
            <tr key={region.regionId} className={region.regionId === effectiveSelectedRegionId ? 'selectedTableRow' : ''} onClick={() => setSelectedRegionId(region.regionId)}>
              <th>
                <input value={region.label} onChange={event => updateRegion(region.regionId, { label: event.currentTarget.value })} />
              </th>
              <td>{region.grid?.role ?? region.type}</td>
              <td>
                {(region.binding?.target === 'cut-metadata' || region.binding?.target === 'cut-group') && (
                  <select
                    value={metadataBindingOptionId(region.binding) ?? 'cut:title'}
                    onChange={event => {
                      const optionId = event.currentTarget.value as MetadataBindingOptionId
                      const binding = metadataBindingFromOptionId(optionId)
                      updateRegion(region.regionId, {
                        binding,
                        label: metadataBindingOptionLabel(optionId),
                        usage: binding.target === 'cut-group' ? 'render-only' : 'input',
                      })
                    }}
                  >
                    {METADATA_BINDING_OPTION_IDS.map(optionId => <option key={optionId} value={optionId}>{metadataBindingOptionLabel(optionId)}</option>)}
                  </select>
                )}
              </td>
              <td>
                {(region.binding?.target === 'cut-metadata' || region.binding?.target === 'cut-group') && (
                  <input
                    className="numberInput"
                    type="number"
                    min="1"
                    step="0.1"
                    value={templateTextMetricValue(template, region.textStyle, 'fontSize', 22, 'font')}
                    onChange={event => updateRegion(region.regionId, {
                      textStyle: withTemplateTextMetric(template, region.textStyle, 'fontSize', Number(event.currentTarget.value), 'font'),
                    })}
                  />
                )}
              </td>
              {(['x', 'y', 'w', 'h'] as const).map(key => (
                <td key={key}>
                  <input
                    className="numberInput"
                    type="number"
                    step="1"
                    value={templateEditorRectPixelValue(region.rect, key, template.page)}
                    onChange={event => updateRegionRectPixel(region.regionId, key, Number(event.currentTarget.value))}
                  />
                </td>
              ))}
              <td>
                {region.grid && (
                  <input className="numberInput" type="number" value={region.grid.frameStart ?? 1} onChange={event => updateRegionGrid(region.regionId, { frameStart: Number(event.currentTarget.value) })} />
                )}
              </td>
              <td>
                {region.grid && (
                  <input className="numberInput" type="number" value={region.grid.rowCount} onChange={event => updateRegionGrid(region.regionId, { rowCount: Number(event.currentTarget.value) })} />
                )}
              </td>
              <td>
                {region.grid && (
                  <input className="numberInput" type="number" min="1" value={region.grid.columns.length} onChange={event => updateRegionColumnCount(region.regionId, Number(event.currentTarget.value))} />
                )}
              </td>
              <td>{region.usage}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  return (
    <section className="panel templatePanel">
      <div className="toolRow templateToolbar">
        <ToolbarGroup className="templateDraftToolbarGroup">
          <span className={`templateDraftStatus ${hasTemplateDraftChanges ? 'dirty' : ''}`.trim()}>{templateDraftStatus}</span>
          <Tooltip label={uiText.template.applyDraftTitle}>
            <button type="button" disabled={!hasTemplateDraftChanges} onClick={applyTemplateDraftChanges}>{uiText.template.applyDraft}</button>
          </Tooltip>
          <Tooltip label={uiText.template.cancelDraftTitle}>
            <button type="button" disabled={!hasTemplateDraftChanges} onClick={cancelTemplateDraftChanges}>{uiText.template.cancelDraft}</button>
          </Tooltip>
        </ToolbarGroup>
        <ToolbarGroup>
          <button type="button" className="primary" onClick={() => setTemplateCreateOpen(true)}>新しいテンプレート</button>
          <ActionMenu
            label={uiText.actions.newTemplate}
            ariaLabel={uiText.actions.newTemplate}
            tooltipLabel={uiText.actions.newTemplateTitle}
            className="templateCreateMenu"
            closeOnMenuItemClick
          >
            <div className="templateCreateMenuGroup">
              <div className="actionMenuSectionLabel">{uiText.template.createSections.paper}</div>
              <TooltipTarget label={uiText.actions.createPaperTemplateFromImageTitle}>
                {tooltipProps => (
                  <label className="fileButton" {...tooltipProps}>
                    {uiText.actions.createPaperTemplateFromImage}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={event => {
                        void handleCreatePaperTemplateDraft(event.currentTarget.files)
                        event.currentTarget.value = ''
                      }}
                    />
                  </label>
                )}
              </TooltipTarget>
              <button type="button" onClick={() => handleCreateTemplateDraft('paper-standard')}>
                {uiText.actions.createPaperTemplateFromStandard}
              </button>
            </div>
            <div className="templateCreateMenuGroup">
              <div className="actionMenuSectionLabel">{uiText.template.createSections.digital}</div>
              <button type="button" onClick={() => handleCreateTemplateDraft('digital-standard')}>
                {uiText.actions.createDigitalTemplate}
              </button>
            </div>
            <div className="templateCreateMenuGroup">
              <div className="actionMenuSectionLabel">{uiText.template.createSections.copy}</div>
              <button type="button" onClick={() => handleCreateTemplateDraft('duplicate-current')}>
                {uiText.actions.duplicateCurrentTemplate}
              </button>
            </div>
          </ActionMenu>
        </ToolbarGroup>
        <ToolbarGroup>
          <TooltipTarget label={uiText.actions.loadTemplateJsonTitle}>
            {tooltipProps => (
              <label className="fileButton" {...tooltipProps}>
                {uiText.actions.loadTemplateJson}
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={event => {
                    void handleLoadTemplateDraft(event.currentTarget.files)
                    event.currentTarget.value = ''
                  }}
                />
              </label>
            )}
          </TooltipTarget>
          <Tooltip label={uiText.actions.downloadTemplateJsonTitle}>
            <button type="button" onClick={() => onSaveTemplate(finalizeTemplateDraftForApply(template))}>{uiText.actions.downloadTemplateJson}</button>
          </Tooltip>
        </ToolbarGroup>
        <ToolbarGroup>
          <Tooltip label={uiText.actions.addMetadataRegionTitle}>
            <button onClick={addMetadataRegion}>{uiText.actions.addMetadataRegion}</button>
          </Tooltip>
          <Tooltip label="罫線と入力欄を持つ構造化された表を追加します">
            <button onClick={addFormRegion}>入力表を追加</button>
          </Tooltip>
          <Tooltip label={uiText.actions.addActionRegionTitle}>
            <button onClick={() => addGridRegion('action')}>{uiText.actions.addActionRegion}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.addSoundRegionTitle}>
            <button onClick={() => addGridRegion('sound')}>{uiText.actions.addSoundRegion}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.addCellRegionTitle}>
            <button onClick={() => addGridRegion('cell')}>{uiText.actions.addCellRegion}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.addCameraRegionTitle}>
            <button onClick={() => addGridRegion('camera')}>{uiText.actions.addCameraRegion}</button>
          </Tooltip>
          <Tooltip label={uiText.actions.addDecorativeGridRegionTitle}>
            <button onClick={addDecorativeGridRegion}>{uiText.actions.addDecorativeGridRegion}</button>
          </Tooltip>
        </ToolbarGroup>
        <ToolbarGroup className="templateProcessToolbarGroup">
          <span className="toolbarGroupLabel">{uiText.template.processSection}</span>
          <span className="muted">{uiText.template.processSummary(correctionLayers.length, defaultCorrectionLayer?.label ?? '-')}</span>
          <Tooltip label={uiText.sheet.processSettingsTitle}>
            <button type="button" className="processSettingsOpenButton" onClick={() => setProcessSettingsOpen(true)}>
              {uiText.processSettings.openShort}
            </button>
          </Tooltip>
        </ToolbarGroup>
        <ToolbarGroup>
          <label className="compactControl">
            {uiText.sheet.zoom}
            <input
              type="range"
              min={SHEET_ZOOM_MIN * 100}
              max={TEMPLATE_ZOOM_MAX * 100}
              value={Math.round(templateZoom * 100)}
              onInput={event => setClampedTemplateZoom(Number(event.currentTarget.value) / 100)}
              onChange={event => setClampedTemplateZoom(Number(event.currentTarget.value) / 100)}
            />
            <span className="zoomValue">{Math.round(templateZoom * 100)}%</span>
          </label>
          <Tooltip label={uiText.actions.zoomResetTitle}>
            <button onClick={() => setClampedTemplateZoom(1)}>{uiText.actions.zoomReset}</button>
          </Tooltip>
          <button type="button" onClick={() => setClampedTemplateZoom(4)}>400%</button>
          <button type="button" onClick={() => setClampedTemplateZoom(8)}>800%</button>
          <button type="button" onClick={() => setClampedTemplateZoom(16)}>1600%</button>
          <button type="button" onClick={() => setClampedTemplateZoom(32)}>3200%</button>
          <Tooltip label={uiText.actions.zoomFitTitle}>
            <button onClick={fitTemplateToViewport}>{uiText.actions.zoomFit}</button>
          </Tooltip>
        </ToolbarGroup>
      </div>
      {processSettingsOpen && (
        <ProcessSettingsDialog
          project={project}
          onClose={() => setProcessSettingsOpen(false)}
          onApply={layers => {
            if (onUpdateCorrectionLayers(layers)) setProcessSettingsOpen(false)
          }}
        />
      )}
      {templateCreateOpen && (
        <TemplateCreateDialog
          onClose={() => setTemplateCreateOpen(false)}
          onCreatePaper={options => { void createPaperTemplateFromOptions(options) }}
          onCreateDigital={createDigitalTemplateFromOptions}
        />
      )}
      <div className="templateWorkspace" style={{ '--template-dock-width': `${dockWidth}px` } as WorkspaceStyle}>
        <TemplateRegionEditor
          template={template}
          setTemplate={updateTemplateDraft}
          imageUrl={templateReferenceImageUrl}
          imageSettings={templateReferenceImageSettings}
          zoom={templateZoom}
          setZoom={setClampedTemplateZoom}
          selectedRegionId={effectiveSelectedRegionId}
          onSelectRegion={setSelectedRegionId}
        />
        <PanelResizeHandle
          label={uiText.layout.resizeTemplateDock}
          min={300}
          max={760}
          value={dockWidth}
          onChange={setDockWidth}
        />
        <aside className="templateDock">
          <div className="dockTabs templateDockTabs" role="tablist" aria-label={uiText.template.editorLabel}>
            {detailTabs.map(([tab, label]) => (
              <button key={tab} className={detailTab === tab ? 'active' : ''} onClick={() => setDetailTab(tab)} role="tab" aria-selected={detailTab === tab}>
                {label}
              </button>
            ))}
          </div>
          <div className="templateDockBody">
            {detailTab === 'region' && templateMeta}
            {detailTab === 'display' && displayControls}
            {detailTab === 'reference' && referenceImageControls}
            {detailTab === 'table' && regionTable}
            {detailTab === 'json' && <textarea className="jsonPreview" value={JSON.stringify(template, null, 2)} readOnly />}
          </div>
        </aside>
      </div>
    </section>
  )
}

type TemplateTextMetricKey = 'fontSize' | 'minFontSize' | 'lineHeight' | 'padding'

function TemplateTextMetricControls({
  template,
  style,
  defaults,
  onChange,
}: {
  template: SheetTemplate
  style: SheetTemplateTextStyle | undefined
  defaults: { fontSizePx: number; minFontSizePx: number; lineHeightPx: number; paddingPx: number }
  onChange: (key: TemplateTextMetricKey, style: SheetTemplateTextStyle) => void
}) {
  const fontUnit = template.page.isPhysical ? 'pt' : 'px'
  const spacingUnit = template.page.isPhysical ? 'mm' : 'px'
  const fields: Array<{
    key: TemplateTextMetricKey
    label: string
    unit: string
    fallback: number
    kind: 'font' | 'spacing'
    min: number
  }> = [
    { key: 'fontSize', label: '文字', unit: fontUnit, fallback: defaults.fontSizePx, kind: 'font', min: 0.1 },
    { key: 'minFontSize', label: '最小', unit: fontUnit, fallback: defaults.minFontSizePx, kind: 'font', min: 0.1 },
    { key: 'lineHeight', label: '行間', unit: fontUnit, fallback: defaults.lineHeightPx, kind: 'font', min: 0.1 },
    { key: 'padding', label: '内余白', unit: spacingUnit, fallback: defaults.paddingPx, kind: 'spacing', min: 0 },
  ]
  return (
    <div className="templateCalibrationTargetFields templateTextMetricFields">
      {fields.map(field => (
        <label key={field.key}>
          <span>{field.label} {field.unit}</span>
          <input
            className="numberInput"
            type="number"
            min={field.min}
            step="0.1"
            value={templateTextMetricValue(template, style, field.key, field.fallback, field.kind)}
            onChange={event => onChange(
              field.key,
              withTemplateTextMetric(template, style, field.key, Number(event.currentTarget.value), field.kind),
            )}
          />
        </label>
      ))}
    </div>
  )
}

function templateTextMetricValue(
  template: SheetTemplate,
  style: SheetTemplateTextStyle | undefined,
  key: TemplateTextMetricKey,
  fallbackReferencePx: number,
  kind: 'font' | 'spacing',
): number {
  const source = style?.[key]
    ?? legacyTemplateTextMetric(style, key)
    ?? sheetTemplateLengthForReferencePx(template, fallbackReferencePx, kind)
  const targetUnit = template.page.isPhysical
    ? kind === 'spacing' ? 'mm' : 'pt'
    : 'px'
  return roundTemplateMetric(convertSheetTemplateLength(template, source, targetUnit).value)
}

function withTemplateTextMetric(
  template: SheetTemplate,
  style: SheetTemplateTextStyle | undefined,
  key: TemplateTextMetricKey,
  value: number,
  kind: 'font' | 'spacing',
): SheetTemplateTextStyle {
  const unit = template.page.isPhysical
    ? kind === 'spacing' ? 'mm' : 'pt'
    : 'px'
  const metric: SheetTemplateLength = {
    value: Math.max(key === 'padding' ? 0 : 0.1, Number.isFinite(value) ? value : 0),
    unit,
  }
  return { ...(style ?? {}), [key]: metric }
}

function legacyTemplateTextMetric(
  style: SheetTemplateTextStyle | undefined,
  key: TemplateTextMetricKey,
): SheetTemplateLength | undefined {
  const legacyKey = key === 'fontSize'
    ? 'fontSizePx'
    : key === 'minFontSize'
      ? 'minFontSizePx'
      : key === 'lineHeight'
        ? 'lineHeightPx'
        : 'paddingPx'
  const value = style?.[legacyKey]
  return typeof value === 'number' && Number.isFinite(value) ? { value, unit: 'px' } : undefined
}

function roundTemplateMetric(value: number): number {
  return Math.round(value * 1000) / 1000
}

const decorativeGridPatternOptions: Array<[SheetTemplateLinePattern | 'none', string]> = [
  ['none', 'なし'],
  ['solid', '実線'],
  ['dotted', '点線'],
  ['dashed', '破線'],
]

function decorativeGridAxisPattern(
  region: SheetTemplate['regions'][number],
  axis: 'row' | 'column',
): SheetTemplateLinePattern | 'none' {
  return region.grid?.lineRules?.find(rule => rule.axis === axis && rule.target === 'inner')?.style?.pattern ?? 'none'
}

function decorativeGridHasOuterBorder(
  region: SheetTemplate['regions'][number],
): boolean {
  const outerAxes = new Set(region.grid?.lineRules?.filter(rule => rule.target === 'outer').map(rule => rule.axis) ?? [])
  return outerAxes.has('row') && outerAxes.has('column')
}

function decorativeGridSharedLineStyle(
  region: SheetTemplate['regions'][number],
) {
  const style = region.grid?.lineRules?.find(rule => rule.style)?.style
  return {
    widthPx: style?.widthPx ?? 1,
    color: style?.color ?? '#2f3430',
  }
}

function isDecorativeGridRegion(
  region: SheetTemplate['regions'][number] | null,
): region is SheetTemplate['regions'][number] & { type: 'decorative'; grid: NonNullable<SheetTemplate['regions'][number]['grid']> } {
  return region?.type === 'decorative' && Boolean(region.grid)
}
