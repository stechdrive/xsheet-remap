import { writeFile } from 'node:fs/promises'
import {
  resolveSheetTemplateGridLayout,
  sheetGridCellRect,
  standardA3SheetTemplate,
  type NormalizedRect,
} from '@xsheet-remap/core'
import { DesktopCdpHarness, type ClientPoint } from './desktop-cdp-harness'

const scenarioIds = [
  'dialogue-audio-import-vad',
  'dialogue-audio-editing',
  'dialogue-audio-playback',
  'dialogue-audio-linking',
] as const
type ScenarioId = typeof scenarioIds[number]

interface AudioRootSnapshot {
  frameOrigin: number
  cutDurationFrames: number
  timelineDurationFrames: number
  audioContentEndFrame: number | null
  vadEngine: string
  activeTrackId: string
}

interface ClipSnapshot {
  trackId: string
  clipId: string
  sourceName: string
  frameStart: number
  frameEnd: number
  selected: boolean
}

interface SegmentSnapshot {
  kind: 'candidate' | 'region'
  trackId: string
  segmentId: string
  frameStart: number
  frameEnd: number
  linked: boolean
  label: string
}

interface SoundCueSnapshot {
  cueId: string
  laneId: string
  frameStart: number
  frameEnd: number
  label: string
}

const args = parseArgs(process.argv.slice(2))
const port = Number(args.port)
if (!Number.isInteger(port) || port <= 0) throw new Error('--port is required')
if (!args.result || !args.report || !args.audio) throw new Error('--result, --report, and --audio are required')
const scenarioId = parseScenarioId(args.scenario)
const checks: string[] = []
const artifacts: string[] = []
let harness: DesktopCdpHarness | null = null

try {
  harness = await DesktopCdpHarness.connect(port)
  await harness.waitForSelector('svg.sheetSvg')
  await openAudioTimeline()
  if (scenarioId === 'dialogue-audio-import-vad') await verifyImportAndVad()
  else if (scenarioId === 'dialogue-audio-editing') await verifyEditing()
  else if (scenarioId === 'dialogue-audio-playback') await verifyPlaybackAndViewport()
  else await verifySheetLinking()

  if (args.screenshot) {
    await harness.captureScreenshot(args.screenshot)
    artifacts.push(args.screenshot)
  }
  await writeJson(args.report, {
    scenario: scenarioId,
    checks,
    final: await modelSnapshot(),
  })
  await writeJson(args.result, {
    passed: true,
    scenario: scenarioId,
    checks,
    artifacts: [args.report, ...artifacts],
  })
} catch (error) {
  if (harness && args['failure-screenshot']) {
    await harness.captureScreenshot(args['failure-screenshot'])
      .then(() => artifacts.push(args['failure-screenshot']))
      .catch(() => undefined)
  }
  await writeJson(args.report, {
    scenario: scenarioId,
    checks,
    error: errorMessage(error),
    debug: harness ? await harness.debugSnapshot().catch(debugError => ({ error: errorMessage(debugError) })) : null,
  })
  await writeJson(args.result, {
    passed: false,
    scenario: scenarioId,
    error: errorMessage(error),
    checks,
    artifacts: [args.report, ...artifacts],
  })
  process.exitCode = 1
} finally {
  harness?.close()
}

