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


class AutomationError(RuntimeError):
    pass


class AutomationPaused(RuntimeError):
    pass


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


class CspImportAutomation:
    def __init__(
        self,
        profile: WorkspaceProfile = DEFAULT_PROFILE,
        *,
        cancel_event: CancellationToken | None = None,
        stop_file: str | Path | None = None,
        pause_on_unhandled_dialog: bool = True,
        progress_callback: ProgressCallback | None = None,
        speed_mode: str = "standard",
    ) -> None:
        self.profile = replace(
            profile,
            rasterize_after_image_import=True,
            close_imported_track_folder_after_image_import=True,
        )
        self.speed_mode = speed_mode
        self.cancel_event = cancel_event
        self.stop_file = Path(stop_file).expanduser().resolve() if stop_file else None
        self.pause_on_unhandled_dialog = pause_on_unhandled_dialog
        self.progress_callback = progress_callback
        self._csp_process_id: int | None = None
        self._stack_anchor_y: int | None = None
        self._stack_anchor_kind: str | None = None
        self._selected_stack_index: int | None = None
        self._stack_reference_path: Path | None = None
        self._stack_reference_names: tuple[str, ...] | None = None
        self._handled_dialog_keys: set[tuple[int | None, str]] = set()

    def run(
        self,
        manifest: CspImportManifest,
        log: OperationLog,
        import_limit: int | None = None,
        *,
        clip_path: str | Path | None = None,
        save_as_path: str | Path | None = None,
        close_after_save: bool = False,
    ) -> None:
        plan = build_import_execution_plan(
            manifest,
            clip_path=clip_path,
            save_as_path=save_as_path,
            close_after_save=close_after_save,
            import_limit=import_limit,
        )
        self._progress(
            "run.started",
            cutCount=len(manifest.cuts),
            importCount=plan.import_count,
            stepCount=len(plan.visible_steps),
        )
        log.add(
            "automation.timing_profile",
            speedMode=self.speed_mode,
            afterDialogSeconds=self.profile.after_dialog_seconds,
            afterXdtsImportSeconds=self.profile.after_xdts_import_seconds,
            afterImageImportSeconds=self.profile.after_image_import_seconds,
            afterBatchImageImportBaseSeconds=self.profile.after_batch_image_import_base_seconds,
            afterBatchImageImportPerFileSeconds=self.profile.after_batch_image_import_per_file_seconds,
            afterRasterizeSeconds=self.profile.after_rasterize_seconds,
            afterBlendModeChangeSeconds=self.profile.after_blend_mode_change_seconds,
            afterTimelineOperationSeconds=self.profile.after_timeline_operation_seconds,
            afterSaveAsSeconds=self.profile.after_save_as_seconds,
            afterKeyInputSeconds=self.profile.after_key_input_seconds,
            afterTextPasteSeconds=self.profile.after_text_paste_seconds,
            dialogPollIntervalSeconds=self.profile.dialog_poll_interval_seconds,
        )
        for step in plan.steps:
            self._run_plan_step(step, manifest, log)
        self._progress("run.finished")

    def _progress(self, event: str, **payload: Any) -> None:
        if self.progress_callback is None:
            return
        try:
            self.progress_callback(event, payload)
        except Exception:
            return

    def _progress_step_start(self, label: str, **payload: Any) -> None:
        self._progress("step.start", label=label, **payload)

    def _progress_step_done(self, label: str, **payload: Any) -> None:
        self._progress("step.done", label=label, **payload)

    def _run_plan_step(self, step: ImportExecutionStep, manifest: CspImportManifest, log: OperationLog) -> None:
        if not step.visible:
            self._execute_plan_step(step, manifest, log)
            return
        self._progress_step_start(step.label, **step.payload)
        self._execute_plan_step(step, manifest, log)
        self._progress_step_done(step.label, **step.payload)

    def _execute_plan_step(self, step: ImportExecutionStep, manifest: CspImportManifest, log: OperationLog) -> None:
        if step.kind == STEP_OPEN_CLIP:
            if step.path is None:
                raise AutomationError("CLIP path is missing from import plan.")
            self._open_clip_file(step.path, log)
            return
        if step.kind == STEP_FOCUS_CSP:
            self._focus_csp(log)
            return
        if step.kind == STEP_CHECK_CONTROL:
            self._check_control(log, step.phase or "control checkpoint")
            return
        if step.kind == STEP_MOVE_FIRST_TIMELINE:
            self._move_to_first_timeline(manifest, log)
            return
        if step.kind == STEP_PREPARE_XDTS_IMPORT:
            self._ensure_timeline_enabled(log, reason="xdts import")
            return
        if step.kind == STEP_IMPORT_SETUP_XDTS:
            self._import_setup_xdts(manifest, log)
            return
        if step.kind == STEP_CREATE_TIMELINE:
            if step.cut is None or step.cut_index is None:
                raise AutomationError("timeline creation step is missing cut metadata.")
            self._create_new_timeline(step.cut, step.cut_index, log)
            return
        if step.kind == STEP_IMPORT_CUT_XDTS:
            if step.cut is None:
                raise AutomationError("XDTS import step is missing cut metadata.")
            self._import_xdts(step.cut, log, verify_layer_stack=step.cut_index == 0 and manifest.setup is None)
            return
        if step.kind == STEP_RENAME_TIMELINE:
            if step.cut is None:
                raise AutomationError("timeline rename step is missing cut metadata.")
            self._rename_current_timeline(step.cut, log)
            return
        if step.kind == STEP_MARK_IMPORT_END_SELECTED:
            self._mark_import_end_selected(manifest, log, reason="xdts import complete")
            return
        if step.kind == STEP_MOVE_FIRST_TIMELINE_FOR_ASSETS:
            self._move_to_first_timeline(manifest, log)
            return
        if step.kind == STEP_DISABLE_TIMELINE_FOR_ASSETS:
            self._ensure_timeline_disabled(log, reason="asset import")
            return
        if step.kind == STEP_IMPORT_TRACK_ASSETS:
            if step.batch is None:
                raise AutomationError("asset import step is missing track batch.")
            self._select_track(step.batch.track, manifest, log)
            self._import_track_images(step.batch.track, step.batch.items, manifest, log)
            return
        if step.kind == STEP_ENABLE_TIMELINE:
            self._restore_timeline_enabled(log, reason="finish")
            return
        if step.kind == STEP_SAVE_AS_CLIP:
            if step.path is None:
                raise AutomationError("Save As path is missing from import plan.")
            self._save_as_clip(step.path, log)
            return
        if step.kind == STEP_CLOSE_CLIP:
            self._close_current_document(log)
            return
        raise AutomationError(f"unsupported import plan step: {step.kind}")

    def _check_control(self, log: OperationLog, phase: str) -> None:
        if self.cancel_event is not None and self.cancel_event.is_set():
            log.add("automation.paused", phase=phase, reason="cancel requested")
            raise AutomationPaused(f"CSP automation paused during {phase}: cancel requested.")
        if self.stop_file is not None and self.stop_file.exists():
            log.add("automation.paused", phase=phase, reason="stop file", stopFile=str(self.stop_file))
            raise AutomationPaused(f"CSP automation paused during {phase}: stop file exists: {self.stop_file}")
        self._pause_if_unhandled_csp_modal(log, phase)

    def _sleep_with_control(self, seconds: float, log: OperationLog, phase: str) -> None:
        deadline = time.monotonic() + max(0.0, seconds)
        while True:
            self._check_control(log, phase)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return
            time.sleep(min(max(0.02, self.profile.dialog_poll_interval_seconds), 0.2, remaining))

    def _open_clip_file(self, clip_path: Path, log: OperationLog) -> None:
        clip_path = clip_path.expanduser().resolve()
        if not clip_path.is_file():
            raise AutomationError(f"CLIP file was not found: {clip_path}")
        if clip_path.suffix.lower() != ".clip":
            raise AutomationError(f"CLIP file path must end with .clip: {clip_path}")
        os.startfile(str(clip_path))  # type: ignore[attr-defined]
        deadline = time.monotonic() + 20.0
        while time.monotonic() < deadline:
            probe = probe_csp_window(self.profile)
            if probe.found:
                log.add("clip.opened", path=str(clip_path), title=probe.title, rect=probe.rect)
                time.sleep(self.profile.after_clip_open_seconds)
                return
            time.sleep(min(0.25, max(0.05, self.profile.dialog_poll_interval_seconds * 3)))
        raise AutomationError(f"CSP did not open after launching CLIP file: {clip_path}")

    def _move_to_first_timeline(self, manifest: CspImportManifest, log: OperationLog) -> None:
        steps = max(1, len(manifest.cuts) + 1)
        for _ in range(steps):
            self._send_shortcut(self.profile.previous_timeline_shortcut)
            time.sleep(self.profile.after_key_input_seconds)
        time.sleep(self.profile.after_timeline_operation_seconds)
        log.add(
            "timeline.moved_to_first",
            shortcut=self.profile.previous_timeline_shortcut,
            attempts=steps,
        )

    def _mark_import_end_selected(self, manifest: CspImportManifest, log: OperationLog, *, reason: str) -> None:
        stack_names = self._load_stack_reference_names_for_manifest(manifest, log)
        end_index = _find_xdts_stack_name_index(stack_names, manifest.import_stack.end_separator) if stack_names else None
        self._selected_stack_index = end_index
        log.add(
            "track.keyboard_position_assumed",
            reason=reason,
            selected=manifest.import_stack.end_separator,
            stackIndex=end_index,
            stackNameCount=len(stack_names),
        )

    def _import_setup_xdts(self, manifest: CspImportManifest, log: OperationLog) -> None:
        if manifest.setup is None:
            return
        log.add("xdts.setup_import_started", path=str(manifest.setup.xdts_path), purpose=manifest.setup.purpose)
        self._import_xdts_path(manifest.setup.xdts_path, manifest, log, verify_layer_stack=True)
        log.add("xdts.setup_imported", path=str(manifest.setup.xdts_path), purpose=manifest.setup.purpose)

    def _ensure_timeline_enabled(self, log: OperationLog, *, reason: str) -> None:
        log.add(
            "timeline.ready_state_assumed",
            requestedEnabled=True,
            reason=reason,
            contract="operator opens CLIP with timeline enabled",
        )

    def _ensure_timeline_disabled(self, log: OperationLog, *, reason: str) -> None:
        self._send_timeline_toggle(log, 1)
        log.add("timeline.state_changed", requestedEnabled=False, reason=reason, verified=False)

    def _restore_timeline_enabled(self, log: OperationLog, *, reason: str) -> None:
        self._send_timeline_toggle(log, 1)
        log.add("timeline.restore_sent", requestedEnabled=True, reason=reason, verified=False)

    def _ensure_timeline_state(self, enabled: bool, log: OperationLog, *, reason: str) -> None:
        current = self._read_timeline_enabled_from_menu(log, reason=reason, attempt=1)
        if current == enabled:
            log.add("timeline.state_already_ok", enabled=enabled, reason=reason)
            return
        self._send_timeline_toggle(log, 1)
        updated = self._read_timeline_enabled_from_menu(log, reason=reason, attempt=2)
        if updated != enabled:
            target = "enabled" if enabled else "disabled"
            raise AutomationError(f"CSP timeline could not be set to {target} for {reason}.")
        log.add("timeline.state_changed", enabled=enabled, reason=reason)

    def _import_all_cut_xdts(self, manifest: CspImportManifest, log: OperationLog) -> None:
        for index, cut in enumerate(manifest.cuts):
            if index > 0:
                self._progress_step_start(f"新規タイムライン作成: {cut.timeline_name}", cutNumber=cut.cut_number)
                self._create_new_timeline(cut, index, log)
                self._progress_step_done(f"新規タイムライン作成: {cut.timeline_name}", cutNumber=cut.cut_number)
            self._progress_step_start(f"XDTS読み込み: {cut.timeline_name}", path=str(cut.xdts_path))
            self._import_xdts(cut, log, verify_layer_stack=index == 0 and manifest.setup is None)
            self._progress_step_done(f"XDTS読み込み: {cut.timeline_name}", path=str(cut.xdts_path))
            self._progress_step_start(f"タイムライン名設定: {cut.timeline_name}", cutNumber=cut.cut_number)
            self._rename_current_timeline(cut, log)
            self._progress_step_done(f"タイムライン名設定: {cut.timeline_name}", cutNumber=cut.cut_number)

    def _create_new_timeline(self, cut: CspImportCut, index: int, log: OperationLog) -> None:
        self._send_shortcut(self.profile.new_timeline_shortcut)
        dialog = self._wait_for_csp_dialog("CSP new timeline dialog did not open")
        self._submit_dialog_with_enter(dialog)
        time.sleep(self.profile.after_timeline_operation_seconds)
        log.add(
            "timeline.created",
            cutId=cut.cut_id,
            cutNumber=cut.cut_number,
            index=index,
            shortcut=self.profile.new_timeline_shortcut,
        )

    def _rename_current_timeline(self, cut: CspImportCut, log: OperationLog) -> None:
        timeline_name = cut.timeline_name
        self._send_shortcut(self.profile.timeline_settings_shortcut)
        dialog = self._wait_for_csp_dialog("CSP timeline settings dialog did not open")
        self._submit_timeline_name_dialog(dialog, timeline_name)
        time.sleep(self.profile.after_timeline_operation_seconds)
        log.add(
            "timeline.renamed",
            cutId=cut.cut_id,
            cutNumber=cut.cut_number,
            timelineName=timeline_name,
            shortcut=self.profile.timeline_settings_shortcut,
            method="accelerator-alt-n",
        )

    def _focus_csp(self, log: OperationLog) -> None:
        try:
            from pywinauto import Desktop
        except ImportError as exc:
            raise AutomationError("pywinauto is required for CSP automation") from exc

        window = Desktop(backend="uia").window(title_re=self.profile.csp_title_regex)
        if not window.exists(timeout=2):
            raise AutomationError("CLIP STUDIO PAINT window was not found")
        window.set_focus()
        time.sleep(self.profile.after_focus_seconds)
        self._csp_process_id = window.process_id()
        log.add("csp.focused", title=window.window_text(), processId=window.process_id(), handle=window.handle)

    def _import_xdts(
        self,
        manifest: CspImportCut | CspImportManifest,
        log: OperationLog,
        *,
        verify_layer_stack: bool = True,
    ) -> None:
        self._import_xdts_path(manifest.xdts_path, manifest, log, verify_layer_stack=verify_layer_stack)

    def _import_xdts_path(
        self,
        xdts_path: Path,
        manifest: CspImportCut | CspImportManifest,
        log: OperationLog,
        *,
        verify_layer_stack: bool = True,
    ) -> None:
        self._selected_stack_index = None
        self._open_file_import_timesheet_dialog()
        self._submit_file_dialog_path(xdts_path, log=log, phase=f"XDTS import {xdts_path.name}")
        self._sleep_with_control(self.profile.after_xdts_import_seconds, log, f"XDTS import {xdts_path.name}")
        log.add(
            "xdts.imported",
            path=str(xdts_path),
            verifiedLayerStack=False,
            contract="CSP selects IMPORT END after this helper's XDTS import",
        )

    def _ensure_timeline_disabled_after_xdts(self, log: OperationLog) -> None:
        """Disable CSP timeline editing and verify the state from the CSP menu.

        XDTS import itself expects the target CLIP to have timeline editing
        enabled. After the XDTS stack is created, image import into animation
        folders must happen with the timeline disabled; otherwise CSP can mutate
        the timeline created by XDTS while registering image cels.
        """

        self._ensure_timeline_disabled(log, reason="asset import")

    def _send_timeline_toggle(self, log: OperationLog, attempt: int) -> None:
        from pywinauto.keyboard import send_keys

        send_keys(self.profile.timeline_toggle_shortcut)
        time.sleep(self.profile.after_timeline_toggle_seconds)
        log.add("timeline.toggle_sent", shortcut=self.profile.timeline_toggle_shortcut, attempt=attempt)

    def _read_timeline_enabled_from_menu(self, log: OperationLog, *, reason: str, attempt: int) -> bool:
        from pywinauto.keyboard import send_keys

        self._open_timeline_menu()
        try:
            check_image = self._capture_screen_rect(self.profile.timeline_enabled_check_rect)
            stats = _timeline_menu_check_area_stats(check_image)
            if stats["darkRatio"] < 0.08:
                log.add("timeline.menu_state_unreadable", attempt=attempt, reason=reason, **stats)
                raise AutomationError(
                    "CSP animation/timeline menu could not be verified on screen. "
                    "Stopping before asset import."
                )
            score = stats["checkmarkScore"]
            enabled = score >= self.profile.timeline_checkmark_score_threshold
            log.add(
                "timeline.menu_state",
                attempt=attempt,
                reason=reason,
                **stats,
                threshold=self.profile.timeline_checkmark_score_threshold,
                enabled=enabled,
            )
            return enabled
        finally:
            send_keys("{ESC}")
            time.sleep(self.profile.after_key_input_seconds)
            send_keys("{ESC}")
            time.sleep(self.profile.after_key_input_seconds)

    def _verify_timeline_disabled_from_menu(self, log: OperationLog, attempt: int) -> bool:
        return not self._read_timeline_enabled_from_menu(log, reason="legacy disabled check", attempt=attempt)

    def _open_timeline_menu(self) -> None:
        self._send_menu_accelerators(ord("A"), (ord("M"),))
        time.sleep(max(self.profile.after_dialog_seconds, self.profile.dialog_poll_interval_seconds))

    def _import_image(self, image_path: Path, log: OperationLog, track_id: str, csp_cell_name: str) -> None:
        self._import_images((image_path,), log, track_id, (csp_cell_name,))

    def _import_images(
        self,
        image_paths: tuple[Path, ...],
        log: OperationLog,
        track_id: str,
        csp_cell_names: tuple[str, ...],
    ) -> None:
        if len(image_paths) != len(csp_cell_names):
            raise AutomationError("image path count and CSP cel name count do not match")
        if not image_paths:
            return
        self._open_file_import_image_dialog()
        self._submit_file_dialog_paths(image_paths, log=log, phase=f"image import {track_id}")
        wait_seconds = self.profile.after_image_import_seconds
        if len(image_paths) > 1:
            wait_seconds = (
                self.profile.after_batch_image_import_base_seconds
                + self.profile.after_batch_image_import_per_file_seconds * len(image_paths)
            )
        self._sleep_with_control(wait_seconds, log, f"image import {track_id}")
        self._rasterize_selected_imported_layers(log, track_id, csp_cell_names)
        self._select_parent_folder_after_asset_import(log, track_id, csp_cell_names)
        for image_path, csp_cell_name in zip(image_paths, csp_cell_names, strict=True):
            log.add("asset.imported", trackId=track_id, cspCellName=csp_cell_name, path=str(image_path))
        if len(image_paths) > 1:
            log.add(
                "asset.batch_imported",
                trackId=track_id,
                count=len(image_paths),
                cspCellNames=list(csp_cell_names),
                paths=[str(path) for path in image_paths],
            )

    def _rasterize_selected_imported_layers(
        self,
        log: OperationLog,
        track_id: str,
        csp_cell_names: tuple[str, ...],
    ) -> None:
        if not csp_cell_names:
            return

        self._open_layer_rasterize_command()
        self._sleep_with_control(self.profile.after_rasterize_seconds, log, f"rasterize {track_id}")
        log.add(
            "asset.batch_rasterized",
            trackId=track_id,
            count=len(csp_cell_names),
            cspCellNames=list(csp_cell_names),
        )

    def _select_parent_folder_after_asset_import(
        self,
        log: OperationLog,
        track_id: str,
        csp_cell_names: tuple[str, ...],
    ) -> None:
        if not csp_cell_names:
            return

        self._send_shortcut(self.profile.select_layer_above_shortcut)
        time.sleep(self.profile.after_parent_folder_select_seconds)
        log.add(
            "track.parent_folder_selected_after_import",
            trackId=track_id,
            shortcut=self.profile.select_layer_above_shortcut,
            count=len(csp_cell_names),
        )

    def _finish_imported_track_folder(
        self,
        track: ImportTrack,
        manifest: CspImportManifest,
        log: OperationLog,
    ) -> None:
        self._close_selected_imported_track_folder(track, log)
        if not self.profile.set_imported_track_blend_mode_to_multiply:
            log.add(
                "track.blend_mode_skipped",
                trackId=track.track_id,
                target=track.xdts_track_name,
                reason="disabled by profile",
            )
            return

        self._set_selected_layer_blend_mode_to_multiply(log, track.track_id, track.xdts_track_name)

    def _close_selected_imported_track_folder(self, track: ImportTrack, log: OperationLog) -> None:
        self._send_shortcut(self.profile.toggle_folder_children_shortcut)
        time.sleep(self.profile.after_folder_toggle_seconds)
        log.add(
            "track.folder_closed",
            trackId=track.track_id,
            target=track.xdts_track_name,
            shortcut=self.profile.toggle_folder_children_shortcut,
        )

    def _set_selected_layer_blend_mode_to_multiply(
        self,
        log: OperationLog,
        track_id: str,
        target_name: str,
    ) -> None:
        if self.profile.set_multiply_shortcut.strip():
            self._send_shortcut(self.profile.set_multiply_shortcut)
        else:
            self._click(self.profile.blend_mode_dropdown.x, self.profile.blend_mode_dropdown.y)
            time.sleep(self.profile.after_key_input_seconds)
            self._send_blend_mode_selection_keys(self.profile.blend_mode_multiply_down_steps)
        self._sleep_with_control(self.profile.after_blend_mode_change_seconds, log, f"blend mode {track_id}")
        log.add("track.blend_mode_set", trackId=track_id, target=target_name, mode="multiply")

    def _save_as_clip(self, save_as_path: Path, log: OperationLog) -> None:
        save_as_path = _resolve_save_as_clip_path(save_as_path)
        save_as_path.parent.mkdir(parents=True, exist_ok=True)
        backup_path: Path | None = None
        try:
            if save_as_path.exists():
                backup_path = _move_existing_save_as_backup(save_as_path)
                log.add("clip.save_as_existing_backed_up", path=str(save_as_path), backupPath=str(backup_path))

            self._send_shortcut(self.profile.save_as_shortcut)
            self._submit_file_dialog_path(save_as_path, log=log, phase="save as CLIP")
            self._sleep_with_control(self.profile.after_save_as_seconds, log, "save as CLIP")
            self._wait_for_saved_clip(save_as_path, log)
            if backup_path is not None:
                _delete_save_as_backup(backup_path, log)
            log.add("clip.saved_as", path=str(save_as_path), shortcut=self.profile.save_as_shortcut)
        except Exception:
            if backup_path is not None:
                _restore_save_as_backup(save_as_path, backup_path, log)
            raise

    def _wait_for_saved_clip(self, save_as_path: Path, log: OperationLog) -> None:
        deadline = time.monotonic() + self.profile.file_dialog_timeout_seconds
        while time.monotonic() < deadline:
            self._check_control(log, "save as CLIP")
            if save_as_path.is_file():
                return
            time.sleep(self.profile.dialog_poll_interval_seconds)
        raise AutomationError(f"CSP Save As did not create the output CLIP file: {save_as_path}")

    def _close_current_document(self, log: OperationLog) -> None:
        self._send_shortcut("^w")
        self._sleep_with_control(self.profile.after_close_document_seconds, log, "close CLIP")
        log.add("clip.close_sent")

    def _send_blend_mode_selection_keys(self, down_steps: int) -> None:
        from pywinauto.keyboard import send_keys

        send_keys("{HOME}")
        time.sleep(self.profile.after_key_input_seconds)
        for _ in range(down_steps):
            send_keys("{DOWN}")
            time.sleep(self.profile.after_key_input_seconds)
        send_keys("{ENTER}")

    def _import_track_images(
        self,
        track: ImportTrack,
        items: tuple[dict[str, Any], ...],
        manifest: CspImportManifest,
        log: OperationLog,
    ) -> None:
        log.add("track.import_batch_started", trackId=track.track_id, count=len(items))
        self._ensure_batch_asset_names_match_csp_cell_names(track, items)
        image_paths = tuple(Path(item["assetPath"]) for item in items)
        csp_cell_names = tuple(str(item["cspCellName"]) for item in items)
        if self.profile.multi_image_import_enabled:
            self._import_images(image_paths, log, track.track_id, csp_cell_names)
            self._finish_imported_track_folder(track, manifest, log)
        else:
            for image_path, csp_cell_name in zip(image_paths, csp_cell_names, strict=True):
                self._import_image(image_path, log, track.track_id, csp_cell_name)
                self._finish_imported_track_folder(track, manifest, log)
        log.add("track.import_batch_finished", trackId=track.track_id, count=len(items))

    def _ensure_batch_asset_names_match_csp_cell_names(
        self,
        track: ImportTrack,
        items: tuple[dict[str, Any], ...],
    ) -> None:
        mismatches = [
            (Path(item["assetPath"]).name, str(item["cspCellName"]))
            for item in items
            if Path(item["assetPath"]).stem != str(item["cspCellName"])
        ]
        if not mismatches:
            return
        details = ", ".join(f"{file_name} != {cell_name}" for file_name, cell_name in mismatches[:5])
        if len(mismatches) > 5:
            details += f", ... +{len(mismatches) - 5}"
        raise AutomationError(
            "CSP image import creates cel names from file names. "
            f"Manifest asset file stems must match cspCellName: {track.track_id}: {details}"
        )

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

    def _click_file_import_submenu(self) -> None:
        self._click(self.profile.file_menu.x, self.profile.file_menu.y)
        time.sleep(self.profile.after_key_input_seconds)
        self._move(self.profile.import_menu_row.x, self.profile.import_menu_row.y)
        time.sleep(self.profile.after_key_input_seconds)

    def _open_file_import_timesheet_dialog(self) -> None:
        if self.profile.import_xdts_shortcut.strip():
            self._send_shortcut(self.profile.import_xdts_shortcut)
        else:
            self._send_menu_accelerators(ord("F"), (ord("I"), ord("T")))

    def _open_file_import_image_dialog(self) -> None:
        if self.profile.import_image_shortcut.strip():
            self._send_shortcut(self.profile.import_image_shortcut)
        else:
            self._send_menu_accelerators(ord("F"), (ord("I"), 0x0D))

    def _open_layer_rasterize_command(self) -> None:
        if self.profile.rasterize_shortcut.strip():
            self._send_shortcut(self.profile.rasterize_shortcut)
        else:
            self._send_menu_accelerators(ord("L"), (ord("Z"),))

    @staticmethod
    def _send_shortcut(shortcut: str) -> None:
        if not shortcut.strip():
            return
        from pywinauto.keyboard import send_keys

        send_keys(shortcut)

    def _send_menu_accelerators(self, top_menu_key: int, submenu_keys: tuple[int, ...]) -> None:
        """Drive CSP menus through Win32 accelerator keys.

        CSP exposes accelerator letters in its Japanese menus, but pywinauto's
        high-level ``send_keys("%{F}")`` path does not reliably open those menus
        in CSP. Low-level virtual-key events match real keyboard input and avoid
        resolution-dependent dropdown coordinates for common menu commands.
        """

        self._send_alt_virtual_key(top_menu_key)
        for key in submenu_keys:
            self._send_virtual_key(key)

    def _send_alt_virtual_key(self, key: int) -> None:
        try:
            import win32api  # type: ignore[import-not-found]
            import win32con  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AutomationError("pywin32 is required for CSP menu accelerator input") from exc

        win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
        time.sleep(self.profile.after_key_input_seconds)
        try:
            self._send_virtual_key(key)
        finally:
            win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
        time.sleep(self.profile.after_key_input_seconds)

    def _send_virtual_key(self, key: int) -> None:
        try:
            import win32api  # type: ignore[import-not-found]
            import win32con  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AutomationError("pywin32 is required for CSP virtual-key input") from exc

        win32api.keybd_event(key, 0, 0, 0)
        time.sleep(self.profile.after_key_input_seconds)
        win32api.keybd_event(key, 0, win32con.KEYEVENTF_KEYUP, 0)
        time.sleep(self.profile.after_key_input_seconds)

    def _submit_file_dialog_path(
        self,
        path: Path,
        *,
        log: OperationLog | None = None,
        phase: str = "file dialog",
    ) -> None:
        self._submit_file_dialog_paths((path,), log=log, phase=phase)

    def _submit_file_dialog_paths(
        self,
        paths: tuple[Path, ...],
        *,
        log: OperationLog | None = None,
        phase: str = "file dialog",
    ) -> None:
        if not paths:
            raise AutomationError("at least one file path is required for the CSP file dialog")
        try:
            import pyperclip  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AutomationError("pyperclip is required to paste file paths into CSP dialogs") from exc

        from pywinauto.keyboard import send_keys

        dialog = self._wait_for_file_dialog(log=log, phase=phase)
        dialog.set_focus()
        self._focus_file_dialog_path_field(dialog)
        pyperclip.copy(_format_file_dialog_paths(paths))
        send_keys("^a")
        time.sleep(self.profile.after_key_input_seconds)
        send_keys("^v")
        time.sleep(self.profile.after_text_paste_seconds)
        send_keys("{ENTER}")
        self._wait_for_file_dialog_closed(dialog)

    def _wait_for_file_dialog(
        self,
        *,
        log: OperationLog | None = None,
        phase: str = "file dialog",
    ) -> Any:
        deadline = time.monotonic() + self.profile.file_dialog_timeout_seconds
        while time.monotonic() < deadline:
            dialog = self._find_csp_file_dialog()
            if dialog is not None:
                return dialog
            if log is not None:
                self._pause_if_unhandled_csp_modal(log, phase)
            time.sleep(self.profile.dialog_poll_interval_seconds)
        raise AutomationError("CSP file dialog did not open after selecting an import command")

    def _wait_for_file_dialog_closed(self, dialog: Any) -> None:
        deadline = time.monotonic() + self.profile.file_dialog_timeout_seconds
        while time.monotonic() < deadline:
            try:
                if not dialog.exists(timeout=self.profile.dialog_poll_interval_seconds):
                    return
            except Exception:
                return
            time.sleep(self.profile.dialog_poll_interval_seconds)
        raise AutomationError("CSP file dialog did not close after submitting the file path")

    def _wait_for_csp_dialog(self, timeout_message: str) -> Any:
        deadline = time.monotonic() + self.profile.file_dialog_timeout_seconds
        while time.monotonic() < deadline:
            dialog = self._find_csp_dialog()
            if dialog is not None:
                return dialog
            time.sleep(self.profile.dialog_poll_interval_seconds)
        raise AutomationError(timeout_message)

    def _submit_dialog_with_enter(self, dialog: Any) -> None:
        from pywinauto.keyboard import send_keys

        dialog.set_focus()
        send_keys("{ENTER}")
        self._wait_for_file_dialog_closed(dialog)

    def _submit_dialog_text(self, dialog: Any, text: str) -> None:
        try:
            import pyperclip  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AutomationError("pyperclip is required to paste text into CSP dialogs") from exc

        from pywinauto.keyboard import send_keys

        dialog.set_focus()
        self._focus_dialog_edit_field(dialog, field_index=0)
        pyperclip.copy(text)
        send_keys("^a")
        time.sleep(self.profile.after_key_input_seconds)
        send_keys("^v")
        time.sleep(self.profile.after_text_paste_seconds)
        send_keys("{ENTER}")
        self._wait_for_file_dialog_closed(dialog)

    def _submit_timeline_name_dialog(self, dialog: Any, text: str) -> None:
        try:
            import pyperclip  # type: ignore[import-not-found]
        except ImportError as exc:
            raise AutomationError("pyperclip is required to paste text into CSP dialogs") from exc

        from pywinauto.keyboard import send_keys

        dialog.set_focus()
        pyperclip.copy(text)
        send_keys("%n")
        time.sleep(self.profile.after_key_input_seconds)
        send_keys("^a")
        time.sleep(self.profile.after_key_input_seconds)
        send_keys("{BACKSPACE}")
        time.sleep(self.profile.after_key_input_seconds)
        send_keys("^v")
        time.sleep(self.profile.after_text_paste_seconds)
        send_keys("{ENTER}")
        try:
            self._wait_for_file_dialog_closed(dialog)
        except AutomationError:
            self._submit_dialog_text(dialog, text)

    def _find_csp_file_dialog(self) -> Any | None:
        try:
            from pywinauto import Desktop
        except ImportError as exc:
            raise AutomationError("pywinauto is required for CSP file dialogs") from exc

        for backend in ("uia", "win32"):
            try:
                windows = Desktop(backend=backend).windows()
            except Exception:
                continue
            for window in windows:
                if _safe_class_name(window) != "#32770":
                    continue
                if not _safe_visible(window):
                    continue
                process_id = _safe_process_id(window)
                if self._csp_process_id is not None and process_id != self._csp_process_id:
                    continue
                title = _safe_text(window)
                if "CSP取り込みヘルパー" in title:
                    continue
                if not _looks_like_windows_file_dialog(window):
                    continue
                return window
        return None

    def _pause_if_unhandled_csp_modal(self, log: OperationLog, phase: str) -> None:
        if not self.pause_on_unhandled_dialog or self._csp_process_id is None:
            return
        dialog = self._find_unhandled_csp_modal()
        if dialog is None:
            return
        if self._handle_known_csp_modal(dialog, log, phase):
            return
        snapshot = self._capture_unhandled_dialog(dialog, log, phase)
        raise AutomationPaused(
            f"CSP displayed an unhandled modal dialog during {phase}. "
            f"Helper stopped without sending further CSP commands. Snapshot: {snapshot or '(capture failed)'}"
        )

    def _find_csp_dialog(self) -> Any | None:
        file_dialog = self._find_csp_file_dialog()
        if file_dialog is not None:
            return file_dialog

        try:
            from pywinauto import Desktop
        except ImportError as exc:
            raise AutomationError("pywinauto is required for CSP dialogs") from exc

        for backend in ("uia", "win32"):
            try:
                windows = Desktop(backend=backend).windows()
            except Exception:
                continue
            for window in windows:
                if not _safe_visible(window):
                    continue
                process_id = _safe_process_id(window)
                if self._csp_process_id is not None and process_id is not None and process_id != self._csp_process_id:
                    continue
                if _looks_like_csp_custom_dialog(window):
                    return window
        return None

    def _find_unhandled_csp_modal(self) -> Any | None:
        try:
            from pywinauto import Desktop
        except ImportError as exc:
            raise AutomationError("pywinauto is required for CSP dialog detection") from exc

        for backend in ("uia", "win32"):
            try:
                windows = Desktop(backend=backend).windows()
            except Exception:
                continue
            for window in windows:
                if not _safe_visible(window):
                    continue
                process_id = _safe_process_id(window)
                if self._csp_process_id is not None and process_id is not None and process_id != self._csp_process_id:
                    continue
                if _looks_like_unhandled_csp_modal(window):
                    return window
        return None

    def _capture_unhandled_dialog(self, dialog: Any, log: OperationLog, phase: str) -> str | None:
        info = _window_debug_info(dialog)
        snapshot_path: Path | None = None
        try:
            from PIL import ImageGrab

            rect = dialog.rectangle()
            base_dir = Path(log.manifest_path).expanduser().resolve().parent
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            snapshot_path = base_dir / f"csp-import-unhandled-dialog-{timestamp}.png"
            snapshot_path.parent.mkdir(parents=True, exist_ok=True)
            ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).convert("RGB").save(snapshot_path)
        except Exception as exc:
            log.add("automation.unhandled_dialog_capture_failed", phase=phase, error=str(exc), **info)
            snapshot_path = None
        log.add(
            "automation.unhandled_dialog",
            phase=phase,
            snapshotPath=str(snapshot_path) if snapshot_path else None,
            **info,
        )
        return str(snapshot_path) if snapshot_path else None

    def _handle_known_csp_modal(self, dialog: Any, log: OperationLog, phase: str) -> bool:
        if not _looks_like_xdts_mismatch_dialog(dialog, phase):
            return False
        key = (_safe_handle(dialog), phase)
        if key in self._handled_dialog_keys:
            return False
        self._handled_dialog_keys.add(key)
        rect = dialog.rectangle()
        width = max(1, rect.right - rect.left)
        height = max(1, rect.bottom - rect.top)
        none_x = int(rect.left + width * 0.05)
        none_y = int(rect.top + height * 0.86)
        ok_x = int(rect.left + width * 0.91)
        ok_y = int(rect.top + height * 0.24)
        method = "alt-n-enter"
        try:
            from pywinauto.keyboard import send_keys

            dialog.set_focus()
            send_keys("%n")
            time.sleep(self.profile.after_key_input_seconds)
            send_keys("{ENTER}")
            try:
                self._wait_for_file_dialog_closed(dialog)
            except AutomationError:
                method = "relative-click"
        except Exception:
            method = "relative-click"
        if method == "relative-click":
            method = "relative-click"
            try:
                dialog.set_focus()
            except Exception:
                pass
            self._click(none_x, none_y)
            time.sleep(self.profile.after_key_input_seconds)
            self._click(ok_x, ok_y)
            try:
                self._wait_for_file_dialog_closed(dialog)
            except AutomationError:
                time.sleep(self.profile.after_dialog_seconds)
        log.add(
            "xdts.mismatch_dialog_handled",
            phase=phase,
            action="do-nothing",
            method=method,
            title=_safe_text(dialog),
            className=_safe_class_name(dialog),
            rect=[rect.left, rect.top, rect.right, rect.bottom],
            nonePoint=[none_x, none_y],
            okPoint=[ok_x, ok_y],
        )
        return True

    def _focus_file_dialog_path_field(self, dialog: Any) -> None:
        """Focus the filename field in a Windows common file dialog.

        CSP uses the standard Windows file dialog. We prefer setting focus to an
        Edit control before pasting the absolute path; if UI Automation cannot
        expose the field, the focused dialog fallback still fails fast when the
        dialog remains open.
        """

        for kwargs in (
            {"control_type": "Edit"},
            {"class_name": "Edit"},
        ):
            try:
                edits = dialog.descendants(**kwargs)
            except Exception:
                continue
            visible_edits = [edit for edit in edits if _safe_visible(edit)]
            if not visible_edits:
                continue
            try:
                visible_edits[-1].set_focus()
                return
            except Exception:
                continue
        dialog.set_focus()

    def _focus_dialog_edit_field(self, dialog: Any, *, field_index: int) -> None:
        edits: list[Any] = []
        for kwargs in (
            {"control_type": "Edit"},
            {"class_name": "Edit"},
        ):
            try:
                edits = dialog.descendants(**kwargs)
            except Exception:
                continue
            visible_edits = [edit for edit in edits if _safe_visible(edit)]
            if visible_edits:
                edits = sorted(visible_edits, key=_control_position_key)
                break
        if not edits:
            if self._focus_csp_custom_timeline_name_field(dialog):
                return
            raise AutomationError("CSP dialog text field could not be found")
        index = max(0, min(field_index, len(edits) - 1))
        try:
            edits[index].set_focus()
        except Exception as exc:
            raise AutomationError("CSP dialog text field could not be focused") from exc

    def _focus_csp_custom_timeline_name_field(self, dialog: Any) -> bool:
        if not _looks_like_csp_custom_dialog(dialog):
            return False
        try:
            rect = dialog.rectangle()
        except Exception:
            return False
        width = rect.right - rect.left
        height = rect.bottom - rect.top
        if width < 240 or height < 120:
            return False
        self._click(rect.left + round(width * 0.45), rect.top + round(height * 0.18))
        time.sleep(self.profile.after_key_input_seconds)
        return True

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
