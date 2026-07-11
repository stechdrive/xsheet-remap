import {
  formatSheetTemplateCutNumber,
  getSheetViewLayout,
  standardA3SheetTemplate,
  type CorrectionLayer,
  type CutMetadataFieldId,
  type CutProject,
  type NormalizedRect,
  type SheetTemplate,
  type SheetTemplateRegionBinding,
} from '@xsheet-remap/core'
import { useMemo, useState, type PointerEvent, type WheelEvent } from 'react'
import { ActionMenu, PanelResizeHandle, ToolbarGroup } from './AppControls'
import type { SheetImageSettings, TemplateDetailTab, WorkspaceStyle } from './appTypes'
import { uiText } from './i18n'
import { ProcessSettingsDialog } from './ProcessSettingsDialog'
import { sortedCorrectionLayers } from './sheetAssets'
import { SHEET_ZOOM_MAX, SHEET_ZOOM_MIN, SHEET_ZOOM_WHEEL_FACTOR } from './sheetConstants'
import {
  calibrationGridBoundsForTemplate,
  calibrationTargetRectForTemplate,
  defaultSheetImageSettings,
  resolveImageRefUrl,
} from './sheetImages'
import {
  clampNumber,
  clampSheetZoom,
  fitZoomForViewport,
  handleHorizontalWheelScroll,
  verticalWheelDelta,
} from './sheetInteraction'
import { GridOverlayLayer, SheetImageLayer, TemplateChromeLayer } from './SheetTemplateLayers'
import {
  cloneSheetTemplate,
  ensureEditableTemplateDraft,
  finalizeTemplateDraftForApply,
  isBuiltInSheetTemplate,
  isModifiedBuiltInSheetTemplate,
  readFileAsDataUrl,
  type TemplateDraftKind,
} from './templateDrafts'
import {
  buildTemplateEditorRenderModel,
  gridHeaderLabelForRole,
  gridHeaderRolesForTemplate,
  hitTestTemplateEditorTarget,
  snapTemplateEditorPointToPagePixels,
  templateEditorHitRadius,
  templateEditorNormalizedRectValue,
  templateEditorPointFromClientRect,
  templateEditorRectPixelValue,
  type TemplateEditorRectKey,
  type TemplateEditorTarget,
} from './templateEditorGeometry'
import {
  buildTemplateColumns,
  clearTemplateCalibrationTargetRect,
  defaultColumnCountForRole,
  defaultRegionLabel,
  gridRoleLabel,
  setTemplateCalibrationTargetRect,
  trackProjectionForRole,
  updateTemplateRectEdge,
  type TemplateGridRole,
  type TemplateRegionEdge,
} from './templateEditing'
import { Tooltip, TooltipTarget } from './Tooltip'

