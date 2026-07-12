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



from .automation_shared import *
from .automation_utils import *


class PaletteAutomationMixin:
    def _capture_layer_palette(self) -> Any:
        return self._capture_screen_rect(self.profile.layer_palette)

    def _scroll_layer_palette_to_top(self) -> None:
        for _ in range(self.profile.layer_palette_reset_scroll_steps):
            self._scroll_layer_palette(self.profile.layer_palette_scroll_page)

    def _scroll_layer_palette_down(self) -> None:
        self._scroll_layer_palette(-self.profile.layer_palette_scroll_page)

    def _scroll_layer_palette(self, wheel_dist: int) -> None:
        from pywinauto.mouse import scroll

        x = round((self.profile.layer_palette.left + self.profile.layer_palette.right) / 2)
        y = round((self.profile.layer_palette.top + self.profile.layer_palette.bottom) / 2)
        scroll(coords=(x, y), wheel_dist=wheel_dist)
        time.sleep(max(0.1, self.profile.after_timeline_operation_seconds))

    def _capture_screen_rect(self, rect: Any) -> Any:
        try:
            from PIL import ImageGrab
        except ImportError as exc:
            raise AutomationError("Pillow is required for CSP screen verification") from exc

        try:
            return ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).convert("RGB")
        except Exception as exc:
            raise AutomationError(f"failed to capture CSP screen area: {exc}") from exc

    def _palette_change_score(self, before: Any, after: Any) -> float:
        try:
            from PIL import ImageChops, ImageStat
        except ImportError as exc:
            raise AutomationError("Pillow is required for CSP layer palette verification") from exc

        if before.size != after.size:
            return 1.0
        diff = ImageChops.difference(before, after)
        stat = ImageStat.Stat(diff)
        return float(sum(stat.mean) / (len(stat.mean) * 255.0))

    def _palette_signature(self, image: Any) -> str:
        try:
            import hashlib
        except ImportError as exc:
            raise AutomationError("hashlib is required for CSP layer palette search") from exc

        sample = image.convert("L").resize((32, 96))
        return hashlib.sha1(sample.tobytes()).hexdigest()

    def _find_import_stack_anchor(
        self,
        before_palette: Any,
        after_palette: Any,
        manifest: CspImportCut | CspImportManifest,
        log: OperationLog,
    ) -> Any | None:
        from .vision import VisionError, find_import_stack_anchor, recognize_csp_layer_palette_text_lines

        delta_marker = _find_palette_delta_anchor(before_palette, after_palette)
        try:
            lines = recognize_csp_layer_palette_text_lines(after_palette)
        except VisionError as exc:
            log.add("ocr.failed", error=str(exc))
            lines = []
        ocr_marker = find_import_stack_anchor(
            lines,
            manifest.import_stack.start_separator,
            manifest.import_stack.end_separator,
        ) if lines else None
        log.add("ocr.layer_palette", lineCount=len(lines), lines=[line.text for line in lines[:20]])
        if delta_marker is not None:
            log.add(
                "xdts.import_stack_delta_anchor",
                y=delta_marker.line.center_y,
                top=delta_marker.line.top,
                bottom=delta_marker.line.bottom,
            )
        if ocr_marker is not None:
            log.add(
                "xdts.import_stack_ocr_anchor",
                marker=ocr_marker.kind,
                text=ocr_marker.line.text,
                y=ocr_marker.line.center_y,
            )
        if delta_marker is not None and ocr_marker is not None:
            distance = abs(delta_marker.line.center_y - ocr_marker.line.center_y)
            if distance > self.profile.row_height:
                log.add(
                    "xdts.import_stack_anchor_disagreement",
                    deltaY=delta_marker.line.center_y,
                    ocrY=ocr_marker.line.center_y,
                    distance=distance,
                )
        return ocr_marker

    @staticmethod
    def _click(x: int, y: int) -> None:
        from pywinauto.mouse import click

        click(button="left", coords=(x, y))

    @staticmethod
    def _move(x: int, y: int) -> None:
        from pywinauto.mouse import move

        move(coords=(x, y))


