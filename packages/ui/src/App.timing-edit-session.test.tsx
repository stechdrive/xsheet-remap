import { describe, expect, it } from 'vitest'
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { activeCutProjectFromDocument, buildClipRegistrationPlan, parseProjectDocument, timingHitForFrame } from '@xsheet-remap/core'
import { App } from './App'
import { useAppController } from './app-shell-controller'
import { uiText } from './i18n'
import {
  clickTemplateFrame,
  openAppNavigationMenu,
  openCutMetadataMenu,
  openSharedCutMenu,
  openTimingExportDialog,
  setSheetRect,
  switchSharedCutByLabel,
} from './App.test-support'

describe('App: timing edit operation boundaries', () => {
  it.each(['action', 'cell'] as const)('selects a different %s cell locally and preserves literal names through save, CLIP planning and undo', role => {
    const { result } = renderHook(() => useAppController({ appKind: 'remap' }))
    const select = (frame: number) => act(() => result.current.handleCellClick(timingHitForFrame(result.current.template, role, 'A', frame)!))
    const type = (value: string) => { for (const character of value) fireEvent.keyDown(window, { key: character }) }
    const enter = () => fireEvent.keyDown(window, { key: 'Enter' })
    const labels = () => result.current.project.logicalSheet.events.map(event => result.current.project.logicalSheet.keys.find(key => key.keyId === event.keyId)?.displayLabel)
    expect(result.current.workMode).toBe('sheet')
    for (const [frame, value] of [[1, '001'], [5, '002'], [9, '001'], [13, '003'], [17, '001']] as const) {
      select(frame); type(value); enter()
    }
    const before = result.current.projectDocumentSnapshot
    const historyDepth = result.current.history.past.length
    select(9); type('004')
    expect(labels()).toEqual(['001', '002', '001', '003', '001'])
    enter()
    expect(labels()).toEqual(['001', '002', '004', '003', '001'])
    expect(result.current.history.past).toHaveLength(historyDepth + 1)
    expect(result.current.project.assets).toHaveLength(0)
    expect(result.current.project.clipDocument!.nodes.filter(node => node.kind === 'raster').map(node => node.name).sort()).toEqual(['001', '002', '003', '004'])
    const saved = parseProjectDocument(JSON.parse(JSON.stringify(result.current.projectDocumentSnapshot)))
    const savedProject = activeCutProjectFromDocument(saved)
    const slot = savedProject.cspTrackSlots.find(item => item.paperTrack === 'A' && item.correctionLayerId === result.current.activeCorrectionLayerId)!
    const folderId = saved.clipDocument!.targets.find(target => target.slotId === slot.slotId)!.folderId
    const plan = buildClipRegistrationPlan(saved, role)
    expect(plan.timelines[0].tracks.find(track => track.folderId === folderId)?.frames).toEqual([
      { frame: 0, value: '001' }, { frame: 4, value: '002' }, { frame: 8, value: '004' },
      { frame: 12, value: '003' }, { frame: 16, value: '001' },
    ])
    act(() => result.current.handleUndo())
    expect(result.current.projectDocumentSnapshot).toEqual(before)
    act(() => result.current.handleRedo())
    expect(result.current.projectDocumentSnapshot).toEqual(saved)
    select(9); type('009'); fireEvent.keyDown(window, { key: 'Escape' })
    expect(result.current.projectDocumentSnapshot).toEqual(saved)
    expect(result.current.history.past).toHaveLength(historyDepth + 1)
  })

  it('commits an out-of-range timing draft before shortening the cut duration', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 80)
    fireEvent.keyDown(window, { key: '9' })
    expect(document.querySelector('.timingDraftText')?.textContent).toBe('9')

    openCutMetadataMenu()
    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '3' } })
    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')).toBeNull()

    fireEvent.change(screen.getByLabelText(uiText.sheet.durationSeconds), { target: { value: '6' } })
    expect(Array.from(document.querySelectorAll('.eventText')).map(element => element.textContent)).toContain('9')
  })

  it('commits a timing draft when pointer focus leaves the sheet editor', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '7' })
    fireEvent.pointerDown(screen.getByLabelText(uiText.sheet.displaySettingsMenu))

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('7')
  })

  it('cancels the active timing draft before traversing project undo history', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '4' })
    const undo = screen.getByRole('button', { name: uiText.actions.undo }) as HTMLButtonElement
    expect(undo.disabled).toBe(false)

    fireEvent.pointerDown(undo)
    fireEvent.focusIn(undo)
    fireEvent.click(undo)

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')).toBeNull()
    expect((screen.getByRole('button', { name: uiText.actions.redo }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('commits the active timing draft before saving the project', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '5' })
    const menu = openAppNavigationMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.actions.saveProject }))

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('5')
  })

  it('commits the active timing draft before preparing timing exports', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '3' })
    openTimingExportDialog()

    expect(document.querySelector('.timingDraftText')).toBeNull()
    expect(document.querySelector('.eventText')?.textContent).toBe('3')
  })

  it('commits a timing draft to its source cut before switching shared cuts', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    const menu = openSharedCutMenu()
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutTitle }))
    fireEvent.change(within(menu).getByLabelText(uiText.sheet.addSharedCutName), { target: { value: 'BOOK別案' } })
    fireEvent.click(within(menu).getByRole('button', { name: uiText.sheet.addSharedCutConfirm }))

    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '8' })
    switchSharedCutByLabel('001')
    expect(document.querySelector('.eventText')).toBeNull()

    switchSharedCutByLabel('BOOK別案')
    expect(document.querySelector('.eventText')?.textContent).toBe('8')
  })

  it('treats an active timing edit as unsaved window state', () => {
    render(<App />)
    const sheet = screen.getByLabelText(uiText.sheet.canvasLabel)
    setSheetRect(sheet, 0, 0)
    clickTemplateFrame(sheet, 'cell', 'A', 1)
    fireEvent.keyDown(window, { key: '6' })

    const beforeUnload = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
  })
})
