import type { CutMetadataFieldId } from './types'
import { createAlphabeticTrackLabels, createPaperTrackColumns } from './sheet-template-layout'
import { NormalizedRect, SHEET_TEMPLATE_SCHEMA_VERSION, SheetTemplate, SheetTemplateFieldDefinition, SheetTemplateFormCell, SheetTemplateFrameProjection, SheetTemplateGridLineStyleRule, SheetTemplateGridRowLineRule, SheetTemplateGridTypography, SheetTemplatePreset, SheetTemplatePresetCapability, SheetTemplateRegion, SheetTemplateTextStyle, SheetTemplateTrackProjection, SheetTemplateUnderlay } from './sheet-template-schema'

export const standardA3DefaultPaperTracks = createAlphabeticTrackLabels(9)

const cellColumns = createPaperTrackColumns('cell', standardA3DefaultPaperTracks)

const actionColumns = createPaperTrackColumns('action', standardA3DefaultPaperTracks)

const soundColumns = Array.from({ length: 4 }, (_, index) => ({
  columnId: `sound_${index + 1}`,
  label: '',
  timelineLaneId: `sound_lane_${index + 1}`,
  xdtsEligible: false,
}))

const cameraColumns = Array.from({ length: 6 }, (_, index) => ({
  columnId: `camera_${index + 1}`,
  label: '',
  timelineLaneId: `camera_lane_${index + 1}`,
  xdtsEligible: false,
}))

const STANDARD_A3_PAGE_WIDTH_PX = 1754

const STANDARD_A3_PAGE_HEIGHT_PX = 2481

const STANDARD_24_FPS_ROW_LINE_RULES: SheetTemplateGridRowLineRule[] = [
  { every: 24, weight: 'strong' },
  { every: 12, weight: 'medium' },
  { every: 6, weight: 'regular' },
]

const STANDARD_A3_TIMING_GRID_TYPOGRAPHY: SheetTemplateGridTypography = {
  cellFontSizePx: 18,
  cellMinFontSizePx: 6,
  cellFontWeight: 800,
  shrinkToFit: false,
}

const STANDARD_A3_METADATA_TEXT_STYLE: SheetTemplateTextStyle = {
  fontSizePx: 24,
  minFontSizePx: 12,
  fontWeight: 700,
  horizontalAlign: 'center',
  verticalAlign: 'middle',
  paddingPx: 8,
  shrinkToFit: true,
}

const STANDARD_A3_GRID_HEADER = { topOffsetPx: 71, heightPx: 48, columnHeightPx: 23 }

const STANDARD_A3_FORM_BORDER = { weight: 'thin' as const, pattern: 'solid' as const, color: '#2f3430', widthPx: 1 }

const STANDARD_A3_SOUND_LINE_STYLE = { pattern: 'dotted' as const, widthPx: 1, color: '#727872' }

const STANDARD_A3_SOUND_LINE_RULES: SheetTemplateGridLineStyleRule[] = [
  { axis: 'column', target: 'all', style: STANDARD_A3_SOUND_LINE_STYLE },
  {
    axis: 'row',
    target: 'all',
    spans: [
      { startBoundary: 0, endBoundary: 1 },
      { startBoundary: 3, endBoundary: 4 },
    ],
    style: STANDARD_A3_SOUND_LINE_STYLE,
  },
]

const STANDARD_A3_RESERVE_LINE_RULES: SheetTemplateGridLineStyleRule[] = [
  {
    axis: 'row',
    target: 'inner',
    style: { pattern: 'dotted', widthPx: 1, color: '#727872' },
  },
  {
    axis: 'row',
    target: 'outer',
    style: STANDARD_A3_FORM_BORDER,
  },
  {
    axis: 'column',
    target: 'outer',
    style: STANDARD_A3_FORM_BORDER,
  },
]

