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


class TrackSelectionMixin:
    def _select_track(self, track: ImportTrack, manifest: CspImportManifest, log: OperationLog) -> None:
        if self._select_track_by_current_stack_position(track, manifest, log):
            return
        raise AutomationError(
            "キーボード操作だけで対象アニメーションフォルダへ移動するためのCSPレイヤー選択位置を特定できません。"
            "タイムラインを有効にして開いた直後のCLIPから開始し、取り込み済み親フォルダを閉じたまま再実行してください。"
            f"対象: {track.track_id} ({track.xdts_track_name})"
        )

    def _select_visible_track(self, visible_row_index: int, log: OperationLog, track_id: str) -> None:
        point = self.profile.stack_row_point(visible_row_index, stack_anchor_y=self._stack_anchor_y)
        self._click(point.x, point.y)
        time.sleep(self.profile.after_track_click_seconds)
        log.add("track.selected", trackId=track_id, visibleRowIndex=visible_row_index, x=point.x, y=point.y)

    def _select_track_by_current_stack_position(
        self,
        track: ImportTrack,
        manifest: CspImportManifest,
        log: OperationLog,
    ) -> bool:
        if self._selected_stack_index is None:
            log.add("track.current_relative.unavailable", trackId=track.track_id)
            return False

        stack_names = self._load_stack_reference_names(manifest, track, log)
        if not stack_names:
            return False
        target_index = _resolve_xdts_stack_target_index(track, manifest, stack_names)
        log.add(
            "track.current_relative.resolved",
            trackId=track.track_id,
            currentIndex=self._selected_stack_index,
            target=track.xdts_track_name,
            targetIndex=target_index,
            stackNameCount=len(stack_names),
        )
        if target_index is None:
            return False

        # This assumes the previous batch left the closed parent animation folder selected.
        current_index = self._selected_stack_index
        delta = _visual_delta_from_xdts_indices(current_index, target_index)
        self._send_layer_selection_delta(delta)
        self._selected_stack_index = target_index
        log.add(
            "track.selected",
            trackId=track.track_id,
            target=track.xdts_track_name,
            method="current-stack-relative",
            currentIndex=current_index,
            targetIndex=target_index,
            visualDelta=delta,
        )
        return True

    def _select_track_by_import_stack_anchor(
        self,
        track: ImportTrack,
        manifest: CspImportManifest,
        log: OperationLog,
    ) -> bool:
        if self._stack_anchor_y is None or self._stack_anchor_kind not in {"start", "end"}:
            self._refresh_import_stack_anchor_for_selection(manifest, log)
        if self._stack_anchor_y is None or self._stack_anchor_kind not in {"start", "end"}:
            log.add(
                "track.anchor_relative.unavailable",
                trackId=track.track_id,
                anchorKind=self._stack_anchor_kind,
                hasAnchorY=self._stack_anchor_y is not None,
            )
            return False

        stack_names = self._load_stack_reference_names(manifest, track, log)
        if not stack_names:
            return False

        anchor_name = (
            manifest.import_stack.start_separator
            if self._stack_anchor_kind == "start"
            else manifest.import_stack.end_separator
        )
        anchor_index = _find_xdts_stack_name_index(stack_names, anchor_name)
        target_index = _resolve_xdts_stack_target_index(track, manifest, stack_names)
        log.add(
            "track.anchor_relative.resolved",
            trackId=track.track_id,
            anchorKind=self._stack_anchor_kind,
            anchorName=anchor_name,
            anchorIndex=anchor_index,
            target=track.xdts_track_name,
            targetIndex=target_index,
            stackNameCount=len(stack_names),
        )
        if anchor_index is None or target_index is None:
            return False

        delta = _visual_delta_from_xdts_indices(anchor_index, target_index)
        self._click(self.profile.row_click_x, self._stack_anchor_y)
        time.sleep(self.profile.after_anchor_click_seconds)
        self._send_layer_selection_delta(delta)
        self._selected_stack_index = target_index
        log.add(
            "track.selected",
            trackId=track.track_id,
            target=track.xdts_track_name,
            method="import-stack-anchor-relative",
            anchorKind=self._stack_anchor_kind,
            anchorIndex=anchor_index,
            targetIndex=target_index,
            visualDelta=delta,
            x=self.profile.row_click_x,
            y=self._stack_anchor_y,
        )
        return True

    def _load_stack_reference_names(
        self,
        manifest: CspImportManifest,
        track: ImportTrack,
        log: OperationLog,
    ) -> tuple[str, ...]:
        return self._load_stack_reference_names_for_manifest(manifest, log, track_id=track.track_id)

    def _load_stack_reference_names_for_manifest(
        self,
        manifest: CspImportManifest,
        log: OperationLog,
        *,
        track_id: str | None = None,
    ) -> tuple[str, ...]:
        path = manifest.stack_reference_xdts_path
        if self._stack_reference_path == path and self._stack_reference_names is not None:
            return self._stack_reference_names
        try:
            stack_names = _load_xdts_track_names(path)
        except AutomationError as exc:
            log.add("track.stack_reference.xdts_unreadable", trackId=track_id, error=str(exc))
            return ()
        if not stack_names:
            log.add("track.stack_reference.no_xdts_stack_names", trackId=track_id)
            return ()
        self._stack_reference_path = path
        self._stack_reference_names = stack_names
        return stack_names

    def _refresh_import_stack_anchor_for_selection(self, manifest: CspImportManifest, log: OperationLog) -> None:
        from .vision import VisionError, find_import_stack_anchor, recognize_csp_layer_palette_text_lines

        self._scroll_layer_palette_to_top()
        seen_signatures: set[str] = set()
        for scroll_index in range(self.profile.layer_palette_search_scroll_steps):
            palette = self._capture_layer_palette()
            signature = self._palette_signature(palette)
            if signature in seen_signatures and scroll_index > 0:
                break
            seen_signatures.add(signature)
            try:
                lines = recognize_csp_layer_palette_text_lines(palette)
            except VisionError as exc:
                log.add("track.anchor_relative.ocr_failed", error=str(exc), scrollIndex=scroll_index)
                lines = []
            marker = find_import_stack_anchor(
                lines,
                manifest.import_stack.start_separator,
                manifest.import_stack.end_separator,
            ) if lines else None
            if marker is not None and marker.kind in {"start", "end"}:
                self._stack_anchor_y = self.profile.layer_palette.top + marker.line.center_y
                self._stack_anchor_kind = marker.kind
                log.add(
                    "track.anchor_relative.refreshed",
                    marker=marker.kind,
                    text=marker.line.text,
                    y=marker.line.center_y,
                    scrollIndex=scroll_index,
                    stackAnchorY=self._stack_anchor_y,
                )
                return
            self._scroll_layer_palette_down()
        log.add("track.anchor_relative.refresh_failed")

    def _send_layer_selection_delta(self, visual_delta: int) -> None:
        if visual_delta == 0:
            return
        from pywinauto.keyboard import send_keys

        key = self.profile.select_layer_below_shortcut if visual_delta > 0 else self.profile.select_layer_above_shortcut
        for index in range(abs(visual_delta)):
            send_keys(key)
            if index % 8 == 7:
                time.sleep(self.profile.after_key_input_seconds)
        time.sleep(self.profile.after_layer_selection_seconds)

    def _select_track_by_layer_palette_search(
        self,
        track: ImportTrack,
        manifest: CspImportManifest,
        log: OperationLog,
    ) -> VisibleTrackMatch | None:
        self._scroll_layer_palette_to_top()
        seen_signatures: set[str] = set()
        for scroll_index in range(self.profile.layer_palette_search_scroll_steps):
            palette = self._capture_layer_palette()
            signature = self._palette_signature(palette)
            if signature in seen_signatures and scroll_index > 0:
                log.add(
                    "track.search.stopped",
                    trackId=track.track_id,
                    reason="palette repeated",
                    scrollIndex=scroll_index,
                )
                break
            seen_signatures.add(signature)

            match = self._find_visible_track_match(track, manifest, palette, log, scroll_index)
            if match is not None:
                click_y = self.profile.layer_palette.top + match.line.center_y
                self._click(self.profile.row_click_x, click_y)
                time.sleep(self.profile.after_track_click_seconds)
                stack_names = self._load_stack_reference_names(manifest, track, log)
                target_index = _resolve_xdts_stack_target_index(track, manifest, stack_names) if stack_names else None
                self._selected_stack_index = target_index
                log.add(
                    "track.selected",
                    trackId=track.track_id,
                    target=match.target_name,
                    text=match.line.text,
                    x=self.profile.row_click_x,
                    y=click_y,
                    scrollIndex=scroll_index,
                    method="ocr-scroll",
                    score=match.score,
                    contextHits=list(match.context_hits),
                    targetIndex=target_index,
                )
                return match
            self._scroll_layer_palette_down()
        log.add("track.search.not_found", trackId=track.track_id, target=track.xdts_track_name)
        return None

    def _find_visible_track_match(
        self,
        track: ImportTrack,
        manifest: CspImportManifest,
        palette: Any,
        log: OperationLog,
        scroll_index: int,
    ) -> VisibleTrackMatch | None:
        from .vision import VisionError, find_csp_layer_row_lines, recognize_csp_layer_palette_text_lines

        try:
            lines = recognize_csp_layer_palette_text_lines(palette)
        except VisionError as exc:
            log.add("track.search.ocr_failed", trackId=track.track_id, error=str(exc), scrollIndex=scroll_index)
            return None

        target_names = _track_search_target_names(track)
        context_names = _track_context_names(track)
        duplicate_count = _manifest_track_name_count(manifest, track.xdts_track_name)
        candidates: list[VisibleTrackMatch] = []
        for target_name in target_names:
            for line in find_csp_layer_row_lines(lines, target_name):
                score, hits = _score_track_context(line, lines, context_names, self.profile.layer_palette_context_search_px)
                candidates.append(
                    VisibleTrackMatch(
                        track_id=track.track_id,
                        target_name=target_name,
                        line=line,
                        score=score,
                        context_hits=hits,
                    )
                )
        log.add(
            "track.search.ocr",
            trackId=track.track_id,
            scrollIndex=scroll_index,
            targets=target_names,
            duplicateNameCount=duplicate_count,
            contextNames=context_names,
            visualOccurrenceIndex=_visual_occurrence_index(track, manifest),
            matches=[
                {
                    "target": item.target_name,
                    "text": item.line.text,
                    "y": item.line.center_y,
                    "score": item.score,
                    "contextHits": list(item.context_hits),
                }
                for item in candidates
            ],
        )
        if not candidates:
            return None
        if track.visible_row_index is not None:
            expected_y = self.profile.stack_row_point(track.visible_row_index, stack_anchor_y=self._stack_anchor_y).y
            return min(candidates, key=lambda item: abs((self.profile.layer_palette.top + item.line.center_y) - expected_y))
        if duplicate_count > 1:
            contextual = [candidate for candidate in candidates if candidate.score > 0]
            if not contextual:
                log.add(
                    "track.search.ambiguous_same_name_without_context",
                    trackId=track.track_id,
                    target=track.xdts_track_name,
                    duplicateNameCount=duplicate_count,
                    contextNames=context_names,
                    scrollIndex=scroll_index,
                )
                return None
            best_score = max(candidate.score for candidate in contextual)
            best = [candidate for candidate in contextual if candidate.score == best_score]
            if len(best) > 1:
                log.add(
                    "track.search.ambiguous_same_name_context_tie",
                    trackId=track.track_id,
                    target=track.xdts_track_name,
                    duplicateNameCount=duplicate_count,
                    candidates=[
                        {
                            "text": candidate.line.text,
                            "y": candidate.line.center_y,
                            "score": candidate.score,
                            "contextHits": list(candidate.context_hits),
                        }
                        for candidate in best
                    ],
                    scrollIndex=scroll_index,
                )
                return None
            return best[0]
        return max(candidates, key=lambda item: (item.score, -item.line.center_y))