async function verifyImportAndVad(): Promise<void> {
  const initial = await audioRoot()
  assert(initial.cutDurationFrames === 144, `expected 144F initial cut, got ${initial.cutDurationFrames}`)
  assert(initial.audioContentEndFrame === null, 'empty project unexpectedly has audio content')
  checks.push('started with an empty audio workspace independent from the 144F sheet cut')

  await importAudio(1, 'dialogue-1', true)
  const clip = (await clips()).find(item => item.trackId === 'dialogue-1')
  assert(clip, 'imported audio clip was not rendered')
  const analyzed = await audioRoot()
  assert(analyzed.vadEngine === 'silero', `expected Silero VAD, got ${analyzed.vadEngine}`)
  assert(analyzed.audioContentEndFrame !== null && analyzed.audioContentEndFrame > 144,
    `fixture must extend past the sheet cut; end=${analyzed.audioContentEndFrame}`)
  assert(analyzed.cutDurationFrames === 144, 'audio import changed the sheet cut duration')
  assert((await segments('candidate')).length > 0, 'Silero did not produce a visible speech candidate')
  assert(await h().evaluate<boolean>(`Boolean(document.querySelector('.dialogueWaveform path'))`), 'waveform path was not rendered')
  checks.push('decoded the generated WAV, rendered its waveform, and produced visible Silero candidates')
  checks.push('extended only the audio workspace past 144F without changing the sheet cut')

  await h().clickSelector('[aria-label="音声トラック2を録音対象にする"]')
  await h().waitFor(() => audioRoot().then(root => root.activeTrackId === 'dialogue-2'), 5_000, 'track 2 activation')
  await h().clickSelector('[aria-label="音声トラック2をミュート"]')
  await h().waitFor(
    () => h().evaluate<boolean>(`document.querySelector('[aria-label="音声トラック2のミュートを解除"]')?.getAttribute('aria-pressed') === 'true'`),
    5_000,
    'track 2 mute',
  )
  await setTrackHeight('dialogue-2', '大')
  const trackHeight = await h().evaluate<number>(`document.querySelector('.dialogueAudioTrack[data-track-id="dialogue-2"]')?.getBoundingClientRect().height ?? 0`)
  assert(trackHeight >= 120, `large track height was not applied: ${trackHeight}`)
  checks.push('switched the armed track, toggled mute, and applied a large track height')
}

async function verifyEditing(): Promise<void> {
  await setTrackVadMode('dialogue-1', 'off')
  await importAudio(1, 'dialogue-1', false)
  await setPlayhead(24)
  await importAudio(24, 'dialogue-1', false)
  const original = (await clips()).filter(item => item.trackId === 'dialogue-1')
  assert(original.length === 2, `expected two overlapping clips, got ${original.length}`)
  assert(original[0].frameEnd >= original[1].frameStart, 'editing fixture clips do not overlap')
  checks.push('kept two overlapping clips as independent non-destructive placements')

  await h().clickSelector(clipSelector(original[0].clipId))
  await h().clickSelector(clipSelector(original[1].clipId), { modifiers: 2 })
  await h().waitFor(
    () => clips().then(items => items.filter(item => item.trackId === 'dialogue-1' && item.selected).length === 2),
    5_000,
    'two selected audio clips',
  )
  await dragSelectorByFrames(clipSelector(original[0].clipId), 6)
  await waitForClipStarts(original.map(item => [item.clipId, item.frameStart + 6]))
  checks.push('multi-selected two clip handles and moved both placements together')

  await h().clickSelector('[aria-label="元に戻す"]')
  await waitForClipStarts(original.map(item => [item.clipId, item.frameStart]))
  await h().clickSelector('[aria-label="やり直す"]')
  await waitForClipStarts(original.map(item => [item.clipId, item.frameStart + 6]))
  checks.push('undid and redid the multi-clip move as exact project snapshots')

  await h().clickSelector('[aria-label="時間範囲選択ツール"]')
  await h().mouseDrag(await audioFramePoint('dialogue-1', 42, 0.72), await audioFramePoint('dialogue-1', 50, 0.72))
  await h().waitForSelector('.dialogueAudioSelectionSummary')
  await h().keyPress('Delete')
  await h().waitFor(async () => {
    const items = (await clips()).filter(item => item.trackId === 'dialogue-1')
    return items.every(item => item.frameEnd < 42 || item.frameStart > 50)
  }, 5_000, 'silenced selected range')
  await h().clickSelector('[aria-label="元に戻す"]')
  await h().waitFor(async () => {
    const items = (await clips()).filter(item => item.trackId === 'dialogue-1')
    return items.some(item => item.frameStart <= 42 && item.frameEnd >= 50)
  }, 5_000, 'undo selected range silence')
  checks.push('created a drag-only time range, silenced it, and restored it with Undo')

  await h().clickSelector('[aria-label="音声トラック2を録音対象にする"]')
  await setTrackVadMode('dialogue-2', 'off')
  await setPlayhead(12)
  await importAudio(12, 'dialogue-2', false)
  assert((await clips()).some(item => item.trackId === 'dialogue-2'), 'track 2 import was not placed on track 2')
  checks.push('imported audio independently into another fixed track')
}

