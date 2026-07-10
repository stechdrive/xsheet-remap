from __future__ import annotations

from dataclasses import asdict, dataclass, field, replace
import json
import os
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class Point:
    x: int
    y: int


@dataclass(frozen=True)
class Rect:
    left: int
    top: int
    right: int
    bottom: int


@dataclass(frozen=True)
class WorkspaceProfile:
    name: str
    csp_title_regex: str
    file_menu: Point
    animation_menu: Point
    layer_menu: Point
    import_menu_row: Point
    import_image_item: Point
    import_timesheet_item: Point
    rasterize_menu_item: Point
    blend_mode_dropdown: Point
    layer_palette: Rect
    timeline_menu_row: Point
    timeline_enabled_check_rect: Rect
    first_stack_row_y: int
    row_height: int
    row_click_x: int
    timeline_palette: Rect = field(default_factory=lambda: Rect(16, 672, 1488, 1028))
    reference_window_rect: Rect = field(default_factory=lambda: Rect(0, 0, 1920, 1080))
    timeline_checkmark_score_threshold: float = 0.012
    after_dialog_seconds: float = 1.0
    file_dialog_timeout_seconds: float = 8.0
    min_palette_change_score_after_xdts: float = 0.002
    layer_palette_reset_scroll_steps: int = 10
    layer_palette_search_scroll_steps: int = 28
    layer_palette_scroll_page: int = 7
    layer_palette_context_search_px: int = 230
    timeline_toggle_shortcut: str = "+t"
    new_timeline_shortcut: str = "^%t"
    timeline_settings_shortcut: str = "^+q"
    previous_timeline_shortcut: str = "^+a"
    next_timeline_shortcut: str = "^+f"
    select_layer_above_shortcut: str = "%]"
    select_layer_below_shortcut: str = "%["
    import_xdts_shortcut: str = "^%x"
    import_image_shortcut: str = "^%i"
    rasterize_shortcut: str = "^%p"
    set_multiply_shortcut: str = "^%l"
    toggle_folder_children_shortcut: str = "^%f"
    save_as_shortcut: str = "^+s"
    automation_speed_mode: str = "turbo"
    multi_image_import_enabled: bool = True
    rasterize_after_image_import: bool = True
    close_imported_track_folder_after_image_import: bool = True
    set_imported_track_blend_mode_to_multiply: bool = True
    blend_mode_multiply_down_steps: int = 3
    after_clip_open_seconds: float = 1.0
    after_focus_seconds: float = 0.3
    after_xdts_import_seconds: float = 2.0
    after_timeline_toggle_seconds: float = 0.6
    after_track_click_seconds: float = 0.3
    after_anchor_click_seconds: float = 0.2
    after_layer_selection_seconds: float = 0.2
    after_parent_folder_select_seconds: float = 0.25
    after_folder_toggle_seconds: float = 0.25
    after_image_import_seconds: float = 1.5
    after_batch_image_import_base_seconds: float = 1.5
    after_batch_image_import_per_file_seconds: float = 0.2
    after_rasterize_seconds: float = 0.8
    after_blend_mode_change_seconds: float = 0.4
    after_timeline_operation_seconds: float = 0.8
    after_save_as_seconds: float = 2.0
    after_close_document_seconds: float = 1.0
    after_key_input_seconds: float = 0.05
    after_text_paste_seconds: float = 0.2
    dialog_poll_interval_seconds: float = 0.1

    def stack_row_point(self, visible_row_index: int, stack_anchor_y: int | None = None) -> Point:
        anchor_y = self.first_stack_row_y if stack_anchor_y is None else stack_anchor_y
        return Point(self.row_click_x, anchor_y + visible_row_index * self.row_height)

    def to_json_dict(self) -> dict[str, Any]:
        return asdict(self)


