import { useEffect, useRef, useState } from 'react'
import {
  resolveSheetTemplateRegionRect,
  sheetFormFieldValueText,
  type CutMetadataFieldId,
  type CutProject,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateFieldDefinition,
} from '@xsheet-remap/core'
import { DurationFrameControl } from './DurationFrameControl'
import { TooltipTarget } from './Tooltip'
import { buildTemplateChromeRenderModel } from './templateEditorGeometry'

type EditableMetadataRegion = SheetTemplate['regions'][number] & {
  binding: Extract<NonNullable<SheetTemplate['regions'][number]['binding']>, { target: 'cut-metadata' }>
}

export function SheetMetadataEditor({
  project,
  template,
  page,
  pageWidth,
  pageHeight,
  displayDurationFrames,
  paperTracks,
  onMetadataChange,
  onDurationChange,
  onFormFieldChange,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  pageWidth: number
  pageHeight: number
  displayDurationFrames: number
  paperTracks: string[]
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
  onFormFieldChange: (definition: SheetTemplateFieldDefinition, value: string | number | boolean) => void
}) {
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null)
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const regions = template.regions.filter((region): region is EditableMetadataRegion =>
    region.type === 'metadata-field'
    && region.usage === 'input'
    && region.binding?.target === 'cut-metadata'
    && region.binding.field !== 'page',
  )
  const regionLayouts = regions.map(region => ({
    region,
    rect: resolveSheetTemplateRegionRect(template, region, displayDurationFrames, {
      paperTracks,
      layoutOverrides: project.sheetView.layoutOverrides,
    }),
  }))
  const formFields = buildTemplateChromeRenderModel(template, paperTracks, displayDurationFrames, {
    layoutOverrides: project.sheetView.layoutOverrides,
  }).formFields.filter(field => field.editable)
  const activeMetadata = regionLayouts.find(item => item.region.regionId === editingRegionId) ?? null
  const activeForm = formFields.find(field => field.key === editingRegionId) ?? null
  const activeRect = activeMetadata?.rect ?? activeForm?.rect ?? null
  const activeLabel = activeMetadata?.region.label ?? activeForm?.definition.label ?? ''

  useEffect(() => {
    if (!editingRegionId) return

    function isInsideEditor(target: EventTarget | null) {
      return target instanceof Node
        && (popoverRef.current?.contains(target) || activeTriggerRef.current?.contains(target))
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isInsideEditor(event.target)) setEditingRegionId(null)
    }

    function handleFocusIn(event: FocusEvent) {
      if (!isInsideEditor(event.target)) setEditingRegionId(null)
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
    }
  }, [editingRegionId])

  function closeEditor(restoreTriggerFocus: boolean) {
    const trigger = activeTriggerRef.current
    setEditingRegionId(null)
    if (restoreTriggerFocus) trigger?.focus()
  }

  function openEditor(regionId: string, trigger: HTMLButtonElement) {
    activeTriggerRef.current = trigger
    setEditingRegionId(regionId)
  }

  return (
    <div className="sheetMetadataEditorLayer" aria-label={`${page.pageIndex + 1}ページのシート情報編集`}>
      {regionLayouts.map(({ region, rect }) => (
        <TooltipTarget key={region.regionId} label={`${region.label}: ダブルクリックまたはEnterで編集`} disabled={editingRegionId === region.regionId}>
          {tooltipProps => (
            <button
              type="button"
              className="sheetMetadataEditHotspot"
              style={rectStyle(rect, pageWidth, pageHeight)}
              aria-label={`${region.label}を編集`}
              aria-haspopup="dialog"
              aria-expanded={editingRegionId === region.regionId}
              aria-keyshortcuts="Enter F2"
              {...tooltipProps}
              onPointerDown={event => {
                tooltipProps.onPointerDown()
                event.stopPropagation()
              }}
              onClick={event => event.stopPropagation()}
              onDoubleClick={event => {
                event.stopPropagation()
                openEditor(region.regionId, event.currentTarget)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === 'F2' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  openEditor(region.regionId, event.currentTarget)
                }
              }}
            />
          )}
        </TooltipTarget>
      ))}
      {formFields.map(field => (
        <TooltipTarget key={field.key} label={`${field.definition.label}: ダブルクリックまたはEnterで編集`} disabled={editingRegionId === field.key}>
          {tooltipProps => (
            <button
              type="button"
              className="sheetMetadataEditHotspot sheetFormEditHotspot"
              style={rectStyle(field.rect, pageWidth, pageHeight)}
              aria-label={`${field.definition.label}を編集`}
              aria-haspopup="dialog"
              aria-expanded={editingRegionId === field.key}
              aria-keyshortcuts="Enter F2"
              {...tooltipProps}
              onPointerDown={event => {
                tooltipProps.onPointerDown()
                event.stopPropagation()
              }}
              onClick={event => event.stopPropagation()}
              onDoubleClick={event => {
                event.stopPropagation()
                openEditor(field.key, event.currentTarget)
              }}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === 'F2' || event.key === ' ') {
                  event.preventDefault()
                  event.stopPropagation()
                  openEditor(field.key, event.currentTarget)
                }
              }}
            />
          )}
        </TooltipTarget>
      ))}
      {activeRect && (activeMetadata || activeForm) && (
        <div
          ref={popoverRef}
          className="sheetMetadataEditorPopover"
          role="dialog"
          aria-label={`${activeLabel}を編集`}
          style={popoverStyle(activeRect, pageWidth, pageHeight)}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeEditor(true)
            }
            if (
              event.key === 'Enter'
              && event.target instanceof HTMLInputElement
              && !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              event.stopPropagation()
              closeEditor(true)
            }
          }}
        >
          <div className="sheetMetadataEditorHeader">
            <strong>{activeLabel}</strong>
            <button type="button" aria-label={`${activeLabel}の編集を閉じる`} onClick={() => closeEditor(true)}>×</button>
          </div>
          {activeMetadata?.region.binding.field === 'duration'
            ? (
              <DurationFrameControl
                frames={project.logicalSheet.durationFrames}
                fps={project.logicalSheet.fps}
                onChange={onDurationChange}
                showLabel={false}
                autoFocus
              />
              )
            : activeMetadata
              ? (
              <div className="sheetMetadataEditorField">
                <input
                  autoFocus
                  aria-label={activeMetadata.region.label}
                  value={metadataValue(project, activeMetadata.region.binding.field, activeMetadata.region.binding.customKey)}
                  onChange={event => onMetadataChange(
                    activeMetadata.region.binding.field,
                    event.currentTarget.value,
                    activeMetadata.region.binding.customKey,
                  )}
                />
              </div>
                )
              : activeForm
                ? <SheetFormFieldControl project={project} field={activeForm} onChange={onFormFieldChange} />
                : null}
        </div>
      )}
    </div>
  )
}

