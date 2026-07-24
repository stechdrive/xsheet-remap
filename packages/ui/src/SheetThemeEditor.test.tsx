import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDefaultSheetTemplateTheme } from '@xsheet-remap/core'
import { SheetThemeEditor } from './SheetThemeEditor'

afterEach(cleanup)

describe('SheetThemeEditor', () => {
  it('applies complete presets and marks manual color edits as custom', () => {
    const onChange = vi.fn()
    const theme = createDefaultSheetTemplateTheme()
    const { rerender } = render(<SheetThemeEditor theme={theme} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('用紙テーマ'), { target: { value: 'warm-paper' } })
    const presetTheme = onChange.mock.calls.at(-1)?.[0]
    expect(presetTheme).toMatchObject({ presetId: 'warm-paper', paper: { color: '#fbf3de' } })

    rerender(<SheetThemeEditor theme={presetTheme} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('用紙色'), { target: { value: '#abcdef' } })
    expect(onChange.mock.calls.at(-1)?.[0]).toMatchObject({
      presetId: undefined,
      paper: { color: '#abcdef' },
    })
  })

  it('updates second bands and adjacent SOUND column colors independently', () => {
    const onChange = vi.fn()
    const theme = createDefaultSheetTemplateTheme()
    const { rerender } = render(<SheetThemeEditor theme={theme} onChange={onChange} />)

    fireEvent.click(screen.getByLabelText('1秒ごとの背景帯'))
    expect(onChange.mock.calls.at(-1)?.[0].paper.secondBands.enabled).toBe(false)

    fireEvent.change(screen.getByLabelText('SOUND 偶数列色'), { target: { value: '#123456' } })
    const changed = onChange.mock.calls.at(-1)?.[0]
    expect(changed.timedRangeCues.sound.columnColors).toEqual([theme.timedRangeCues.sound.columnColors[0], '#123456'])
    expect(changed.timedRangeCues.camera.columnColors).toEqual(theme.timedRangeCues.camera.columnColors)

    rerender(<SheetThemeEditor theme={changed} onChange={onChange} />)
    expect((screen.getByLabelText('SOUND 偶数列色') as HTMLInputElement).value).toBe('#123456')
  })
})
