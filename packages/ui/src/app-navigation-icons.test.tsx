import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DisplaySettingsIcon, PaperSheetIcon, SharedCutIcon, TextSizeIcon } from './app-navigation'

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
        'M6 2.5h9l3 3v16H6z',
        'M15 2.5v3h3M8.5 8.5h7M8.5 11.5h4',
        'M13.5 20v-6.5M10.5 16.5l3-3 3 3',
      ],
    },
    {
      Icon: DisplaySettingsIcon,
      className: 'pageDisplayIcon',
      paths: [
        'M9.6 3.5h4.8l.5 2.1c.6.2 1.2.6 1.7 1l2.1-.6 2.4 4.1-1.6 1.5v.8l1.6 1.5-2.4 4.1-2.1-.6c-.5.4-1.1.8-1.7 1l-.5 2.1H9.6l-.5-2.1c-.6-.2-1.2-.6-1.7-1l-2.1.6-2.4-4.1 1.6-1.5v-.8l-1.6-1.5L5.3 6l2.1.6c.5-.4 1.1-.8 1.7-1z',
      ],
      circle: { cx: '12', cy: '12', r: '3' },
    },
    {
      Icon: TextSizeIcon,
      className: 'textSizeIcon',
      paths: [
        'M3.5 19 8 6l4.5 13M5.2 14h5.6',
        'M19.5 19v-6.2c0-1.5-1.1-2.4-2.7-2.4-1.4 0-2.4.7-2.8 1.8M19.5 15.1h-2.3c-2 0-3.2.8-3.2 2.1 0 1.2 1 2 2.4 2 1.8 0 3.1-1.2 3.1-2.7',
      ],
    },
  ])('renders the approved $className metaphor at the shared 24-unit size', ({ Icon, className, paths, circle }) => {
    const { container } = render(<Icon />)
    const svg = container.querySelector('svg')

    expect(svg?.getAttribute('viewBox')).toBe('0 0 24 24')
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.classList.contains('topIconSvg')).toBe(true)
    expect(svg?.classList.contains(className)).toBe(true)
    expect(Array.from(svg?.querySelectorAll('path') ?? [], path => path.getAttribute('d'))).toEqual(paths)

    if (circle) {
      const element = svg?.querySelector('circle')
      expect(element).not.toBeNull()
      expect(Object.fromEntries(Object.keys(circle).map(key => [key, element?.getAttribute(key)]))).toEqual(circle)
    } else {
      expect(svg?.querySelector('circle')).toBeNull()
    }
  })
})
