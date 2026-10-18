import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { activeCutProjectFromDocument, baseTimingProcessId, createSheetPages, openClipDocument, selectTimingProcess, setEvent, standardA3SheetTemplate, timingForProcess } from '@xsheet-remap/core'
import { independentClipFixture } from '../../core/src/clip-workflows.fixture'
import { SheetProcessReferenceLayer } from './SheetProcessReferenceLayer'

afterEach(cleanup)
it('keeps sparse base keys visible, marks only working keys and never changes either timing stream', () => {
  const { data, columns } = independentClipFixture()
  const document = openClipDocument(data, 'data:,', { timelineIds: ['t1'], role: 'cell', columns: columns.map(column => ({ ...column, name: 'A' })), baseProcess: 'あ／テスト' })
  const initial = activeCutProjectFromDocument(document), base = baseTimingProcessId(initial)
  const other = initial.correctionLayers.find(process => process.layerId !== base)!.layerId
  const project = selectTimingProcess(initial, other), before = JSON.stringify(project)
  const page = createSheetPages(standardA3SheetTemplate, 24)[0]
  const { container, rerender } = render(<svg><SheetProcessReferenceLayer project={project} template={standardA3SheetTemplate} page={page} /></svg>)
  expect([...container.querySelectorAll('[data-base-frame]')].map(node => node.getAttribute('data-base-frame'))).toEqual(['1', '9'])
  expect(container.querySelector('[data-working-frame="5"]')).not.toBeNull()
  expect(container.querySelector('[data-working-frame="1"]')).toBeNull()
  expect(JSON.stringify(project)).toBe(before)
  const edited = setEvent(project, 'A', 1, timingForProcess(project.logicalSheet, other).events[0].keyId, 'cell')
  rerender(<svg><SheetProcessReferenceLayer project={edited} template={standardA3SheetTemplate} page={page} /></svg>)
  expect(container.querySelector('[data-base-frame="1"]')).toBeNull()
  expect(container.querySelector('[data-working-frame="1"]')?.getAttribute('data-base-value')).toBe('001')
  expect(timingForProcess(edited.logicalSheet, base).events).toEqual(timingForProcess(initial.logicalSheet, base).events)
  rerender(<svg><SheetProcessReferenceLayer project={initial} template={standardA3SheetTemplate} page={page} /></svg>)
  expect(container.querySelector('[data-testid="base-process-reference"]')).toBeNull()
})
