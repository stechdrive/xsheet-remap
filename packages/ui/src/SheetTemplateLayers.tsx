import type { SheetTemplate } from '@xsheet-remap/core'
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings } from './levelCorrection'
import { LevelCorrectionFilterDefinition } from './LevelCorrectionFilter'
import { levelCorrectionFilterUrl, useLevelCorrectionFilterId } from './levelCorrectionFilterModel'
import type { SheetImageSettings } from './appTypes'
import { useWarpedSheetImageUrl } from './sheetImages'
import type { TemplateChromeRenderModel, TemplateGridOverlayRenderModel } from './templateEditorGeometry'

export function SheetImageLayer({
  imageUrl,
  imageSettings,
  template,
  forceRaw = false,
  preview = false,
}: {
  imageUrl: string
  imageSettings: SheetImageSettings
  template: SheetTemplate
  forceRaw?: boolean
  preview?: boolean
}) {
  const warpedImageUrl = useWarpedSheetImageUrl(forceRaw ? null : imageUrl, imageSettings, template, preview ? 'preview' : 'final')
  const effectiveLevelCorrection = imageSettings.levelCorrection
    ? normalizeLevelCorrectionSettings(imageSettings.levelCorrection)
    : defaultLevelCorrectionSettings()
  const levelCorrectionFilterId = useLevelCorrectionFilterId('sheetImageLevelCorrection')
  const levelCorrectionFilter = levelCorrectionFilterUrl(levelCorrectionFilterId, effectiveLevelCorrection)
  const filterDefinition = levelCorrectionFilter
    ? (
      <defs>
        <LevelCorrectionFilterDefinition id={levelCorrectionFilterId} settings={effectiveLevelCorrection} />
      </defs>
      )
    : null

  if (warpedImageUrl) {
    return (
      <>
        {filterDefinition}
        <image
          className="sheetImage"
          href={warpedImageUrl}
          x="0"
          y="0"
          width="1"
          height="1"
          preserveAspectRatio="none"
          opacity={imageSettings.opacity}
          filter={levelCorrectionFilter}
        />
      </>
    )
  }

  return (
    <>
      {filterDefinition}
      <image
        className={forceRaw ? 'sheetImage sheetImageRaw' : 'sheetImage'}
        href={imageUrl}
        x={imageSettings.x}
        y={imageSettings.y}
        width={imageSettings.scale}
        height={imageSettings.scale}
        preserveAspectRatio="none"
        opacity={imageSettings.opacity}
        filter={levelCorrectionFilter}
      />
    </>
  )
}

export function TemplateChromeLayer({ model }: { model: TemplateChromeRenderModel }) {
  return (
    <g className="templateChrome" aria-hidden="true">
      {model.showOuterFrame && <rect className="templateOuterFrame" x="0.02" y="0.019" width="0.96" height="0.952" />}
      <g>
        {model.referenceRegions.map(region => (
          <g key={region.regionId} className={`templateReferenceRegion ${region.type}`}>
            <rect className="templateReferenceBox" x={region.rect.x} y={region.rect.y} width={region.rect.w} height={region.rect.h} />
          </g>
        ))}
      </g>
      {model.headers.map(header => (
        <g key={header.regionId}>
          <rect className="templateHeaderBox" style={{ fill: 'none' }} x={header.rect.x} y={header.rect.y} width={header.rect.w} height={header.rect.h} />
          {header.label ? <text className="templateHeaderText" x={header.labelX} y={header.labelY} textAnchor="middle" fontSize={header.labelFontSize}>{header.label}</text> : null}
          {header.columns.map(column => (
            <text key={column.columnId} className="templateColumnText" x={column.x} y={column.y} textAnchor="middle" fontSize={column.fontSize}>{column.label}</text>
          ))}
        </g>
      ))}
    </g>
  )
}

export function GridOverlayLayer({ model }: { model: TemplateGridOverlayRenderModel }) {
  return (
    <g className={`gridOverlay gridOverlay-${model.role}`}>
      {model.rowPaths.map(path => (
        <path key={path.className} className={path.className} d={path.d} />
      ))}
      {model.columnPath && <path className={model.columnPath.className} d={model.columnPath.d} />}
      {model.labels.map(label => (
        <text
          key={label.key}
          className="gridRowGuideLabel"
          x={label.x}
          y={label.y}
          textAnchor={label.textAnchor}
          fontSize={label.fontSize}
        >
          {label.text}
        </text>
      ))}
    </g>
  )
}
