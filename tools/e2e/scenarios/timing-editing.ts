import type { SheetTimingRole } from '@xsheet-remap/core'

type FrameAction = (role: SheetTimingRole, track: string, frame: number) => Promise<void>
type RangeAction = (role: SheetTimingRole, track: string, start: number, end: number) => Promise<void>
type EventAssertion = (role: SheetTimingRole, track: string, frame: number, label: string) => Promise<void>

interface TimingEditingActions {
  clickFrame: FrameAction
  rightClickFrame: FrameAction
  dragRange: RangeAction
  waitForSelectedRange: RangeAction
  waitForSelectedFrame: FrameAction
  waitForEventAt: EventAssertion
  waitForNoEventAt: EventAssertion
  keyPress: (key: string) => Promise<void>
  keyboardShortcut: (key: string) => Promise<void>
  clickMenuItem: (label: string) => Promise<void>
  waitForPageCondition: (condition: () => boolean, label?: string) => Promise<void>
  waitForSelectedRangeTracks: (role: SheetTimingRole, tracks: string[], start: number, end: number) => Promise<void>
  dragRangeBetweenTracks: (role: SheetTimingRole, startTrack: string, start: number, endTrack: string, end: number) => Promise<void>
  dragTimelineEvent: (sourceRole: SheetTimingRole, sourceTrack: string, sourceFrame: number, targetRole: SheetTimingRole, targetTrack: string, targetFrame: number) => Promise<void>
}

export async function verifyTimingEditingScenario(actions: TimingEditingActions, checks: string[]): Promise<void> {
  const { clickFrame, rightClickFrame, dragRange, waitForSelectedRange, waitForSelectedFrame, waitForEventAt,
    waitForNoEventAt, keyPress, keyboardShortcut, clickMenuItem, waitForPageCondition, waitForSelectedRangeTracks,
    dragRangeBetweenTracks, dragTimelineEvent } = actions
  await dragRange('cell', 'A', 1, 3)
  await waitForPageCondition(() => Boolean(document.querySelector('.selectedRangeRect')), 'visible CELL selection range')
  await waitForSelectedRange('cell', 'A', 1, 3)
  await keyPress('1')
  await waitForNoEventAt('cell', 'A', 1, '1')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', 1, '1')
  await waitForSelectedFrame('cell', 'A', 4)
  checks.push('committed a CELL range value only on Enter and advanced by the selected range length')

  await clickFrame('cell', 'B', 2)
  await keyPress('2')
  await waitForNoEventAt('cell', 'B', 2, '2')
  await keyPress('Enter')
  await waitForEventAt('cell', 'B', 2, '2')
  await dragRangeBetweenTracks('cell', 'A', 1, 'B', 3)
  await waitForSelectedRangeTracks('cell', ['A', 'B'], 1, 3)
  await keyboardShortcut('c')
  await clickFrame('cell', 'C', 30)
  await waitForSelectedFrame('cell', 'C', 30)
  await keyboardShortcut('v')
  await waitForEventAt('cell', 'C', 30, '1')
  await waitForEventAt('cell', 'D', 31, '2')
  await waitForNoEventAt('cell', 'C', 31, '2')
  checks.push('copied a multi-track CELL rectangle while preserving track and frame offsets')

  await dragRange('cell', 'A', 1, 3)
  await waitForSelectedRange('cell', 'A', 1, 3)
  await keyboardShortcut('c')
  await dragRange('cell', 'B', 10, 15)
  await waitForSelectedRange('cell', 'B', 10, 15)
  await rightClickFrame('cell', 'B', 10)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'timing repeat context menu')
  await clickMenuItem('選択範囲内にリピート貼り付け')
  await waitForEventAt('cell', 'B', 10, '1')
  await waitForEventAt('cell', 'B', 13, '1')
  await waitForNoEventAt('cell', 'B', 12, '1')
  await waitForNoEventAt('cell', 'B', 15, '1')
  checks.push('repeated a sparse copied range without filling its empty frames')

  await clickFrame('cell', 'B', 20)
  await waitForSelectedFrame('cell', 'B', 20)
  await keyboardShortcut('v')
  await waitForEventAt('cell', 'B', 20, '1')
  await waitForNoEventAt('cell', 'B', 22, '1')
  checks.push('pasted a copied timing range from a single target cell')

  await dragRange('cell', 'B', 22, 20)
  await waitForSelectedRange('cell', 'B', 20, 22)
  await keyboardShortcut('x')
  await waitForNoEventAt('cell', 'B', 20, '1')
  await waitForNoEventAt('cell', 'B', 22, '1')
  checks.push('cut only the selected timing range')

  await clickFrame('cell', 'A', 6)
  await waitForSelectedFrame('cell', 'A', 6)
  await keyPress('2')
  await waitForNoEventAt('cell', 'A', 6, '2')
  await keyPress('Enter')
  await waitForEventAt('cell', 'A', 6, '2')
  await dragTimelineEvent('cell', 'A', 6, 'cell', 'A', 8)
  await waitForEventAt('cell', 'A', 8, '2')
  await waitForNoEventAt('cell', 'A', 6, '2')
  checks.push('moved an existing timeline event without leaving a duplicate at its source')

  await rightClickFrame('cell', 'A', 8)
  await waitForPageCondition(() => Boolean(document.querySelector('[role="menu"]')), 'timing delete context menu')
  await clickMenuItem('キーを削除 ([Del])')
  await waitForNoEventAt('cell', 'A', 8, '2')
  checks.push('deleted a timeline event from the sheet context menu')

  await clickFrame('action', 'A', 40)
  await keyPress('7')
  await keyPress('Enter')
  await clickFrame('action', 'A', 42)
  await keyPress('8')
  await keyPress('Enter')
  await dragRange('action', 'A', 43, 40)
  await waitForSelectedRange('action', 'A', 40, 43)
  await keyboardShortcut('c')
  await clickFrame('cell', 'E', 40)
  await keyboardShortcut('v')
  await waitForEventAt('cell', 'E', 40, '7')
  await waitForEventAt('cell', 'E', 42, '8')
  await clickFrame('cell', 'E', 40)
  await keyPress('9')
  await keyPress('Enter')
  await waitForEventAt('cell', 'E', 40, '9')
  await waitForEventAt('action', 'A', 40, '7')
  await keyboardShortcut('z')
  await waitForEventAt('cell', 'E', 40, '7')
  await dragRange('cell', 'E', 43, 40)
  await keyboardShortcut('c')
  await clickFrame('action', 'B', 40)
  await keyboardShortcut('v')
  await waitForEventAt('action', 'B', 40, '7')
  await waitForEventAt('action', 'B', 42, '8')
  checks.push('copied ACTION to CELL and back, renumbered CELL independently, and restored it with undo')
}
