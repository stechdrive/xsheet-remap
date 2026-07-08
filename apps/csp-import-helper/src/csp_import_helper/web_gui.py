from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
import html
import json
from pathlib import Path
import re
import sys
import threading
from typing import Any
import webbrowser

from . import __version__
from .automation import AutomationError, AutomationPaused, CspImportAutomation, default_output_clip_path
from .emergency_stop import EmergencyHotkeys
from .logging import OperationLog
from .manifest import CspImportManifest, ManifestError, build_import_plan, load_manifest, validate_manifest_files
from .profile import (
    DEFAULT_PROFILE,
    SPEED_MODE_FAST,
    SPEED_MODE_STANDARD,
    SPEED_MODE_TURBO,
    WorkspaceProfile,
    apply_workspace_profile_speed,
    load_workspace_profile,
    save_workspace_profile,
    shortcut_to_display_text,
    update_workspace_profile_shortcuts,
)
from .progress_plan import build_import_execution_plan


EMERGENCY_HOTKEY_TEXT = "Ctrl+Alt+F12 / Ctrl+Alt+Pause"
MANIFEST_DROP_HINT = ".xci をドロップ、または選択"
CLIP_DROP_HINT = ".clip をドロップ、または選択"
WORKSPACE_ASSET_URL = "https://assets.clip-studio.com/ja-jp/detail?id=2285656"
MULTIPLY_ACTION_ASSET_URL = "https://assets.clip-studio.com/ja-jp/detail?id=2285681"
ALLOWED_EXTERNAL_URLS = frozenset((WORKSPACE_ASSET_URL, MULTIPLY_ACTION_ASSET_URL))
SPEED_DISPLAY_TO_MODE = {
    "標準": SPEED_MODE_STANDARD,
    "高速": SPEED_MODE_FAST,
    "最速": SPEED_MODE_TURBO,
}
MODE_TO_SPEED_DISPLAY = {mode: display for display, mode in SPEED_DISPLAY_TO_MODE.items()}
LINE_SEED_FONT_CSS_FILES = ("400.css", "700.css", "800.css")
SHORTCUT_FIELDS: tuple[dict[str, str], ...] = (
    {"key": "timelineToggleShortcut", "label": "タイムライン有効化切替", "profile": "timeline_toggle_shortcut"},
    {"key": "newTimelineShortcut", "label": "新規タイムライン", "profile": "new_timeline_shortcut"},
    {"key": "timelineSettingsShortcut", "label": "タイムライン設定", "profile": "timeline_settings_shortcut"},
    {"key": "previousTimelineShortcut", "label": "前のタイムライン", "profile": "previous_timeline_shortcut"},
    {"key": "nextTimelineShortcut", "label": "次のタイムライン", "profile": "next_timeline_shortcut"},
    {"key": "selectLayerAboveShortcut", "label": "選択レイヤー 上へ", "profile": "select_layer_above_shortcut"},
    {"key": "selectLayerBelowShortcut", "label": "選択レイヤー 下へ", "profile": "select_layer_below_shortcut"},
    {"key": "importXdtsShortcut", "label": "XDTS読み込み", "profile": "import_xdts_shortcut"},
    {"key": "importImageShortcut", "label": "画像読み込み", "profile": "import_image_shortcut"},
    {"key": "rasterizeShortcut", "label": "ラスタライズ", "profile": "rasterize_shortcut"},
    {"key": "setMultiplyShortcut", "label": "乗算オートアクション", "profile": "set_multiply_shortcut"},
    {"key": "toggleFolderChildrenShortcut", "label": "フォルダーと配下を開閉", "profile": "toggle_folder_children_shortcut"},
    {"key": "saveAsShortcut", "label": "別名で保存", "profile": "save_as_shortcut"},
)


def _line_seed_font_source_roots() -> Iterable[Path]:
    current_file = Path(__file__).resolve()
    yield current_file.parent / "fonts" / "line-seed-jp"
    for parent in current_file.parents:
        yield parent / "node_modules" / "@fontsource" / "line-seed-jp"


def _line_seed_font_face_css() -> str:
    for root in _line_seed_font_source_roots():
        if not all((root / css_file).exists() for css_file in LINE_SEED_FONT_CSS_FILES):
            continue
        files_root = root / "files"
        if not files_root.exists():
            continue
        chunks: list[str] = []
        for css_file in LINE_SEED_FONT_CSS_FILES:
            css = (root / css_file).read_text(encoding="utf-8")
            css = re.sub(
                r"url\(\./files/([^)]+)\)",
                lambda match: f'url("{(files_root / match.group(1)).resolve().as_uri()}")',
                css,
            )
            chunks.append(css)
        return "\n".join(chunks)
    return ""


def launch_gui(
    initial_manifest: str | None = None,
    profile_path: str | None = None,
    initial_clip: str | None = None,
    *,
    initial_speed_mode: str = SPEED_MODE_STANDARD,
    auto_start: bool = False,
) -> int:
    app = CspImportHelperWebGui(
        initial_manifest,
        profile_path,
        initial_clip,
        initial_speed_mode=initial_speed_mode,
        auto_start=auto_start,
    )
    try:
        app.run()
        return 0
    except Exception as exc:
        _show_gui_startup_error(exc)
        return 1


def _gui_startup_error_message(exc: Exception) -> str:
    return (
        "CSP自動登録ヘルパーのGUIを起動できませんでした。\n\n"
        "同梱ランタイムまたはWebView backendが利用できません。"
        "ZIPのブロックを解除して再展開するか、"
        "WebView2 Runtimeを更新してから再実行してください。\n\n"
        f"{type(exc).__name__}: {exc}"
    )


def _show_gui_startup_error(exc: Exception) -> None:
    message = _gui_startup_error_message(exc)
    print(message, file=sys.stderr)
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, message, "CSP自動登録ヘルパー", 0x10)
    except Exception:
        pass


def select_dropped_import_files(paths: Iterable[Path]) -> tuple[Path | None, Path | None]:
    manifest_path: Path | None = None
    clip_path: Path | None = None
    for path in paths:
        if path.is_dir():
            continue
        suffix = path.suffix.casefold()
        if suffix == ".xci" and manifest_path is None:
            manifest_path = path
        elif suffix == ".clip" and clip_path is None:
            clip_path = path
        if manifest_path is not None and clip_path is not None:
            break
    return manifest_path, clip_path


