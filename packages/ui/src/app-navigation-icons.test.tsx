import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DisplaySettingsIcon, PaperSheetIcon, SharedCutIcon } from './app-navigation'

describe('sheet workspace rail icons', () => {
  it.each([
    {
      Icon: SharedCutIcon,
      className: 'sharedCutIcon',
      paths: [
        'M3.5 7.5h17v12.5h-17z',
        'M3.5 7.5V4.8L19.7 2l.8 5.5z',
        'M8 4 6.8 7.5M13 3.2l-1.2 4.3M18 2.5l-1.2 5',
        'M6.5 14h4.2M10.7 14l4-3M10.7 14l4 3M14.7 9.8v2.4M14.7 15.8v2.4',
      ],
    },
    {
      Icon: PaperSheetIcon,
      className: 'paperSheetIcon',
      paths: [
        'M7 2.5h9.5L19 5v6.5H7z',
        'M16.5 2.5V5H19M9.5 7.5h7',
        'M4 10.5h16l1.5 4v5H2.5v-5z',
        'M5 14.5h14',
        'M6 19.5v2h12v-2',
      ],
    },
    {
      Icon: DisplaySettingsIcon,
      className: 'pageDisplayIcon',
      paths: [
        'M2.5 12S6 6 12 6s9.5 6 9.5 6S18 18 12 18 2.5 12 2.5 12z',
        'M12 9v6',
      ],
      rect: { x: '8', y: '9', width: '8', height: '6', rx: '0.7' },
    },
  ])('renders the approved $className metaphor at the shared 24-unit size', ({ Icon, className, paths, rect }) => {
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')

    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.classList.contains('topIconSvg')).toBe(true)
    expect(svg?.classList.contains(className)).toBe(true)
    expect(Array.from(svg?.querySelectorAll('path') ?? [], path => path.getAttribute('d'))).toEqual(paths)

    if (rect) {
      const element = svg?.querySelector('rect')
      expect(element).not.toBeNull()
      expect(Object.fromEntries(Object.keys(rect).map(key => [key, element?.getAttribute(key)]))).toEqual(rect)
    } else {
      expect(svg?.querySelector('rect')).toBeNull()
    }
  })
})
