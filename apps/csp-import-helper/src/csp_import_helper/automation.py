from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
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



from .automation_dialogs import DialogAutomationMixin
from .automation_palette import PaletteAutomationMixin
from .automation_shared import *
from .automation_track_selection import TrackSelectionMixin
from .automation_utils import *

class CspImportAutomation(TrackSelectionMixin, DialogAutomationMixin, PaletteAutomationMixin):
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
        for cut in manifest.cuts:
            for track in cut.tracks:
                for cel in track.cels:
                    if cel.asset_path is None:
                        log.add(
                            "asset.skipped",
                            cutId=cut.cut_id,
                            trackId=track.track_id,
                            cspCellName=cel.csp_cell_name,
                            assetId=cel.asset_id,
                            reason="no material source",
                        )
                    elif not cel.asset_path.is_file():
                        log.add(
                            "asset.skipped",
                            cutId=cut.cut_id,
                            trackId=track.track_id,
                            cspCellName=cel.csp_cell_name,
                            assetId=cel.asset_id,
                            path=str(cel.asset_path),
                            reason="material file not found",
                        )
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
        csp_cell_names = tuple(str(item["cspCellName"]) for item in items)
        with tempfile.TemporaryDirectory(prefix="xsheet-csp-import-") as staging_directory:
            image_paths = self._stage_image_paths_for_csp_names(items, Path(staging_directory), log, track.track_id)
            if self.profile.multi_image_import_enabled:
                self._import_images(image_paths, log, track.track_id, csp_cell_names)
                self._finish_imported_track_folder(track, manifest, log)
            else:
                for image_path, csp_cell_name in zip(image_paths, csp_cell_names, strict=True):
                    self._import_image(image_path, log, track.track_id, csp_cell_name)
                    self._finish_imported_track_folder(track, manifest, log)
        log.add("track.import_batch_finished", trackId=track.track_id, count=len(items))

    def _stage_image_paths_for_csp_names(
        self,
        items: tuple[dict[str, Any], ...],
        staging_directory: Path,
        log: OperationLog,
        track_id: str,
    ) -> tuple[Path, ...]:
        staged: list[Path] = []
        for item in items:
            source = Path(item["assetPath"])
            csp_cell_name = str(item["cspCellName"])
            if source.stem == csp_cell_name:
                staged.append(source)
                continue
            if re.search(r'[<>:"/\\|?*]', csp_cell_name) or csp_cell_name.endswith((" ", ".")):
                raise AutomationError(f"CSP cel name cannot be used as a staging file name: {csp_cell_name}")
            target = staging_directory / f"{csp_cell_name}{source.suffix}"
            try:
                os.link(source, target)
                method = "hardlink"
            except OSError:
                shutil.copy2(source, target)
                method = "copy"
            staged.append(target)
            log.add(
                "asset.staged_for_csp_name",
                trackId=track_id,
                cspCellName=csp_cell_name,
                sourcePath=str(source),
                stagedPath=str(target),
                method=method,
            )
        return tuple(staged)
