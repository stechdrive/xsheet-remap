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

export function TemplateChromeLayer({
  model,
  showLines = true,
  showLabels = true,
}: {
  model: TemplateChromeRenderModel
  showLines?: boolean
  showLabels?: boolean
}) {
  return (
    <g className="templateChrome" aria-hidden="true">
      {showLines && model.showOuterFrame && <rect className="templateOuterFrame" style={{ stroke: model.theme.ink.lines.outer }} x="0.02" y="0.019" width="0.96" height="0.952" />}
      {showLines && <g>
        {model.referenceRegions.map(region => (
          <g key={region.regionId} className={`templateReferenceRegion ${region.type}`}>
            <rect className="templateReferenceBox" style={{ stroke: model.theme.ink.reference }} x={region.rect.x} y={region.rect.y} width={region.rect.w} height={region.rect.h} />
          </g>
        ))}
      </g>}
      {showLines && model.formBoxes.map(box => (
        <rect
          key={box.key}
          className="templateFormBox"
          x={box.rect.x}
          y={box.rect.y}
          width={box.rect.w}
          height={box.rect.h}
          style={svgLineStyle(box.style)}
        />
      ))}
      {showLabels && model.formLabels.map(label => (
        <SheetSvgText
          key={label.key}
          className="templateFormLabel"
          x={label.x}
          y={label.y}
          textAnchor={label.textAnchor}
          dominantBaseline={label.dominantBaseline}
          fontSizePx={label.fontSizePx}
          fontWeight={label.fontWeight}
          pageSize={model.pageSize}
          style={{ fill: model.theme.ink.text }}
        >
          {label.text}
        </SheetSvgText>
      ))}
      {model.headers.map(header => (
        <g key={header.regionId}>
          {showLines && <rect className="templateHeaderBox" style={{ fill: 'none', stroke: model.theme.ink.lines.outer }} x={header.rect.x} y={header.rect.y} width={header.rect.w} height={header.rect.h} />}
          {showLines && header.columnHeaderRect.h > 0 && (
            <>
              <rect className="templateHeaderBox" style={{ stroke: model.theme.ink.lines.outer }} x={header.columnHeaderRect.x} y={header.columnHeaderRect.y} width={header.columnHeaderRect.w} height={header.columnHeaderRect.h} />
              <path className="templateThinLine" style={{ stroke: model.theme.ink.lines.thin }} d={header.columnBoundaries.map(x => `M ${x} ${header.columnHeaderRect.y} V ${header.columnHeaderRect.y + header.columnHeaderRect.h}`).join(' ')} />
            </>
          )}
          {showLabels && header.label ? <SheetSvgText className="templateHeaderText" style={{ fill: model.theme.ink.text }} x={header.labelX} y={header.labelY} textAnchor="middle" fontSizePx={header.labelFontSizePx} pageSize={model.pageSize}>{header.label}</SheetSvgText> : null}
          {showLabels && header.columns.map(column => (
            <SheetSvgText key={column.columnId} className="templateColumnText" style={{ fill: model.theme.ink.text }} x={column.x} y={column.y} textAnchor="middle" dominantBaseline={column.dominantBaseline} fontSizePx={column.fontSizePx} pageSize={model.pageSize}>{column.label}</SheetSvgText>
          ))}
        </g>
      ))}
    </g>
  )
}

export function GridOverlayLayer({
  model,
  showLines = true,
  showLabels = true,
}: {
  model: TemplateGridOverlayRenderModel
  showLines?: boolean
  showLabels?: boolean
}) {
  return (
    <g className={`gridOverlay gridOverlay-${model.role}`}>
      {showLines && model.backgroundBands.map(band => (
        <rect
          key={band.key}
          className="gridSecondBand"
          x={band.rect.x}
          y={band.rect.y}
          width={band.rect.w}
          height={band.rect.h}
          fill={band.color}
          opacity={band.opacity}
        />
      ))}
      {showLines && model.rowPaths.map(path => (
        <path key={`${path.className}:${path.d}`} className={path.className} d={path.d} style={path.style ? svgLineStyle(path.style) : undefined} />
      ))}
      {showLines && model.columnPath && <path className={model.columnPath.className} d={model.columnPath.d} style={model.columnPath.style ? svgLineStyle(model.columnPath.style) : undefined} />}
      {showLabels && model.labels.map(label => (
        <SheetSvgText
          key={label.key}
          className="gridRowGuideLabel"
          x={label.x}
          y={label.y}
          textAnchor={label.textAnchor}
          fontSizePx={label.fontSizePx}
          pageSize={model.pageSize}
          style={{ fill: model.theme.ink.text }}
        >
          {label.text}
        </SheetSvgText>
      ))}
      {showLabels && model.frameNumbers.map(item => (
        <SheetSvgText
          key={item.key}
          className="gridActionFrameNumber"
          x={item.x}
          y={item.y}
          textAnchor={item.textAnchor}
          dominantBaseline="text-after-edge"
          fontSizePx={item.fontSizePx}
          pageSize={model.pageSize}
          style={{ fill: model.theme.ink.text }}
        >
          {item.text}
        </SheetSvgText>
      ))}
      {showLabels && model.secondCounters.map(item => (
        <SheetSvgText
          key={item.key}
          className="gridSecondCounter"
          x={item.x}
          y={item.y}
          textAnchor={item.textAnchor}
          dominantBaseline="text-after-edge"
          fontSizePx={item.fontSizePx}
          pageSize={model.pageSize}
          style={{ fill: model.theme.ink.text }}
        >
          {item.text}
        </SheetSvgText>
      ))}
      {showLabels && model.bottomTrackLabels.map(item => (
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
          style={{ fill: model.theme.ink.text }}
        >
          {item.text}
        </SheetSvgText>
      ))}
    </g>
  )
}

function svgLineStyle(style: { color: string; widthPx: number; dashPx: number[] }) {
  return {
    fill: 'none',
    stroke: style.color,
    strokeWidth: `${style.widthPx}px`,
    strokeDasharray: style.dashPx.length > 0 ? style.dashPx.map(value => `${value}px`).join(' ') : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  }
}
