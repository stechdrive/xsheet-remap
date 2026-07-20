import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { addTimelineLane, createDefaultProject, createProjectFromTemplate, createSheetPages, digitalStandardSheetTemplate, resolveSheetTemplatePageSize, standardA3SheetTemplate, timelineLanesForLayout, updateProjectPaperTracks, updateSheetFormField } from '@xsheet-remap/core'
import { SheetMetadataEditor } from './SheetMetadataEditor'

afterEach(cleanup)

describe('SheetMetadataEditor page fields', () => {
  it('keeps expanded digital metadata and MEMO hotspots on their form cell bounds', () => {
    let project = updateProjectPaperTracks(
      createProjectFromTemplate(digitalStandardSheetTemplate),
      Array.from({ length: 12 }, (_, index) => String.fromCharCode(65 + index)),
    )
    for (let index = 4; index < 6; index += 1) project = addTimelineLane(project, { role: 'sound', label: `S${index + 1}` }).project
    for (let index = 4; index < 7; index += 1) project = addTimelineLane(project, { role: 'camera', label: String(index + 1) }).project
    const paperTracks = project.logicalSheet.paperTracks.map(track => track.paperTrack)
    const timelineLanes = timelineLanesForLayout(project)
    const pageSize = resolveSheetTemplatePageSize(digitalStandardSheetTemplate, 144, { paperTracks, timelineLanes })
    const [page] = createSheetPages(digitalStandardSheetTemplate, 144)
    const onMetadataChange = vi.fn()
    const onAnnotationRegionSelect = vi.fn()

    render(
      <SheetMetadataEditor
        project={project}
        template={digitalStandardSheetTemplate}
        page={page!}
        pageWidth={pageSize.widthPx}
        pageHeight={pageSize.heightPx}
        displayDurationFrames={144}
        paperTracks={paperTracks}
        onMetadataChange={onMetadataChange}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
        onAnnotationRegionSelect={onAnnotationRegionSelect}
      />,
    )

    const title = screen.getByRole('button', { name: 'タイトルを編集' })
    const episode = screen.getByRole('button', { name: '話数を編集' })
    const memo = screen.getByRole('button', { name: 'MEMOをメモ対象に選択' })
    expect(Number.parseFloat(title.style.width)).toBeGreaterThan(600)
    expect(Number.parseFloat(episode.style.width)).toBeCloseTo(160)
    expect(Number.parseFloat(memo.style.width)).toBeCloseTo(pageSize.widthPx - 64)

    fireEvent.click(memo)
    expect(onAnnotationRegionSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      regionId: 'digital_memo_area', targetId: 'cell:digital_memo_box', label: 'MEMO',
    }))
    fireEvent.doubleClick(title)
    fireEvent.change(screen.getByRole('textbox', { name: 'タイトル' }), { target: { value: '可変幅タイトル' } })
    expect(onMetadataChange).toHaveBeenLastCalledWith('title', '可変幅タイトル', undefined)
  })

  it('selects and highlights only one form cell when the template declares cell targets', () => {
    const project = createDefaultProject()
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)
    const onAnnotationRegionSelect = vi.fn()
    const commonProps = {
      project,
      template: standardA3SheetTemplate,
      page: page!,
      pageWidth: 877,
      pageHeight: 1241,
      displayDurationFrames: project.logicalSheet.durationFrames,
      paperTracks: standardA3SheetTemplate.defaults.paperTracks,
      onMetadataChange: vi.fn(),
      onDurationChange: vi.fn(),
      onFormFieldChange: vi.fn(),
      onAnnotationRegionSelect,
    }
    const { container, rerender } = render(<SheetMetadataEditor {...commonProps} />)
    const field = container.querySelector<HTMLButtonElement>('[data-annotation-target-id="cell:process_field_original"]')!

    fireEvent.click(field)
    expect(onAnnotationRegionSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      regionId: 'top_process_check_area',
      targetId: 'cell:process_field_original',
      label: '原図',
    }))

    rerender(<SheetMetadataEditor {...commonProps} selectedAnnotationTarget={{
      regionId: 'top_process_check_area',
      targetId: 'cell:process_field_original',
    }} />)
    expect(container.querySelectorAll('[data-annotation-target-selected="true"]')).toHaveLength(1)
    expect(container.querySelector('[data-annotation-target-selected="true"]')?.getAttribute('data-annotation-target-id'))
      .toBe('cell:process_field_original')
  })

  it('groups only cells that share a template memo target id', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const process = template.regions.find(region => region.regionId === 'top_process_check_area')!
    const groupedIds = ['process_field_direction_rough', 'process_field_supervision_rough']
    process.form!.cells!.forEach(cell => {
      if (groupedIds.includes(cell.cellId)) cell.memoTarget = { scope: 'group', targetId: 'rough-review', label: '前半確認' }
    })
    const project = createDefaultProject()
    const [page] = createSheetPages(template, project.logicalSheet.durationFrames)
    const commonProps = {
      project,
      template,
      page: page!,
      pageWidth: 877,
      pageHeight: 1241,
      displayDurationFrames: project.logicalSheet.durationFrames,
      paperTracks: template.defaults.paperTracks,
      onMetadataChange: vi.fn(),
      onDurationChange: vi.fn(),
      onFormFieldChange: vi.fn(),
      onAnnotationRegionSelect: vi.fn(),
    }
    const { container, rerender } = render(<SheetMetadataEditor {...commonProps} />)
    expect(container.querySelectorAll('[data-annotation-target-id="group:rough-review"]')).toHaveLength(2)

    rerender(<SheetMetadataEditor {...commonProps} selectedAnnotationTarget={{
      regionId: 'top_process_check_area',
      targetId: 'group:rough-review',
    }} />)
    expect(container.querySelectorAll('[data-annotation-target-selected="true"]')).toHaveLength(2)
  })

  it('keeps a target-disabled form cell editable without selecting an annotation target', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const process = template.regions.find(region => region.regionId === 'top_process_check_area')!
    process.form!.cells!.find(cell => cell.cellId === 'process_field_original')!.memoTarget = { scope: 'none' }
    const project = createDefaultProject()
    const [page] = createSheetPages(template, project.logicalSheet.durationFrames)
    const onAnnotationRegionSelect = vi.fn()
    const { container } = render(
      <SheetMetadataEditor
        project={project}
        template={template}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={template.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
        onAnnotationRegionSelect={onAnnotationRegionSelect}
      />,
    )
    const field = container.querySelector<HTMLButtonElement>('[data-region-id="top_process_check_area"]')!
    expect(field.dataset.annotationTargetId).toBeUndefined()
    fireEvent.click(field)
    expect(onAnnotationRegionSelect).not.toHaveBeenCalled()
    fireEvent.doubleClick(field)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('selects TITLE and MEMO as stable template-region annotation targets on one click', () => {
    const project = createDefaultProject()
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)
    const onAnnotationRegionSelect = vi.fn()

    render(
      <SheetMetadataEditor
        project={project}
        template={standardA3SheetTemplate}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={standardA3SheetTemplate.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
        onAnnotationRegionSelect={onAnnotationRegionSelect}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'タイトルを編集' }))
    expect(onAnnotationRegionSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'template-region', regionId: 'top_title_field', label: 'タイトル', pageId: 'page_1',
    }))
    fireEvent.click(screen.getByRole('button', { name: 'MEMOを編集' }))
    expect(onAnnotationRegionSelect).toHaveBeenLastCalledWith(expect.objectContaining({
      kind: 'template-region', regionId: 'top_memo_area', label: 'MEMO', pageId: 'page_1',
    }))
  })

  it('opens the A3 memo as an inline multiline editor and writes to the active page', () => {
    const project = createDefaultProject()
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)
    const onFormFieldChange = vi.fn()

    render(
      <SheetMetadataEditor
        project={project}
        template={standardA3SheetTemplate}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={standardA3SheetTemplate.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={onFormFieldChange}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'MEMOを編集' }))
    const editor = screen.getByRole('textbox', { name: 'MEMO' })
    expect(editor.classList.contains('sheetInlineMultilineTextarea')).toBe(true)
    expect(Number.parseFloat(editor.style.fontSize)).toBeCloseTo(8, 1)
    expect(Number.parseFloat(editor.style.lineHeight)).toBeCloseTo(10, 1)
    expect(Number.parseFloat(editor.style.padding)).toBeCloseTo(4, 1)

    fireEvent.change(editor, { target: { value: 'ページ固有のメモ' } })
    expect(onFormFieldChange).not.toHaveBeenCalled()

    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    expect(onFormFieldChange).toHaveBeenCalledWith(
      expect.objectContaining({ fieldId: 'memo.body', scope: 'page', valueType: 'multiline' }),
      'ページ固有のメモ',
      'page_1',
    )

    expect(screen.queryByRole('dialog', { name: 'MEMOを編集' })).toBeNull()
  })

  it('marks text that cannot fit at the template minimum size', () => {
    const definition = { fieldId: 'memo.body', scope: 'page' as const, valueType: 'multiline' as const }
    const project = updateSheetFormField(createDefaultProject(), definition, 'メ'.repeat(4000), 'page_1')
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)

    render(
      <SheetMetadataEditor
        project={project}
        template={standardA3SheetTemplate}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={standardA3SheetTemplate.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'MEMOを編集' }).dataset.textOverflow).toBe('true')
  })

  it('uses a popover when the template cell selects that presentation', () => {
    const template = structuredClone(standardA3SheetTemplate)
    const memo = template.regions.find(region => region.regionId === 'top_memo_area')!
    memo.form!.cells!.find(cell => cell.cellId === 'memo_body')!.editPresentation = 'popover'
    const project = createDefaultProject()
    const [page] = createSheetPages(template, project.logicalSheet.durationFrames)

    render(
      <SheetMetadataEditor
        project={project}
        template={template}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={template.defaults.paperTracks}
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
      />,
    )

    fireEvent.doubleClick(screen.getByRole('button', { name: 'MEMOを編集' }))
    const editor = screen.getByRole('textbox', { name: 'MEMO' })
    expect(editor.classList.contains('sheetInlineMultilineTextarea')).toBe(false)
    expect(screen.getByRole('dialog', { name: 'MEMOを編集' }).classList.contains('sheetMetadataEditorPopover')).toBe(true)
  })

  it('withdraws all metadata hotspots while another sheet interaction owns the pointer', () => {
    const project = createDefaultProject()
    const [page] = createSheetPages(standardA3SheetTemplate, project.logicalSheet.durationFrames)

    render(
      <SheetMetadataEditor
        project={project}
        template={standardA3SheetTemplate}
        page={page!}
        pageWidth={877}
        pageHeight={1241}
        displayDurationFrames={project.logicalSheet.durationFrames}
        paperTracks={standardA3SheetTemplate.defaults.paperTracks}
        interactionBlocked
        onMetadataChange={vi.fn()}
        onDurationChange={vi.fn()}
        onFormFieldChange={vi.fn()}
      />,
    )

    expect(document.querySelector('.sheetMetadataEditorLayer')?.classList.contains('interactionBlocked')).toBe(true)
    expect((screen.getByRole('button', { name: 'MEMOを編集' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