function SheetFormFieldControl({
  project,
  field,
  onChange,
}: {
  project: CutProject
  field: ReturnType<typeof buildTemplateChromeRenderModel>['formFields'][number]
  onChange: (definition: SheetTemplateFieldDefinition, value: string | number | boolean) => void
}) {
  const value = project.sheetFormData[field.definition.scope][field.fieldId]
  const text = sheetFormFieldValueText(value)
  if (field.definition.valueType === 'boolean') {
    return (
      <label className="sheetMetadataEditorCheckbox">
        <input autoFocus type="checkbox" checked={value?.kind === 'boolean' && value.value} onChange={event => onChange(field.definition, event.currentTarget.checked)} />
        <span>チェック</span>
      </label>
    )
  }
  if (field.definition.valueType === 'choice') {
    return (
      <div className="sheetMetadataEditorField">
        <select autoFocus aria-label={field.definition.label} value={text} onChange={event => onChange(field.definition, event.currentTarget.value)}>
          <option value="" />
          {field.definition.choices?.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </div>
    )
  }
  if (field.definition.valueType === 'multiline') {
    return (
      <div className="sheetMetadataEditorField">
        <textarea autoFocus aria-label={field.definition.label} value={text} onChange={event => onChange(field.definition, event.currentTarget.value)} />
      </div>
    )
  }
  return (
    <div className="sheetMetadataEditorField">
      <input
        autoFocus
        type={field.definition.valueType === 'number' || field.definition.valueType === 'duration' ? 'number' : field.definition.valueType === 'date' ? 'date' : 'text'}
        aria-label={field.definition.label}
        value={text}
        onChange={event => onChange(field.definition, event.currentTarget.value)}
      />
    </div>
  )
}

function metadataValue(project: CutProject, field: CutMetadataFieldId, customKey?: string): string {
  if (field === 'custom') return customKey ? project.cut.custom?.[customKey] ?? '' : ''
  if (field === 'duration' || field === 'page') return ''
  return project.cut[field] ?? ''
}

function rectStyle(
  rect: { x: number; y: number; w: number; h: number },
  pageWidth: number,
  pageHeight: number,
) {
  return {
    left: `${rect.x * pageWidth}px`,
    top: `${rect.y * pageHeight}px`,
    width: `${rect.w * pageWidth}px`,
    height: `${rect.h * pageHeight}px`,
  }
}

function popoverStyle(
  rect: { x: number; y: number; w: number; h: number },
  pageWidth: number,
  pageHeight: number,
) {
  const width = Math.min(300, Math.max(220, pageWidth - 16))
  const height = 142
  const left = Math.max(8, Math.min(rect.x * pageWidth, pageWidth - width - 8))
  const below = (rect.y + rect.h) * pageHeight + 6
  const top = below + height <= pageHeight - 8
    ? below
    : Math.max(8, rect.y * pageHeight - height - 6)
  return { left: `${left}px`, top: `${top}px`, width: `${width}px` }
}