async function verifyPlaybackAndViewport(): Promise<void> {
  await setTrackVadMode('dialogue-1', 'off')
  await importAudio(1, 'dialogue-1', false)
  await setPlayhead(20)
  const start = await rulerFramePoint(20)
  const next = await rulerFramePoint(21)
  await h().mouseDrag(start, next)
  await waitForPlayhead(21)
  checks.push('scrubbed by exactly one project frame')

  await h().clickSelector('[aria-label="▶ 再生ヘッドから"]')
  await h().waitForSelector('[aria-label="⏸ 一時停止"]', 5_000)
  await h().waitFor(
    () => playheadFrame().then(frame => frame > 21),
    5_000,
    'advancing playback head',
  )
  await h().clickSelector('[aria-label="⏸ 一時停止"]')
  await h().waitForSelector('[aria-label="▶ 再生ヘッドから"]')
  checks.push('started and stopped decoded multi-track playback from the playhead')

  const root = await audioRoot()
  assert(root.audioContentEndFrame !== null, 'audio content end is missing')
  await setPlayhead(root.audioContentEndFrame)
  await h().clickSelector('[aria-label="▶ 再生ヘッドから"]')
  await h().waitFor(
    async () => (await playheadFrame()) < root.audioContentEndFrame!,
    5_000,
    'playback restart from head at timeline end',
  )
  await h().clickSelector('[aria-label="⏸ 一時停止"]')
  checks.push('restarted playback from the head after reaching the audio end')

  const fitWidth = await contentAndViewportWidth()
  await h().setFormFieldValue('[aria-label="音声タイムラインのズーム"]', '90')
  await h().waitFor(async () => {
    const width = await contentAndViewportWidth()
    return width.content > fitWidth.content && width.content > width.viewport
  }, 5_000, 'zoomed timeline width')
  await h().clickSelector('[aria-label="音声タイムライン全体を表示"]')
  await h().waitFor(async () => {
    const width = await contentAndViewportWidth()
    return width.content <= width.viewport + 2
  }, 5_000, 'fit timeline width')
  checks.push('zoomed the timeline and restored fit-to-workspace display')

  await setTrackHeight('dialogue-1', '大')
  await setTrackHeight('dialogue-2', '大')
  await setTrackHeight('dialogue-3', '大')
  const panelResizeStart = await h().centerOf('[aria-label="音声タイムラインの高さを変更"]')
  await h().mouseDrag(panelResizeStart, { x: panelResizeStart.x, y: panelResizeStart.y + 1_000 })
  await h().waitFor(
    () => h().evaluate<boolean>(`Number(document.querySelector('[aria-label="音声タイムラインの高さを変更"]')?.getAttribute('aria-valuenow')) <= 180`),
    5_000,
    'minimum audio panel height',
  )
  await h().waitFor(async () => h().evaluate<boolean>(`
    (() => {
      const scroller = document.querySelector('.dialogueAudioScroller');
      if (!(scroller instanceof HTMLElement) || scroller.scrollHeight <= scroller.clientHeight) return false;
      scroller.scrollTop = Math.min(120, scroller.scrollHeight - scroller.clientHeight);
      return scroller.scrollTop > 0;
    })()
  `), 5_000, 'vertical timeline scrolling')
  checks.push('kept large tracks operable through vertical scrolling in the minimum panel height')
}

