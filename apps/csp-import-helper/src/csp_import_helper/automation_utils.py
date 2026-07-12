from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
import unicodedata
from typing import Any, Callable, Protocol

from .logging import OperationLog
from .manifest import CspImportCut, CspImportManifest, ImportTrack
from .progress_plan import (
    STEP_CHECK_CONTROL,
    STEP_CLOSE_CLIP,
    STEP_CREATE_TIMELINE,
    STEP_DISABLE_TIMELINE_FOR_ASSETS,
    STEP_ENABLE_TIMELINE,
    STEP_FOCUS_CSP,
    STEP_IMPORT_CUT_XDTS,
    STEP_IMPORT_SETUP_XDTS,
    STEP_IMPORT_TRACK_ASSETS,
    STEP_MARK_IMPORT_END_SELECTED,
    STEP_MOVE_FIRST_TIMELINE,
    STEP_MOVE_FIRST_TIMELINE_FOR_ASSETS,
    STEP_OPEN_CLIP,
    STEP_PREPARE_XDTS_IMPORT,
    STEP_RENAME_TIMELINE,
    STEP_SAVE_AS_CLIP,
    ImportExecutionStep,
    build_import_execution_plan,
)
from .profile import DEFAULT_PROFILE, WorkspaceProfile
from .automation_errors import AutomationError



def _safe_text(item: Any) -> str:
    try:
        return item.window_text().strip()
    except Exception:
        return ""


def _safe_class_name(item: Any) -> str:
    try:
        return str(item.class_name())
    except Exception:
        return ""


def _safe_process_id(item: Any) -> int | None:
    try:
        return int(item.process_id())
    except Exception:
        return None


def _safe_handle(item: Any) -> int | None:
    try:
        return int(item.handle)
    except Exception:
        return None


def _safe_visible(item: Any) -> bool:
    try:
        return bool(item.is_visible())
    except Exception:
        return False


def _looks_like_csp_custom_dialog(item: Any) -> bool:
    class_name = _safe_class_name(item)
    if not class_name.startswith("742DEA58-ED6B-4402-BC11-20DFC6D08040-"):
        return False
    title = _safe_text(item)
    if not title:
        return False
    try:
        rect = item.rectangle()
    except Exception:
        return False
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    return 200 <= width <= 900 and 80 <= height <= 600


def _looks_like_unhandled_csp_modal(item: Any) -> bool:
    class_name = _safe_class_name(item)
    title = _safe_text(item)
    if "CSP取り込みヘルパー" in title:
        return False
    try:
        rect = item.rectangle()
    except Exception:
        return False
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if class_name == "#32770":
        if _looks_like_windows_file_dialog(item):
            return False
        return 160 <= width <= 2200 and 70 <= height <= 1600
    if width < 160 or height < 70 or width > 1000 or height > 700:
        return False
    return class_name.startswith("742DEA58-ED6B-4402-BC11-20DFC6D08040-")


def _looks_like_windows_file_dialog(item: Any) -> bool:
    if _safe_class_name(item) != "#32770":
        return False
    title = _safe_text(item)
    if "CSP取り込みヘルパー" in title:
        return False
    try:
        rect = item.rectangle()
    except Exception:
        return False
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if width < 420 or height < 260:
        return False

    edit_count = _visible_descendant_count(item, ({"control_type": "Edit"}, {"class_name": "Edit"}))
    button_count = _visible_descendant_count(item, ({"control_type": "Button"}, {"class_name": "Button"}))
    combo_count = _visible_descendant_count(item, ({"control_type": "ComboBox"}, {"class_name": "ComboBox"}))
    return edit_count >= 1 and button_count >= 2 and combo_count >= 1


def _visible_descendant_count(item: Any, queries: tuple[dict[str, str], ...]) -> int:
    seen: set[int] = set()
    count = 0
    for query in queries:
        try:
            descendants = item.descendants(**query)
        except Exception:
            continue
        for descendant in descendants:
            key = _safe_handle(descendant) or id(descendant)
            if key in seen:
                continue
            seen.add(key)
            if _safe_visible(descendant):
                count += 1
    return count


def _looks_like_xdts_mismatch_dialog(item: Any, phase: str) -> bool:
    if not phase.startswith("XDTS import"):
        return False
    title = _safe_text(item)
    return "タイムシート" in title and "読み込み" in title


