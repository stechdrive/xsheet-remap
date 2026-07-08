from __future__ import annotations

import json
import os
from dataclasses import dataclass
from dataclasses import replace
from pathlib import Path
from typing import Any

from .automation import AutomationError
from .profile import (
    Point,
    Rect,
    WorkspaceProfile,
    save_workspace_profile,
    scale_profile_to_window,
    workspace_profile_name_base,
)
from .vision import (
    OcrLine,
    VisionError,
    find_import_stack_anchor,
    normalize_csp_name_text,
    recognize_csp_layer_palette_text_lines,
    recognize_csp_ui_text_lines,
)


@dataclass(frozen=True)
class ProfileCalibrationResult:
    profile: WorkspaceProfile
    profile_path: Path | None
    csp_title: str
    csp_rect: Rect
    used_ocr_anchors: bool
    top_menu_ocr_line_count: int
    right_panel_ocr_line_count: int
    timeline_panel_ocr_line_count: int
    layer_palette_ocr_line_count: int
    import_stack_marker: str | None
    import_stack_text: str | None
    warning: str | None = None

    def to_json_dict(self) -> dict[str, object]:
        return {
            "profilePath": str(self.profile_path) if self.profile_path is not None else None,
            "cspTitle": self.csp_title,
            "cspRect": self.csp_rect.__dict__,
            "profile": self.profile.to_json_dict(),
            "usedOcrAnchors": self.used_ocr_anchors,
            "topMenuOcrLineCount": self.top_menu_ocr_line_count,
            "rightPanelOcrLineCount": self.right_panel_ocr_line_count,
            "timelinePanelOcrLineCount": self.timeline_panel_ocr_line_count,
            "layerPaletteOcrLineCount": self.layer_palette_ocr_line_count,
            "importStackMarker": self.import_stack_marker,
            "importStackText": self.import_stack_text,
            "warning": self.warning,
        }


@dataclass(frozen=True)
class OcrProfileCalibration:
    profile: WorkspaceProfile
    top_menu_lines: tuple[OcrLine, ...]
    right_panel_lines: tuple[OcrLine, ...]
    timeline_panel_lines: tuple[OcrLine, ...]
    used_ocr_anchors: bool


def calibrate_profile_from_csp_window(
    base_profile: WorkspaceProfile,
    *,
    save_path: str | Path | None = None,
    save: bool = True,
    start_separator: str = "===== XSHEET IMPORT START =====",
    end_separator: str = "===== XSHEET IMPORT END =====",
) -> ProfileCalibrationResult:
    csp_title, csp_rect = _read_csp_window_rect(base_profile)
    window_image = _capture_screen_rect(csp_rect)
    ocr_calibration = calibrate_profile_from_window_image(base_profile, csp_rect, window_image)
    profile = ocr_calibration.profile
    ocr_line_count = 0
    marker_kind: str | None = None
    marker_text: str | None = None
    warning: str | None = None

    try:
        palette = _capture_screen_rect(profile.layer_palette)
        lines = recognize_csp_layer_palette_text_lines(palette)
        ocr_line_count = len(lines)
        marker = find_import_stack_anchor(lines, start_separator, end_separator)
        if marker is not None:
            marker_kind = marker.kind
            marker_text = marker.line.text
    except (AutomationError, VisionError) as exc:
        warning = f"レイヤーパレットOCR確認に失敗しました: {exc}"

    profile_path = save_workspace_profile(profile, save_path) if save else None
    if warning is None and not ocr_calibration.used_ocr_anchors:
        warning = (
            "CSPウィンドウは検出しましたが、上部メニューまたはレイヤーパレットのOCRアンカーを十分に取得できませんでした。"
            "全体スケールのprofileを保存しています。"
        )
    elif warning is None and ocr_line_count == 0:
        warning = "CSPウィンドウは検出しましたが、レイヤーパレットの文字を読み取れませんでした。"
    elif warning is None and ocr_line_count < 5:
        warning = (
            "CSPウィンドウに合わせたprofileは保存しましたが、レイヤーパレットOCRの行数が少ないため、"
            "ワークスペースやパレット位置を確認してください。"
        )

    return ProfileCalibrationResult(
        profile=profile,
        profile_path=profile_path,
        csp_title=csp_title,
        csp_rect=csp_rect,
        used_ocr_anchors=ocr_calibration.used_ocr_anchors,
        top_menu_ocr_line_count=len(ocr_calibration.top_menu_lines),
        right_panel_ocr_line_count=len(ocr_calibration.right_panel_lines),
        timeline_panel_ocr_line_count=len(ocr_calibration.timeline_panel_lines),
        layer_palette_ocr_line_count=ocr_line_count,
        import_stack_marker=marker_kind,
        import_stack_text=marker_text,
        warning=warning,
    )


