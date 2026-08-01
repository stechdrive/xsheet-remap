import { withSheetTemplatePaperTracks, type CutProject, type SheetTemplate } from '@xsheet-remap/core'

export function templatePreviewForProject(
  template: SheetTemplate,
  project: CutProject,
  useCurrentProjectValues: boolean,
): SheetTemplate {
  if (!useCurrentProjectValues) return template
  const paperTracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)
  return withSheetTemplatePaperTracks({
    ...template,
    defaults: {
      ...template.defaults,
      fps: project.logicalSheet.fps,
      frameOrigin: project.logicalSheet.frameOrigin,
      durationFrames: project.logicalSheet.durationFrames,
      paperTracks,
    },
  }, paperTracks)
}
