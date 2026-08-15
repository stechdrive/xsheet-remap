import { describe, expect, it } from 'vitest'
import {
  createDefaultProject,
  createSheetPages,
  digitalStandardSheetTemplate,
  projectSheetLayoutOptions,
} from '@xsheet-remap/core'
import {
  stackGuideInsertTargetFromPoint,
  stackGuidePlacementTargetFromPointer,
} from './stack-guides-interaction'

describe('stack guide interaction geometry', () => {
  it('uses the same expanded digital layout for insertion and drag placement', () => {
    const project = createDefaultProject()
    const options = projectSheetLayoutOptions(project, digitalStandardSheetTemplate)
    const page = createSheetPages(
      digitalStandardSheetTemplate,
      options.durationFrames ?? digitalStandardSheetTemplate.defaults.durationFrames,
      options.frameOrigin ?? digitalStandardSheetTemplate.defaults.frameOrigin,
    )[0]!
    const svg = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }),
    } as unknown as SVGSVGElement

    for (const x of [0.27, 0.29, 0.3]) {
      const insert = stackGuideInsertTargetFromPoint(
        digitalStandardSheetTemplate,
        project,
        page,
        { x, y: 0.2 },
        'page',
      )
      const placement = stackGuidePlacementTargetFromPointer(
        svg,
        x * 1000,
        200,
        project,
        digitalStandardSheetTemplate,
        page,
      )

      expect(placement).toMatchObject({
        regionId: insert?.regionId,
        displayRole: insert?.displayRole,
        gapIndex: insert?.gapIndex,
        snapIndex: insert?.snapIndex,
      })
    }
  })
})
