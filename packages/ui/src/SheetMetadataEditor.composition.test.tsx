import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultProject, createSheetPages, standardA3SheetTemplate } from '@xsheet-remap/core'
import { SheetMetadataEditor } from './SheetMetadataEditor'
import { useState } from 'react'
import { updateCutMetadata } from './cutMetadata'

afterEach(cleanup)
describe('sheet field composition boundaries (simulated events)', () => {
  it.each(['MEMO', 'タイトル'])('keeps %s open when Escape/Enter belong to the IME, then commits on outside input', label => {
    const project = createDefaultProject(), template = standardA3SheetTemplate
    const onFormFieldChange = vi.fn(), onMetadataChange = vi.fn()
    function Harness() {
      const [current, setCurrent] = useState(project)
      return <SheetMetadataEditor project={current} template={template} page={createSheetPages(template, 144)[0]!}
        pageWidth={877} pageHeight={1241} displayDurationFrames={144} paperTracks={template.defaults.paperTracks}
        onMetadataChange={(field, value, key) => { onMetadataChange(field, value, key); setCurrent(p => updateCutMetadata(p, field, value, key)) }}
        onDurationChange={vi.fn()} onFormFieldChange={onFormFieldChange} />
    }
    render(<Harness />)
    fireEvent.doubleClick(screen.getByRole('button', { name: `${label}を編集` }))
    const editor = screen.getByRole<HTMLInputElement>('textbox', { name: label })
    fireEvent.compositionStart(editor)
    fireEvent.change(editor, { target: { value: '日本語の下書き' } })
    for (const key of ['Escape', 'Enter']) {
      fireEvent.keyDown(editor, { key, isComposing: true, ctrlKey: true })
      expect(screen.queryByRole('textbox', { name: label })).toBe(editor)
      fireEvent.keyDown(editor, { key, keyCode: 229 })
      expect(screen.queryByRole('textbox', { name: label })).toBe(editor)
    }
    fireEvent.compositionEnd(editor, { data: '日本語の下書き' })
    fireEvent.pointerDown(editor)
    expect(editor.value).toBe('日本語の下書き')
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('textbox', { name: label })).toBeNull()
    if (label === 'MEMO') expect(onFormFieldChange).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fieldId: 'memo.body' }), '日本語の下書き', 'page_1')
    else expect(onMetadataChange).toHaveBeenLastCalledWith('title', '日本語の下書き', undefined)
  })
})
