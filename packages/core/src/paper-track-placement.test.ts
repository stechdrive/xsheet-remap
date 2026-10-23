import { describe, expect, it } from 'vitest'
import { independentClipFixture } from './clip-workflows.fixture'
import { openClipDocument, activeCutProjectFromDocument, buildClipRegistrationPlan, parseProjectDocument } from './index'
import { paperTrackDisplayRole } from './paper-track-placement'

describe('imported paper column placement', () => {
  it.each(['action', 'cell'] as const)('retains %s for every column and shared cut without changing native layer identity', role => {
    const { data, columns } = independentClipFixture()
    const document = openClipDocument(data, 'data:,', { role, columns, timelineIds: ['t1', 't2'] })
    const restored = parseProjectDocument(JSON.parse(JSON.stringify(document)))
    for (const cut of restored.cuts) for (const revision of cut.revisions) {
      expect(revision.logicalSheet.paperTracks.every(track => track.viewPlacement?.sheetRole === role)).toBe(true)
      expect(revision.logicalSheet.paperTracks.every(track => track.viewPlacement?.snapIndex === undefined)).toBe(true)
    }
    expect(restored.clipDocument?.nodes).toEqual(data.layers)
    expect(buildClipRegistrationPlan(restored, role)).toEqual(buildClipRegistrationPlan(document, role))
  })

  it('recovers legacy imported placement from all processes and cuts, preserving manual positions and ambiguous roles', () => {
    const { document } = independentClipFixture()
    for (const cut of document.cuts) for (const revision of cut.revisions) {
      for (const track of revision.logicalSheet.paperTracks) delete track.viewPlacement
      revision.logicalSheet.events.forEach(event => { event.sheetRole = 'action' })
      for (const timing of Object.values(revision.logicalSheet.processTimings?.inactive ?? {})) timing.events.forEach(event => { event.sheetRole = 'action' })
    }
    const recovered = parseProjectDocument(document)
    expect(activeCutProjectFromDocument(recovered).logicalSheet.paperTracks.map(paperTrackDisplayRole)).toEqual(['action', 'action'])
    expect(parseProjectDocument(recovered)).toEqual(recovered)
    const manual = document.cuts[0].revisions[0].logicalSheet.paperTracks[0]
    manual.viewPlacement = { snapIndex: 3, templateId: document.sheetTemplate.templateId }
    expect(parseProjectDocument(document).cuts[0].revisions[0].logicalSheet.paperTracks[0].viewPlacement).toEqual(manual.viewPlacement)
    expect(paperTrackDisplayRole(manual)).toBe('cell')
    const revision = document.cuts[1].revisions[0]
    const event = revision.logicalSheet.events[0]
    revision.logicalSheet.events.push({ ...event, eventId: 'mixed-role', frame: 20, sheetRole: 'cell' })
    const mixed = parseProjectDocument(document).cuts[1].revisions[0].logicalSheet.paperTracks.find(track => track.paperTrack === event.paperTrack)!
    expect(mixed.viewPlacement).toBeUndefined()
  })
})