def calibrate_profile_from_window_image(
    base_profile: WorkspaceProfile,
    csp_rect: Rect,
    window_image: Any,
) -> OcrProfileCalibration:
    """Build a profile for the current CSP window using OCR anchors.

    Fixed CSP workspaces are visually stable, but screen resolution and window
    size change absolute coordinates. Whole-window scaling is unreliable for
    docked palettes, so this keeps the profile's relative menu/palette offsets
    while using OCR to locate the current top menu and right-side layer panel.
    """

    fallback = scale_profile_to_window(base_profile, csp_rect)
    width, height = window_image.size
    top_crop_bottom = min(height, max(90, round(height * 0.08)))
    right_crop_left = min(width - 1, max(0, round(width * 0.48)))
    right_crop_bottom = min(height, max(180, round(height * 0.22)))

    top_menu_lines = _recognize_csp_window_crop(
        window_image,
        name="top-menu",
        crop_rect=(0, 0, width, top_crop_bottom),
        screen_left=csp_rect.left,
        screen_top=csp_rect.top,
        scale=2,
    )
    right_panel_lines = _recognize_csp_window_crop(
        window_image,
        name="right-panel",
        crop_rect=(right_crop_left, 0, width, right_crop_bottom),
        screen_left=csp_rect.left + right_crop_left,
        screen_top=csp_rect.top,
        scale=3,
    )
    preliminary_layer_palette = _infer_layer_palette_rect(base_profile, csp_rect, right_panel_lines)
    timeline_crop_top = top_crop_bottom
    timeline_crop_right = width
    if preliminary_layer_palette is not None:
        timeline_crop_right = min(width, max(1, preliminary_layer_palette.left - csp_rect.left))
    timeline_panel_lines = _recognize_csp_window_crop(
        window_image,
        name="timeline-panel",
        crop_rect=(0, timeline_crop_top, timeline_crop_right, height),
        screen_left=csp_rect.left,
        screen_top=csp_rect.top + timeline_crop_top,
        scale=2,
    )

    profile = _profile_from_ocr_lines(base_profile, csp_rect, top_menu_lines, right_panel_lines, timeline_panel_lines)
    if profile is None:
        return OcrProfileCalibration(
            profile=fallback,
            top_menu_lines=tuple(top_menu_lines),
            right_panel_lines=tuple(right_panel_lines),
            timeline_panel_lines=tuple(timeline_panel_lines),
            used_ocr_anchors=False,
        )
    return OcrProfileCalibration(
        profile=profile,
        top_menu_lines=tuple(top_menu_lines),
        right_panel_lines=tuple(right_panel_lines),
        timeline_panel_lines=tuple(timeline_panel_lines),
        used_ocr_anchors=True,
    )