class CspImportHelperWebGui:
    def __init__(
        self,
        initial_manifest: str | None = None,
        profile_path: str | None = None,
        initial_clip: str | None = None,
        *,
        initial_speed_mode: str = SPEED_MODE_STANDARD,
        auto_start: bool = False,
    ) -> None:
        self.initial_manifest = initial_manifest
        self.auto_start = auto_start
        self.auto_start_attempted = False
        self.window: Any | None = None
        self.webview: Any | None = None
        self.lock = threading.RLock()
        self.profile_path = profile_path
        self.notice: dict[str, str] | None = None
        self.manifest: CspImportManifest | None = None
        self.manifest_path_display = MANIFEST_DROP_HINT
        self.clip_path = str(Path(initial_clip).expanduser()) if initial_clip else ""
        self.clip_path_display = self._display_path(initial_clip) if initial_clip else CLIP_DROP_HINT
        self.save_path = ""
        self.summary = ""
        self.cut_summary = ""
        self.cut_count = 0
        self.asset_count = 0
        self.track_count = 0
        self.run_status = ""
        self.emergency_status = f"非常停止: {EMERGENCY_HOTKEY_TEXT}"
        self.close_after_save = False
        self.speed_mode = initial_speed_mode if initial_speed_mode in MODE_TO_SPEED_DISPLAY else SPEED_MODE_STANDARD
        self.progress_total = 0
        self.progress_done = 0
        self.progress_steps: list[str] = []
        self.progress_log_lines: list[str] = []
        self.progress_activity_label = ""
        self.progress_status = "待機中"
        self.progress_detail = ""
        self.progress_error_reason = ""
        self.progress_error = False
        self.diagnostic_log: list[str] = []
        self.cancel_event: threading.Event | None = None
        self.running = False
        self.profile = self._load_profile(profile_path)

    def run(self) -> None:
        import webview

        self.webview = webview
        self.window = webview.create_window(
            f"CSP自動登録ヘルパー v{__version__}",
            html=HTML,
            js_api=CspImportHelperWebApi(self),
            width=900,
            height=720,
            min_size=(820, 660),
        )
        webview.start(self._on_webview_started, self.window)

    def _on_webview_started(self, window: Any) -> None:
        self.window = window
        try:
            window.events.loaded += lambda *_args: self._install_drop_handlers(window)
        except Exception:
            self._install_drop_handlers(window)

    def _install_drop_handlers(self, window: Any) -> None:
        try:
            from webview.dom import DOMEventHandler
        except Exception as exc:
            self._set_notice("error", f"ドラッグ&ドロップ初期化に失敗しました: {exc}")
            return

        def on_drop(event: dict[str, Any]) -> None:
            files = event.get("dataTransfer", {}).get("files", [])
            paths = []
            if isinstance(files, list):
                for item in files:
                    if isinstance(item, dict):
                        path = item.get("pywebviewFullPath") or item.get("path") or item.get("name")
                        if path:
                            paths.append(str(path))
            self.handle_drop(paths)
            self._push_state_to_webview()

        try:
            window.dom.document.events.drop += DOMEventHandler(on_drop, prevent_default=True)
        except Exception as exc:
            self._set_notice("error", f"ドラッグ&ドロップ初期化に失敗しました: {exc}")

    def initialize(self) -> dict[str, Any]:
        if self.initial_manifest:
            self.load_manifest_path(self.initial_manifest)
            self.initial_manifest = None
        if self.auto_start and not self.auto_start_attempted:
            self.auto_start_attempted = True
            if self._can_start():
                self.start_import()
            else:
                self._set_notice("warning", "自動開始できません。自動登録ファイルとクリスタファイルを確認してください。")
        return self.get_state()

    def get_state(self) -> dict[str, Any]:
        with self.lock:
            return {
                "version": __version__,
                "manifestPathDisplay": self.manifest_path_display,
                "clipPath": self.clip_path,
                "clipPathDisplay": self.clip_path_display,
                "savePath": self.save_path,
                "summary": self.summary,
                "cutSummary": self.cut_summary,
                "metrics": {
                    "cuts": self.cut_count,
                    "assets": self.asset_count,
                    "tracks": self.track_count,
                },
                "runStatus": self.run_status,
                "emergencyStatus": self.emergency_status,
                "closeAfterSave": self.close_after_save,
                "speedMode": self.speed_mode,
                "speedDisplay": MODE_TO_SPEED_DISPLAY.get(self.speed_mode, "標準"),
                "canStart": self._can_start_locked(),
                "running": self.running,
                "progress": {
                    "total": self.progress_total,
                    "done": self.progress_done,
                    "steps": list(self.progress_steps),
                    "activity": self.progress_activity_label,
                    "status": self.progress_status,
                    "detail": self.progress_detail,
                    "errorReason": self.progress_error_reason,
                    "logs": list(self.progress_log_lines),
                    "error": self.progress_error,
                },
            }

    def choose_manifest(self) -> dict[str, Any]:
        result = self._create_file_dialog(
            "OPEN",
            file_types=("CSP自動登録ファイル (*.xci)", "All files (*.*)"),
        )
        if result:
            return self.load_manifest_path(result)
        return self.get_state()

    def choose_clip(self) -> dict[str, Any]:
        result = self._create_file_dialog(
            "OPEN",
            file_types=("クリスタファイル (*.clip)", "All files (*.*)"),
        )
        if result:
            self._set_clip_path(result)
        return self.get_state()

    def choose_save_path(self) -> dict[str, Any]:
        with self.lock:
            initial = Path(self.save_path).expanduser() if self.save_path.strip() else None
        kwargs: dict[str, Any] = {
            "file_types": ("クリスタファイル (*.clip)", "All files (*.*)"),
        }
        if initial is not None:
            kwargs["directory"] = str(initial.parent)
            kwargs["save_filename"] = initial.name
        result = self._create_file_dialog("SAVE", **kwargs)
        if result:
            with self.lock:
                self.save_path = _ensure_clip_suffix(result)
                self._prepare_progress_preview_locked()
        return self.get_state()

    def _create_file_dialog(self, dialog_type: str, **kwargs: Any) -> str | None:
        if self.window is None or self.webview is None:
            return None
        try:
            file_dialog = getattr(self.webview, "FileDialog", None)
            if file_dialog is not None:
                kind = getattr(file_dialog, dialog_type)
            else:
                kind = getattr(self.webview, f"{dialog_type}_DIALOG")
            result = self.window.create_file_dialog(kind, **kwargs)
        except Exception as exc:
            self._set_notice("error", f"ファイルダイアログを開けません: {exc}")
            return None
        return _first_dialog_path(result)

    def handle_drop(self, raw_paths: list[str]) -> dict[str, Any]:
        paths = tuple(Path(path) for path in raw_paths if path)
        manifest_path, clip_path = select_dropped_import_files(paths)
        if clip_path is not None:
            self._set_clip_path(clip_path)
        if manifest_path is not None:
            self.load_manifest_path(str(manifest_path))
        if manifest_path is None and clip_path is None:
            self._set_notice("warning", ".xci または .clip をドロップしてください。")
        return self.get_state()

    def set_options(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            self.close_after_save = bool(payload.get("closeAfterSave"))
            speed_mode = str(payload.get("speedMode") or self.speed_mode)
            if speed_mode in MODE_TO_SPEED_DISPLAY:
                self.speed_mode = speed_mode
            save_path = payload.get("savePath")
            if isinstance(save_path, str):
                self.save_path = save_path
            self._prepare_progress_preview_locked()
        return self.get_state()

    def load_manifest_path(self, path: str) -> dict[str, Any]:
        try:
            manifest = load_manifest(path)
            file_errors = validate_manifest_files(manifest)
            if file_errors:
                raise ManifestError("\n".join(file_errors))
            plan = build_import_plan(manifest)
        except ManifestError as exc:
            with self.lock:
                self.manifest = None
                self.manifest_path_display = self._display_path(path)
                self.summary = "CSP自動登録ファイルを読み込めません。"
                self.cut_summary = "タイムライン: -"
                self.cut_count = 0
                self.asset_count = 0
                self.track_count = 0
                self.run_status = "登録ファイルエラー"
                self._reset_progress_locked([])
                self._set_notice_locked("error", str(exc))
                self._log_locked(f"ERROR: {exc}")
            return self.get_state()

        with self.lock:
            self.manifest = manifest
            self.manifest_path_display = self._display_path(manifest.path)
            track_count = len({item["trackId"] for item in plan})
            self.cut_count = len(manifest.cuts)
            self.asset_count = len(plan)
            self.track_count = track_count
            self.summary = f"カット: {self.cut_count}件 / 素材: {self.asset_count}件 / セル列: {self.track_count}件"
            self.cut_summary = "タイムライン: " + " / ".join(
                f"{cut.timeline_name} ({cut.duration_frames}f)" for cut in manifest.cuts
            )
            self.save_path = str(default_output_clip_path(manifest))
            self._log_locked(f"manifest loaded: {manifest.path}")
            self._log_locked(f"cut folder: {manifest.assets_root}")
            if manifest.setup:
                self._log_locked(f"setup XDTS: {manifest.setup.xdts_path}")
            self._log_locked("cuts:")
            for cut in manifest.cuts:
                self._log_locked(f"- {cut.timeline_name} ({cut.cut_number}): {cut.duration_frames}f / XDTS {cut.xdts_path}")
            self._log_locked("asset import plan:")
            for item in plan:
                self._log_locked(f"- {item['xdtsTrackName']} / {item['cspCellName']} <- {item['assetPath']}")
            self._prepare_progress_preview_locked()
        return self.get_state()

    def start_import(self) -> dict[str, Any]:
        with self.lock:
            if self.manifest is None:
                self._set_notice_locked("warning", "CSP自動登録ファイル(.xci)を選択してください。")
                return self.get_state()
            if not self.clip_path.strip():
                self._set_notice_locked("warning", "操作対象のクリスタファイル(.clip)を選択してください。")
                return self.get_state()
            if self.running:
                return self.get_state()
            manifest = self.manifest
            clip_path = self.clip_path
            save_as_path = self.save_path.strip() or str(default_output_clip_path(manifest))
            self.save_path = save_as_path
            close_after_save = self.close_after_save
            speed_mode = self.speed_mode
            cancel_event = threading.Event()
            self.cancel_event = cancel_event
            self.running = True
            self.run_status = "実行中: CSP操作を開始します"
            self._reset_progress_locked(self._build_progress_steps(manifest, clip_path, save_as_path, close_after_save))

        def worker() -> None:
            log = OperationLog(manifest_path=str(manifest.path), dry_run=False)
            try:
                self._log_threadsafe("CSP操作を開始します。")
                automation = CspImportAutomation(
                    apply_workspace_profile_speed(self.profile, speed_mode),
                    cancel_event=cancel_event,
                    progress_callback=self._automation_progress_threadsafe,
                    speed_mode=speed_mode,
                )
                with EmergencyHotkeys(cancel_event) as hotkeys:
                    log.add("automation.emergency_hotkeys", labels=hotkeys.registered_labels)
                    hotkey_text = ", ".join(hotkeys.registered_labels) or "登録なし"
                    self._set_emergency_status_threadsafe(f"非常停止: {hotkey_text}")
                    self._set_run_status_threadsafe("実行中: CSPを操作しています")
                    self._log_threadsafe(f"非常停止: {hotkey_text}")
                    automation.run(
                        manifest,
                        log,
                        clip_path=clip_path,
                        save_as_path=save_as_path,
                        close_after_save=close_after_save,
                    )
                log.write(manifest.operation_log_path)
                self._log_threadsafe(f"完了: {manifest.operation_log_path}")
                self._set_run_status_threadsafe("完了")
            except AutomationPaused as exc:
                message = str(exc)
                log.error(message)
                log.write(manifest.operation_log_path)
                self._log_threadsafe(f"PAUSED: {message}")
                self._mark_progress_error_threadsafe()
                self._set_run_status_threadsafe("一時停止")
                self._set_notice_threadsafe("warning", message)
            except (AutomationError, ManifestError) as exc:
                message = str(exc)
                log.error(message)
                log.write(manifest.operation_log_path)
                self._log_threadsafe(f"ERROR: {message}")
                self._mark_progress_error_threadsafe()
                self._set_run_status_threadsafe("エラー")
                self._set_notice_threadsafe("error", message)
            finally:
                with self.lock:
                    self.cancel_event = None
                    self.running = False
                self._push_state_to_webview()

        threading.Thread(target=worker, daemon=True).start()
        return self.get_state()

    def request_cancel(self) -> dict[str, Any]:
        with self.lock:
            if self.cancel_event is not None:
                self.cancel_event.set()
                self.run_status = "停止要求済み"
                self.progress_status = "停止要求済み"
                self._log_locked("停止要求を受け付けました。現在のチェック点で停止します。")
        return self.get_state()

    def close_window(self) -> dict[str, Any]:
        with self.lock:
            if self.running:
                self._set_notice_locked("warning", "実行中は閉じられません。停止または非常停止を使ってください。")
                return self.get_state()
        if self.window is not None:
            try:
                self.window.destroy()
            except Exception:
                pass
        return self.get_state()

    def open_external_url(self, url: str) -> dict[str, Any]:
        if url not in ALLOWED_EXTERNAL_URLS:
            return {"ok": False, "error": "許可されていないURLです。"}
        webbrowser.open(url)
        return {"ok": True}

    def get_profile_settings(self) -> dict[str, Any]:
        with self.lock:
            return {
                "ok": True,
                "fields": [
                    {
                        "key": field["key"],
                        "label": field["label"],
                        "value": shortcut_to_display_text(str(getattr(self.profile, field["profile"]))),
                        "defaultValue": shortcut_to_display_text(str(getattr(DEFAULT_PROFILE, field["profile"]))),
                    }
                    for field in SHORTCUT_FIELDS
                ],
                "setMultiply": self.profile.set_imported_track_blend_mode_to_multiply,
            }

    def save_profile_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        shortcuts = payload.get("shortcuts")
        if not isinstance(shortcuts, dict):
            self._set_notice("error", "ショートカット設定を保存できません。")
            return self.get_state()
        try:
            updated = update_workspace_profile_shortcuts(
                self.profile,
                timeline_toggle_shortcut=str(shortcuts.get("timelineToggleShortcut", "")),
                select_layer_above_shortcut=str(shortcuts.get("selectLayerAboveShortcut", "")),
                select_layer_below_shortcut=str(shortcuts.get("selectLayerBelowShortcut", "")),
                new_timeline_shortcut=str(shortcuts.get("newTimelineShortcut", "")),
                timeline_settings_shortcut=str(shortcuts.get("timelineSettingsShortcut", "")),
                previous_timeline_shortcut=str(shortcuts.get("previousTimelineShortcut", "")),
                next_timeline_shortcut=str(shortcuts.get("nextTimelineShortcut", "")),
                import_xdts_shortcut=str(shortcuts.get("importXdtsShortcut", "")),
                import_image_shortcut=str(shortcuts.get("importImageShortcut", "")),
                rasterize_shortcut=str(shortcuts.get("rasterizeShortcut", "")),
                set_multiply_shortcut=str(shortcuts.get("setMultiplyShortcut", "")),
                toggle_folder_children_shortcut=str(shortcuts.get("toggleFolderChildrenShortcut", "")),
                save_as_shortcut=str(shortcuts.get("saveAsShortcut", "")),
            )
            updated = replace(
                updated,
                rasterize_after_image_import=True,
                close_imported_track_folder_after_image_import=True,
                set_imported_track_blend_mode_to_multiply=bool(payload.get("setMultiply")),
            )
            path = save_workspace_profile(updated, self.profile_path)
        except (OSError, ValueError) as exc:
            self._set_notice("error", f"設定保存エラー: {exc}")
            return self.get_state()
        with self.lock:
            self.profile = updated
            self._log_locked(f"profile saved: {path}")
        return self.get_state()

    def _set_clip_path(self, path: str | Path) -> None:
        clip_path = Path(path).expanduser()
        with self.lock:
            self.clip_path = str(clip_path)
            self.clip_path_display = self._display_path(clip_path)
            self._prepare_progress_preview_locked()

    def _prepare_progress_preview_locked(self) -> None:
        if self.manifest is None:
            self._reset_progress_locked([])
            self.progress_status = "待機中"
            self.progress_detail = ""
            self.progress_error_reason = ""
            return
        save_as_path = self.save_path.strip() or str(default_output_clip_path(self.manifest))
        steps = self._build_progress_steps(self.manifest, self.clip_path, save_as_path, self.close_after_save)
        self._reset_progress_locked(steps)
        self.progress_status = "開始できます" if self._can_start_locked() else "待機中"
        self.progress_detail = ""
        self.progress_error_reason = ""

    def _build_progress_steps(
        self,
        manifest: CspImportManifest,
        clip_path: str,
        save_as_path: str,
        close_after_save: bool,
    ) -> list[str]:
        return build_import_execution_plan(
            manifest,
            clip_path=clip_path,
            save_as_path=save_as_path,
            close_after_save=close_after_save,
        ).progress_labels

    def _reset_progress_locked(self, steps: list[str]) -> None:
        self.progress_steps = steps
        self.progress_total = len(steps)
        self.progress_done = 0
        self.progress_log_lines = []
        self.progress_activity_label = ""
        self.progress_error_reason = ""
        self.progress_error = False

    def _automation_progress_threadsafe(self, event: str, payload: dict[str, object]) -> None:
        with self.lock:
            self._handle_progress_event_locked(event, payload)
        self._push_state_to_webview()

    def _handle_progress_event_locked(self, event: str, payload: dict[str, object]) -> None:
        label = str(payload.get("label") or "")
        if event == "run.started":
            self._start_progress_activity_locked("クリスタへ接続")
            self.progress_detail = ""
            self.progress_error_reason = ""
            return
        if event == "step.start":
            self._start_progress_activity_locked(label)
            self.progress_detail = ""
            self.progress_error_reason = ""
            return
        if event == "step.done":
            self.progress_done = min(self.progress_total, self.progress_done + 1)
            self.progress_status = "実行中"
            self.progress_detail = f"{label} 完了"
            self._progress_line_locked(f"{label} 完了")
            return
        if event == "run.finished":
            self.progress_activity_label = ""
            if self.progress_done < self.progress_total:
                self.progress_done = self.progress_total
            self.progress_status = "完了"
            self.progress_detail = "すべての工程が完了しました。"
            self._progress_line_locked("すべての工程が完了しました。")

    def _start_progress_activity_locked(self, label: str) -> None:
        self.progress_activity_label = label
        self.progress_status = label

    def _progress_line_locked(self, message: str) -> None:
        self.progress_log_lines.append(message)
        self.progress_log_lines = self.progress_log_lines[-3:]

    def _mark_progress_error_threadsafe(self) -> None:
        with self.lock:
            self.progress_activity_label = ""
            self.progress_error = True
        self._push_state_to_webview()

    def _load_profile(self, path: str | None) -> WorkspaceProfile:
        try:
            return load_workspace_profile(path)
        except ValueError as exc:
            message = f"profileを読み込めないため既定値を使います。{exc}"
            self.notice = {"level": "warning", "text": message}
            self.progress_status = "要確認"
            self.progress_detail = message
            return DEFAULT_PROFILE

    def _display_path(self, path: str | Path | None) -> str:
        if path is None:
            return ""
        value = Path(path)
        return f"{value.name}  ({value.parent})"

    def _can_start(self) -> bool:
        with self.lock:
            return self._can_start_locked()

    def _can_start_locked(self) -> bool:
        return self.manifest is not None and bool(self.clip_path.strip()) and not self.running

    def _set_run_status_threadsafe(self, message: str) -> None:
        with self.lock:
            self.run_status = message
            if not self.progress_activity_label:
                self.progress_status = message
        self._push_state_to_webview()

    def _set_emergency_status_threadsafe(self, message: str) -> None:
        with self.lock:
            self.emergency_status = message
        self._push_state_to_webview()

    def _set_notice(self, level: str, text: str) -> None:
        with self.lock:
            self._set_notice_locked(level, text)

    def _set_notice_threadsafe(self, level: str, text: str) -> None:
        self._set_notice(level, text)
        self._push_state_to_webview()

    def _set_notice_locked(self, level: str, text: str) -> None:
        self.notice = {"level": level, "text": text}
        if level in {"warning", "error"}:
            self.progress_detail = text
            if not self.progress_activity_label:
                self.progress_status = "エラー" if level == "error" else "要確認"
            if level == "error":
                self.progress_error = True
                self.progress_error_reason = text

    def _log_threadsafe(self, message: str) -> None:
        with self.lock:
            self._log_locked(message)

    def _log_locked(self, message: str) -> None:
        self.diagnostic_log.append(message)

    def _push_state_to_webview(self) -> None:
        window = self.window
        if window is None:
            return
        try:
            state_json = json.dumps(self.get_state(), ensure_ascii=False)
            window.evaluate_js(f"window.xsheetApplyState && window.xsheetApplyState({state_json});")
        except Exception as exc:
            with self.lock:
                self._log_locked(f"webview state push failed: {exc}")


class CspImportHelperWebApi:
    def __init__(self, app: CspImportHelperWebGui) -> None:
        self._app = app

    def initialize(self) -> dict[str, Any]:
        return self._app.initialize()

    def get_state(self) -> dict[str, Any]:
        return self._app.get_state()

    def choose_manifest(self) -> dict[str, Any]:
        return self._app.choose_manifest()

    def choose_clip(self) -> dict[str, Any]:
        return self._app.choose_clip()

    def choose_save_path(self) -> dict[str, Any]:
        return self._app.choose_save_path()

    def handle_drop(self, raw_paths: list[str]) -> dict[str, Any]:
        return self._app.handle_drop(raw_paths)

    def set_options(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._app.set_options(payload)

    def start_import(self) -> dict[str, Any]:
        return self._app.start_import()

    def request_cancel(self) -> dict[str, Any]:
        return self._app.request_cancel()

    def close_window(self) -> dict[str, Any]:
        return self._app.close_window()

    def open_external_url(self, url: str) -> dict[str, Any]:
        return self._app.open_external_url(url)

    def get_profile_settings(self) -> dict[str, Any]:
        return self._app.get_profile_settings()

    def save_profile_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        return self._app.save_profile_settings(payload)


def _first_dialog_path(result: object) -> str | None:
    if result is None:
        return None
    if isinstance(result, str):
        return result
    if isinstance(result, (list, tuple)) and result:
        first = result[0]
        if first:
            return str(first)
    return None


def _ensure_clip_suffix(path: str) -> str:
    value = Path(path)
    if value.suffix.casefold() == ".clip":
        return str(value)
    return str(value.with_suffix(".clip"))


HTML = r"""<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    /* __LINE_SEED_FONT_FACE_CSS__ */
    :root {
      color-scheme: light;
      font-family: "LINE Seed JP", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif;
      background: #eef1f5;
      color: #202633;
      --panel: #ffffff;
      --line: #d8dee8;
      --muted: #667285;
      --text: #202633;
      --blue: #1d63c8;
      --green: #21845a;
      --amber: #c77614;
      --red: #bd382d;
      --ink: #111827;
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef1f5; }
    button, input, select { font: inherit; }
    input[type="text"], select { line-height: 1.45; }
    .app { min-height: 100vh; padding: 14px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 12px; }
    .top { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; align-items: center; }
    .top-actions { display: inline-flex; align-items: center; gap: 8px; }
    h1 { margin: 0; font-size: 20px; line-height: 1.15; letter-spacing: 0; }
    .version { margin-top: 3px; color: var(--muted); font-size: 12px; }
    .badge { min-width: 112px; height: 30px; display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid #cfd7e4; background: #fff; color: #334155; font-weight: 700; font-size: 12px; }
    .badge.running { border-color: #f1bd71; background: #fff6e8; color: #7a4300; }
    .badge.ready { border-color: #a7d2bd; background: #ebf8f0; color: #145f3c; }
    .badge.error { border-color: #efb2ab; background: #fff0ef; color: #8f2219; }
    .workspace { min-height: 0; display: grid; grid-template-columns: minmax(420px, 1.1fr) minmax(330px, .9fr); gap: 12px; }
    .column { min-width: 0; display: grid; gap: 12px; align-content: start; }
    .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 12px; box-shadow: 0 1px 2px rgba(20, 28, 40, .05); }
    .panel-title { margin: 0 0 10px; font-size: 13px; color: #3a4556; font-weight: 800; }
    .drop-stack { display: grid; gap: 8px; }
    .drop-card { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 58px; padding: 10px; background: #f8fafc; border: 1px solid #e0e6ef; border-radius: 8px; }
    .drop-card.ready { background: #f5fbf8; border-color: #b8dcca; }
    .drop-active .drop-card { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(29, 99, 200, .14); }
    .file-kind { color: #3b4657; font-size: 12px; font-weight: 800; }
    .path { margin-top: 4px; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .path.empty { color: #8a94a5; }
    .save-row { margin-top: 10px; display: grid; grid-template-columns: 86px minmax(0, 1fr) auto; gap: 8px; align-items: center; }
    .label { color: #3a4556; font-weight: 800; font-size: 13px; }
    select, input[type="text"] { height: 32px; border: 1px solid #cbd4e1; border-radius: 6px; padding: 4px 8px; background: #fff; color: var(--text); min-width: 0; }
    button { height: 32px; padding: 0 12px; border: 1px solid #c5cedd; background: #fff; border-radius: 6px; color: #202838; cursor: pointer; font-weight: 700; }
    button:hover:not(:disabled) { background: #f3f6fa; }
    button:disabled { opacity: .45; cursor: default; }
    button.primary { background: var(--blue); border-color: var(--blue); color: #fff; }
    button.primary:hover:not(:disabled) { background: #174f9f; }
    button.stop { color: #9d1b1b; border-color: #e1b8b8; background: #fffafa; }
    .icon-button { width: 32px; min-width: 32px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    .icon-button svg { width: 18px; height: 18px; stroke: currentColor; stroke-width: 2; fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .metric { min-height: 64px; padding: 9px 10px; border: 1px solid #e0e6ef; border-radius: 8px; background: #fbfcfe; }
    .metric-label { color: var(--muted); font-size: 11px; font-weight: 800; }
    .metric-value { margin-top: 4px; color: var(--ink); font-size: 24px; line-height: 1; font-weight: 800; font-variant-numeric: tabular-nums; }
    .cuts { margin-top: 10px; color: #566173; min-height: 20px; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .option-grid { display: grid; grid-template-columns: 1fr 96px; gap: 8px; align-items: center; }
    .check { display: flex; align-items: center; gap: 6px; white-space: nowrap; color: #303a4c; }
    .actions { margin-top: 10px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; }
    .progress-shell { display: grid; gap: 10px; }
    .progress-head { display: grid; grid-template-columns: 110px minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    .stream { position: relative; width: 98px; height: 22px; overflow: hidden; border-radius: 6px; background: #f3f6fa; border: 1px solid #e0e6ef; color: var(--amber); font-family: "LINE Seed JP", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif; font-weight: 800; }
    .stream::before { content: ">>>"; position: absolute; top: 1px; left: -34px; opacity: 0; animation: stream 1.05s linear infinite; }
    .stream.idle::before { animation: none; opacity: 0; }
    @keyframes stream { 0% { transform: translateX(0); opacity: 0; } 8% { opacity: 1; } 74% { opacity: 1; } 100% { transform: translateX(132px); opacity: 0; } }
    .status { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .count { color: #596579; font-variant-numeric: tabular-nums; font-weight: 800; }
    .blocks { height: 20px; display: grid; gap: 2px; }
    .block { background: #e5ebf3; border-radius: 2px; overflow: hidden; position: relative; }
    .block.done { background: var(--blue); }
    .block.active { background: #f2bb46; }
    .block.error { background: var(--red); }
    .block.active::after { content: ""; position: absolute; inset: 2px auto 2px 0; width: 34%; background: rgba(255,255,255,.65); animation: sweep .9s linear infinite; }
    @keyframes sweep { from { transform: translateX(-120%); } to { transform: translateX(320%); } }
    .detail { color: #3f4a5c; min-height: 21px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .error-reason { display: none; max-height: 168px; overflow: auto; padding: 8px 10px; border: 1px solid #efb2ab; border-left-width: 4px; border-radius: 6px; background: #fff8f7; color: #651f18; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
    .error-reason.show { display: block; }
    .error-reason-label { display: block; margin-bottom: 3px; color: #8f2219; font-size: 11px; font-weight: 800; }
    .logs { min-height: 58px; padding: 8px 10px; background: #f8fafc; border: 1px solid #e0e6ef; border-radius: 6px; color: #354052; white-space: pre-line; line-height: 1.45; }
    .footer { color: #8a1f11; font-weight: 800; background: #fff4d6; border: 1px solid #efd28a; border-radius: 6px; padding: 8px 10px; line-height: 1.45; white-space: pre-line; }
    .modal-backdrop { display: none; position: fixed; inset: 0; background: rgba(14, 22, 35, .35); align-items: center; justify-content: center; padding: 24px; }
    .modal-backdrop.show { display: flex; }
    .modal { width: min(720px, 100%); max-height: calc(100vh - 48px); overflow: auto; background: #fff; border-radius: 8px; border: 1px solid #d4dbe7; box-shadow: 0 12px 36px rgba(0,0,0,.22); padding: 16px; }
    .modal h2 { margin: 0 0 12px; font-size: 17px; }
    .help-modal { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: min(860px, 100%); padding: 0; overflow: hidden; }
    .help-modal header, .help-modal footer { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 16px; border-bottom: 1px solid #e1e6ef; }
    .help-modal footer { display: block; border-top: 1px solid #e1e6ef; border-bottom: 0; }
    .help-modal header div { min-width: 0; }
    .help-modal header .icon-button { flex: 0 0 auto; align-self: flex-start; }
    .help-modal h2 { margin: 0 0 3px; }
    .help-modal header p, .help-modal footer p { margin: 0; color: #607086; font-size: 12px; line-height: 1.5; }
    .help-content { min-height: 0; overflow: auto; display: grid; gap: 10px; padding: 14px 16px; }
    .help-section { padding: 12px; border: 1px solid #dce3ed; border-radius: 8px; background: #fbfcfe; }
    .help-section.warning { border-color: #e5c572; background: #fffaf0; }
    .help-section h3 { margin: 0 0 6px; color: #1f2a3a; font-size: 14px; }
    .help-section p { margin: 0 0 8px; color: #4d5b70; font-size: 12px; line-height: 1.55; }
    .help-section ol, .help-section ul { display: grid; gap: 7px; margin: 0; padding-left: 22px; }
    .help-section li { color: #303a4c; font-size: 12px; line-height: 1.55; }
    .help-section li.critical, .help-section li.critical strong { color: #8a1f11; }
    .help-section li::marker { color: var(--blue); font-weight: 800; }
    .help-section strong { color: #172033; }
    .help-links { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0 0; }
    .help-link { min-height: 30px; display: inline-flex; align-items: center; gap: 6px; padding: 4px 9px; border: 1px solid #b8c9e4; border-radius: 6px; background: #f5f9ff; color: #174f9f; font-size: 12px; font-weight: 800; text-decoration: none; }
    .help-link:hover { background: #edf4ff; }
    .help-link::after { content: "↗"; font-size: 11px; line-height: 1; }
    .shortcut-grid { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 8px 12px; align-items: center; }
    .shortcut-grid input { width: 180px; }
    .shortcut-grid input.capturing { border-color: var(--blue); box-shadow: 0 0 0 2px rgba(29,95,209,.16); }
    .modal-footer { display: flex; justify-content: space-between; gap: 8px; margin-top: 14px; }
    @media (max-width: 820px) {
      .workspace { grid-template-columns: 1fr; }
      .save-row { grid-template-columns: 1fr; }
      .option-grid, .actions { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app" id="app">
    <section class="top">
      <div>
        <h1>CSP自動登録ヘルパー</h1>
        <div class="version" id="version"></div>
      </div>
      <div class="top-actions">
        <button class="icon-button" id="helpButton" type="button" aria-label="ヘルプを開く" title="ヘルプ">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"></path>
            <path d="M12 17h.01"></path>
          </svg>
        </button>
        <div class="badge" id="runBadge">待機中</div>
      </div>
    </section>

    <section class="workspace">
      <div class="column">
        <section class="panel">
          <h2 class="panel-title">入力ファイル</h2>
          <div class="drop-stack">
            <div class="drop-card" id="manifestCard" title="xsheet-remapの「タイムシート/CSP自動登録」で書き出した .xci を指定します。">
              <div>
                <div class="file-kind">CSP自動登録ファイル (.xci)</div>
                <div class="path empty" id="manifestPath"></div>
              </div>
              <button id="chooseManifest">選択</button>
            </div>
            <div class="drop-card" id="clipCard" title="操作対象のクリスタファイルを指定します。">
              <div>
                <div class="file-kind">クリスタファイル (.clip)</div>
                <div class="path empty" id="clipPath"></div>
              </div>
              <button id="chooseClip">選択</button>
            </div>
          </div>
          <div class="save-row">
            <div class="label">保存先</div>
            <input id="savePath" type="text" title="処理完了後に別名保存するCLIPファイルです。ファイル名込みで指定します。">
            <button id="chooseSave">変更</button>
          </div>
        </section>

        <section class="panel">
          <h2 class="panel-title">工程</h2>
          <div class="progress-shell">
            <div class="progress-head">
              <div class="stream idle" id="activity"></div>
              <div class="status" id="progressStatus">待機中</div>
              <div class="count" id="progressCount">0 / 0</div>
            </div>
            <div class="blocks" id="blocks"></div>
            <div class="detail" id="progressDetail"></div>
            <div class="error-reason" id="progressErrorReason"><span class="error-reason-label">停止理由</span><span id="progressErrorReasonText"></span></div>
            <div class="logs" id="progressLogs"></div>
          </div>
        </section>
      </div>

      <div class="column">
        <section class="panel">
          <h2 class="panel-title">読み込み内容</h2>
          <div class="metrics">
            <div class="metric"><div class="metric-label">カット</div><div class="metric-value" id="metricCuts">0</div></div>
            <div class="metric"><div class="metric-label">素材</div><div class="metric-value" id="metricAssets">0</div></div>
            <div class="metric"><div class="metric-label">セル列</div><div class="metric-value" id="metricTracks">0</div></div>
          </div>
          <div class="cuts" id="cutSummary"></div>
        </section>

        <section class="panel">
          <h2 class="panel-title">実行</h2>
          <div class="option-grid">
            <label class="check"><input id="closeAfterSave" type="checkbox">保存後にCLIPを閉じる</label>
            <select id="speed" title="標準は初回/NAS/不安定環境向け。高速は通常運用、最速は検証済み環境向けです。">
              <option value="standard">標準</option>
              <option value="fast">高速</option>
              <option value="turbo">最速</option>
            </select>
          </div>
          <div class="actions">
            <button id="profileButton" title="クリスタ側ショートカットとヘルパー設定を合わせます。">設定</button>
            <button class="primary" id="startButton">開始</button>
            <button class="stop" id="cancelButton">停止</button>
          </div>
        </section>

        <button id="closeButton">終了</button>
      </div>
    </section>

    <section class="footer" id="emergency">自動登録中はマウス・キーボード操作禁止。クリスタを前面のままにしてください。
既存のアニメーションフォルダーは全て非表示、または親フォルダを非表示にしてから開始してください。
非常停止: Ctrl+Alt+F12 / Ctrl+Alt+Pause</section>
  </main>

  <div class="modal-backdrop" id="helpModal">
    <div class="modal help-modal" role="dialog" aria-modal="true" aria-label="CSP自動登録ヘルパーの使い方">
      <header>
        <div>
          <h2>CSP自動登録ヘルパーの使い方</h2>
          <p>CSPはCLIP STUDIO PAINT、つまりクリスタのことです。このヘルパーはクリスタを自動操作して、XDTSと画像素材を組み込みます。</p>
        </div>
        <button class="icon-button" id="helpClose" type="button" aria-label="ヘルプを閉じる" title="閉じる">
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M18 6 6 18"></path>
            <path d="m6 6 12 12"></path>
          </svg>
        </button>
      </header>
      <div class="help-content">
        <section class="help-section warning">
          <h3>先に必ず準備すること</h3>
          <ol>
            <li><strong>Kodakのドキュメントスキャナで登録画像をスキャンします。</strong> 紙シート、動画用紙、セル画像は同じ前提のスキャン画像として扱います。</li>
            <li><strong>OLMペグホールスタビライザーでタップ穴基準に位置合わせします。</strong> 登録画像は、ヘルパーに渡す前に必ず位置合わせしてください。</li>
            <li><strong>作業対象の.clipはコピーを使います。</strong> 初回や設定変更後は、本番ファイルではなくテスト用コピーで確認してください。</li>
          </ol>
        </section>
        <section class="help-section">
          <h3>クリスタへ組み込む手順</h3>
          <ol>
            <li><strong>xsheet-remapで「タイムシート/CSP自動登録」を書き出します。</strong> カットフォルダ内にヘルパー用の登録ファイル（csp-import.xci）、XDTS、素材参照が作られます。</li>
            <li><strong>この画面でCSP自動登録ヘルパー用ファイル(.xci)を選びます。</strong> .xciをこのウィンドウへドロップしても読み込めます。</li>
            <li><strong>操作対象のクリスタファイル(.clip)を選びます。</strong> ヘルパーはこの.clipをクリスタで開いて処理します。</li>
            <li><strong>保存先を確認します。</strong> ファイル名込みの.clipパスにしてください。フォルダだけでは保存できません。</li>
            <li><strong>「開始」を押します。</strong> クリスタにXDTSを読み込み、必要な画像セルを登録し、最後に指定先へ別名保存します。</li>
          </ol>
        </section>
        <section class="help-section">
          <h3>実行前のクリスタ側チェック</h3>
          <p>ヘルパー用のショートカット設定済みワークスペースと、乗算オートアクションを先にクリスタへ読み込んでください。</p>
          <div class="help-links">
            <a class="help-link external-link" href="__WORKSPACE_ASSET_URL__" data-external-url="__WORKSPACE_ASSET_URL__" target="_blank" rel="noopener noreferrer">ワークスペースをAssetsで開く</a>
            <a class="help-link external-link" href="__MULTIPLY_ACTION_ASSET_URL__" data-external-url="__MULTIPLY_ACTION_ASSET_URL__" target="_blank" rel="noopener noreferrer">乗算オートアクションをAssetsで開く</a>
          </div>
          <ul>
            <li class="critical"><strong>最重要: 読み込ませたCLIPファイル内の既存のアニメーションフォルダーが全て非表示になるようにしてください。</strong> 各アニメーションフォルダ、またはそれを含む親フォルダを非表示にした状態であることを開始前に必ず確認してください。表示されたままだと、自動登録のフォルダ積み込みが崩れます。</li>
            <li>CLIP STUDIO PAINT（クリスタ）へ、xsheet-remap用ワークスペースを読み込み、ワークスペースとショートカットがヘルパーの「設定」と合っていること。</li>
            <li>乗算オートアクションを読み込んだ後、ファイル &gt; ショートカットキー設定から、設定領域 &gt; オートアクションを選び、読み込んだxsheet-remapオートアクションの「乗算」にCtrl+Alt+Lを割り当てていること。ワークスペース読み込みだけではオートアクションのショートカットは自動設定されません。</li>
            <li>自分でレイヤー合成モードを乗算にするオートアクションを作っている場合も、ヘルパーの「設定」にある「乗算オートアクション」と同じショートカットが割り当たっていれば使えます。</li>
            <li>タイムライン編集が有効な状態から始めること。ヘルパーはXDTS読み込み後に必要なタイミングで切り替えます。</li>
            <li>クリスタの確認ダイアログや保存ダイアログを残したまま開始しないこと。</li>
            <li>初回、NAS上のファイル、不安定な環境では速度を「標準」にすること。</li>
          </ul>
        </section>
        <section class="help-section">
          <h3>実行中の注意</h3>
          <ul>
            <li><strong>自動登録中はマウス・キーボードを触らないでください。</strong> ヘルパーがクリスタを前面にして操作します。</li>
            <li>止めたい場合はCtrl+Alt+F12、またはCtrl+Alt+Pauseを押します。次の安全なチェック地点で停止します。</li>
            <li>不明なクリスタのモーダルが出た場合、ヘルパーは無理に進めず停止します。ログと画面状態を確認してください。</li>
            <li>完了後は保存された.clipを開き、セル名、工程、BG/BOOK、撮影指示、メモの積み順を確認します。</li>
          </ul>
        </section>
      </div>
      <footer>
        <p>csp-import.xciはヘルパー用の登録ファイルであり、クリスタへ直接読み込むファイルではありません。必ずこのCSP自動登録ヘルパーから実行してください。</p>
      </footer>
    </div>
  </div>

  <div class="modal-backdrop" id="profileModal">
    <div class="modal">
      <h2>ショートカット設定</h2>
      <div class="shortcut-grid" id="shortcutGrid"></div>
      <label class="check" style="margin-top:12px;"><input id="setMultiply" type="checkbox">アニメーションフォルダを乗算にする</label>
      <div class="modal-footer">
        <button id="resetShortcuts">ショートカットを既定に戻す</button>
        <div>
          <button id="profileCancel">キャンセル</button>
          <button class="primary" id="profileSave">適用</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    const state = { latest: null, profileFields: [], dragDepth: 0 };
    const $ = (id) => document.getElementById(id);

    function invoke(name, ...args) {
      return window.pywebview.api[name](...args).then(applyState);
    }

    function pathClass(value, hint) {
      return value && value !== hint ? "path" : "path empty";
    }

    function applyState(next) {
      if (!next) return;
      state.latest = next;
      $("version").textContent = `v${next.version}`;
      renderBadge(next);
      renderFiles(next);
      renderMetrics(next);
      renderControls(next);
      renderProgress(next.progress || {});
    }
    window.xsheetApplyState = applyState;

    function renderBadge(next) {
      const badge = $("runBadge");
      const progress = next.progress || {};
      const text = progress.error ? "要確認" : (next.running ? "実行中" : (next.canStart ? "準備完了" : "待機中"));
      badge.textContent = text;
      badge.className = `badge ${progress.error ? "error" : next.running ? "running" : next.canStart ? "ready" : ""}`;
    }

    function renderFiles(next) {
      const metrics = next.metrics || {};
      const manifestReady = (metrics.cuts || 0) > 0;
      const clipReady = !!next.clipPath;
      $("manifestPath").textContent = next.manifestPathDisplay || "";
      $("manifestPath").className = pathClass(next.manifestPathDisplay, ".xci をドロップ、または選択");
      $("manifestCard").classList.toggle("ready", manifestReady);
      $("clipPath").textContent = next.clipPathDisplay || "";
      $("clipPath").className = pathClass(next.clipPathDisplay, ".clip をドロップ、または選択");
      $("clipCard").classList.toggle("ready", clipReady);
      $("savePath").value = next.savePath || "";
      $("cutSummary").textContent = next.cutSummary || "";
    }

    function renderMetrics(next) {
      const metrics = next.metrics || {};
      $("metricCuts").textContent = metrics.cuts || 0;
      $("metricAssets").textContent = metrics.assets || 0;
      $("metricTracks").textContent = metrics.tracks || 0;
    }

    function renderControls(next) {
      $("closeAfterSave").checked = !!next.closeAfterSave;
      $("speed").value = next.speedMode || "standard";
      $("startButton").disabled = !next.canStart;
      $("cancelButton").disabled = !next.running;
      $("chooseManifest").disabled = !!next.running;
      $("chooseClip").disabled = !!next.running;
      $("chooseSave").disabled = !!next.running;
      $("savePath").disabled = !!next.running;
      $("profileButton").disabled = !!next.running;
      $("helpButton").disabled = !!next.running;
      const emergency = next.emergencyStatus || "非常停止: Ctrl+Alt+F12 / Ctrl+Alt+Pause";
      $("emergency").textContent = `自動登録中はマウス・キーボード操作禁止。クリスタを前面のままにしてください。\n既存のアニメーションフォルダーは全て非表示、または親フォルダを非表示にしてから開始してください。\n${emergency}`;
    }

    function renderProgress(progress) {
      $("progressStatus").textContent = progress.status || "待機中";
      $("progressDetail").textContent = progress.detail || "";
      const errorReason = progress.errorReason || "";
      $("progressErrorReason").classList.toggle("show", !!errorReason);
      $("progressErrorReasonText").textContent = errorReason;
      $("progressErrorReason").title = errorReason;
      $("progressCount").textContent = `${progress.done || 0} / ${progress.total || 0}`;
      $("progressLogs").textContent = (progress.logs || []).join("\n") || "";
      $("activity").classList.toggle("idle", !progress.activity);
      renderBlocks(progress);
    }

    function renderBlocks(progress) {
      const total = progress.total || 0;
      const done = progress.done || 0;
      const blocks = $("blocks");
      blocks.style.gridTemplateColumns = total ? `repeat(${total}, minmax(4px, 1fr))` : "1fr";
      blocks.innerHTML = "";
      if (!total) {
        const block = document.createElement("div");
        block.className = "block";
        blocks.appendChild(block);
        return;
      }
      for (let i = 0; i < total; i += 1) {
        const block = document.createElement("div");
        let cls = "block";
        if (progress.error && i >= done) cls += " error";
        else if (i < done) cls += " done";
        else if (i === done && progress.activity) cls += " active";
        block.className = cls;
        blocks.appendChild(block);
      }
    }

    function syncOptions() {
      if (!state.latest || state.latest.running) return;
      invoke("set_options", {
        closeAfterSave: $("closeAfterSave").checked,
        speedMode: $("speed").value,
        savePath: $("savePath").value,
      });
    }

    function shortcutFromEvent(event) {
      if (event.metaKey) return null;
      const key = event.key;
      const modifierOnly = ["Control", "Shift", "Alt", "Meta", "OS"].includes(key);
      if (modifierOnly) return null;
      if (!event.ctrlKey && !event.shiftKey && !event.altKey) return null;
      const parts = [];
      if (event.ctrlKey) parts.push("Ctrl");
      if (event.shiftKey) parts.push("Shift");
      if (event.altKey) parts.push("Alt");
      const names = { " ": "SPACE", "Escape": "ESC", "Enter": "ENTER", "ArrowUp": "UP", "ArrowDown": "DOWN", "ArrowLeft": "LEFT", "ArrowRight": "RIGHT", "PageUp": "PAGEUP", "PageDown": "PAGEDOWN" };
      const displayKey = names[key] || key.toUpperCase();
      if (!displayKey || displayKey.length > 16) return null;
      parts.push(displayKey);
      return parts.join("+");
    }

    async function openProfileModal() {
      const settings = await window.pywebview.api.get_profile_settings();
      state.profileFields = settings.fields || [];
      const grid = $("shortcutGrid");
      grid.innerHTML = "";
      for (const field of state.profileFields) {
        const label = document.createElement("label");
        label.textContent = field.label;
        const input = document.createElement("input");
        input.type = "text";
        input.readOnly = true;
        input.dataset.key = field.key;
        input.dataset.defaultValue = field.defaultValue || "";
        input.value = field.value || "";
        input.addEventListener("focus", () => input.classList.add("capturing"));
        input.addEventListener("blur", () => input.classList.remove("capturing"));
        input.addEventListener("keydown", (event) => {
          event.preventDefault();
          const shortcut = shortcutFromEvent(event);
          if (shortcut) input.value = shortcut;
        });
        grid.appendChild(label);
        grid.appendChild(input);
      }
      $("setMultiply").checked = !!settings.setMultiply;
      $("profileModal").classList.add("show");
    }

    function closeProfileModal() {
      $("profileModal").classList.remove("show");
    }

    function openHelpModal() {
      $("helpModal").classList.add("show");
    }

    function closeHelpModal() {
      $("helpModal").classList.remove("show");
    }

    async function openExternalLink(event) {
      const url = event.currentTarget.dataset.externalUrl;
      if (!url) return;
      event.preventDefault();
      try {
        await window.pywebview.api.open_external_url(url);
      } catch (_error) {
        window.open(url, "_blank", "noopener");
      }
    }

    async function saveProfileModal() {
      const shortcuts = {};
      document.querySelectorAll("#shortcutGrid input").forEach((input) => {
        shortcuts[input.dataset.key] = input.value;
      });
      const next = await window.pywebview.api.save_profile_settings({
        shortcuts,
        setMultiply: $("setMultiply").checked,
      });
      closeProfileModal();
      applyState(next);
    }

    function resetProfileFields() {
      document.querySelectorAll("#shortcutGrid input").forEach((input) => {
        input.value = input.dataset.defaultValue || "";
      });
    }

    function bindUi() {
      $("chooseManifest").addEventListener("click", () => invoke("choose_manifest"));
      $("chooseClip").addEventListener("click", () => invoke("choose_clip"));
      $("chooseSave").addEventListener("click", () => invoke("choose_save_path"));
      $("closeAfterSave").addEventListener("change", syncOptions);
      $("speed").addEventListener("change", syncOptions);
      $("savePath").addEventListener("change", syncOptions);
      $("startButton").addEventListener("click", () => invoke("start_import"));
      $("cancelButton").addEventListener("click", () => invoke("request_cancel"));
      $("closeButton").addEventListener("click", () => invoke("close_window"));
      $("helpButton").addEventListener("click", openHelpModal);
      $("helpClose").addEventListener("click", closeHelpModal);
      document.querySelectorAll(".external-link").forEach((link) => {
        link.addEventListener("click", openExternalLink);
      });
      $("helpModal").addEventListener("click", (event) => {
        if (event.target === $("helpModal")) closeHelpModal();
      });
      $("profileButton").addEventListener("click", openProfileModal);
      $("profileCancel").addEventListener("click", closeProfileModal);
      $("profileSave").addEventListener("click", saveProfileModal);
      $("resetShortcuts").addEventListener("click", resetProfileFields);
      document.addEventListener("dragenter", (event) => {
        event.preventDefault();
        state.dragDepth += 1;
        document.body.classList.add("drop-active");
      });
      document.addEventListener("dragover", (event) => {
        event.preventDefault();
      });
      document.addEventListener("dragleave", () => {
        state.dragDepth = Math.max(0, state.dragDepth - 1);
        if (state.dragDepth === 0) document.body.classList.remove("drop-active");
      });
      document.addEventListener("drop", (event) => {
        event.preventDefault();
        state.dragDepth = 0;
        document.body.classList.remove("drop-active");
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeHelpModal();
      });
    }

    function bootWhenApiIsReady() {
      if (state.booted) return;
      if (!window.pywebview || !window.pywebview.api) {
        setTimeout(bootWhenApiIsReady, 50);
        return;
      }
      state.booted = true;
      bindUi();
      window.pywebview.api.initialize().then(applyState);
    }

    window.addEventListener("pywebviewready", bootWhenApiIsReady);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", bootWhenApiIsReady);
    } else {
      bootWhenApiIsReady();
    }
  </script>
</body>
</html>
"""

HTML = (
    HTML.replace("/* __LINE_SEED_FONT_FACE_CSS__ */", _line_seed_font_face_css())
    .replace("__WORKSPACE_ASSET_URL__", html.escape(WORKSPACE_ASSET_URL, quote=True))
    .replace("__MULTIPLY_ACTION_ASSET_URL__", html.escape(MULTIPLY_ACTION_ASSET_URL, quote=True))
)