DEFAULT_PROFILE = WorkspaceProfile(
    name="csp-ex-ja-1920x1080-default",
    csp_title_regex=".*CLIP STUDIO PAINT.*",
    file_menu=Point(36, 35),
    animation_menu=Point(283, 35),
    layer_menu=Point(354, 35),
    import_menu_row=Point(295, 453),
    import_image_item=Point(384, 457),
    import_timesheet_item=Point(430, 801),
    rasterize_menu_item=Point(408, 438),
    blend_mode_dropdown=Point(1340, 101),
    layer_palette=Rect(1144, 74, 1558, 1028),
    timeline_menu_row=Point(300, 267),
    timeline_enabled_check_rect=Rect(482, 260, 508, 286),
    first_stack_row_y=176,
    row_height=29,
    row_click_x=1240,
    timeline_palette=Rect(16, 672, 1488, 1028),
)


PROFILE_SCHEMA_VERSION = 2
SPEED_MODE_STANDARD = "standard"
SPEED_MODE_FAST = "fast"
SPEED_MODE_TURBO = "turbo"
SPEED_MODES = (SPEED_MODE_STANDARD, SPEED_MODE_FAST, SPEED_MODE_TURBO)


def default_profile_path() -> Path:
    base = os.environ.get("APPDATA")
    if base:
        return Path(base) / "xsheet-remap" / "csp-import-helper" / "workspace-profile.json"
    return Path.home() / ".xsheet-remap" / "csp-import-helper" / "workspace-profile.json"


def shortcut_to_display_text(shortcut: str) -> str:
    value = shortcut.strip()
    if not value:
        return ""
    modifiers: list[str] = []
    index = 0
    while index < len(value) and value[index] in "^+%":
        symbol = value[index]
        if symbol == "^":
            modifiers.append("Ctrl")
        elif symbol == "+":
            modifiers.append("Shift")
        elif symbol == "%":
            modifiers.append("Alt")
        index += 1
    key = value[index:].strip()
    if key.startswith("{") and key.endswith("}"):
        key = key[1:-1]
    key = key.upper()
    return "+".join([*modifiers, key] if key else modifiers)


def shortcut_from_display_text(shortcut: str) -> str:
    value = shortcut.strip()
    if not value:
        return ""
    if any(symbol in value for symbol in ("^", "%")) or value.startswith("+"):
        return _normalize_pywinauto_shortcut(value)

    modifier_symbols: list[str] = []
    key_parts: list[str] = []
    for raw_part in value.replace("＋", "+").split("+"):
        part = raw_part.strip()
        if not part:
            continue
        normalized = part.casefold()
        if normalized in ("ctrl", "control", "ctl"):
            modifier_symbols.append("^")
        elif normalized == "shift":
            modifier_symbols.append("+")
        elif normalized in ("alt", "option"):
            modifier_symbols.append("%")
        else:
            key_parts.append(part)
    if not key_parts:
        return "".join(modifier_symbols)
    key = "+".join(key_parts).strip()
    if key.startswith("{") and key.endswith("}"):
        storage_key = key
    elif len(key) == 1:
        storage_key = key.casefold()
    else:
        storage_key = key.casefold()
    return "".join(modifier_symbols) + storage_key


def _normalize_pywinauto_shortcut(shortcut: str) -> str:
    value = shortcut.strip()
    modifiers: list[str] = []
    index = 0
    while index < len(value) and value[index] in "^+%":
        modifiers.append(value[index])
        index += 1
    key = value[index:].strip()
    if len(key) == 1:
        key = key.casefold()
    elif not (key.startswith("{") and key.endswith("}")):
        key = key.casefold()
    return "".join(modifiers) + key


def load_workspace_profile(path: str | Path | None = None) -> WorkspaceProfile:
    profile_path = Path(path).expanduser() if path else default_profile_path()
    if not profile_path.exists():
        return DEFAULT_PROFILE
    try:
        raw = json.loads(profile_path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"CSP helper profile could not be read: {profile_path}: {exc}") from exc
    return workspace_profile_from_json(raw)


def save_workspace_profile(profile: WorkspaceProfile, path: str | Path | None = None) -> Path:
    profile_path = Path(path).expanduser() if path else default_profile_path()
    profile_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": PROFILE_SCHEMA_VERSION,
        "profile": profile.to_json_dict(),
    }
    profile_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return profile_path


