import { standardA3SheetTemplate } from '@xsheet-remap/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TemplateRegionBindingEditor } from './TemplateRegionBindingEditor'
import { templateRegionAuthoringName } from './templateRegionAuthoring'

afterEach(cleanup)

describe('TemplateRegionBindingEditor', () => {
  it('edits metadata, including a custom project field, independently from printed labels', () => {
    const region = standardA3SheetTemplate.regions.find(candidate => candidate.binding?.target === 'cut-metadata')!
    const onChange = vi.fn()
    render(<TemplateRegionBindingEditor region={region} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText(`${templateRegionAuthoringName(region)}の表示する情報`), { target: { value: 'cut:custom' } })

    expect(onChange).toHaveBeenLastCalledWith({ target: 'cut-metadata', field: 'custom', customKey: 'custom' })
  })

  it('exposes annotation storage identity and intent', () => {
    const region = standardA3SheetTemplate.regions.find(candidate => candidate.binding?.target === 'annotation-layer')!
    const onChange = vi.fn()
    render(<TemplateRegionBindingEditor region={region} onChange={onChange} />)
    const name = templateRegionAuthoringName(region)

    fireEvent.change(screen.getByLabelText(`${name}の注釈レイヤーID`), { target: { value: 'director-notes' } })
    fireEvent.change(screen.getByLabelText(`${name}の注釈用途`), { target: { value: 'process-note' } })

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: 'annotation-layer', layerId: 'director-notes' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ target: 'annotation-layer', intent: 'process-note' }))
  })

  it('exposes timeline role and optional section identity', () => {
    const source = standardA3SheetTemplate.regions.find(candidate => candidate.grid?.role === 'action')!
    const region = { ...source, binding: { target: 'timeline-section' as const, role: 'action' as const } }
    const onChange = vi.fn()
    render(<TemplateRegionBindingEditor region={region} onChange={onChange} />)
    const name = templateRegionAuthoringName(region)

    fireEvent.change(screen.getByLabelText(`${name}のタイムライン役割`), { target: { value: 'camera' } })
    fireEvent.change(screen.getByLabelText(`${name}のタイムライン区分ID`), { target: { value: 'camera-main' } })

    expect(onChange).toHaveBeenCalledWith({ target: 'timeline-section', role: 'camera' })
    expect(onChange).toHaveBeenCalledWith({ target: 'timeline-section', role: 'action', sectionId: 'camera-main' })
  })
})