async function verifySheetLinking(): Promise<void> {
  await importAudio(1, 'dialogue-1', true)
  let candidate = (await segments('candidate')).find(item => item.frameEnd <= 136)
    ?? (await segments('candidate'))[0]
  assert(candidate, 'no speech candidate available for SOUND linking')
  if (candidate.frameEnd > 136) {
    const targetEnd = Math.min(120, candidate.frameStart + 30)
    await dragSegmentEdge(candidate, 'end', targetEnd - candidate.frameEnd)
    candidate = await h().waitFor(async () => {
      const current = (await segments('candidate')).find(item => item.segmentId === candidate!.segmentId)
      return current?.frameEnd === targetEnd ? current : null
    }, 5_000, 'candidate trimmed inside sheet cut')
  }

  await h().clickSelector(segmentSelector(candidate))
  await h().clickButton('音響指示へ割付…')
  await h().waitForSelector('[role="dialog"][aria-label="SOUND指示"]')
  await h().setFormFieldValue('[aria-label="SOUNDラベル"]', 'E2Eリンク')
  await h().setFormFieldValue('[aria-label="SOUND内容"]', '音声とシートの双方向連動')
  await h().clickButton('作成して割り付け')
  const linkedRegion = await h().waitFor(async () => {
    const region = (await segments('region')).find(item => item.linked && item.label.includes('E2Eリンク'))
    return region ?? null
  }, 8_000, 'linked dialogue region')
  let cue = await h().waitFor(async () => {
    const item = (await soundCues()).find(current => current.label.includes('E2Eリンク'))
    return item ?? null
  }, 8_000, 'linked sheet SOUND cue')
  assert(cue.frameStart === linkedRegion.frameStart && cue.frameEnd === linkedRegion.frameEnd,
    'new linked cue and region do not share exact boundaries')
  checks.push('created a sheet SOUND cue from a detected speech interval and linked exact boundaries')

  await h().clickSelector(soundCueBodySelector(cue))
  await waitForPlayhead(cue.frameStart)
  await h().clickSelector('[aria-label="音声トラック2を録音対象にする"]')
  assert((await audioRoot()).activeTrackId === 'dialogue-2', 'sheet selection blocked audio track switching')
  await setPlayhead(Math.min(cue.frameStart + 2, cue.frameEnd))
  checks.push('selected a linked sheet label without blocking track switching or playhead movement')

  await dragSoundCueBody(cue, 8)
  cue = await waitForCue(cue.cueId, cue.frameStart + 8, cue.frameEnd + 8)
  let region = await waitForRegion(linkedRegion.segmentId, cue.frameStart, cue.frameEnd)
  checks.push('moved the sheet SOUND label and followed it with the linked audio interval')

  await h().clickSelector('[aria-label="音声トラック1を録音対象にする"]')
  await dragSelectorByFrames(segmentSelector(region), 5)
  region = await waitForRegion(region.segmentId, region.frameStart + 5, region.frameEnd + 5)
  cue = await waitForCue(cue.cueId, region.frameStart, region.frameEnd)
  checks.push('moved the linked audio interval and followed it with the sheet SOUND label')

  await dragSegmentEdge(region, 'end', 3)
  region = await waitForRegion(region.segmentId, region.frameStart, region.frameEnd + 3)
  cue = await waitForCue(cue.cueId, region.frameStart, region.frameEnd)
  checks.push('resized the audio interval edge and synchronized the sheet label duration')

  await h().clickSelector('[aria-label="元に戻す"]')
  const undone = await waitForRegion(region.segmentId, region.frameStart, region.frameEnd - 3)
  await waitForCue(cue.cueId, undone.frameStart, undone.frameEnd)
  await h().clickSelector('[aria-label="やり直す"]')
  await waitForRegion(region.segmentId, region.frameStart, region.frameEnd)
  await waitForCue(cue.cueId, region.frameStart, region.frameEnd)
  checks.push('undid and redid a linked interval edit without breaking the assignment')
}

async function openAudioTimeline(): Promise<void> {
  const collapsed = await h().evaluate<boolean>(`document.querySelector('.dialogueAudioTimeline')?.classList.contains('isCollapsed') ?? false`)
  if (collapsed) await h().clickButton('音声タイムラインを開く')
  await h().waitForSelector('.dialogueAudioTimeline:not(.isCollapsed) .dialogueAudioContent')
}

async function importAudio(frame: number, trackId: string, waitForVad: boolean): Promise<void> {
  const beforeCount = (await clips()).length
  if ((await audioRoot()).activeTrackId !== trackId) {
    const index = Number(trackId.split('-').at(-1))
    await h().clickSelector(`[aria-label="音声トラック${index}を録音対象にする"]`)
  }
  await setPlayhead(frame)
  await h().setFileInputFiles('.dialogueAudioTimeline input[type="file"]', [args.audio])
  await h().waitFor(() => clips().then(items => items.length > beforeCount), 15_000, `audio import at ${frame}F`)
  if (waitForVad) {
    await h().waitFor(
      () => audioRoot().then(root => root.vadEngine === 'silero' || root.vadEngine === 'fallback'),
      60_000,
      'VAD analysis completion',
    )
  }
}

async function setTrackVadMode(trackId: string, mode: 'off' | 'candidates' | 'auto-region'): Promise<void> {
  await h().clickSelector(`.dialogueAudioTrackHeader[data-track-id="${trackId}"]`, { button: 'right' })
  await h().waitForSelector('.dialogueAudioContextMenu select')
  await h().setFormFieldValue('.dialogueAudioContextMenu select', mode)
  await h().keyPress('Escape')
}

