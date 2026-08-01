import { createDefaultProject, digitalStandardSheetTemplate } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { templatePreviewForProject } from './templateProjectPreview'

describe('template project preview', () => {
  it('uses current logical sheet values without changing template defaults', () => {
    const project = createDefaultProject()
    project.logicalSheet.fps = 30
    project.logicalSheet.frameOrigin = 10
    project.logicalSheet.durationFrames = 24
    project.logicalSheet.paperTracks = project.logicalSheet.paperTracks.slice(0, 2)

    const preview = templatePreviewForProject(digitalStandardSheetTemplate, project, true)

    expect(preview.defaults).toMatchObject({ fps: 30, frameOrigin: 10, durationFrames: 24 })
    expect(preview.defaults.paperTracks).toEqual(project.logicalSheet.paperTracks.map(track => track.paperTrack))
    expect(digitalStandardSheetTemplate.defaults.durationFrames).not.toBe(24)
  })

  it('keeps the authored defaults in standalone mode', () => {
    expect(templatePreviewForProject(digitalStandardSheetTemplate, createDefaultProject(), false)).toBe(digitalStandardSheetTemplate)
  })
})