const TEMPLATE_CALIBRATION_TARGET_ID = '__template_calibration_target__'
const CUT_METADATA_FIELD_IDS: CutMetadataFieldId[] = ['title', 'episode', 'scene', 'cut', 'duration', 'worker', 'page']
type MetadataBindingOptionId = `cut:${CutMetadataFieldId}` | 'group:shared-cut-numbers'
const METADATA_BINDING_OPTION_IDS: MetadataBindingOptionId[] = [
  ...CUT_METADATA_FIELD_IDS.map(field => `cut:${field}` as const),
  'group:shared-cut-numbers',
]

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
  const [detailTab, setDetailTab] = useState<TemplateDetailTab>('region')
  const [templateZoom, setTemplateZoom] = useState(1)
  const [dockWidth, setDockWidth] = useState(380)
  const [processSettingsOpen, setProcessSettingsOpen] = useState(false)
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
  const effectiveSelectedRegionId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : selectedRegion?.regionId ?? null
  const correctionLayers = sortedCorrectionLayers(project)
  const defaultCorrectionLayer = correctionLayers[0] ?? null
  const templateReferenceImageUrl = template.defaultUnderlay?.imageRef
    ? resolveImageRefUrl({ ...template.defaultUnderlay.imageRef, assetPath: template.defaultUnderlay.assetPath })
    : null
  const templateReferenceImageSettings: SheetImageSettings = template.defaultUnderlay?.alignment
    ? { ...defaultSheetImageSettings(), ...template.defaultUnderlay.alignment }
    : defaultSheetImageSettings()

  function setClampedTemplateZoom(value: number) {
    setTemplateZoom(clampSheetZoom(value))
  }

  function updateTemplateDraft(updater: (currentTemplate: SheetTemplate) => SheetTemplate) {
    setDraftTemplate(currentTemplate => {
      const nextTemplate = updater(ensureEditableTemplateDraft(currentTemplate))
      return isModifiedBuiltInSheetTemplate(nextTemplate) ? ensureEditableTemplateDraft(nextTemplate) : nextTemplate
    })
  }

  function replaceTemplateDraft(nextTemplate: SheetTemplate | null, nextTab: TemplateDetailTab) {
    if (!nextTemplate) return
    const clonedTemplate = cloneSheetTemplate(isModifiedBuiltInSheetTemplate(nextTemplate) ? ensureEditableTemplateDraft(nextTemplate) : nextTemplate)
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
      ...currentTemplate,
      page: {
        ...currentTemplate.page,
        ...updates,
      },
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

  function updateRegion(regionId: string, updates: Partial<SheetTemplate['regions'][number]>) {
    updateTemplateDraft(currentTemplate => ({
      ...currentTemplate,
      regions: currentTemplate.regions.map(region => region.regionId === regionId ? { ...region, ...updates } : region),
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
        fontSizePx: 22,
        minFontSizePx: 10,
        fontWeight: 700,
        horizontalAlign: 'center',
        verticalAlign: 'middle',
        paddingPx: 8,
        shrinkToFit: true,
      },
    }
    setDraftTemplate({ ...editableTemplate, regions: [...editableTemplate.regions, region] })
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

  const detailTabs: Array<[TemplateDetailTab, string]> = [
    ['region', uiText.template.detailTabs.region],
    ['display', uiText.template.detailTabs.display],
    ['reference', uiText.template.detailTabs.reference],
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
          </dl>
          )
        : <p className="muted">{uiText.template.noReferenceImage}</p>}
    </div>
  )

  const displayControls = (
    <div className="detailStack">
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
            <th>{uiText.template.headers.fontSize}</th>
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
                    value={region.textStyle?.fontSizePx ?? 22}
                    onChange={event => updateRegion(region.regionId, {
                      textStyle: { ...(region.textStyle ?? {}), fontSizePx: Math.max(1, Number(event.currentTarget.value)) },
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
              max={SHEET_ZOOM_MAX * 100}
              value={Math.round(templateZoom * 100)}
              onInput={event => setClampedTemplateZoom(Number(event.currentTarget.value) / 100)}
              onChange={event => setClampedTemplateZoom(Number(event.currentTarget.value) / 100)}
            />
            <span className="zoomValue">{Math.round(templateZoom * 100)}%</span>
          </label>
          <Tooltip label={uiText.actions.zoomResetTitle}>
            <button onClick={() => setClampedTemplateZoom(1)}>{uiText.actions.zoomReset}</button>
          </Tooltip>
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

type TemplateEditorDragPreview = {
  targetId: string
  rect: NormalizedRect
}

function TemplateRegionEditor({
  template,
  setTemplate,
  imageUrl,
  imageSettings,
  zoom,
  setZoom,
  selectedRegionId,
  onSelectRegion,
}: {
  template: SheetTemplate
  setTemplate: (updater: (currentTemplate: SheetTemplate) => SheetTemplate) => void
  imageUrl: string | null
  imageSettings: SheetImageSettings
  zoom: number
  setZoom: (zoom: number) => void
  selectedRegionId: string | null
  onSelectRegion: (regionId: string) => void
}) {
  const [dragPreview, setDragPreview] = useState<TemplateEditorDragPreview | null>(null)
  const editorTemplate = useMemo(() => {
    if (!dragPreview) return template
    if (dragPreview.targetId === TEMPLATE_CALIBRATION_TARGET_ID) {
      return setTemplateCalibrationTargetRect(template, dragPreview.rect)
    }
    return {
      ...template,
      regions: template.regions.map(region => region.regionId === dragPreview.targetId
        ? { ...region, rect: dragPreview.rect }
        : region),
    }
  }, [dragPreview, template])
  const renderModel = useMemo(() => buildTemplateEditorRenderModel(editorTemplate), [editorTemplate])
  const calibrationTargetRect = renderModel.calibrationTargetRect
  const isCalibrationTargetSelected = selectedRegionId === TEMPLATE_CALIBRATION_TARGET_ID
  const selectedRegion = selectedRegionId && !isCalibrationTargetSelected ? editorTemplate.regions.find(region => region.regionId === selectedRegionId) ?? null : null
  const [hoveredTargetId, setHoveredTargetId] = useState<string | null>(null)
  const regionHitRadius = useMemo(() => templateEditorHitRadius(editorTemplate, zoom, 6), [editorTemplate, zoom])
  const calibrationHitRadius = useMemo(() => templateEditorHitRadius(editorTemplate, zoom, 9), [editorTemplate, zoom])
  const effectiveHoveredTargetId = hoveredTargetId === TEMPLATE_CALIBRATION_TARGET_ID
    ? calibrationTargetRect ? hoveredTargetId : null
    : hoveredTargetId && editorTemplate.regions.some(region => region.regionId === hoveredTargetId)
      ? hoveredTargetId
      : null
  const hoveredRegion = effectiveHoveredTargetId && effectiveHoveredTargetId !== selectedRegionId && effectiveHoveredTargetId !== TEMPLATE_CALIBRATION_TARGET_ID
    ? editorTemplate.regions.find(region => region.regionId === effectiveHoveredTargetId) ?? null
    : null
  const isCalibrationTargetHovered = effectiveHoveredTargetId === TEMPLATE_CALIBRATION_TARGET_ID && !isCalibrationTargetSelected

  function pointFromEvent(event: PointerEvent<SVGSVGElement> | PointerEvent<SVGElement>) {
    const svg = (event.currentTarget.ownerSVGElement ?? event.currentTarget) as SVGSVGElement
    return templateEditorPointFromSvg(svg, event.clientX, event.clientY)
  }

  function templateEditorPointFromSvg(svg: SVGSVGElement, clientX: number, clientY: number) {
    return snapTemplateEditorPointToPagePixels(
      templateEditorPointFromClientRect(svg.getBoundingClientRect(), clientX, clientY),
      editorTemplate.page,
    )
  }

  function targetFromEvent(event: PointerEvent<SVGElement>): TemplateEditorTarget | null {
    return hitTestTemplateEditorTarget(editorTemplate, pointFromEvent(event), {
      calibrationTargetRect,
      calibrationHitRadius,
      regionHitRadius,
    })
  }

  function targetId(target: TemplateEditorTarget | null): string | null {
    if (!target) return null
    return target.kind === 'calibration-target' ? TEMPLATE_CALIBRATION_TARGET_ID : target.regionId
  }

  function handleHitSurfacePointerMove(event: PointerEvent<SVGElement>) {
    const nextTargetId = targetId(targetFromEvent(event))
    setHoveredTargetId(current => current === nextTargetId ? current : nextTargetId)
  }

  function handleHitSurfacePointerLeave() {
    setHoveredTargetId(null)
  }

  function handleHitSurfacePointerDown(event: PointerEvent<SVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = targetFromEvent(event)
    if (!target) return
    event.preventDefault()
    event.stopPropagation()
    onSelectRegion(target.kind === 'calibration-target' ? TEMPLATE_CALIBRATION_TARGET_ID : target.regionId)
  }

  function commitDragRect(targetId: string, rect: NormalizedRect) {
    setTemplate(currentTemplate => {
      if (targetId === TEMPLATE_CALIBRATION_TARGET_ID) {
        return setTemplateCalibrationTargetRect(currentTemplate, rect)
      }
      return {
        ...currentTemplate,
        regions: currentTemplate.regions.map(region => region.regionId === targetId ? { ...region, rect } : region),
      }
    })
  }

  function handleEdgePointerDown(edge: TemplateRegionEdge, event: PointerEvent<SVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const target = event.currentTarget
    const targetId = isCalibrationTargetSelected ? TEMPLATE_CALIBRATION_TARGET_ID : selectedRegionId
    const startRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedRegion?.rect
    if (!targetId || !startRect) return
    const svg = target.ownerSVGElement
    if (!svg) return
    let latestPoint = pointFromEvent(event)
    let previewFrameId = 0
    const updatePreview = () => {
      previewFrameId = 0
      setDragPreview({ targetId, rect: updateTemplateRectEdge(startRect, edge, latestPoint) })
    }
    const updateFromEvent = (nextEvent: globalThis.PointerEvent) => {
      if (nextEvent.pointerId !== pointerId) return
      latestPoint = templateEditorPointFromSvg(svg, nextEvent.clientX, nextEvent.clientY)
      if (previewFrameId === 0) previewFrameId = window.requestAnimationFrame(updatePreview)
    }
    const finishDrag = (nextEvent: globalThis.PointerEvent, useEventPoint: boolean) => {
      if (nextEvent.pointerId !== pointerId) return
      if (useEventPoint) {
        latestPoint = templateEditorPointFromSvg(svg, nextEvent.clientX, nextEvent.clientY)
      }
      if (previewFrameId !== 0) window.cancelAnimationFrame(previewFrameId)
      window.removeEventListener('pointermove', updateFromEvent)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      const finalRect = updateTemplateRectEdge(startRect, edge, latestPoint)
      if (!sameNormalizedRect(startRect, finalRect)) commitDragRect(targetId, finalRect)
      setDragPreview(null)
      if (
        typeof target.releasePointerCapture === 'function'
        && (typeof target.hasPointerCapture !== 'function' || target.hasPointerCapture(pointerId))
      ) {
        target.releasePointerCapture(pointerId)
      }
    }
    const handlePointerUp = (nextEvent: globalThis.PointerEvent) => finishDrag(nextEvent, true)
    const handlePointerCancel = (nextEvent: globalThis.PointerEvent) => finishDrag(nextEvent, false)
    target.setPointerCapture(pointerId)
    updatePreview()
    window.addEventListener('pointermove', updateFromEvent)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
  }

  function handleWheelZoom(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) {
      handleHorizontalWheelScroll(event)
      return
    }
    const rawVerticalDelta = verticalWheelDelta(event)
    if (rawVerticalDelta === 0) return
    event.preventDefault()
    const viewport = event.currentTarget
    const rect = viewport.getBoundingClientRect()
    const localX = event.clientX - rect.left
    const localY = event.clientY - rect.top
    const contentX = viewport.scrollLeft + localX
    const contentY = viewport.scrollTop + localY
    const factor = rawVerticalDelta < 0 ? SHEET_ZOOM_WHEEL_FACTOR : 1 / SHEET_ZOOM_WHEEL_FACTOR
    const nextZoom = clampSheetZoom(zoom * factor)
    const ratio = nextZoom / zoom
    setZoom(nextZoom)
    window.requestAnimationFrame(() => {
      viewport.scrollLeft = contentX * ratio - localX
      viewport.scrollTop = contentY * ratio - localY
    })
  }

  const activeEditorRect = isCalibrationTargetSelected ? calibrationTargetRect : selectedRegion?.rect ?? null
  const activeEditorRectReadout = activeEditorRect
    ? (['x', 'y', 'w', 'h'] as const)
        .map(key => `${key.toUpperCase()} ${templateEditorRectPixelValue(activeEditorRect, key, editorTemplate.page)}`)
        .join(' / ')
    : null

  return (
    <div className="templateEditor">
      <div className="templateEditorViewport" onWheel={handleWheelZoom}>
        <svg
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
          className="templateEditorSvg"
          aria-label={uiText.template.editorLabel}
          style={{ width: `${editorTemplate.page.widthPx * zoom}px`, aspectRatio: `${editorTemplate.page.widthPx} / ${editorTemplate.page.heightPx}` }}
        >
          <g className="templateStaticLayer" aria-hidden="true">
            <rect x="0" y="0" width="1" height="1" fill="#f7f7f4" />
            {imageUrl && <SheetImageLayer imageUrl={imageUrl} imageSettings={imageSettings} template={editorTemplate} forceRaw preview />}
            <TemplateChromeLayer model={renderModel.chrome} />
            {renderModel.gridOverlays.map(model => (
              <GridOverlayLayer key={model.regionId} model={model} />
            ))}
          </g>
          <g className="templateInteractionOverlay">
            {hoveredRegion && (
              <rect
                className="templateRegionHighlight hovered"
                x={hoveredRegion.rect.x}
                y={hoveredRegion.rect.y}
                width={hoveredRegion.rect.w}
                height={hoveredRegion.rect.h}
              />
            )}
            {calibrationTargetRect && (
              <g className="templateCalibrationTarget">
                <rect
                  className={[
                    'templateCalibrationTargetOutline',
                    isCalibrationTargetSelected ? 'selected' : '',
                    isCalibrationTargetHovered ? 'hovered' : '',
                  ].filter(Boolean).join(' ')}
                  x={calibrationTargetRect.x}
                  y={calibrationTargetRect.y}
                  width={calibrationTargetRect.w}
                  height={calibrationTargetRect.h}
                />
              </g>
            )}
            <rect
              className={effectiveHoveredTargetId ? 'templateEditorHitSurface interactive' : 'templateEditorHitSurface'}
              x="0"
              y="0"
              width="1"
              height="1"
              onPointerMove={handleHitSurfacePointerMove}
              onPointerLeave={handleHitSurfacePointerLeave}
              onPointerDown={handleHitSurfacePointerDown}
            />
            {selectedRegion && (
              <TemplateEditHandles rect={selectedRegion.rect} onEdgePointerDown={handleEdgePointerDown} />
            )}
            {isCalibrationTargetSelected && calibrationTargetRect && (
              <TemplateEditHandles rect={calibrationTargetRect} variant="calibrationTarget" onEdgePointerDown={handleEdgePointerDown} />
            )}
          </g>
        </svg>
      </div>
      <div className="templateEditorCaption">
        <strong>{isCalibrationTargetSelected ? uiText.template.calibrationTarget : selectedRegion?.label ?? '-'}</strong>
        <span className="muted">
          {isCalibrationTargetSelected
            ? uiText.template.calibrationTargetCaption
            : selectedRegion?.grid ? `${gridRoleLabel(selectedRegion.grid.role)} / ${selectedRegion.grid.columns.length}列 / ${selectedRegion.grid.rowCount}行` : uiText.template.noGridRegion}
        </span>
        {activeEditorRectReadout && <span className="templateEditorRectReadout">{activeEditorRectReadout} px</span>}
      </div>
    </div>
  )
}

function TemplateEditHandles({
  rect,
  variant,
  onEdgePointerDown,
}: {
  rect: NormalizedRect
  variant?: 'calibrationTarget'
  onEdgePointerDown: (edge: TemplateRegionEdge, event: PointerEvent<SVGElement>) => void
}) {
  const left = rect.x
  const right = rect.x + rect.w
  const top = rect.y
  const bottom = rect.y + rect.h
  const midX = rect.x + rect.w / 2
  const midY = rect.y + rect.h / 2
  const knobRadius = 0.005

  return (
    <g className={variant === 'calibrationTarget' ? 'templateEditHandles calibrationTarget' : 'templateEditHandles'}>
      <rect className="templateSelectedRegion" x={rect.x} y={rect.y} width={rect.w} height={rect.h} />
      <line className="templateEdgeGuide vertical" x1={left} x2={left} y1={0} y2={1} />
      <line className="templateEdgeGuide vertical" x1={right} x2={right} y1={0} y2={1} />
      <line className="templateEdgeGuide horizontal" x1={0} x2={1} y1={top} y2={top} />
      <line className="templateEdgeGuide horizontal" x1={0} x2={1} y1={bottom} y2={bottom} />
      <line className="templateEdgeHit vertical" x1={left} x2={left} y1={0} y2={1} onPointerDown={event => onEdgePointerDown('left', event)} />
      <line className="templateEdgeHit vertical" x1={right} x2={right} y1={0} y2={1} onPointerDown={event => onEdgePointerDown('right', event)} />
      <line className="templateEdgeHit horizontal" x1={0} x2={1} y1={top} y2={top} onPointerDown={event => onEdgePointerDown('top', event)} />
      <line className="templateEdgeHit horizontal" x1={0} x2={1} y1={bottom} y2={bottom} onPointerDown={event => onEdgePointerDown('bottom', event)} />
      <circle className="templateHandleKnob vertical" cx={left} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('left', event)} />
      <circle className="templateHandleKnob vertical" cx={right} cy={midY} r={knobRadius} onPointerDown={event => onEdgePointerDown('right', event)} />
      <circle className="templateHandleKnob horizontal" cx={midX} cy={top} r={knobRadius} onPointerDown={event => onEdgePointerDown('top', event)} />
      <circle className="templateHandleKnob horizontal" cx={midX} cy={bottom} r={knobRadius} onPointerDown={event => onEdgePointerDown('bottom', event)} />
    </g>
  )
}

function metadataFieldLabel(field: CutMetadataFieldId): string {
  return {
    title: 'タイトル',
    episode: '話数',
    scene: 'シーン',
    cut: 'カット',
    duration: '尺',
    worker: '作業者',
    page: 'ページ',
    custom: 'カスタム',
  }[field]
}

function metadataBindingOptionId(binding: SheetTemplateRegionBinding | undefined): MetadataBindingOptionId | null {
  if (binding?.target === 'cut-metadata') return `cut:${binding.field}`
  if (binding?.target === 'cut-group' && binding.field === 'shared-cut-numbers') return 'group:shared-cut-numbers'
  return null
}

function metadataBindingFromOptionId(optionId: MetadataBindingOptionId): SheetTemplateRegionBinding {
  if (optionId === 'group:shared-cut-numbers') {
    return { target: 'cut-group', field: 'shared-cut-numbers', opening: '[', closing: ']', separator: '・' }
  }
  return { target: 'cut-metadata', field: optionId.slice(4) as CutMetadataFieldId }
}

function metadataBindingOptionLabel(optionId: MetadataBindingOptionId): string {
  return optionId === 'group:shared-cut-numbers'
    ? '兼用カット'
    : metadataFieldLabel(optionId.slice(4) as CutMetadataFieldId)
}

function standardCalibrationTargetRectForTemplate(template: SheetTemplate): NormalizedRect | null {
  if (template.templateKind !== standardA3SheetTemplate.templateKind || template.layoutMode !== standardA3SheetTemplate.layoutMode) return null
  const rect = standardA3SheetTemplate.calibration?.targetRect
  return rect ? { ...rect } : null
}

function sameNormalizedRect(a: NormalizedRect, b: NormalizedRect): boolean {
  const epsilon = 0.000001
  return Math.abs(a.x - b.x) <= epsilon
    && Math.abs(a.y - b.y) <= epsilon
    && Math.abs(a.w - b.w) <= epsilon
    && Math.abs(a.h - b.h) <= epsilon
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
