import type { SheetTemplate, SheetTemplateUnderlayPlacement } from '@xsheet-remap/core'
import { defaultLevelCorrectionSettings, normalizeLevelCorrectionSettings } from './levelCorrection'
import { LevelCorrectionFilterDefinition } from './LevelCorrectionFilter'
import { levelCorrectionFilterUrl, useLevelCorrectionFilterId } from './levelCorrectionFilterModel'
import type { SheetImageSettings } from './appTypes'
import { useWarpedSheetImageUrl } from './sheetImages'
import type { TemplateChromeRenderModel, TemplateGridOverlayRenderModel } from './templateEditorGeometry'
import { SheetSvgText } from './SheetSvgText'

export function SheetImageLayer({
  imageUrl,
  imageSettings,
  template,
  forceRaw = false,
  preview = false,
  placement,
}: {
  imageUrl: string
  imageSettings: SheetImageSettings
  template: SheetTemplate
  forceRaw?: boolean
  preview?: boolean
  placement?: SheetTemplateUnderlayPlacement
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
        x={placement ? placement.offsetXPx / template.page.widthPx : imageSettings.x}
        y={placement ? placement.offsetYPx / template.page.heightPx : imageSettings.y}
        width={placement ? placement.renderedWidthPx / template.page.widthPx : imageSettings.scale}
        height={placement ? placement.renderedHeightPx / template.page.heightPx : imageSettings.scale}
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
          {header.label ? <SheetSvgText className="templateHeaderText" x={header.labelX} y={header.labelY} textAnchor="middle" fontSizePx={header.labelFontSizePx} pageSize={model.pageSize}>{header.label}</SheetSvgText> : null}
          {header.columns.map(column => (
            <SheetSvgText key={column.columnId} className="templateColumnText" x={column.x} y={column.y} textAnchor="middle" fontSizePx={column.fontSizePx} pageSize={model.pageSize}>{column.label}</SheetSvgText>
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
        <SheetSvgText
          key={label.key}
          className="gridRowGuideLabel"
          x={label.x}
          y={label.y}
          textAnchor={label.textAnchor}
          fontSizePx={label.fontSizePx}
          pageSize={model.pageSize}
        >
          {label.text}
        </SheetSvgText>
      ))}
      {model.frameNumbers.map(item => (
        <SheetSvgText
          key={item.key}
          className="gridActionFrameNumber"
          x={item.x}
          y={item.y}
          textAnchor={item.textAnchor}
          dominantBaseline="text-after-edge"
          fontSizePx={item.fontSizePx}
          pageSize={model.pageSize}
        >
          {item.text}
        </SheetSvgText>
      ))}
      {model.secondCounters.map(item => (
        <SheetSvgText
          key={item.key}
          className="gridSecondCounter"
          x={item.x}
          y={item.y}
          textAnchor={item.textAnchor}
          dominantBaseline="text-after-edge"
          fontSizePx={item.fontSizePx}
          pageSize={model.pageSize}
        >
          {item.text}
        </SheetSvgText>
      ))}
      {model.bottomTrackLabels.map(item => (
        <SheetSvgText
          key={item.key}
          className="gridBottomTrackLabel"
          x={item.x}
          y={item.y}
          textAnchor="middle"
          dominantBaseline="text-after-edge"
          fontSizePx={item.fontSizePx}
          pageSize={model.pageSize}
          opacity={item.opacity}
        >
          {item.text}
        </SheetSvgText>
      ))}
    </g>
  )
}
