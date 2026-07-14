import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SheetCorrectorHelpDialog } from './sheet-corrector-components'

afterEach(cleanup)

describe('SheetCorrectorHelpDialog', () => {
  it('leads with drag-and-drop usage and explains when to open the app', () => {
    const onClose = vi.fn()
    render(<SheetCorrectorHelpDialog onClose={onClose} />)

    expect(screen.getByText('普段はアプリを開かず、タイムシート画像をドロップするだけで使えます。')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'まずは画像をドロップするだけ' })).toBeTruthy()
    expect(screen.getByText('タイムシート画像をショートカットまたは「xsheet-corrector.exe」へドロップすると、自動で画像を補正してPSDを作成します。')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '複数の画像もまとめて処理できます' })).toBeTruthy()
    expect(screen.getByText('カットフォルダをそのままドロップして、フォルダ内の対象画像をまとめて処理することもできます。', { exact: false })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'アプリ画面は確認・調整したいときに' })).toBeTruthy()
    expect(screen.getByText('自動処理で「要確認」になった画像を直したい')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '画面で確認しながら処理する' })).toBeTruthy()
    expect(screen.queryByText('高精度補正', { exact: false })).toBeNull()
    expect(screen.queryByText('バッチ', { exact: false })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
