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


class DialogAutomationMixin:
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

