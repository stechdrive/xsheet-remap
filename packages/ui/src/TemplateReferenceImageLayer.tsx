import type { SheetTemplate, SheetTemplateUnderlayPlacement } from '@xsheet-remap/core'
import { useId, useMemo } from 'react'
import type { SheetImageSettings } from './appTypes'
import { SheetImageLayer } from './SheetTemplateLayers'

export const TEMPLATE_REFERENCE_TINT_COLOR = '#ff1f12'
// Shadow, midtone, and highlight output values after the source is reduced to luminance.
// This keeps paper nearly white while mapping dark printed lines to the target red instead of black.
export const TEMPLATE_REFERENCE_TINT_CURVES = {
  red: '1 1 1',
  green: '0.122 0.54 0.96',
  blue: '0.071 0.45 0.95',
} as const

export function TemplateReferenceImageLayer({
  imageUrl,
  imageSettings,
  template,
  placement,
  opacity,
}: {
  imageUrl: string
  imageSettings: SheetImageSettings
  template: SheetTemplate
  placement?: SheetTemplateUnderlayPlacement
  opacity: number
}) {
  const filterId = `templateReferenceTint-${useId().replace(/:/g, '')}`
  const opaqueImageSettings = useMemo(() => ({ ...imageSettings, opacity: 1 }), [imageSettings])

  return (
    <>
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            in="SourceGraphic"
            result="luminance"
            type="matrix"
            values="
              0.2126 0.7152 0.0722 0 0
              0.2126 0.7152 0.0722 0 0
              0.2126 0.7152 0.0722 0 0
              0 0 0 1 0
            "
          />
          <feComponentTransfer in="luminance">
            <feFuncR type="table" tableValues={TEMPLATE_REFERENCE_TINT_CURVES.red} />
            <feFuncG type="table" tableValues={TEMPLATE_REFERENCE_TINT_CURVES.green} />
            <feFuncB type="table" tableValues={TEMPLATE_REFERENCE_TINT_CURVES.blue} />
            <feFuncA type="identity" />
          </feComponentTransfer>
        </filter>
      </defs>
      <g
        className="templateReferenceImageLayer"
        data-tint-color={TEMPLATE_REFERENCE_TINT_COLOR}
        opacity={opacity}
        filter={`url(#${filterId})`}
      >
        <SheetImageLayer
          imageUrl={imageUrl}
          imageSettings={opaqueImageSettings}
          template={template}
          placement={placement}
          forceRaw
          preview
        />
      </g>
    </>
  )
}