async function setTrackHeight(trackId: string, label: '小' | '中' | '大'): Promise<void> {
  await h().clickSelector(`.dialogueAudioTrackHeader[data-track-id="${trackId}"]`, { button: 'right' })
  await h().waitForSelector('.dialogueAudioContextMenu')
  await h().clickSelector(`[aria-label="トラック高 ${label}"]`)
}

async function setPlayhead(frame: number): Promise<void> {
  await h().mouseClick(await rulerFramePoint(frame))
  await waitForPlayhead(frame)
}

async function waitForPlayhead(frame: number): Promise<void> {
  await h().waitFor(() => playheadFrame().then(value => value === frame), 5_000, `playhead ${frame}F`)
}

async function playheadFrame(): Promise<number> {
  return h().evaluate<number>(`Number(document.querySelector('.dialogueAudioPlayhead')?.getAttribute('aria-valuenow'))`)
}

async function rulerFramePoint(frame: number): Promise<ClientPoint> {
  return framePoint('.dialogueAudioRuler', frame, 0.5)
}

async function audioFramePoint(trackId: string, frame: number, yRatio: number): Promise<ClientPoint> {
  return framePoint(`.dialogueAudioTrack[data-track-id="${trackId}"] .dialogueAudioWaveformLane`, frame, yRatio)
}

async function framePoint(selector: string, frame: number, yRatio: number): Promise<ClientPoint> {
  return h().evaluate<ClientPoint>(`
    (() => {
      const root = document.querySelector('.dialogueAudioTimeline');
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!(root instanceof HTMLElement) || !(element instanceof HTMLElement)) throw new Error('audio frame surface missing');
      element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = element.getBoundingClientRect();
      const origin = Number(root.dataset.frameOrigin);
      const duration = Number(root.dataset.timelineDurationFrames);
      return {
        x: rect.left + ((${frame} - origin + 0.5) / duration) * rect.width,
        y: rect.top + rect.height * ${yRatio},
      };
    })()
  `)
}

async function dragSelectorByFrames(selector: string, deltaFrames: number): Promise<void> {
  const start = await h().centerOf(selector)
  const pixelsPerFrame = await h().evaluate<number>(`
    (() => {
      const root = document.querySelector('.dialogueAudioTimeline');
      const content = document.querySelector('.dialogueAudioContent');
      if (!(root instanceof HTMLElement) || !(content instanceof HTMLElement)) return 0;
      return content.getBoundingClientRect().width / Number(root.dataset.timelineDurationFrames);
    })()
  `)
  assert(pixelsPerFrame > 0, 'could not resolve audio pixels per frame')
  const roundingMargin = Math.sign(deltaFrames) * 0.35
  await h().mouseDrag(start, { x: start.x + pixelsPerFrame * (deltaFrames + roundingMargin), y: start.y })
}

async function dragSegmentEdge(segment: SegmentSnapshot, edge: 'start' | 'end', deltaFrames: number): Promise<void> {
  const selector = `${segmentSelector(segment)} [data-segment-edge="${edge}"]`
  await dragSelectorByFrames(selector, deltaFrames)
}

async function dragSoundCueBody(cue: SoundCueSnapshot, deltaFrames: number): Promise<void> {
  const anchorFrame = Math.min(cue.frameEnd, cue.frameStart + 1)
  const [start, end] = await soundFramePoints(cue.laneId, anchorFrame, anchorFrame + deltaFrames)
  await h().mouseDrag(start, end)
}

