import { useEffect, useMemo, useRef, useState } from 'react'
import {
  resolveSheetTemplateRegionRect,
  resolveSheetTemplateTextStyle,
  sheetFormFieldsForScope,
  sheetFormFieldValueText,
  timelineLanesForLayout,
  type CutMetadataFieldId,
  type CutProject,
  type SheetPage,
  type SheetTemplate,
  type SheetTemplateFieldDefinition,
  type NormalizedRect,
} from '@xsheet-remap/core'
import { DurationFrameControl } from './DurationFrameControl'
import { TooltipTarget } from './Tooltip'
import { buildTemplateChromeRenderModel } from './templateEditorGeometry'
import { resolveMultilineFormTextLayout } from './formTextLayout'
import type { TemplateRegionAnnotationTarget } from './appTypes'
import {
  resolveTemplateRegionMemoTarget,
  sameTemplateMemoTarget,
  type TemplateMemoTargetRef,
} from './templateMemoTargets'

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
  interactionBlocked = false,
  selectedAnnotationTarget = null,
  onMetadataChange,
  onDurationChange,
  onFormFieldChange,
  onAnnotationRegionSelect = () => {},
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  pageWidth: number
  pageHeight: number
  displayDurationFrames: number
  paperTracks: string[]
  interactionBlocked?: boolean
  selectedAnnotationTarget?: Pick<TemplateRegionAnnotationTarget, 'regionId' | 'targetId'> | null
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
  onFormFieldChange: (definition: SheetTemplateFieldDefinition, value: string | number | boolean, pageId: string) => void
  onAnnotationRegionSelect?: (target: TemplateRegionAnnotationTarget) => void
}) {
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null)
  const [inlineDraft, setInlineDraft] = useState('')
  const inlineDraftRef = useRef('')
  const activeTriggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const timelineLanes = useMemo(() => timelineLanesForLayout(project), [project])
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
      timelineLanes,
      layoutOverrides: project.sheetView.layoutOverrides,
    }),
  }))
  const chrome = useMemo(
    () => buildTemplateChromeRenderModel(template, paperTracks, displayDurationFrames, {
      layoutOverrides: project.sheetView.layoutOverrides,
      timelineLanes,
    }),
    [displayDurationFrames, paperTracks, project.sheetView.layoutOverrides, template, timelineLanes],
  )
  const formFields = chrome.formFields.filter(field => field.editable)
  const activeMetadata = regionLayouts.find(item => item.region.regionId === editingRegionId) ?? null
  const activeForm = formFields.find(field => field.key === editingRegionId) ?? null
  const activeRect = activeMetadata?.rect ?? activeForm?.rect ?? null
  const activeLabel = activeMetadata?.region.label ?? activeForm?.definition.label ?? ''
  const activeFormIsInline = activeForm?.editPresentation === 'inline'
    && (activeForm.definition.valueType === 'text' || activeForm.definition.valueType === 'multiline')
  const activeResolvedTextStyle = activeForm
    ? resolveSheetTemplateTextStyle(template, chrome.pageSize, activeForm.textStyle, { fontWeight: 700 })
    : null
  const activeInlineLayout = activeFormIsInline && activeForm
    ? activeForm.definition.valueType === 'multiline'
      ? resolveMultilineFormTextLayout(inlineDraft, activeForm.rect, chrome.pageSize, activeResolvedTextStyle!)
      : {
          fontSizePx: activeResolvedTextStyle!.fontSizePx,
          lineHeightPx: activeResolvedTextStyle!.lineHeightPx,
          paddingPx: activeResolvedTextStyle!.paddingPx,
          overflow: false,
        }
    : null
  const memoTargetRect = (target: TemplateMemoTargetRef): NormalizedRect => {
    const rects = [
      ...regionLayouts
        .filter(item => sameTemplateMemoTarget(resolveTemplateRegionMemoTarget(item.region), target))
        .map(item => item.rect),
      ...formFields
        .filter(field => sameTemplateMemoTarget(field.memoTarget, target))
        .map(field => field.rect),
      ...chrome.formAnnotationTargets
        .filter(item => sameTemplateMemoTarget(item.memoTarget, target))
        .map(item => item.rect),
    ]
    return rects.reduce(unionRect, rects[0] ?? { x: 0, y: 0, w: 1, h: 1 })
  }
  const pageScale = pageHeight / Math.max(1, chrome.pageSize.heightPx)

  useEffect(() => {
    if (!editingRegionId) return

    function commitAndCloseEditor() {
      if (activeFormIsInline && activeForm) {
        const currentValue = sheetFormFieldValueText(
          sheetFormFieldsForScope(project.sheetFormData, activeForm.definition.scope, page.pageId)[activeForm.fieldId],
        )
        if (inlineDraftRef.current !== currentValue) {
          onFormFieldChange(activeForm.definition, inlineDraftRef.current, page.pageId)
        }
      }
      setEditingRegionId(null)
    }

    function isInsideEditor(target: EventTarget | null) {
      return target instanceof Node
        && (popoverRef.current?.contains(target) || activeTriggerRef.current?.contains(target))
    }

    function handlePointerDown(event: PointerEvent) {
      if (!isInsideEditor(event.target)) commitAndCloseEditor()
    }

    function handleFocusIn(event: FocusEvent) {
      if (!isInsideEditor(event.target)) commitAndCloseEditor()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('focusin', handleFocusIn, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('focusin', handleFocusIn, true)
    }
  }, [activeForm, activeFormIsInline, editingRegionId, onFormFieldChange, page.pageId, project.sheetFormData])

  useEffect(() => {
    if (!activeFormIsInline || !activeForm) return
    const surface = activeTriggerRef.current?.closest('.sheetPageSurface')
    const renderedFields = surface
      ? Array.from(surface.querySelectorAll<SVGTextElement>('.metadataFieldText'))
        .filter(element => element.dataset.regionId === activeForm.key)
      : []
    const previousVisibility = renderedFields.map(element => element.style.visibility)
    renderedFields.forEach(element => { element.style.visibility = 'hidden' })
    return () => {
      renderedFields.forEach((element, index) => { element.style.visibility = previousVisibility[index] ?? '' })
    }
  }, [activeForm, activeFormIsInline])

  useEffect(() => {
    if (!activeFormIsInline) return
    const timeout = window.setTimeout(() => {
      popoverRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    }, 0)
    return () => window.clearTimeout(timeout)
  }, [activeFormIsInline, editingRegionId])

  function closeEditor(restoreTriggerFocus: boolean, commitMultiline: boolean) {
    const trigger = activeTriggerRef.current
    if (commitMultiline && activeFormIsInline && activeForm) {
      const currentValue = sheetFormFieldValueText(
        sheetFormFieldsForScope(project.sheetFormData, activeForm.definition.scope, page.pageId)[activeForm.fieldId],
      )
      if (inlineDraftRef.current !== currentValue) {
        onFormFieldChange(activeForm.definition, inlineDraftRef.current, page.pageId)
      }
    }
    setEditingRegionId(null)
    if (restoreTriggerFocus) trigger?.focus()
  }

  function openEditor(regionId: string, trigger: HTMLButtonElement) {
    activeTriggerRef.current = trigger
    const form = formFields.find(field => field.key === regionId)
    if (form?.editPresentation === 'inline'
      && (form.definition.valueType === 'text' || form.definition.valueType === 'multiline')) {
      const value = sheetFormFieldValueText(
        sheetFormFieldsForScope(project.sheetFormData, form.definition.scope, page.pageId)[form.fieldId],
      )
      inlineDraftRef.current = value
      setInlineDraft(value)
    }
    setEditingRegionId(regionId)
  }

  return (
    <div
      className={[
        'sheetMetadataEditorLayer',
        interactionBlocked ? 'interactionBlocked' : '',
        editingRegionId ? 'editing' : '',
      ].filter(Boolean).join(' ')}
      aria-label={`${page.pageIndex + 1}ページのシート情報編集`}
    >
      {regionLayouts.map(({ region, rect }) => (
        <TooltipTarget key={region.regionId} label={`${region.label}: クリックでメモ対象、ダブルクリックまたはEnterで編集`} disabled={interactionBlocked || editingRegionId === region.regionId}>
          {tooltipProps => (
            <button
              type="button"
              className="sheetMetadataEditHotspot"
              style={rectStyle(rect, pageWidth, pageHeight)}
              data-region-id={region.regionId}
              data-annotation-target-selected={sameTemplateMemoTarget(selectedAnnotationTarget, { regionId: region.regionId }) ? 'true' : undefined}
              aria-label={`${region.label}を編集`}
              aria-haspopup="dialog"
              aria-expanded={editingRegionId === region.regionId}
              aria-keyshortcuts="Enter F2"
              disabled={interactionBlocked}
              {...tooltipProps}
              onPointerDown={event => {
                tooltipProps.onPointerDown()
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                const target = resolveTemplateRegionMemoTarget(region)
                onAnnotationRegionSelect(annotationRegionTarget(page, template, target, memoTargetRect(target)))
              }}
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
      {formFields.map(field => {
        const value = formFieldEditorText(project, field, page.pageId)
        const overflow = field.definition.valueType === 'multiline'
          && resolveMultilineFormTextLayout(
            value,
            field.rect,
            chrome.pageSize,
            resolveSheetTemplateTextStyle(template, chrome.pageSize, field.textStyle, { fontWeight: 700 }),
          ).overflow
        const selectionHint = field.memoTarget ? 'クリックでメモ対象、' : ''
        const tooltipLabel = overflow
          ? `${field.definition.label}: 文字が欄内に収まりません。${selectionHint}ダブルクリックまたはEnterで編集`
          : `${field.definition.label}: ${selectionHint}ダブルクリックまたはEnterで編集`
        return (
        <TooltipTarget key={field.key} label={tooltipLabel} disabled={interactionBlocked || editingRegionId === field.key}>
          {tooltipProps => (
            <button
              type="button"
              className="sheetMetadataEditHotspot sheetFormEditHotspot"
              style={rectStyle(field.rect, pageWidth, pageHeight)}
              data-region-id={field.regionId}
              data-annotation-target-id={field.memoTarget?.targetId}
              data-annotation-target-selected={sameTemplateMemoTarget(selectedAnnotationTarget, field.memoTarget) ? 'true' : undefined}
              data-text-overflow={overflow ? 'true' : 'false'}
              aria-label={`${field.definition.label}を編集`}
              aria-haspopup="dialog"
              aria-expanded={editingRegionId === field.key}
              aria-keyshortcuts="Enter F2"
              disabled={interactionBlocked}
              {...tooltipProps}
              onPointerDown={event => {
                tooltipProps.onPointerDown()
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                if (field.memoTarget) {
                  onAnnotationRegionSelect(annotationRegionTarget(page, template, field.memoTarget, memoTargetRect(field.memoTarget)))
                }
              }}
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
        )
      })}
      {chrome.formAnnotationTargets.map(target => (
        <TooltipTarget key={target.key} label={`${target.memoTarget.label}: クリックでメモ対象`} disabled={interactionBlocked}>
          {tooltipProps => (
            <button
              type="button"
              className="sheetMetadataEditHotspot sheetFormAnnotationHotspot"
              style={rectStyle(target.rect, pageWidth, pageHeight)}
              data-region-id={target.memoTarget.regionId}
              data-annotation-target-id={target.memoTarget.targetId}
              data-annotation-target-selected={sameTemplateMemoTarget(selectedAnnotationTarget, target.memoTarget) ? 'true' : undefined}
              aria-label={`${target.memoTarget.label}をメモ対象に選択`}
              disabled={interactionBlocked}
              {...tooltipProps}
              onPointerDown={event => {
                tooltipProps.onPointerDown()
                event.stopPropagation()
              }}
              onClick={event => {
                event.stopPropagation()
                onAnnotationRegionSelect(annotationRegionTarget(page, template, target.memoTarget, memoTargetRect(target.memoTarget)))
              }}
            />
          )}
        </TooltipTarget>
      ))}
      {activeRect && activeForm && activeFormIsInline && activeInlineLayout && (
        <div
          ref={popoverRef}
          className={`sheetInlineMultilineEditor${activeInlineLayout.overflow ? ' overflow' : ''}`}
          data-text-overflow={activeInlineLayout.overflow ? 'true' : 'false'}
          role="dialog"
          aria-label={`${activeLabel}を編集`}
          style={rectStyle(activeRect, pageWidth, pageHeight)}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              closeEditor(true, false)
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault()
              event.stopPropagation()
              closeEditor(true, true)
            }
          }}
        >
          <SheetFormFieldControl
            project={project}
            field={activeForm}
            pageId={page.pageId}
            inlineStyle={{
              fontSizePx: activeInlineLayout.fontSizePx * pageScale,
              lineHeightPx: activeInlineLayout.lineHeightPx * pageScale,
              paddingPx: activeInlineLayout.paddingPx * pageScale,
              fontWeight: activeResolvedTextStyle!.fontWeight,
              overflow: activeInlineLayout.overflow,
            }}
            valueOverride={inlineDraft}
            onInlineDraftChange={value => {
              inlineDraftRef.current = value
              setInlineDraft(value)
            }}
            onChange={onFormFieldChange}
          />
        </div>
      )}
      {activeRect && (activeMetadata || activeForm) && !activeFormIsInline && (
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
              closeEditor(true, false)
            }
            if (
              event.key === 'Enter'
              && event.target instanceof HTMLInputElement
              && !event.nativeEvent.isComposing
            ) {
              event.preventDefault()
              event.stopPropagation()
              closeEditor(true, true)
            }
          }}
        >
          <div className="sheetMetadataEditorHeader">
            <strong>{activeLabel}</strong>
            <button type="button" aria-label={`${activeLabel}の編集を閉じる`} onClick={() => closeEditor(true, true)}>×</button>
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
              : activeForm?.definition.builtinBinding
                ? (
                  <BuiltinMetadataFieldControl
                    project={project}
                    field={activeForm}
                    onMetadataChange={onMetadataChange}
                    onDurationChange={onDurationChange}
                  />
                  )
                : activeForm
                  ? <SheetFormFieldControl project={project} field={activeForm} pageId={page.pageId} onChange={onFormFieldChange} />
                : null}
        </div>
      )}
    </div>
  )
}

