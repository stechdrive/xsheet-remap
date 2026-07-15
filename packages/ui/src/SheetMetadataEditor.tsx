import { useState } from 'react'
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
  pageWidth: number
  pageHeight: number
  displayDurationFrames: number
  paperTracks: string[]
  onMetadataChange: (field: CutMetadataFieldId, value: string, customKey?: string) => void
  onDurationChange: (frames: number) => void
}) {
  const [editingRegionId, setEditingRegionId] = useState<string | null>(null)
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

  return (
    <div className="sheetMetadataEditorLayer" aria-label={`${page.pageIndex + 1}ページのシート情報編集`}>
      {regionLayouts.map(({ region, rect }) => (
        <button
          key={region.regionId}
          type="button"
          className="sheetMetadataEditHotspot"
          style={rectStyle(rect, pageWidth, pageHeight)}
          aria-label={`${region.label}を編集`}
          aria-expanded={editingRegionId === region.regionId}
          title={`${region.label}を編集`}
          onClick={event => {
            event.stopPropagation()
            setEditingRegionId(region.regionId)
          }}
        >
          <PencilIcon />
        </button>
      ))}
      {active && (
        <div
          className="sheetMetadataEditorPopover"
          role="dialog"
          aria-label={`${active.region.label}を編集`}
          style={popoverStyle(active.rect, pageWidth, pageHeight)}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => {
            if (event.key === 'Escape') setEditingRegionId(null)
          }}
        >
          <div className="sheetMetadataEditorHeader">
            <strong>{active.region.label}</strong>
            <button type="button" aria-label={`${active.region.label}の編集を閉じる`} onClick={() => setEditingRegionId(null)}>×</button>
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