async function soundFramePoints(laneId: string, startFrame: number, endFrame: number): Promise<[ClientPoint, ClientPoint]> {
  const start = templateSoundFrameLocation(laneId, startFrame)
  const end = templateSoundFrameLocation(laneId, endFrame)
  assert(start.pageId === end.pageId, `cross-page SOUND drag is not supported: ${startFrame}-${endFrame}`)
  const target = {
    x: Math.min(start.rect.x, end.rect.x),
    y: Math.min(start.rect.y, end.rect.y),
    w: Math.max(start.rect.x + start.rect.w, end.rect.x + end.rect.w) - Math.min(start.rect.x, end.rect.x),
    h: Math.max(start.rect.y + start.rect.h, end.rect.y + end.rect.h) - Math.min(start.rect.y, end.rect.y),
  }
  return h().evaluate<[ClientPoint, ClientPoint]>(`
    (async () => {
      const pageId = ${JSON.stringify(start.pageId)};
      const sheet = Array.from(document.querySelectorAll('svg.sheetSvg'))
        .find(item => item.getAttribute('data-page-id') === pageId);
      if (!(sheet instanceof SVGSVGElement)) throw new Error('sheet page missing: ' + pageId);
      sheet.scrollIntoView({ block: 'center', inline: 'center' });
      const viewport = sheet.closest('.sheetViewport');
      if (viewport instanceof HTMLElement) {
        const pageBox = sheet.getBoundingClientRect();
        const viewportBox = viewport.getBoundingClientRect();
        const target = {
          left: pageBox.left + ${target.x} * pageBox.width,
          top: pageBox.top + ${target.y} * pageBox.height,
          right: pageBox.left + ${target.x + target.w} * pageBox.width,
          bottom: pageBox.top + ${target.y + target.h} * pageBox.height,
        };
        const inset = 48;
        if (target.top < viewportBox.top + inset) viewport.scrollTop += target.top - viewportBox.top - inset;
        else if (target.bottom > viewportBox.bottom - inset) viewport.scrollTop += target.bottom - viewportBox.bottom + inset;
        if (target.left < viewportBox.left + inset) viewport.scrollLeft += target.left - viewportBox.left - inset;
        else if (target.right > viewportBox.right - inset) viewport.scrollLeft += target.right - viewportBox.right + inset;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      const box = sheet.getBoundingClientRect();
      const point = rect => ({
        x: box.left + (rect.x + rect.w * 0.5) * box.width,
        y: box.top + (rect.y + rect.h * 0.5) * box.height,
      });
      return [
        point(${JSON.stringify(start.rect)}),
        point(${JSON.stringify(end.rect)}),
      ];
    })()
  `)
}

function templateSoundFrameLocation(laneId: string, frame: number): { pageId: string; rect: NormalizedRect } {
  const frameOrigin = standardA3SheetTemplate.defaults.frameOrigin
  const pageFrames = standardA3SheetTemplate.defaults.durationFrames
  const pageIndex = Math.floor((frame - frameOrigin) / pageFrames)
  const localFrame = frame - pageIndex * pageFrames
  for (const region of standardA3SheetTemplate.regions) {
    if (region.type !== 'exposure-grid' || region.grid?.role !== 'sound') continue
    const layout = resolveSheetTemplateGridLayout(standardA3SheetTemplate, region, {
      durationFrames: pageFrames,
      frameOrigin,
      role: 'sound',
    })
    if (!layout || localFrame < layout.frames.frameStart || localFrame > layout.frames.frameEnd) continue
    const columnIndex = layout.columns.findIndex(column => column.timelineLaneId === laneId)
    if (columnIndex < 0) continue
    const rect = sheetGridCellRect(layout, columnIndex, localFrame - layout.frames.frameStart)
    if (rect) return { pageId: `page_${pageIndex + 1}`, rect }
  }
  throw new Error(`template SOUND hit not found: ${laneId} ${frame}`)
}

async function waitForClipStarts(expected: Array<[string, number]>): Promise<void> {
  await h().waitFor(async () => {
    const byId = new Map((await clips()).map(item => [item.clipId, item]))
    return expected.every(([clipId, frameStart]) => byId.get(clipId)?.frameStart === frameStart)
  }, 5_000, `clip starts ${JSON.stringify(expected)}`)
}

async function waitForRegion(segmentId: string, frameStart: number, frameEnd: number): Promise<SegmentSnapshot> {
  return h().waitFor(async () => {
    const region = (await segments('region')).find(item => item.segmentId === segmentId)
    return region?.frameStart === frameStart && region.frameEnd === frameEnd ? region : null
  }, 8_000, `region ${segmentId} ${frameStart}-${frameEnd}`)
}

async function waitForCue(cueId: string, frameStart: number, frameEnd: number): Promise<SoundCueSnapshot> {
  return h().waitFor(async () => {
    const cue = (await soundCues()).find(item => item.cueId === cueId)
    return cue?.frameStart === frameStart && cue.frameEnd === frameEnd ? cue : null
  }, 8_000, `SOUND ${cueId} ${frameStart}-${frameEnd}`)
}