function annotationRegionTarget(
  page: SheetPage,
  template: SheetTemplate,
  target: TemplateMemoTargetRef,
  rect: NormalizedRect,
): TemplateRegionAnnotationTarget {
  return {
    kind: 'template-region',
    pageId: page.pageId,
    templateId: template.templateId,
    regionId: target.regionId,
    targetId: target.targetId,
    logicalTargetId: target.logicalTargetId,
    rect,
    label: target.label,
  }
}

function unionRect(left: NormalizedRect, right: NormalizedRect): NormalizedRect {
  const x = Math.min(left.x, right.x)
  const y = Math.min(left.y, right.y)
  const rightEdge = Math.max(left.x + left.w, right.x + right.w)
  const bottomEdge = Math.max(left.y + left.h, right.y + right.h)
  return { x, y, w: rightEdge - x, h: bottomEdge - y }
}

function SheetFormFieldControl({
  project,
  field,
  pageId,
  inlineStyle,
  valueOverride,
  onInlineDraftChange,
  onChange,
}: {
  project: CutProject
  field: ReturnType<typeof buildTemplateChromeRenderModel>['formFields'][number]
  pageId: string
  inlineStyle?: { fontSizePx: number; lineHeightPx: number; paddingPx: number; fontWeight: number; overflow: boolean }
  valueOverride?: string
  onInlineDraftChange?: (value: string) => void
  onChange: (definition: SheetTemplateFieldDefinition, value: string | number | boolean, pageId: string) => void
}) {
  const value = sheetFormFieldsForScope(project.sheetFormData, field.definition.scope, pageId)[field.fieldId]
  const text = valueOverride ?? sheetFormFieldValueText(value)
  if (field.definition.valueType === 'boolean') {
    return (
      <label className="sheetMetadataEditorCheckbox">
        <input autoFocus type="checkbox" checked={value?.kind === 'boolean' && value.value} onChange={event => onChange(field.definition, event.currentTarget.checked, pageId)} />
        <span>チェック</span>
      </label>
    )
  }
  if (field.definition.valueType === 'choice') {
    return (
      <div className="sheetMetadataEditorField">
        <select autoFocus aria-label={field.definition.label} value={text} onChange={event => onChange(field.definition, event.currentTarget.value, pageId)}>
          <option value="" />
          {field.definition.choices?.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>
      </div>
    )
  }
  if (field.definition.valueType === 'multiline') {
    return (
      <div className="sheetMetadataEditorField">
        <textarea
          autoFocus
          className={inlineStyle ? 'sheetInlineMultilineTextarea' : undefined}
          aria-label={field.definition.label}
          value={text}
          style={inlineStyle ? {
            fontSize: `${inlineStyle.fontSizePx}px`,
            lineHeight: `${inlineStyle.lineHeightPx}px`,
            padding: `${inlineStyle.paddingPx}px`,
            fontWeight: inlineStyle.fontWeight,
            overflowY: inlineStyle.overflow ? 'auto' : 'hidden',
          } : undefined}
          onChange={event => {
            if (onInlineDraftChange) onInlineDraftChange(event.currentTarget.value)
            else onChange(field.definition, event.currentTarget.value, pageId)
          }}
        />
      </div>
    )
  }
  return (
    <div className="sheetMetadataEditorField">
      <input
        autoFocus
        className={inlineStyle ? 'sheetInlineTextInput' : undefined}
        type={field.definition.valueType === 'number' || field.definition.valueType === 'duration' ? 'number' : field.definition.valueType === 'date' ? 'date' : 'text'}
        aria-label={field.definition.label}
        value={text}
        style={inlineStyle ? {
          fontSize: `${inlineStyle.fontSizePx}px`,
          lineHeight: `${inlineStyle.lineHeightPx}px`,
          padding: `${inlineStyle.paddingPx}px`,
          fontWeight: inlineStyle.fontWeight,
        } : undefined}
        onChange={event => {
          if (onInlineDraftChange) onInlineDraftChange(event.currentTarget.value)
          else onChange(field.definition, event.currentTarget.value, pageId)
        }}
      />
    </div>
  )
}

function metadataValue(project: CutProject, field: CutMetadataFieldId, customKey?: string): string {
  if (field === 'custom') return customKey ? project.cut.custom?.[customKey] ?? '' : ''
  if (field === 'duration' || field === 'page') return ''
  return project.cut[field] ?? ''
}

function formFieldEditorText(
  project: CutProject,
  field: ReturnType<typeof buildTemplateChromeRenderModel>['formFields'][number],
  pageId: string,
): string {
  const builtin = field.definition.builtinBinding
  if (builtin) {
    if (builtin.field === 'duration') {
      const fps = Math.max(1, Math.round(project.logicalSheet.fps))
      const frames = Math.max(1, Math.round(project.logicalSheet.durationFrames))
      return `${String(Math.floor(frames / fps)).padStart(2, '0')}+${String(frames % fps).padStart(2, '0')}`
    }
    return metadataValue(project, builtin.field, builtin.customKey)
  }
  return sheetFormFieldValueText(
    sheetFormFieldsForScope(project.sheetFormData, field.definition.scope, pageId)[field.fieldId],
  )
}

function BuiltinMetadataFieldControl({
  project,
  field,
  onMetadataChange,
  onDurationChange,
}: {
  project: CutProject
  field: ReturnType<typeof buildTemplateChromeRenderModel>['formFields'][number]
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
}) {
  const binding = field.definition.builtinBinding!
  if (binding.field === 'duration') {
    return (
      <DurationFrameControl
        frames={project.logicalSheet.durationFrames}
        fps={project.logicalSheet.fps}
        onChange={onDurationChange}
        showLabel={false}
        autoFocus
      />
    )
  }
  return (
    <div className="sheetMetadataEditorField">
      <input
        autoFocus
        aria-label={field.definition.label}
        value={metadataValue(project, binding.field, binding.customKey)}
        onChange={event => onMetadataChange(binding.field, event.currentTarget.value, binding.customKey)}
      />
    </div>
  )
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
