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
from .automation_errors import AutomationError, AutomationPaused



from .automation_utils import _safe_clip_file_name, _safe_clip_stem, _safe_text

class CancellationToken(Protocol):
    def is_set(self) -> bool:
        ...


ProgressCallback = Callable[[str, dict[str, Any]], None]


@dataclass(frozen=True)
class WindowProbe:
    found: bool
    title: str | None
    process_id: int | None
    handle: int | None
    rect: tuple[int, int, int, int] | None
    backend_summary: dict[str, Any]


@dataclass(frozen=True)
class VisibleTrackMatch:
    track_id: str
    target_name: str
    line: Any
    score: int = 0
    context_hits: tuple[str, ...] = ()


def default_output_clip_path(manifest: CspImportManifest) -> Path:
    if manifest.output_clip_file_name:
        return manifest.assets_root / _safe_clip_file_name(manifest.output_clip_file_name)
    stem_parts = [cut.timeline_name or cut.cut_number for cut in manifest.cuts]
    stem = "_".join(_safe_clip_stem(part) for part in stem_parts if part.strip())
    if not stem:
        stem = "csp-import"
    return manifest.assets_root / f"{stem[:120]}.clip"


def probe_csp_window(profile: WorkspaceProfile = DEFAULT_PROFILE) -> WindowProbe:
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        raise AutomationError("pywinauto is required for CSP probing") from exc

    backend_summary: dict[str, Any] = {}
    try:
        window = Desktop(backend="uia").window(title_re=profile.csp_title_regex)
        if not window.exists(timeout=1):
            return WindowProbe(False, None, None, None, None, backend_summary)
        rect = window.rectangle()
        descendants = window.descendants()
        backend_summary["uiaDescendants"] = len(descendants)
        backend_summary["uiaNamedControls"] = sum(1 for item in descendants if _safe_text(item))
        return WindowProbe(
            found=True,
            title=window.window_text(),
            process_id=window.process_id(),
            handle=window.handle,
            rect=(rect.left, rect.top, rect.right, rect.bottom),
            backend_summary=backend_summary,
        )
    except Exception as exc:  # pragma: no cover - depends on live CSP
        raise AutomationError(f"failed to probe CSP window: {exc}") from exc