def apply_workspace_profile_speed(profile: WorkspaceProfile, speed_mode: str) -> WorkspaceProfile:
    mode = speed_mode.strip().casefold()
    if mode in ("", "normal", "default", SPEED_MODE_STANDARD):
        return profile
    if mode not in (SPEED_MODE_FAST, SPEED_MODE_TURBO):
        raise ValueError(f"unsupported CSP helper speed mode: {speed_mode}")

    def cap(current: float, fast_value: float) -> float:
        return min(max(0.0, current), fast_value)

    if mode == SPEED_MODE_TURBO:
        return replace(
            profile,
            after_clip_open_seconds=cap(profile.after_clip_open_seconds, 0.15),
            after_focus_seconds=cap(profile.after_focus_seconds, 0.03),
            after_xdts_import_seconds=cap(profile.after_xdts_import_seconds, 0.35),
            after_timeline_toggle_seconds=cap(profile.after_timeline_toggle_seconds, 0.05),
            after_track_click_seconds=cap(profile.after_track_click_seconds, 0.01),
            after_anchor_click_seconds=cap(profile.after_anchor_click_seconds, 0.01),
            after_layer_selection_seconds=cap(profile.after_layer_selection_seconds, 0.005),
            after_parent_folder_select_seconds=cap(profile.after_parent_folder_select_seconds, 0.01),
            after_folder_toggle_seconds=cap(profile.after_folder_toggle_seconds, 0.01),
            after_dialog_seconds=cap(profile.after_dialog_seconds, 0.05),
            after_image_import_seconds=cap(profile.after_image_import_seconds, 0.08),
            after_batch_image_import_base_seconds=cap(profile.after_batch_image_import_base_seconds, 0.12),
            after_batch_image_import_per_file_seconds=cap(profile.after_batch_image_import_per_file_seconds, 0.005),
            after_rasterize_seconds=cap(profile.after_rasterize_seconds, 0.05),
            after_blend_mode_change_seconds=cap(profile.after_blend_mode_change_seconds, 0.01),
            after_timeline_operation_seconds=cap(profile.after_timeline_operation_seconds, 0.08),
            after_save_as_seconds=cap(profile.after_save_as_seconds, 0.25),
            after_close_document_seconds=cap(profile.after_close_document_seconds, 0.08),
            after_key_input_seconds=cap(profile.after_key_input_seconds, 0.005),
            after_text_paste_seconds=cap(profile.after_text_paste_seconds, 0.015),
            dialog_poll_interval_seconds=cap(profile.dialog_poll_interval_seconds, 0.015),
        )

    return replace(
        profile,
        after_clip_open_seconds=cap(profile.after_clip_open_seconds, 0.75),
        after_focus_seconds=cap(profile.after_focus_seconds, 0.2),
        after_xdts_import_seconds=cap(profile.after_xdts_import_seconds, 1.25),
        after_timeline_toggle_seconds=cap(profile.after_timeline_toggle_seconds, 0.35),
        after_track_click_seconds=cap(profile.after_track_click_seconds, 0.15),
        after_anchor_click_seconds=cap(profile.after_anchor_click_seconds, 0.1),
        after_layer_selection_seconds=cap(profile.after_layer_selection_seconds, 0.08),
        after_parent_folder_select_seconds=cap(profile.after_parent_folder_select_seconds, 0.12),
        after_folder_toggle_seconds=cap(profile.after_folder_toggle_seconds, 0.12),
        after_dialog_seconds=cap(profile.after_dialog_seconds, 0.45),
        after_image_import_seconds=cap(profile.after_image_import_seconds, 0.7),
        after_batch_image_import_base_seconds=cap(profile.after_batch_image_import_base_seconds, 0.75),
        after_batch_image_import_per_file_seconds=cap(profile.after_batch_image_import_per_file_seconds, 0.08),
        after_rasterize_seconds=cap(profile.after_rasterize_seconds, 0.4),
        after_blend_mode_change_seconds=cap(profile.after_blend_mode_change_seconds, 0.2),
        after_timeline_operation_seconds=cap(profile.after_timeline_operation_seconds, 0.45),
        after_save_as_seconds=cap(profile.after_save_as_seconds, 1.25),
        after_close_document_seconds=cap(profile.after_close_document_seconds, 0.6),
        after_key_input_seconds=cap(profile.after_key_input_seconds, 0.035),
        after_text_paste_seconds=cap(profile.after_text_paste_seconds, 0.1),
        dialog_poll_interval_seconds=cap(profile.dialog_poll_interval_seconds, 0.06),
    )