const STANDARD_A3_PROCESS_FIELDS: SheetTemplateFieldDefinition[] = [
  ['process.original', '原図', 'revision', 'text'],
  ['process.direction.rough', '演出（前）', 'revision', 'text'],
  ['process.supervision.rough', '監督（前）', 'revision', 'text'],
  ['process.animationDirector.rough', '作監（前）', 'revision', 'text'],
  ['process.chiefAnimationDirector.rough', '総作監（前）', 'revision', 'text'],
  ['process.direction.final', '演出', 'revision', 'text'],
  ['process.supervision.final', '監督', 'revision', 'text'],
  ['process.animationDirector.final', '作監', 'revision', 'text'],
  ['process.chiefAnimationDirector.final', '総作監', 'revision', 'text'],
  ['process.videoCheck', '動画検査', 'revision', 'text'],
  ['process.colorDesign', '色指定', 'revision', 'text'],
  ['process.colorCheck', '色検査', 'revision', 'text'],
  ['material.cgCell', 'CGセル', 'revision', 'text'],
  ['material.cgBg', 'CG BG', 'revision', 'text'],
  ['effect.2d', '2D', 'revision', 'text'],
  ['effect.special', '特効', 'revision', 'text'],
  ['output.sizeX', 'サイズ X', 'cut', 'number'],
  ['output.sizeY', 'サイズ Y', 'cut', 'number'],
  ['output.dpi', '解像度 DPI', 'cut', 'number'],
].map(([fieldId, label, scope, valueType]) => ({ fieldId, label, scope, valueType } as SheetTemplateFieldDefinition))

function formLabelCell(
  cellId: string,
  row: number,
  column: number,
  label: string,
  columnSpan = 1,
  textStyle: SheetTemplateTextStyle = { fontSizePx: 10, minFontSizePx: 7, fontWeight: 700, horizontalAlign: 'center', verticalAlign: 'middle', paddingPx: 2, shrinkToFit: true },
): SheetTemplateFormCell {
  return { cellId, row, column, columnSpan, kind: 'label', label, textStyle }
}

function formFieldCell(cellId: string, row: number, column: number, fieldId: string, columnSpan = 1): SheetTemplateFormCell {
  return {
    cellId,
    row,
    column,
    columnSpan,
    kind: 'field',
    fieldId,
    textStyle: { fontSizePx: 13, minFontSizePx: 7, fontWeight: 700, horizontalAlign: 'center', verticalAlign: 'middle', paddingPx: 2, shrinkToFit: true },
  }
}

function standardA3Rect(x: number, y: number, w: number, h: number): NormalizedRect {
  return {
    x: x / STANDARD_A3_PAGE_WIDTH_PX,
    y: y / STANDARD_A3_PAGE_HEIGHT_PX,
    w: w / STANDARD_A3_PAGE_WIDTH_PX,
    h: h / STANDARD_A3_PAGE_HEIGHT_PX,
  }
}

function metadataFieldRegion(
  regionId: string,
  label: string,
  field: CutMetadataFieldId,
  rect: NormalizedRect,
  textStyle: SheetTemplateTextStyle = {
    fontSizePx: 22,
    minFontSizePx: 11,
    fontWeight: 700,
    horizontalAlign: 'center',
    verticalAlign: 'middle',
    paddingPx: 8,
    shrinkToFit: true,
  },
): SheetTemplateRegion {
  return {
    regionId,
    type: 'metadata-field',
    label,
    rect,
    usage: 'input',
    inputKind: 'text',
    binding: { target: 'cut-metadata', field },
    textStyle,
  }
}

function sharedCutNumbersRegion(
  regionId: string,
  rect: NormalizedRect,
  textStyle: SheetTemplateTextStyle,
): SheetTemplateRegion {
  return {
    regionId,
    type: 'metadata-field',
    label: '兼用カット',
    rect,
    usage: 'render-only',
    inputKind: 'text',
    binding: {
      target: 'cut-group',
      field: 'shared-cut-numbers',
      opening: '[',
      closing: ']',
      separator: '・',
    },
    textStyle,
  }
}

export const standardA3DefaultUnderlay: SheetTemplateUnderlay = {
  sourceId: 'sheet_source_standard_a3_default_underlay',
  label: 'A3標準タイムシート',
  assetPath: 'templates/standard-a3/timesheet.png',
  imageRef: {
    name: 'timesheet.png',
    size: 153481,
    assetPath: 'templates/standard-a3/timesheet.png',
    pixelWidth: STANDARD_A3_PAGE_WIDTH_PX,
    pixelHeight: STANDARD_A3_PAGE_HEIGHT_PX,
    ppiX: 150.0124,
    ppiY: 150.0124,
  },
  placement: {
    mode: 'pixel-exact',
    sourceWidthPx: STANDARD_A3_PAGE_WIDTH_PX,
    sourceHeightPx: STANDARD_A3_PAGE_HEIGHT_PX,
    offsetXPx: 0,
    offsetYPx: 0,
    renderedWidthPx: STANDARD_A3_PAGE_WIDTH_PX,
    renderedHeightPx: STANDARD_A3_PAGE_HEIGHT_PX,
    ppiX: 150.0124,
    ppiY: 150.0124,
  },
}

