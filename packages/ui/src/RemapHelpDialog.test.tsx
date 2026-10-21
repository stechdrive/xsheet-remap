import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RemapHelpDialog, RemapHelpPage, type RemapHelpTopic } from './RemapHelpDialog'

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/') })

describe('Remap unified help', () => {
  it('opens the selected chapter separately and closes the modal only after success', async () => {
    const onClose = vi.fn()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<RemapHelpDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole('tab', { name: '詳しい使い方' }))
    fireEvent.click(screen.getByRole('button', { name: /SOUND指示とセリフ音声/ }))
    fireEvent.click(screen.getByRole('button', { name: '別タブで開く' }))
    await screen.findByRole('alert')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'SOUND指示とセリフ音声' })).toBeTruthy()

    open.mockReturnValue({ opener: window } as Window)
    fireEvent.click(within(screen.getByRole('group', { name: 'ヘルプの対象' })).getByRole('button', { name: 'シート編集' }))
    fireEvent.click(screen.getByRole('button', { name: '別タブで開く' }))
    await vi.waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(open.mock.lastCall?.[0]).toContain('app=help&topic=sheet&view=detailed&chapter=sound')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('restores standalone reading position, updates its URL and tolerates an unknown chapter', () => {
    window.history.replaceState(null, '', '/xsheet-remap/?app=help&topic=template&view=detailed&chapter=save')
    const { unmount } = render(<RemapHelpPage />)
    expect(screen.getByRole('main', { name: 'xsheet-remapの使い方' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('button', { name: '別タブで開く' })).toBeNull()
    expect(screen.getByRole('heading', { name: '保存・利用' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '次の章 →' }))
    expect(new URLSearchParams(window.location.search).get('chapter')).toBe('troubleshooting')
    unmount()
    window.history.replaceState(null, '', '/?app=help&topic=clip&view=detailed&chapter=unknown')
    render(<RemapHelpPage />)
    expect(screen.getByRole('heading', { name: 'CLIPレイヤーと素材' })).toBeTruthy()
  })

  it.each<[RemapHelpTopic, string, string]>([
    ['sheet', 'シート編集', 'タイムシートを作って保存する'],
    ['clip', 'CLIP組み立て', '素材とタイミングからCLIPを作る'],
    ['template', 'テンプレート作成・編集', '最短でテンプレートを完成させる'],
  ])('opens the %s workflow and keeps every integrated manual reachable', (initialTopic, label, heading) => {
    render(<RemapHelpDialog initialTopic={initialTopic} onClose={vi.fn()} />)
    const topics = within(screen.getByRole('group', { name: 'ヘルプの対象' }))
    expect(topics.getByRole('button', { name: label }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy()

    fireEvent.click(topics.getByRole('button', { name: 'シート編集' }))
    fireEvent.click(screen.getByRole('tab', { name: '詳しい使い方' }))
    fireEvent.click(screen.getByRole('button', { name: /SOUND指示とセリフ音声/ }))
    expect(screen.getByRole('heading', { name: '選択と非破壊編集' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /紙シート画像と認識/ }))
    expect(screen.getByText('紙シートのAI読み取り')).toBeTruthy()

    fireEvent.click(topics.getByRole('button', { name: 'CLIP組み立て' }))
    expect(screen.getByRole('heading', { name: 'CLIPレイヤーと素材' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '音声とCLIPへの書き戻し' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '← 前の章' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '次の章 →' }))
    expect(screen.getByRole('heading', { name: 'プロジェクトと保存' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /読み込みと書き出し/ }))
    expect(screen.getByRole('heading', { name: 'After Effectsへセルタイミングを渡す' })).toBeTruthy()

    fireEvent.click(topics.getByRole('button', { name: 'テンプレート作成・編集' }))
    expect(screen.getByRole('heading', { name: '作り方を選ぶ' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /参照画像と補正基準枠/ }))
    expect(screen.getByRole('heading', { name: '補正基準枠' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /保存・利用/ }))
    expect(screen.getByText('プロジェクトへ反映')).toBeTruthy()
    expect(screen.getByText(/JSON保存だけでは編集中のシートは変わりません/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '次の章 →' }))
    expect(screen.getByRole('button', { name: '次の章 →' }).hasAttribute('disabled')).toBe(true)

    fireEvent.click(topics.getByRole('button', { name: 'シート編集' }))
    expect(screen.getByRole('heading', { name: '画面の見方' })).toBeTruthy()
  })

  it('supports keyboard tabs, shared licenses, returning to a guide and closing', () => {
    const onClose = vi.fn()
    render(<RemapHelpDialog onClose={onClose} />)
    const quick = screen.getByRole('tab', { name: 'クイックガイド' })
    quick.focus()
    fireEvent.keyDown(quick, { key: 'ArrowRight' })
    const detailed = screen.getByRole('tab', { name: '詳しい使い方' })
    expect(document.activeElement).toBe(detailed)
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(detailed.id)
    fireEvent.keyDown(detailed, { key: 'End' })
    expect(screen.getByRole('article', { name: 'ライセンス・謝辞' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'テンプレート作成・編集' }))
    expect(quick.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '最短でテンプレートを完成させる' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
