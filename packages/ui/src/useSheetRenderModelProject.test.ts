import { renderHook } from '@testing-library/react'
import { addAnnotation, createDefaultProject, createOrSetEvent } from '@xsheet-remap/core'
import { describe, expect, it } from 'vitest'
import { useSheetRenderModelProject } from './useSheetRenderModelProject'

describe('useSheetRenderModelProject', () => {
  it('ignores annotation-only commits but refreshes sheet geometry changes', () => {
    const project = createDefaultProject()
    const { result, rerender } = renderHook(
      ({ currentProject }) => useSheetRenderModelProject(currentProject),
      { initialProps: { currentProject: project } },
    )
    const initialRenderProject = result.current
    const withInk = addAnnotation(project, {
      annotationId: 'annotation_1',
      pageId: 'page_1',
      tool: 'pen',
      color: '#123456',
      width: 0.002,
      points: [
        { x: 0.1, y: 0.1, pressure: 0.5 },
        { x: 0.2, y: 0.2, pressure: 0.5 },
      ],
    })

    rerender({ currentProject: withInk })
    expect(result.current).toBe(initialRenderProject)

    const withTiming = createOrSetEvent(withInk, 'A', 12).project
    rerender({ currentProject: withTiming })
    expect(result.current).toBe(withTiming)
  })
})