def _profile_from_ocr_lines(
    base_profile: WorkspaceProfile,
    csp_rect: Rect,
    top_menu_lines: list[OcrLine],
    right_panel_lines: list[OcrLine],
    timeline_panel_lines: list[OcrLine],
) -> WorkspaceProfile | None:
    file_menu = _find_menu_point(top_menu_lines, ("ファイル", "FILE"))
    animation_menu = _find_menu_point(top_menu_lines, ("アニメーション", "ANIMATION"))
    preferred_menu_y = (
        round((file_menu.y + animation_menu.y) / 2)
        if file_menu is not None and animation_menu is not None
        else None
    )
    layer_menu = _find_menu_point(top_menu_lines, ("レイヤー", "レイヤ", "LAYER"), preferred_y=preferred_menu_y)
    layer_palette = _infer_layer_palette_rect(base_profile, csp_rect, right_panel_lines)
    if file_menu is None or animation_menu is None or layer_menu is None or layer_palette is None:
        return None
    timeline_palette = _infer_timeline_palette_rect(base_profile, csp_rect, timeline_panel_lines, layer_palette)
    if timeline_palette is None:
        timeline_palette = scale_profile_to_window(base_profile, csp_rect).timeline_palette

    ui_scale = _estimate_ui_scale(top_menu_lines)

    def menu_point(anchor: Point, reference_anchor: Point, reference_point: Point) -> Point:
        return Point(
            anchor.x + round((reference_point.x - reference_anchor.x) * ui_scale),
            anchor.y + round((reference_point.y - reference_anchor.y) * ui_scale),
        )

    def menu_rect(anchor: Point, reference_anchor: Point, reference_rect: Rect) -> Rect:
        return Rect(
            anchor.x + round((reference_rect.left - reference_anchor.x) * ui_scale),
            anchor.y + round((reference_rect.top - reference_anchor.y) * ui_scale),
            anchor.x + round((reference_rect.right - reference_anchor.x) * ui_scale),
            anchor.y + round((reference_rect.bottom - reference_anchor.y) * ui_scale),
        )

    palette_reference_top_delta = base_profile.first_stack_row_y - base_profile.layer_palette.top
    palette_reference_row_click_delta = base_profile.row_click_x - base_profile.layer_palette.left
    palette_reference_width = max(1, base_profile.layer_palette.right - base_profile.layer_palette.left)
    inferred_width = max(1, layer_palette.right - layer_palette.left)
    palette_scale_x = inferred_width / palette_reference_width

    return replace(
        base_profile,
        name=(
            f"{workspace_profile_name_base(base_profile.name)}"
            f"-ocr-calibrated-{csp_rect.right - csp_rect.left}x{csp_rect.bottom - csp_rect.top}"
        ),
        file_menu=file_menu,
        animation_menu=animation_menu,
        layer_menu=layer_menu,
        import_menu_row=menu_point(file_menu, base_profile.file_menu, base_profile.import_menu_row),
        import_image_item=menu_point(file_menu, base_profile.file_menu, base_profile.import_image_item),
        import_timesheet_item=menu_point(file_menu, base_profile.file_menu, base_profile.import_timesheet_item),
        rasterize_menu_item=menu_point(layer_menu, base_profile.layer_menu, base_profile.rasterize_menu_item),
        timeline_menu_row=menu_point(animation_menu, base_profile.animation_menu, base_profile.timeline_menu_row),
        timeline_enabled_check_rect=menu_rect(
            animation_menu,
            base_profile.animation_menu,
            base_profile.timeline_enabled_check_rect,
        ),
        blend_mode_dropdown=Point(
            layer_palette.left + round((base_profile.blend_mode_dropdown.x - base_profile.layer_palette.left) * palette_scale_x),
            layer_palette.top + round((base_profile.blend_mode_dropdown.y - base_profile.layer_palette.top) * ui_scale),
        ),
        layer_palette=layer_palette,
        timeline_palette=timeline_palette,
        first_stack_row_y=layer_palette.top + round(palette_reference_top_delta * ui_scale),
        row_click_x=layer_palette.left + round(palette_reference_row_click_delta * palette_scale_x),
        row_height=max(1, round(base_profile.row_height * ui_scale)),
        layer_palette_context_search_px=max(1, round(base_profile.layer_palette_context_search_px * ui_scale)),
        reference_window_rect=csp_rect,
    )