def _window_debug_info(item: Any) -> dict[str, Any]:
    info: dict[str, Any] = {
        "title": _safe_text(item),
        "className": _safe_class_name(item),
        "processId": _safe_process_id(item),
    }
    try:
        rect = item.rectangle()
        info["rect"] = [rect.left, rect.top, rect.right, rect.bottom]
        info["width"] = rect.right - rect.left
        info["height"] = rect.bottom - rect.top
    except Exception:
        pass
    texts: list[str] = []
    try:
        descendants = item.descendants()
    except Exception:
        descendants = []
    for child in descendants[:40]:
        text = _safe_text(child)
        if text:
            texts.append(text)
    if texts:
        info["descendantTexts"] = list(dict.fromkeys(texts))[:20]
    return info


def _control_position_key(item: Any) -> tuple[int, int]:
    try:
        rect = item.rectangle()
        return (rect.top, rect.left)
    except Exception:
        return (0, 0)


def _timeline_menu_check_area_stats(image: Any) -> dict[str, float]:
    get_pixels = getattr(image, "get_flattened_data", image.getdata)
    pixels = list(get_pixels())
    if not pixels:
        return {"checkmarkScore": 0.0, "darkRatio": 0.0}
    bright = sum(1 for r, g, b in pixels if r >= 150 and g >= 150 and b >= 150)
    dark = sum(1 for r, g, b in pixels if r <= 80 and g <= 80 and b <= 80)
    return {
        "checkmarkScore": bright / len(pixels),
        "darkRatio": dark / len(pixels),
    }


