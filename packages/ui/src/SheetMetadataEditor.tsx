import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  resolveSheetTemplateRegionRect,
  type CutMetadataFieldId,
  type CutProject,
  type SheetPage,
  type SheetTemplate,
} from '@xsheet-remap/core'
import { DurationFrameControl } from './app-navigation'

type EditableMetadataRegion = SheetTemplate['regions'][number] & {
  binding: Extract<NonNullable<SheetTemplate['regions'][number]['binding']>, { target: 'cut-metadata' }>
}

export function SheetMetadataEditor({
  project,
  template,
  page,
  pageSize,
  pageWidth,
  pageHeight,
  displayDurationFrames,
  paperTracks,
  onMetadataChange,
  onDurationChange,
}: {
  project: CutProject
  template: SheetTemplate
  page: SheetPage
  pageSize: { widthPx: number; heightPx: number }
  pageWidth: number
  pageHeight: number
  displayDurationFrames: number
  paperTracks: string[]
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
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
  const active = regionLayouts.find(item => item.region.regionId === editingRegionId) ?? null

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

  return (
    <div className="sheetMetadataEditorLayer" aria-label={`${page.pageIndex + 1}ページのシート情報編集`}>
      {regionLayouts.map(({ region, rect }) => (
        <button
          key={region.regionId}
          type="button"
          className="sheetMetadataEditHotspot"
          style={hotspotStyle(rect, pageSize, pageWidth, pageHeight)}
          aria-label={`${region.label}を編集`}
          aria-expanded={editingRegionId === region.regionId}
          title={`${region.label}を編集`}
          onClick={event => {
            event.stopPropagation()
            if (editingRegionId === region.regionId) {
              setEditingRegionId(null)
              return
            }
            activeTriggerRef.current = event.currentTarget
            setEditingRegionId(region.regionId)
          }}
        >
          <PencilIcon />
        </button>
      ))}
      {active && (
        <div
          ref={popoverRef}
          className="sheetMetadataEditorPopover"
          role="dialog"
          aria-label={`${active.region.label}を編集`}
          style={popoverStyle(active.rect, pageWidth, pageHeight)}
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
            <strong>{active.region.label}</strong>
            <button type="button" aria-label={`${active.region.label}の編集を閉じる`} onClick={() => closeEditor(true)}>×</button>
          </div>
          {active.region.binding.field === 'duration'
            ? (
              <DurationFrameControl
                frames={project.logicalSheet.durationFrames}
                fps={project.logicalSheet.fps}
                onChange={onDurationChange}
              />
              )
            : (
              <div className="sheetMetadataEditorField">
                <input
                  autoFocus
                  aria-label={active.region.label}
                  value={metadataValue(project, active.region.binding.field, active.region.binding.customKey)}
                  onChange={event => onMetadataChange(
                    active.region.binding.field,
                    event.currentTarget.value,
                    active.region.binding.customKey,
                  )}
                />
              </div>
              )}
        </div>
      )}
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

export function metadataEditIconSizePx(
  rect: { w: number; h: number },
  pageSize: { widthPx: number; heightPx: number },
  displayedPageSize: { widthPx: number; heightPx: number },
) {
  const templateShortSide = Math.min(
    rect.w * pageSize.widthPx,
    rect.h * pageSize.heightPx,
  )
  const displayedShortSide = Math.min(
    rect.w * displayedPageSize.widthPx,
    rect.h * displayedPageSize.heightPx,
  )
  const templateSize = clamp(templateShortSide * 0.32, 20, 26)
  const displayedSizeLimit = Math.max(16, displayedShortSide - 6)
  return Math.round(Math.min(templateSize, displayedSizeLimit))
}

function hotspotStyle(
  rect: { x: number; y: number; w: number; h: number },
  pageSize: { widthPx: number; heightPx: number },
  pageWidth: number,
  pageHeight: number,
): CSSProperties {
  return {
    ...rectStyle(rect, pageWidth, pageHeight),
    '--metadata-edit-icon-size': `${metadataEditIconSizePx(rect, pageSize, {
      widthPx: pageWidth,
      heightPx: pageHeight,
    })}px`,
  } as CSSProperties
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
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

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4l11-11-4-4L4 16v4Z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  )
}