def workspace_profile_name_base(name: str) -> str:
    for marker in ("-ocr-calibrated-", "-calibrated-"):
        index = name.find(marker)
        if index >= 0:
            return name[:index]
    return name


def workspace_profile_from_json(raw: dict[str, Any]) -> WorkspaceProfile:
    if not isinstance(raw, dict):
        raise ValueError("profile JSON root must be an object")
    if "profile" in raw:
        schema_version = raw.get("schemaVersion", 1)
        if schema_version not in (1, PROFILE_SCHEMA_VERSION):
            raise ValueError(f"unsupported profile schemaVersion: {schema_version}")
        raw_profile = raw["profile"]
    else:
        schema_version = 1
        raw_profile = raw
    if not isinstance(raw_profile, dict):
        raise ValueError("profile must be an object")

    if schema_version == 1:
        raw_profile = dict(raw_profile)
        shortcut_migrations = {
            "select_layer_above_shortcut": ("+f", DEFAULT_PROFILE.select_layer_above_shortcut),
            "select_layer_below_shortcut": ("+a", DEFAULT_PROFILE.select_layer_below_shortcut),
            "save_as_shortcut": ("+%s", DEFAULT_PROFILE.save_as_shortcut),
        }
        for key, (old_default, new_default) in shortcut_migrations.items():
            if raw_profile.get(key, old_default) == old_default:
                raw_profile[key] = new_default

    values = DEFAULT_PROFILE.to_json_dict()
    values.update(raw_profile)
    if values["automation_speed_mode"] not in SPEED_MODES:
        values["automation_speed_mode"] = SPEED_MODE_TURBO
    for key in (
        "file_menu",
        "animation_menu",
        "layer_menu",
        "import_menu_row",
        "import_image_item",
        "import_timesheet_item",
        "rasterize_menu_item",
        "blend_mode_dropdown",
        "timeline_menu_row",
    ):
        values[key] = _point_from_json(values[key], key)
    for key in ("layer_palette", "timeline_palette", "timeline_enabled_check_rect", "reference_window_rect"):
        values[key] = _rect_from_json(values[key], key)
    return WorkspaceProfile(**values)


def scale_profile_to_window(profile: WorkspaceProfile, window_rect: Rect) -> WorkspaceProfile:
    source = profile.reference_window_rect
    source_width = max(1, source.right - source.left)
    source_height = max(1, source.bottom - source.top)
    target_width = max(1, window_rect.right - window_rect.left)
    target_height = max(1, window_rect.bottom - window_rect.top)
    sx = target_width / source_width
    sy = target_height / source_height

    def map_x(value: int) -> int:
        return window_rect.left + round((value - source.left) * sx)

    def map_y(value: int) -> int:
        return window_rect.top + round((value - source.top) * sy)

    def map_point(point: Point) -> Point:
        return Point(map_x(point.x), map_y(point.y))

    def map_rect(rect: Rect) -> Rect:
        return Rect(map_x(rect.left), map_y(rect.top), map_x(rect.right), map_y(rect.bottom))

    return replace(
        profile,
        name=f"{workspace_profile_name_base(profile.name)}-calibrated-{target_width}x{target_height}",
        file_menu=map_point(profile.file_menu),
        animation_menu=map_point(profile.animation_menu),
        layer_menu=map_point(profile.layer_menu),
        import_menu_row=map_point(profile.import_menu_row),
        import_image_item=map_point(profile.import_image_item),
        import_timesheet_item=map_point(profile.import_timesheet_item),
        rasterize_menu_item=map_point(profile.rasterize_menu_item),
        blend_mode_dropdown=map_point(profile.blend_mode_dropdown),
        layer_palette=map_rect(profile.layer_palette),
        timeline_palette=map_rect(profile.timeline_palette),
        timeline_menu_row=map_point(profile.timeline_menu_row),
        timeline_enabled_check_rect=map_rect(profile.timeline_enabled_check_rect),
        first_stack_row_y=map_y(profile.first_stack_row_y),
        row_click_x=map_x(profile.row_click_x),
        row_height=max(1, round(profile.row_height * sy)),
        layer_palette_context_search_px=max(1, round(profile.layer_palette_context_search_px * sy)),
        reference_window_rect=window_rect,
    )