def _recognize_csp_window_crop(
    image: Any,
    *,
    name: str,
    crop_rect: tuple[int, int, int, int],
    screen_left: int,
    screen_top: int,
    scale: int,
) -> list[OcrLine]:
    crop = image.crop(crop_rect)
    lines = recognize_csp_ui_text_lines(crop, scale=scale)
    _write_ocr_debug(name, crop, lines)
    return [
        OcrLine(
            text=line.text,
            left=line.left + screen_left,
            top=line.top + screen_top,
            right=line.right + screen_left,
            bottom=line.bottom + screen_top,
        )
        for line in lines
    ]


def _write_ocr_debug(name: str, image: Any, lines: list[OcrLine]) -> None:
    debug_dir = os.environ.get("XSHEET_CSP_OCR_DEBUG_DIR")
    if not debug_dir:
        return
    try:
        output_dir = Path(debug_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
        image.save(output_dir / f"{name}.png")
        payload = [
            {
                "text": line.text,
                "left": line.left,
                "top": line.top,
                "right": line.right,
                "bottom": line.bottom,
            }
            for line in lines
        ]
        (output_dir / f"{name}.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        return


def _find_menu_point(lines: list[OcrLine], targets: tuple[str, ...], *, preferred_y: int | None = None) -> Point | None:
    normalized_targets = tuple(normalize_csp_name_text(target) for target in targets)
    candidates = [
        line
        for line in lines
        if any(target and target in normalize_csp_name_text(line.text) for target in normalized_targets)
    ]
    if not candidates:
        return None
    if preferred_y is not None:
        near_menu = [
            line
            for line in candidates
            if abs(round((line.top + line.bottom) / 2) - preferred_y) <= 45
        ]
        if near_menu:
            candidates = near_menu
    def sort_key(item: OcrLine) -> tuple[int, int]:
        center_y = round((item.top + item.bottom) / 2)
        if preferred_y is not None:
            return (abs(center_y - preferred_y), item.left)
        return (item.top, item.left)

    line = min(candidates, key=sort_key)
    return Point(round((line.left + line.right) / 2), round((line.top + line.bottom) / 2))


def _infer_layer_palette_rect(
    base_profile: WorkspaceProfile,
    csp_rect: Rect,
    lines: list[OcrLine],
) -> Rect | None:
    layer_lines = [
        line
        for line in lines
        if _looks_like_layer_panel_text(line)
    ]
    if not layer_lines:
        return None

    height = csp_rect.bottom - csp_rect.top
    reference_height = max(1, base_profile.reference_window_rect.bottom - base_profile.reference_window_rect.top)
    reference_palette_width = max(1, base_profile.layer_palette.right - base_profile.layer_palette.left)
    reference_bottom_gap = max(24, base_profile.reference_window_rect.bottom - base_profile.layer_palette.bottom)

    topmost = min(layer_lines, key=lambda line: (line.top, line.left))
    leftmost = min(line.left for line in layer_lines)
    rightmost = max(line.right for line in layer_lines)
    ui_scale = _estimate_ui_scale(lines)
    left_margin = max(32, round(40 * ui_scale))
    top_margin = max(8, round(10 * ui_scale))
    palette_width = max(round(reference_palette_width * ui_scale), rightmost - leftmost + round(260 * ui_scale))
    # The distributed helper workspace keeps the layer palette as the right-side
    # dock. The built-in development profile historically had unrelated right
    # panels, so scaling its right gap would make a modern layer-only dock far
    # too narrow. Once OCR finds the right-side layer panel, prefer the current
    # window's right edge and keep only a small safety margin.
    right_gap = max(12, round(16 * ui_scale))
    bottom_gap = round(reference_bottom_gap * min(height / reference_height, 1.25))

    left = max(csp_rect.left, leftmost - left_margin)
    right = csp_rect.right - right_gap
    if right <= left + 120:
        right = min(csp_rect.right - 16, left + max(360, palette_width))
    top = max(csp_rect.top, topmost.top - top_margin)
    bottom = max(top + 240, csp_rect.bottom - bottom_gap)
    return Rect(left, top, right, bottom)


def _infer_timeline_palette_rect(
    _base_profile: WorkspaceProfile,
    csp_rect: Rect,
    lines: list[OcrLine],
    layer_palette: Rect | None,
) -> Rect | None:
    ui_scale = _estimate_ui_scale(lines)
    if layer_palette is not None:
        right_limit = layer_palette.left - max(8, round(12 * ui_scale))
    else:
        right_limit = csp_rect.right - max(12, round(16 * ui_scale))
    timeline_lines = [
        line
        for line in lines
        if line.left < right_limit
        and line.top > csp_rect.top + 40
        and _looks_like_timeline_panel_text(line)
    ]
    if not timeline_lines:
        return None

    left_margin = max(48, round(70 * ui_scale))
    top_margin = max(8, round(12 * ui_scale))
    bottom_gap = max(8, round(12 * ui_scale))
    topmost = min(timeline_lines, key=lambda line: (line.top, line.left))
    leftmost = min(line.left for line in timeline_lines)

    left = max(csp_rect.left, leftmost - left_margin)
    right = right_limit
    top = max(csp_rect.top, topmost.top - top_margin)
    bottom = max(top + 180, csp_rect.bottom - bottom_gap)
    if right <= left + 240:
        return None
    return Rect(left, top, right, bottom)


def _looks_like_layer_panel_text(line: OcrLine) -> bool:
    normalized = normalize_csp_name_text(line.text)
    if not normalized:
        return False
    return (
        "レイヤー" in normalized
        or "検索" in normalized
        or "キーワード" in normalized
        or normalized in {"LAYER", "LAYERS"}
    )


def _looks_like_timeline_panel_text(line: OcrLine) -> bool:
    normalized = normalize_csp_name_text(line.text)
    if not normalized:
        return False
    if normalized.startswith("タイムライン"):
        return "名" not in normalized and "設定" not in normalized
    if normalized.startswith("TIMELINE"):
        return "NAME" not in normalized and "SETTING" not in normalized
    return False


def _estimate_ui_scale(lines: list[OcrLine]) -> float:
    heights = sorted(max(1, line.bottom - line.top) for line in lines if line.bottom > line.top)
    if not heights:
        return 1.0
    median = heights[len(heights) // 2]
    # The default 1920x1080 CSP workspace profile was measured against CSP UI
    # text boxes that PaddleOCR reports around 18-20 px high. Use that as the
    # neutral scale so resolution changes do not accidentally double row
    # heights just because the window itself is larger.
    return min(1.5, max(0.85, median / 19.0))


def _read_csp_window_rect(profile: WorkspaceProfile) -> tuple[str, Rect]:
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        raise AutomationError("pywinauto is required for CSP profile calibration") from exc

    window = Desktop(backend="uia").window(title_re=profile.csp_title_regex)
    if not window.exists(timeout=2):
        raise AutomationError("CLIP STUDIO PAINT window was not found")
    window.set_focus()
    rect = window.rectangle()
    return window.window_text(), Rect(rect.left, rect.top, rect.right, rect.bottom)


def _capture_screen_rect(rect: Any) -> Any:
    try:
        from PIL import ImageGrab
    except ImportError as exc:
        raise AutomationError("Pillow is required for CSP profile calibration") from exc
    try:
        return ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).convert("RGB")
    except Exception as exc:
        raise AutomationError(f"failed to capture CSP screen area: {exc}") from exc
