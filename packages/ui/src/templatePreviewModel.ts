import type { SheetTemplate } from '@xsheet-remap/core'
import { buildTemplateEditorRegionRenderModel, type TemplateEditorRenderModel } from './templateEditorGeometry'

/** Rebuild only affected regions; fixed paper headers and unrelated forms keep their model. */
export function buildTemplateRegionsPreview(template: SheetTemplate, regionIds: ReadonlySet<string>,
  base: TemplateEditorRenderModel): TemplateEditorRenderModel {
  const models = [...regionIds].flatMap(id => {
    const model = buildTemplateEditorRegionRenderModel(template, id)
    return model ? [model] : []
  })
  return {
    calibrationTargetRect: null,
    chrome: {
      ...base.chrome, showOuterFrame: false,
      referenceRegions: models.flatMap(model => model.chrome.referenceRegions),
      headers: models.flatMap(model => model.chrome.headers),
      formBoxes: models.flatMap(model => model.chrome.formBoxes),
      formLabels: models.flatMap(model => model.chrome.formLabels),
      formFields: models.flatMap(model => model.chrome.formFields),
      formAnnotationTargets: models.flatMap(model => model.chrome.formAnnotationTargets),
    },
    gridOverlays: models.flatMap(model => model.gridOverlay ? [model.gridOverlay] : []),
  }
}