export const standardA3SheetTemplate: SheetTemplate = {
  schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
  templateId: 'standard-a3-timesheet-v2',
  name: 'A3標準',
  templateKind: 'japanese-a3-paper',
  layoutMode: 'fixed-page',
  defaultUnderlay: standardA3DefaultUnderlay,
  defaultUnderlayUsage: 'reference-only',
  style: {
    outerFrame: { visible: false },
    bottomTrackLabels: {
      visible: true,
    },
    secondCounter: {
      visible: true,
    },
    gridHeader: {
      labelOverrides: {
        action: 'ACTION',
        sound: '',
        cell: 'CELL',
        camera: 'CAMERA',
      },
    },
    bgBookLabel: {
      baseOffsetMm: 4.74,
      lanePitchMm: 3.39,
      labelHeightMm: 2.37,
      fontSizePt: 5.04,
      minWidthMm: 3.73,
      maxWidthMm: 12.87,
      pageMarginMm: 1.02,
      poleGapMm: 0.34,
      textPaddingMm: 0.51,
      connectorStrokeMm: 0.67,
      estimatedCharWidthMm: 1.02,
      radiusMm: 0.34,
    },
  },
  calibration: {
    targetRect: standardA3Rect(35, 637, 1683, 1772),
  },
  viewLayout: {
    type: 'paged',
    framesPerPage: 144,
    defaultViewMode: 'continuous',
    workRange: {
      supportsPreRoll: true,
      supportsPostRoll: true,
      preRollFrames: 24,
      postRollFrames: 0,
      showPreRoll: false,
      showPostRoll: true,
    },
    frameAxis: {
      type: 'paged',
      framesPerPage: 144,
      overflow: 'paginate',
    },
    trackAxis: {
      type: 'fixed-slots',
      overflow: 'hidden',
    },
    surface: {
      type: 'fixed-page',
    },
  },
  page: {
    widthPx: STANDARD_A3_PAGE_WIDTH_PX,
    heightPx: STANDARD_A3_PAGE_HEIGHT_PX,
    dpi: 150,
    isPhysical: true,
    format: 'A3',
    orientation: 'portrait',
    coordinateSpace: 'normalized',
  },
  annotationDefaults: {
    timelineMemo: { defaultWidthMm: 35, singleFrameHeightFrames: 12 },
  },
  defaults: {
    fps: 24,
    durationFrames: 144,
    frameOrigin: 1,
    paperTracks: standardA3DefaultPaperTracks,
  },
  fields: [
    ...STANDARD_A3_PROCESS_FIELDS,
    { fieldId: 'memo.body', label: 'MEMO', scope: 'page', valueType: 'multiline' },
  ],
  regions: [
    {
      regionId: 'top_process_check_area',
      type: 'form-table',
      label: '工程チェック欄',
      rect: standardA3Rect(35, 47, 1598, 71),
      usage: 'input',
      inputKind: 'text',
      form: {
        columns: [57, 57, 57, 58, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57, 57.5, 57.5, 71, 71, 143],
        rows: [23, 48],
        fillEmptyCells: true,
        borderStyle: STANDARD_A3_FORM_BORDER,
        cells: [
          formLabelCell('process_label_original', 0, 0, '原図'),
          formLabelCell('process_label_direction_rough', 0, 2, '演出'),
          formLabelCell('process_label_supervision_rough', 0, 3, '監督'),
          formLabelCell('process_label_animation_director_rough', 0, 4, '作監'),
          formLabelCell('process_label_chief_animation_director_rough', 0, 5, '総作監'),
          formLabelCell('process_label_direction_final', 0, 10, '演出'),
          formLabelCell('process_label_supervision_final', 0, 11, '監督'),
          formLabelCell('process_label_animation_director_final', 0, 12, '作監'),
          formLabelCell('process_label_chief_animation_director_final', 0, 13, '総作監'),
          formLabelCell('process_label_video_check', 0, 15, '動画検査', 2),
          formLabelCell('process_label_color', 0, 17, '色指定・検査', 2),
          formLabelCell('process_label_cg', 0, 19, 'CG素材', 2),
          formLabelCell('process_label_effect', 0, 21, '2D・特効', 2),
          formLabelCell('process_label_size', 0, 23, 'サイズ', 2),
          formLabelCell('process_label_dpi', 0, 25, '解像度'),
          formFieldCell('process_field_original', 1, 0, 'process.original'),
          formFieldCell('process_field_direction_rough', 1, 2, 'process.direction.rough'),
          formFieldCell('process_field_supervision_rough', 1, 3, 'process.supervision.rough'),
          formFieldCell('process_field_animation_director_rough', 1, 4, 'process.animationDirector.rough'),
          formFieldCell('process_field_chief_animation_director_rough', 1, 5, 'process.chiefAnimationDirector.rough'),
          formFieldCell('process_field_direction_final', 1, 10, 'process.direction.final'),
          formFieldCell('process_field_supervision_final', 1, 11, 'process.supervision.final'),
          formFieldCell('process_field_animation_director_final', 1, 12, 'process.animationDirector.final'),
          formFieldCell('process_field_chief_animation_director_final', 1, 13, 'process.chiefAnimationDirector.final'),
          formFieldCell('process_field_video_check', 1, 15, 'process.videoCheck', 2),
          formFieldCell('process_field_color_design', 1, 17, 'process.colorDesign'),
          formFieldCell('process_field_color_check', 1, 18, 'process.colorCheck'),
          formFieldCell('process_field_cg_cell', 1, 19, 'material.cgCell'),
          formFieldCell('process_field_cg_bg', 1, 20, 'material.cgBg'),
          formFieldCell('process_field_2d', 1, 21, 'effect.2d'),
          formFieldCell('process_field_special', 1, 22, 'effect.special'),
          formFieldCell('process_field_size_x', 1, 23, 'output.sizeX'),
          formFieldCell('process_field_size_y', 1, 24, 'output.sizeY'),
          formFieldCell('process_field_dpi', 1, 25, 'output.dpi'),
        ],
      },
    },
    {
      regionId: 'top_metadata_form',
      type: 'form-table',
      label: 'カット情報見出し',
      rect: standardA3Rect(35, 141, 1683, 95),
      usage: 'render-only',
      form: {
        columns: [656, 172, 171, 256, 257, 171],
        rows: [24, 71],
        fillEmptyCells: true,
        borderStyle: STANDARD_A3_FORM_BORDER,
        cells: [
          formLabelCell('metadata_label_title', 0, 0, 'TITLE'),
          formLabelCell('metadata_label_episode', 0, 1, 'NO.'),
          formLabelCell('metadata_label_cut', 0, 2, 'CUT'),
          formLabelCell('metadata_label_time', 0, 3, 'TIME'),
          formLabelCell('metadata_label_worker', 0, 4, 'NAME'),
          formLabelCell('metadata_label_page', 0, 5, 'PAGE'),
          ...Array.from({ length: 6 }, (_, column) => ({ cellId: `metadata_value_${column}`, row: 1, column, kind: 'spacer' as const })),
        ],
      },
    },
    metadataFieldRegion('top_title_field', 'タイトル', 'title', standardA3Rect(35, 165, 656, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    metadataFieldRegion('top_episode_field', '話数', 'episode', standardA3Rect(691, 165, 172, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    {
      ...metadataFieldRegion('top_cut_field', 'カット', 'cut', standardA3Rect(863, 165, 171, 71), STANDARD_A3_METADATA_TEXT_STYLE),
      textStyleVariants: {
        sharedCutNumbersVisible: {
          verticalAlign: 'top',
          paddingPx: 5,
        },
      },
    },
    sharedCutNumbersRegion('top_shared_cut_numbers_field', standardA3Rect(863, 198, 171, 38), {
      fontSizePx: 13,
      minFontSizePx: 8,
      lineHeightPx: 15,
      fontWeight: 700,
      horizontalAlign: 'center',
      verticalAlign: 'top',
      paddingPx: 2,
      shrinkToFit: true,
    }),
    metadataFieldRegion('top_duration_field', '尺', 'duration', standardA3Rect(1034, 165, 256, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    metadataFieldRegion('top_worker_field', '作業者', 'worker', standardA3Rect(1290, 165, 257, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    metadataFieldRegion('top_page_field', 'ページ', 'page', standardA3Rect(1547, 165, 171, 71), STANDARD_A3_METADATA_TEXT_STYLE),
    {
      regionId: 'top_memo_area',
      type: 'memo-area',
      label: 'MEMO',
      rect: standardA3Rect(35, 259, 1113, 331),
      usage: 'input',
      inputKind: 'text',
      form: {
        columns: [1],
        rows: [24, 307],
        cells: [{
          ...formLabelCell('memo_label', 0, 0, 'MEMO', 1, { fontSizePx: 10, fontWeight: 700, horizontalAlign: 'left', verticalAlign: 'middle', paddingPx: 2 }),
          border: false,
        }, {
          cellId: 'memo_body',
          row: 1,
          column: 0,
          kind: 'field',
          fieldId: 'memo.body',
          border: false,
          editPresentation: 'inline',
          textStyle: {
            fontSizePx: 16,
            minFontSizePx: 10,
            lineHeightPx: 20,
            fontWeight: 400,
            horizontalAlign: 'left',
            verticalAlign: 'top',
            paddingPx: 8,
            shrinkToFit: true,
          },
        }],
      },
    },
    {
      regionId: 'top_shooting_notes_area',
      type: 'annotation-area',
      label: '撮影画面処理',
      rect: standardA3Rect(1148, 259, 200, 331),
      usage: 'reference',
      inputKind: 'annotation',
      binding: {
        target: 'annotation-layer',
        layerId: 'camera-note',
        intent: 'camera-note',
      },
      form: {
        columns: [200],
        rows: [24, 118, 47, 118, 24],
        borderStyle: STANDARD_A3_FORM_BORDER,
        cells: [
          { ...formLabelCell('shooting_notes_label', 0, 0, '撮影画面処理', 1, { fontSizePx: 10, fontWeight: 700, horizontalAlign: 'left', verticalAlign: 'middle', paddingPx: 2 }), border: false },
          { cellId: 'shooting_notes_box_1', row: 1, column: 0, kind: 'annotation' },
          { cellId: 'shooting_notes_box_2', row: 3, column: 0, kind: 'annotation' },
        ],
      },
    },
    {
      regionId: 'top_count_table_area',
      type: 'count-table',
      label: '二原・動画・ペイント集計',
      rect: standardA3Rect(1405, 259, 313, 331),
      usage: 'input',
      inputKind: 'number',
      form: {
        columns: [57, 85, 86, 85],
        rows: [24, 47, 24, 23, 24, 24, 23, 24, 24, 23, 47],
        borderStyle: STANDARD_A3_FORM_BORDER,
        projection: {
          source: 'logical-paper-tracks',
          nameLabel: 'NAME',
          totalLabel: '計',
          fieldPrefix: 'count',
          scope: 'revision',
          columns: [
            { columnId: 'secondary', label: '二原', fieldSuffix: 'secondary' },
            { columnId: 'video', label: '動画', fieldSuffix: 'video' },
            { columnId: 'paint', label: 'ペイント', fieldSuffix: 'paint' },
          ],
        },
      },
    },
    {
      regionId: 'main_grid_outer_frame',
      type: 'form-table',
      label: 'タイムライン外枠',
      rect: standardA3Rect(35, 637, 1683, 1772),
      usage: 'render-only',
      form: {
        columns: [1],
        rows: [1],
        borderStyle: STANDARD_A3_FORM_BORDER,
        cells: [{ cellId: 'main_grid_outer_box', row: 0, column: 0, kind: 'spacer' }],
      },
    },
    {
      regionId: 'left_action_reserve_grid',
      type: 'decorative',
      label: '予備列 1-72',
      rect: standardA3Rect(35, 708, 29, 1701),
      usage: 'render-only',
      grid: {
        role: 'other',
        frameStart: 1,
        frameEnd: 72,
        rowCount: 72,
        lineRules: STANDARD_A3_RESERVE_LINE_RULES,
        columns: [{ columnId: 'left_action_reserve', label: '' }],
      },
    },
    {
      regionId: 'left_action_grid',
      type: 'exposure-grid',
      label: 'ACTION 1-72',
      rect: standardA3Rect(64, 708, 257, 1701),
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_action',
      grid: { role: 'action', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: actionColumns },
    },
    {
      regionId: 'left_sound_grid',
      type: 'exposure-grid',
      label: 'SOUND 1-72',
      rect: standardA3Rect(321, 708, 114, 1701),
      usage: 'input',
      inputKind: 'dialogue',
      inputMode: 'timed-range',
      flowGroupId: 'main_sound',
      grid: { role: 'sound', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, lineRules: STANDARD_A3_SOUND_LINE_RULES, columns: soundColumns },
    },
    {
      regionId: 'left_cell_grid',
      type: 'exposure-grid',
      label: 'CELL 1-72',
      rect: { x: 0.248, y: 0.2854, w: 0.146, h: 0.6856 },
      usage: 'input',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_cell',
      grid: { role: 'cell', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: cellColumns },
    },
    {
      regionId: 'left_camera_grid',
      type: 'exposure-grid',
      label: 'CAMERA 1-72',
      rect: { x: 0.394, y: 0.2854, w: 0.0981, h: 0.6856 },
      usage: 'input',
      inputKind: 'camera',
      inputMode: 'timed-range',
      flowGroupId: 'main_camera',
      grid: { role: 'camera', frameStart: 1, frameEnd: 72, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, columns: cameraColumns },
    },
    {
      regionId: 'right_action_reserve_grid',
      type: 'decorative',
      label: '予備列 73-144',
      rect: standardA3Rect(891, 708, 29, 1701),
      usage: 'render-only',
      grid: {
        role: 'other',
        frameStart: 73,
        frameEnd: 144,
        rowCount: 72,
        lineRules: STANDARD_A3_RESERVE_LINE_RULES,
        columns: [{ columnId: 'right_action_reserve', label: '' }],
      },
    },
    {
      regionId: 'right_action_grid',
      type: 'exposure-grid',
      label: 'ACTION 73-144',
      rect: standardA3Rect(920, 708, 256, 1701),
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_action',
      grid: { role: 'action', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: actionColumns },
    },
    {
      regionId: 'right_sound_grid',
      type: 'exposure-grid',
      label: 'SOUND 73-144',
      rect: standardA3Rect(1176, 708, 114, 1701),
      usage: 'input',
      inputKind: 'dialogue',
      inputMode: 'timed-range',
      flowGroupId: 'main_sound',
      grid: { role: 'sound', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, lineRules: STANDARD_A3_SOUND_LINE_RULES, columns: soundColumns },
    },
    {
      regionId: 'right_cell_grid',
      type: 'exposure-grid',
      label: 'CELL 73-144',
      rect: { x: 0.7355, y: 0.2854, w: 0.1465, h: 0.6856 },
      usage: 'input',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'main_cell',
      grid: { role: 'cell', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, trackProjection: { source: 'logical-paper-tracks', startIndex: 0, overflow: 'hidden' }, typography: STANDARD_A3_TIMING_GRID_TYPOGRAPHY, columns: cellColumns },
    },
    {
      regionId: 'right_camera_grid',
      type: 'exposure-grid',
      label: 'CAMERA 73-144',
      rect: { x: 0.882, y: 0.2854, w: 0.0975, h: 0.6856 },
      usage: 'input',
      inputKind: 'camera',
      inputMode: 'timed-range',
      flowGroupId: 'main_camera',
      grid: { role: 'camera', frameStart: 73, frameEnd: 144, rowCount: 72, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, header: STANDARD_A3_GRID_HEADER, columns: cameraColumns },
    },
  ],
}

export const standardA3SheetTemplatePreset: SheetTemplatePreset = {
  presetId: 'standard-a3-default',
  name: 'A3標準',
  sheetTemplate: standardA3SheetTemplate,
  defaultUnderlay: standardA3DefaultUnderlay,
  source: 'built-in',
  capabilities: ['sheet-view', 'image-correction'],
}

const DIGITAL_STANDARD_PAGE_WIDTH_PX = 1920

const DIGITAL_STANDARD_PAGE_HEIGHT_PX = 3600

const DIGITAL_STANDARD_MARGIN_X_PX = 32

const DIGITAL_STANDARD_CONTENT_WIDTH_PX = DIGITAL_STANDARD_PAGE_WIDTH_PX - DIGITAL_STANDARD_MARGIN_X_PX * 2

const DIGITAL_STANDARD_GRID_TOP_PX = 620

const DIGITAL_STANDARD_GRID_HEIGHT_PX = 2880

function digitalRect(x: number, y: number, w: number, h: number): NormalizedRect {
  return {
    x: x / DIGITAL_STANDARD_PAGE_WIDTH_PX,
    y: y / DIGITAL_STANDARD_PAGE_HEIGHT_PX,
    w: w / DIGITAL_STANDARD_PAGE_WIDTH_PX,
    h: h / DIGITAL_STANDARD_PAGE_HEIGHT_PX,
  }
}

const digitalActionColumns = createPaperTrackColumns('action', standardA3DefaultPaperTracks)

const digitalCellColumns = createPaperTrackColumns('cell', standardA3DefaultPaperTracks)

const digitalSoundColumns = Array.from({ length: 4 }, (_, index) => ({
  columnId: `digital_sound_${index + 1}`,
  label: `S${index + 1}`,
  timelineLaneId: `sound_lane_${index + 1}`,
  xdtsEligible: false,
}))

const digitalCameraColumns = Array.from({ length: 4 }, (_, index) => ({
  columnId: `digital_camera_${index + 1}`,
  label: String(index + 1),
  timelineLaneId: `camera_lane_${index + 1}`,
  xdtsEligible: false,
}))

const digitalLogicalFrameProjection: SheetTemplateFrameProjection = {
  source: 'logical-frames',
  overflow: 'scroll',
}

const digitalLogicalPaperTrackProjection: SheetTemplateTrackProjection = {
  source: 'logical-paper-tracks',
  startIndex: 0,
  overflow: 'scroll',
}

const DIGITAL_STANDARD_TIMING_GRID_TYPOGRAPHY: SheetTemplateGridTypography = {
  cellFontSizePx: 18,
  cellMinFontSizePx: 6,
  cellFontWeight: 800,
  shrinkToFit: false,
}

export const digitalStandardSheetTemplate: SheetTemplate = {
  schemaVersion: SHEET_TEMPLATE_SCHEMA_VERSION,
  templateId: 'digital-standard-v2',
  name: 'デジタル標準',
  templateKind: 'digital-native',
  layoutMode: 'infinite-digital',
  style: {
    gridHeader: {
      labelOverrides: {
        action: 'ACTION',
        sound: 'SOUND',
        cell: 'CELL',
        camera: 'CAMERA',
      },
    },
    secondCounter: {
      visible: true,
    },
  },
  viewLayout: {
    type: 'infinite',
    defaultViewMode: 'continuous',
    workRange: {
      supportsPreRoll: true,
      supportsPostRoll: true,
      preRollFrames: 24,
      postRollFrames: 0,
      showPreRoll: false,
      showPostRoll: true,
    },
    frameAxis: {
      type: 'infinite',
      overflow: 'scroll',
    },
    trackAxis: {
      type: 'logical-width',
      overflow: 'scroll',
    },
    surface: {
      type: 'continuous-canvas',
    },
  },
  page: {
    widthPx: DIGITAL_STANDARD_PAGE_WIDTH_PX,
    heightPx: DIGITAL_STANDARD_PAGE_HEIGHT_PX,
    isPhysical: false,
    format: 'digital',
    orientation: 'portrait',
    coordinateSpace: 'normalized',
  },
  annotationDefaults: {
    timelineMemo: { defaultWidthPx: 225, singleFrameHeightFrames: 12 },
  },
  defaults: {
    fps: 24,
    durationFrames: 144,
    frameOrigin: 1,
    paperTracks: standardA3DefaultPaperTracks,
  },
  regions: [
    metadataFieldRegion('digital_title_field', 'タイトル', 'title', digitalRect(32, 54, 600, 60)),
    metadataFieldRegion('digital_episode_field', '話数', 'episode', digitalRect(644, 54, 160, 60)),
    metadataFieldRegion('digital_scene_field', 'シーン', 'scene', digitalRect(816, 54, 160, 60)),
    {
      ...metadataFieldRegion('digital_cut_field', 'カット', 'cut', digitalRect(988, 54, 160, 60)),
      textStyleVariants: {
        sharedCutNumbersVisible: {
          verticalAlign: 'top',
          paddingPx: 4,
        },
      },
    },
    sharedCutNumbersRegion('digital_shared_cut_numbers_field', digitalRect(988, 82, 160, 32), {
      fontSizePx: 12,
      minFontSizePx: 7,
      lineHeightPx: 14,
      fontWeight: 700,
      horizontalAlign: 'center',
      verticalAlign: 'top',
      paddingPx: 2,
      shrinkToFit: true,
    }),
    metadataFieldRegion('digital_duration_field', '尺', 'duration', digitalRect(1160, 54, 190, 60)),
    metadataFieldRegion('digital_worker_field', '作業者', 'worker', digitalRect(1362, 54, 300, 60)),
    metadataFieldRegion('digital_page_field', 'ページ', 'page', digitalRect(1674, 54, 214, 60)),
    {
      regionId: 'digital_memo_area',
      type: 'memo-area',
      label: 'MEMO',
      rect: digitalRect(DIGITAL_STANDARD_MARGIN_X_PX, 160, DIGITAL_STANDARD_CONTENT_WIDTH_PX, 300),
      usage: 'input',
      inputKind: 'annotation',
      inputMode: 'free-annotation',
      binding: {
        target: 'annotation-layer',
        layerId: 'memo',
        intent: 'memo',
      },
    },
    {
      regionId: 'digital_action_grid',
      type: 'exposure-grid',
      label: 'ACTION',
      rect: digitalRect(32, DIGITAL_STANDARD_GRID_TOP_PX, 420, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'reference',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'digital_action',
      grid: { role: 'action', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: digitalLogicalPaperTrackProjection, frameProjection: digitalLogicalFrameProjection, typography: DIGITAL_STANDARD_TIMING_GRID_TYPOGRAPHY, columns: digitalActionColumns },
    },
    {
      regionId: 'digital_sound_grid',
      type: 'exposure-grid',
      label: 'SOUND',
      rect: digitalRect(476, DIGITAL_STANDARD_GRID_TOP_PX, 220, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'input',
      inputKind: 'dialogue',
      inputMode: 'timed-range',
      flowGroupId: 'digital_sound',
      grid: { role: 'sound', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, frameProjection: digitalLogicalFrameProjection, columns: digitalSoundColumns },
    },
    {
      regionId: 'digital_cell_grid',
      type: 'exposure-grid',
      label: 'CELL',
      rect: digitalRect(720, DIGITAL_STANDARD_GRID_TOP_PX, 800, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'input',
      inputKind: 'timing-event',
      inputMode: 'point-event',
      flowGroupId: 'digital_cell',
      grid: { role: 'cell', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, trackProjection: digitalLogicalPaperTrackProjection, frameProjection: digitalLogicalFrameProjection, typography: DIGITAL_STANDARD_TIMING_GRID_TYPOGRAPHY, columns: digitalCellColumns },
    },
    {
      regionId: 'digital_camera_grid',
      type: 'exposure-grid',
      label: 'CAMERA',
      rect: digitalRect(1544, DIGITAL_STANDARD_GRID_TOP_PX, 344, DIGITAL_STANDARD_GRID_HEIGHT_PX),
      usage: 'input',
      inputKind: 'camera',
      inputMode: 'timed-range',
      flowGroupId: 'digital_camera',
      grid: { role: 'camera', frameStart: 1, rowCount: 144, majorLineEvery: 6, pageBreakEvery: 24, rowLineRules: STANDARD_24_FPS_ROW_LINE_RULES, frameProjection: digitalLogicalFrameProjection, columns: digitalCameraColumns },
    },
  ],
}

export const digitalStandardSheetTemplatePreset: SheetTemplatePreset = {
  presetId: 'digital-standard',
  name: 'デジタル標準',
  sheetTemplate: digitalStandardSheetTemplate,
  source: 'built-in',
  capabilities: ['sheet-view'],
}

export const sheetTemplatePresets: SheetTemplatePreset[] = [standardA3SheetTemplatePreset, digitalStandardSheetTemplatePreset]

export function sheetTemplatePresetsForCapability(
  capability: SheetTemplatePresetCapability,
  presets: readonly SheetTemplatePreset[] = sheetTemplatePresets,
): SheetTemplatePreset[] {
  return presets.filter(preset => sheetTemplatePresetSupportsCapability(preset, capability))
}

export function sheetTemplatePresetsForImageCorrection(
  presets: readonly SheetTemplatePreset[] = sheetTemplatePresets,
): SheetTemplatePreset[] {
  return sheetTemplatePresetsForCapability('image-correction', presets)
}

export function sheetTemplatePresetSupportsCapability(
  preset: SheetTemplatePreset,
  capability: SheetTemplatePresetCapability,
): boolean {
  return (preset.capabilities ?? defaultSheetTemplatePresetCapabilities(preset.sheetTemplate)).includes(capability)
}

export function defaultSheetTemplatePresetCapabilities(template: SheetTemplate): SheetTemplatePresetCapability[] {
  const capabilities: SheetTemplatePresetCapability[] = ['sheet-view']
  if (isSheetTemplateImageCorrectionCapable(template)) capabilities.push('image-correction')
  return capabilities
}

export function isSheetTemplateImageCorrectionCapable(
  template: Pick<SheetTemplate, 'defaultUnderlay' | 'calibration' | 'page' | 'regions'>,
): boolean {
  return Boolean(
    template.defaultUnderlay
      && template.page.widthPx > 0
      && template.page.heightPx > 0
      && (template.calibration?.targetRect || template.regions.some(region => region.type === 'exposure-grid' && region.grid)),
  )
}