def update_workspace_profile_shortcuts(
    profile: WorkspaceProfile,
    *,
    timeline_toggle_shortcut: str,
    select_layer_above_shortcut: str,
    select_layer_below_shortcut: str,
    new_timeline_shortcut: str | None = None,
    timeline_settings_shortcut: str | None = None,
    previous_timeline_shortcut: str | None = None,
    next_timeline_shortcut: str | None = None,
    import_xdts_shortcut: str | None = None,
    import_image_shortcut: str | None = None,
    rasterize_shortcut: str | None = None,
    set_multiply_shortcut: str | None = None,
    toggle_folder_children_shortcut: str | None = None,
    save_as_shortcut: str | None = None,
) -> WorkspaceProfile:
    def shortcut_value(value: str | None, current: str, default: str) -> str:
        if value is None:
            return current
        return shortcut_from_display_text(value) or default

    return replace(
        profile,
        timeline_toggle_shortcut=shortcut_from_display_text(timeline_toggle_shortcut) or DEFAULT_PROFILE.timeline_toggle_shortcut,
        select_layer_above_shortcut=shortcut_from_display_text(select_layer_above_shortcut) or DEFAULT_PROFILE.select_layer_above_shortcut,
        select_layer_below_shortcut=shortcut_from_display_text(select_layer_below_shortcut) or DEFAULT_PROFILE.select_layer_below_shortcut,
        new_timeline_shortcut=shortcut_value(new_timeline_shortcut, profile.new_timeline_shortcut, DEFAULT_PROFILE.new_timeline_shortcut),
        timeline_settings_shortcut=shortcut_value(
            timeline_settings_shortcut,
            profile.timeline_settings_shortcut,
            DEFAULT_PROFILE.timeline_settings_shortcut,
        ),
        previous_timeline_shortcut=shortcut_value(
            previous_timeline_shortcut,
            profile.previous_timeline_shortcut,
            DEFAULT_PROFILE.previous_timeline_shortcut,
        ),
        next_timeline_shortcut=shortcut_value(next_timeline_shortcut, profile.next_timeline_shortcut, DEFAULT_PROFILE.next_timeline_shortcut),
        import_xdts_shortcut=shortcut_value(import_xdts_shortcut, profile.import_xdts_shortcut, DEFAULT_PROFILE.import_xdts_shortcut),
        import_image_shortcut=shortcut_value(import_image_shortcut, profile.import_image_shortcut, DEFAULT_PROFILE.import_image_shortcut),
        rasterize_shortcut=shortcut_value(rasterize_shortcut, profile.rasterize_shortcut, DEFAULT_PROFILE.rasterize_shortcut),
        set_multiply_shortcut=shortcut_value(set_multiply_shortcut, profile.set_multiply_shortcut, DEFAULT_PROFILE.set_multiply_shortcut),
        toggle_folder_children_shortcut=shortcut_value(
            toggle_folder_children_shortcut,
            profile.toggle_folder_children_shortcut,
            DEFAULT_PROFILE.toggle_folder_children_shortcut,
        ),
        save_as_shortcut=shortcut_value(save_as_shortcut, profile.save_as_shortcut, DEFAULT_PROFILE.save_as_shortcut),
    )


def _point_from_json(raw: Any, key: str) -> Point:
    if isinstance(raw, Point):
        return raw
    if not isinstance(raw, dict):
        raise ValueError(f"profile.{key} must be an object")
    return Point(_required_int(raw, "x", key), _required_int(raw, "y", key))


def _rect_from_json(raw: Any, key: str) -> Rect:
    if isinstance(raw, Rect):
        return raw
    if not isinstance(raw, dict):
        raise ValueError(f"profile.{key} must be an object")
    return Rect(
        _required_int(raw, "left", key),
        _required_int(raw, "top", key),
        _required_int(raw, "right", key),
        _required_int(raw, "bottom", key),
    )


def _required_int(raw: dict[str, Any], field_name: str, owner: str) -> int:
    value = raw.get(field_name)
    if not isinstance(value, int):
        raise ValueError(f"profile.{owner}.{field_name} must be an integer")
    return value
