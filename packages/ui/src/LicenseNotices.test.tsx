import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { LicenseNotices } from './LicenseNotices'

afterEach(cleanup)

describe('in-app licenses', () => {
  it('shows the application license and searches the actual dependency version and complete notice', async () => {
    render(<LicenseNotices />)
    expect(screen.getByText(/Copyright \(c\) 2026 stechdrive/)).toBeTruthy()
    const search = await screen.findByRole('searchbox', { name: 'ライブラリ名・ライセンスで検索' })
    fireEvent.change(search, { target: { value: 'sql.js' } })
    expect(screen.getByText('1.15.1 · MIT')).toBeTruthy()
    expect(screen.queryByText('1.14.2 · MIT')).toBeNull()
    const details = screen.getByText('sql.js', { exact: true }).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    await waitFor(() => expect(within(details).getByText(/Copyright \(c\) 2017 sql.js authors/)).toBeTruthy())
    fireEvent.change(search, { target: { value: 'unknown nonexistent library' } })
    expect(screen.getByText('一致するライブラリはありません。')).toBeTruthy()
  })
  it('keeps the encoder license and source/build links available inside the app', async () => {
    render(<LicenseNotices />)
    const search = await screen.findByRole('searchbox', { name: 'ライブラリ名・ライセンスで検索' })
    fireEvent.change(search, { target: { value: 'LAME' } })
    const details = screen.getByText('LAME MP3 encoder', { exact: true }).closest('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    await waitFor(() => expect(screen.getByText(/GNU LIBRARY GENERAL PUBLIC LICENSE/)).toBeTruthy())
    expect(screen.getByRole('link', { name: /sourceforge.net/ }).getAttribute('href')).toContain('/3.100/')
    expect(screen.getByRole('link', { name: /mediabunny/ }).getAttribute('href')).toContain('/v1.62.0/')
  })
})
