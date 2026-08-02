import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetCorrectorHelpDialog } from './sheet-corrector-components'

afterEach(cleanup)

describe('SheetCorrectorHelpDialog', () => {
  it('leads with the shortest workflow and exposes all operations by chapter', () => {
    const onClose = vi.fn()
    render(<SheetCorrectorHelpDialog onClose={onClose} />)

    expect(screen.getByRole('dialog', { name: 'シート画像補正の使い方' })).toBeTruthy()
    const quickTab = screen.getByRole('tab', { name: 'クイックガイド' })
    const detailedTab = screen.getByRole('tab', { name: '詳しい使い方' })
    expect(quickTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '画像をドロップしてPSDを作る' })).toBeTruthy()
    expect(screen.getByText(/通常は編集画面を開く必要はありません/)).toBeTruthy()
    expect(screen.getByText(/元画像と同じフォルダに補正済みPSD/)).toBeTruthy()
    expect(screen.getByRole('heading', { name: '編集画面を使うのはこんなとき' })).toBeTruthy()

    fireEvent.click(detailedTab)
    expect(detailedTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('heading', { name: '画像からすぐPSDを作る' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /四隅を合わせて補正する/ }))
    expect(screen.getByRole('heading', { name: '四隅を手動で直す' })).toBeTruthy()
    expect(screen.getByText(/必ず「変形適用」を押します/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /PSDを出力して編集する/ }))
    expect(screen.getByRole('heading', { name: 'PSDのレイヤー' })).toBeTruthy()
    expect(screen.getByText(/既存ファイルを上書きしません/)).toBeTruthy()
    expect(screen.queryByText('高精度補正', { exact: false })).toBeNull()
    expect(screen.queryByText('バッチ', { exact: false })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