async function audioRoot(): Promise<AudioRootSnapshot> {
  return h().evaluate<AudioRootSnapshot>(`
    (() => {
      const root = document.querySelector('.dialogueAudioTimeline:not(.isCollapsed)');
      if (!(root instanceof HTMLElement)) throw new Error('expanded audio timeline missing');
      const contentEnd = Number(root.dataset.audioContentEndFrame);
      return {
        frameOrigin: Number(root.dataset.frameOrigin),
        cutDurationFrames: Number(root.dataset.cutDurationFrames),
        timelineDurationFrames: Number(root.dataset.timelineDurationFrames),
        audioContentEndFrame: Number.isFinite(contentEnd) && root.dataset.audioContentEndFrame ? contentEnd : null,
        vadEngine: root.dataset.vadEngine ?? '',
        activeTrackId: root.dataset.activeTrackId ?? '',
      };
    })()
  `)
}

async function clips(): Promise<ClipSnapshot[]> {
  return h().evaluate<ClipSnapshot[]>(`
    Array.from(document.querySelectorAll('.dialogueAudioClipHandle')).map(item => ({
      trackId: item.dataset.trackId ?? '',
      clipId: item.dataset.clipId ?? '',
      sourceName: item.dataset.sourceName ?? '',
      frameStart: Number(item.dataset.frameStart),
      frameEnd: Number(item.dataset.frameEnd),
      selected: item.classList.contains('isSelected'),
    }))
  `)
}

async function segments(kind?: 'candidate' | 'region'): Promise<SegmentSnapshot[]> {
  const all = await h().evaluate<SegmentSnapshot[]>(`
    Array.from(document.querySelectorAll('.dialogueSpeechSegment')).map(item => ({
      kind: item.dataset.segmentKind,
      trackId: item.dataset.trackId ?? '',
      segmentId: item.dataset.segmentId ?? '',
      frameStart: Number(item.dataset.frameStart),
      frameEnd: Number(item.dataset.frameEnd),
      linked: item.dataset.linked === 'true',
      label: item.getAttribute('aria-label') ?? '',
    }))
  `)
  return kind ? all.filter(item => item.kind === kind) : all
}

async function soundCues(): Promise<SoundCueSnapshot[]> {
  return h().evaluate<SoundCueSnapshot[]>(`
    Array.from(document.querySelectorAll('.soundCue')).map(item => ({
      cueId: item.dataset.soundCueId ?? '',
      laneId: item.dataset.soundLaneId ?? '',
      frameStart: Number(item.dataset.frameStart),
      frameEnd: Number(item.dataset.frameEnd),
      label: item.getAttribute('aria-label') ?? item.textContent ?? '',
    }))
  `)
}

async function modelSnapshot(): Promise<Record<string, unknown>> {
  return {
    root: await audioRoot(),
    clips: await clips(),
    segments: await segments(),
    soundCues: await soundCues(),
    playheadFrame: await playheadFrame(),
  }
}

async function contentAndViewportWidth(): Promise<{ content: number; viewport: number }> {
  return h().evaluate<{ content: number; viewport: number }>(`
    (() => {
      const content = document.querySelector('.dialogueAudioContent');
      const viewport = document.querySelector('.dialogueAudioScroller');
      return {
        content: content?.getBoundingClientRect().width ?? 0,
        viewport: viewport?.getBoundingClientRect().width ?? 0,
      };
    })()
  `)
}

function clipSelector(clipId: string): string {
  return `.dialogueAudioClipHandle[data-clip-id="${cssEscape(clipId)}"]`
}

function segmentSelector(segment: Pick<SegmentSnapshot, 'kind' | 'segmentId'>): string {
  return `.dialogueSpeechSegment[data-segment-kind="${segment.kind}"][data-segment-id="${cssEscape(segment.segmentId)}"]`
}

function soundCueBodySelector(cue: Pick<SoundCueSnapshot, 'cueId'>): string {
  return `.soundCue[data-sound-cue-id="${cssEscape(cue.cueId)}"] .soundCueBody`
}

function h(): DesktopCdpHarness {
  if (!harness) throw new Error('CDP harness is not connected')
  return harness
}

function parseScenarioId(value: string | undefined): ScenarioId {
  if (value && (scenarioIds as readonly string[]).includes(value)) return value as ScenarioId
  throw new Error(`--scenario must be one of: ${scenarioIds.join(', ')}`)
}

function parseArgs(raw: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let index = 0; index < raw.length; index += 1) {
    if (!raw[index].startsWith('--')) continue
    result[raw[index].slice(2)] = raw[index + 1] ?? ''
    index += 1
  }
  return result
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
