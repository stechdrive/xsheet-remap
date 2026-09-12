import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useModalDialogKeyboardBoundary } from './useModalDialogKeyboardBoundary'
import { useFloatingEditorBoundary } from './useFloatingEditorBoundary'
import { useInlineEditorSession } from './useInlineEditorSession'

afterEach(cleanup)
describe('shared editing boundaries during composition', () => {
  it.each(['modal', 'floating'] as const)('%s ignores composition cancellation keys but owns ordinary Escape', mode => {
    const cancel = vi.fn()
    function Modal() { const ref = useModalDialogKeyboardBoundary<HTMLDivElement>(cancel); return <div ref={ref}><input aria-label="edit" /></div> }
    function Floating() { const boundary = useFloatingEditorBoundary<HTMLDivElement>(cancel); return <div ref={boundary.rootRef} onKeyDown={boundary.handleKeyDown}><input aria-label="edit" /></div> }
    render(mode === 'modal' ? <Modal /> : <Floating />)
    const editor = screen.getByRole('textbox')
    fireEvent.compositionStart(editor)
    fireEvent.keyDown(editor, { key: 'Escape', isComposing: true })
    fireEvent.keyDown(editor, { key: 'Escape', keyCode: 229 })
    expect(cancel).not.toHaveBeenCalled()
    fireEvent.compositionEnd(editor)
    fireEvent.keyDown(editor, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(1)
  })
  it('commits the current DOM draft once after composition and ignores a later blur', () => {
    const save = vi.fn()
    function Editor() {
      const session = useInlineEditorSession<HTMLTextAreaElement>({ active: true, sessionKey: 'memo', onCommit: input => save(input?.value), onCancel: vi.fn() })
      return <><textarea ref={session.editorRef} aria-label="edit" onBlur={session.commit} /><button onClick={session.commit}>保存</button></>
    }
    render(<Editor />)
    const editor = screen.getByRole('textbox')
    fireEvent.compositionStart(editor); fireEvent.input(editor, { target: { value: '確定した文字' }, isComposing: true }); fireEvent.compositionEnd(editor)
    fireEvent.click(screen.getByRole('button')); fireEvent.blur(editor)
    expect(save).toHaveBeenCalledExactlyOnceWith('確定した文字')
  })
})