def _find_palette_delta_anchor(before: Any, after: Any) -> ImportStackMarker | None:
    try:
        from PIL import ImageChops
    except ImportError as exc:
        raise AutomationError("Pillow is required for CSP layer palette verification") from exc

    if before.size != after.size:
        return None

    diff = ImageChops.difference(before, after).convert("L")
    width, height = diff.size
    search_top = min(70, max(0, height - 1))
    x_start = min(32, max(0, width - 1))
    x_end = max(x_start + 1, width - 8)
    row_scores: list[float] = []
    sample_count = max(1, ((x_end - x_start) + 1) // 2)
    pixels = diff.load()
    for y in range(height):
        changed = 0
        for x in range(x_start, x_end, 2):
            if pixels[x, y] >= 24:
                changed += 1
        row_scores.append(changed / sample_count)

    smoothed: list[float] = []
    for index, _score in enumerate(row_scores):
        start = max(0, index - 2)
        end = min(height, index + 3)
        smoothed.append(sum(row_scores[start:end]) / (end - start))

    threshold = 0.018
    min_run = 4
    run_start: int | None = None
    for y in range(search_top, height):
        if smoothed[y] >= threshold:
            if run_start is None:
                run_start = y
            continue
        if run_start is not None and y - run_start >= min_run:
            return _palette_delta_marker(run_start, y, width)
        run_start = None

    if run_start is not None and height - run_start >= min_run:
        return _palette_delta_marker(run_start, height - 1, width)
    return None


def _palette_delta_marker(top: int, bottom: int, width: int) -> ImportStackMarker:
    from .vision import ImportStackMarker, OcrLine

    return ImportStackMarker(
        kind="palette-delta",
        line=OcrLine(
            text="",
            left=0,
            top=top,
            right=width,
            bottom=bottom,
        ),
    )


def _format_file_dialog_paths(paths: tuple[Path, ...]) -> str:
    if not paths:
        raise AutomationError("at least one file path is required for the CSP file dialog")
    path_texts = tuple(str(path) for path in paths)
    if any('"' in path_text for path_text in path_texts):
        raise AutomationError("file paths containing double quotes cannot be pasted into the CSP file dialog")
    if len(path_texts) == 1:
        return path_texts[0]
    return " ".join(f'"{path_text}"' for path_text in path_texts)


def _load_xdts_track_names(path: Path) -> tuple[str, ...]:
    try:
        text = path.read_text(encoding="utf-8-sig")
    except OSError as exc:
        raise AutomationError(f"failed to read XDTS for stack order: {path}: {exc}") from exc
    json_start = text.find("{")
    if json_start < 0:
        raise AutomationError(f"XDTS JSON body was not found: {path}")
    try:
        raw = json.loads(text[json_start:])
    except json.JSONDecodeError as exc:
        raise AutomationError(f"XDTS JSON body is invalid: {path}: {exc}") from exc

    time_tables = raw.get("timeTables")
    if not isinstance(time_tables, list) or not time_tables:
        return ()
    headers = time_tables[0].get("timeTableHeaders") if isinstance(time_tables[0], dict) else None
    if not isinstance(headers, list):
        return ()
    for header in headers:
        if not isinstance(header, dict):
            continue
        names = header.get("names")
        if isinstance(names, list) and all(isinstance(item, str) for item in names):
            return tuple(names)
    return ()


def _find_xdts_stack_name_index(stack_names: tuple[str, ...], name: str) -> int | None:
    target = _row_key(name)
    if not target:
        return None
    for index, item in enumerate(stack_names):
        if _row_key(item) == target:
            return index
    for index, item in enumerate(stack_names):
        if target in _row_key(item):
            return index
    return None


def _resolve_xdts_stack_target_index(
    track: ImportTrack,
    manifest: CspImportManifest,
    stack_names: tuple[str, ...],
) -> int | None:
    target = _row_key(track.xdts_track_name)
    if not target:
        return None

    same_name_count = sum(1 for name in stack_names if _row_key(name) == target)
    if (
        same_name_count <= 1
        and 0 <= track.stack_order < len(stack_names)
        and _row_key(stack_names[track.stack_order]) == target
    ):
        return track.stack_order

    candidates = [index for index, name in enumerate(stack_names) if _row_key(name) == target]
    if not candidates:
        return None
    if len(candidates) == 1:
        return candidates[0]

    scored = [
        (index, _score_xdts_stack_target(track, manifest, stack_names, index))
        for index in candidates
    ]
    best_score = max(score for _index, score in scored)
    best = [index for index, score in scored if score == best_score and score > 0]
    return best[0] if len(best) == 1 else None


def _score_xdts_stack_target(
    track: ImportTrack,
    manifest: CspImportManifest,
    stack_names: tuple[str, ...],
    candidate_index: int,
) -> int:
    same_name_indices = [index for index, name in enumerate(stack_names) if _row_key(name) == _row_key(track.xdts_track_name)]
    context_names = _track_context_names(track)
    prefer_context = len(same_name_indices) > 1 and len(context_names) > 0
    score = max(0, 40 - abs(candidate_index - track.stack_order))
    if candidate_index == track.stack_order:
        score += 5 if prefer_context else 1000
    if context_names:
        group_marker = _nearest_previous_separator_name(stack_names, candidate_index)
        for context in context_names:
            if group_marker and _text_matches_context(group_marker, context):
                score += 2000 if prefer_context else 100
    visual_occurrence = _visual_occurrence_index(track, manifest)
    visual_same_name_indices = sorted(same_name_indices, reverse=True)
    try:
        if visual_same_name_indices.index(candidate_index) == visual_occurrence:
            score += 20
    except ValueError:
        pass
    return score


def _nearest_previous_separator_name(stack_names: tuple[str, ...], before_index: int) -> str | None:
    for index in range(before_index - 1, -1, -1):
        name = stack_names[index]
        if _is_separator_name(name):
            return name
    return None


def _is_separator_name(name: str) -> bool:
    stripped = name.strip()
    return stripped.startswith("=====") and stripped.endswith("=====")


def _visual_delta_from_xdts_indices(anchor_index: int, target_index: int) -> int:
    # CSP layer palette shows upper layers at the top. XDTS import stack order is
    # START -> ... -> END, so visual order is the reverse of XDTS order.
    return anchor_index - target_index


def _track_search_target_names(track: ImportTrack) -> list[str]:
    return [track.xdts_track_name]


def _track_context_names(track: ImportTrack) -> list[str]:
    names: list[str] = []
    for name in (*track.target_folder_path, track.stage_label, track.stage_id):
        if name and name not in names and name != track.xdts_track_name:
            names.append(name)
    if track.stage_label:
        separator_name = f"===== {track.stage_label} ====="
        if separator_name not in names:
            names.append(separator_name)
    if track.target_folder_path:
        joined = "/".join(track.target_folder_path)
        if joined and joined not in names and joined != track.xdts_track_name:
            names.append(joined)
        separator_name = f"===== {joined} ====="
        if separator_name not in names:
            names.append(separator_name)
    return names


def _manifest_track_name_count(manifest: CspImportManifest, layer_name: str) -> int:
    target = _row_key(layer_name)
    return sum(1 for item in manifest.importable_tracks if _row_key(item.xdts_track_name) == target)


def _visual_occurrence_index(track: ImportTrack, manifest: CspImportManifest) -> int:
    target = _row_key(track.xdts_track_name)
    visual_order = sorted(manifest.importable_tracks, key=lambda item: (-item.stack_order, item.track_id))
    index = 0
    for item in visual_order:
        if _row_key(item.xdts_track_name) != target:
            continue
        if item.track_id == track.track_id:
            return index
        index += 1
    return 0


def _score_track_context(
    candidate: OcrLine,
    lines: list[OcrLine],
    context_names: list[str],
    search_px: int,
) -> tuple[int, tuple[str, ...]]:
    if not context_names:
        return 0, ()

    score = 0
    hits: list[str] = []
    for line in lines:
        if line is candidate:
            continue
        distance = abs(line.center_y - candidate.center_y)
        if distance > search_px:
            continue
        for context in context_names:
            if _text_matches_context(line.text, context):
                score += max(1, search_px - distance)
                if context not in hits:
                    hits.append(context)
    return score, tuple(hits)


def _text_matches_context(text: str, context: str) -> bool:
    normalized_text = _row_key(text)
    normalized_context = _row_key(context)
    if normalized_context and normalized_context in normalized_text:
        return True
    compact_text = _compact_text(text)
    compact_context = _compact_text(context)
    return bool(compact_context and compact_context in compact_text)


def _row_key(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(char.upper() for char in normalized if char.isalnum())


def _safe_clip_stem(value: str) -> str:
    normalized = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', "_", value.strip())
    normalized = normalized.strip("._")
    return normalized or "cut"


def _safe_clip_file_name(value: str) -> str:
    file_name = value.replace("\\", "/").rsplit("/", 1)[-1]
    stem = file_name[:-5] if file_name.casefold().endswith(".clip") else file_name
    return f"{_safe_clip_stem(stem)[:120]}.clip"


def _move_existing_save_as_backup(save_as_path: Path) -> Path:
    backup_path = _available_sibling_path(
        save_as_path.with_name(
            f"{save_as_path.stem}.backup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}{save_as_path.suffix}"
        )
    )
    save_as_path.replace(backup_path)
    return backup_path


def _delete_save_as_backup(backup_path: Path, log: OperationLog) -> None:
    try:
        backup_path.unlink(missing_ok=True)
    except OSError as exc:
        log.add("clip.save_as_backup_cleanup_failed", backupPath=str(backup_path), error=str(exc))


def _restore_save_as_backup(save_as_path: Path, backup_path: Path, log: OperationLog) -> None:
    if not backup_path.exists():
        return
    if save_as_path.exists():
        failed_path = _available_sibling_path(
            save_as_path.with_name(
                f"{save_as_path.stem}.failed-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}{save_as_path.suffix}"
            )
        )
        save_as_path.replace(failed_path)
        log.add("clip.save_as_failed_output_moved", path=str(save_as_path), failedPath=str(failed_path))
    backup_path.replace(save_as_path)
    log.add("clip.save_as_existing_restored", path=str(save_as_path), backupPath=str(backup_path))


def _available_sibling_path(path: Path) -> Path:
    if not path.exists():
        return path
    for index in range(2, 1000):
        candidate = path.with_name(f"{path.stem}-{index}{path.suffix}")
        if not candidate.exists():
            return candidate
    raise AutomationError(f"could not allocate backup path near: {path}")


def _resolve_save_as_clip_path(save_as_path: Path) -> Path:
    expanded = save_as_path.expanduser()
    if expanded.exists() and expanded.is_dir():
        raise AutomationError(f"Save As output path must include a .clip file name: {expanded}")
    resolved = expanded.resolve()
    if resolved.suffix.lower() != ".clip":
        resolved = resolved.with_suffix(".clip")
    return resolved


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", "", value).upper()


__all__ = [name for name, value in globals().items() if name.startswith("_") and not name.startswith("__") and callable(value)]
