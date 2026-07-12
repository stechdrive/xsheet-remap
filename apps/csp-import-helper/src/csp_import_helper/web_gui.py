from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
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
from .web_gui_html import build_web_gui_html


EMERGENCY_HOTKEY_TEXT = "Ctrl+Alt+F12 / Ctrl+Alt+Pause"
MANIFEST_DROP_HINT = ".xci をドロップ、または選択"
CLIP_DROP_HINT = ".clip をドロップ、または選択"
WORKSPACE_ASSET_URL = "https://assets.clip-studio.com/ja-jp/detail?id=2285979"
OLM_PEG_HOLE_STABILIZER_URL = "https://www.olm.co.jp/post/olm-peg-hole-stabilizer-updated"
ALLOWED_EXTERNAL_URLS = frozenset((WORKSPACE_ASSET_URL, OLM_PEG_HOLE_STABILIZER_URL))
MODE_TO_SPEED_DISPLAY = {
    SPEED_MODE_STANDARD: "標準（安定優先）",
    SPEED_MODE_FAST: "高速",
    SPEED_MODE_TURBO: "最速（推奨）",
}
LINE_SEED_FONT_CSS_FILES = ("400.css", "700.css", "800.css")
SHORTCUT_FIELDS: tuple[dict[str, str], ...] = (
    {"key": "timelineToggleShortcut", "label": "タイムライン有効化切替", "profile": "timeline_toggle_shortcut"},
    {"key": "newTimelineShortcut", "label": "新規タイムライン", "profile": "new_timeline_shortcut"},
    {"key": "timelineSettingsShortcut", "label": "タイムライン設定", "profile": "timeline_settings_shortcut"},
    {"key": "previousTimelineShortcut", "label": "前のタイムライン", "profile": "previous_timeline_shortcut"},
    {"key": "nextTimelineShortcut", "label": "次のタイムライン", "profile": "next_timeline_shortcut"},
    {"key": "selectLayerAboveShortcut", "label": "編集対象にする＞上のレイヤー", "profile": "select_layer_above_shortcut"},
    {"key": "selectLayerBelowShortcut", "label": "編集対象にする＞下のレイヤー", "profile": "select_layer_below_shortcut"},
    {"key": "importXdtsShortcut", "label": "XDTS読み込み", "profile": "import_xdts_shortcut"},
    {"key": "importImageShortcut", "label": "画像読み込み", "profile": "import_image_shortcut"},
    {"key": "rasterizeShortcut", "label": "ラスタライズ", "profile": "rasterize_shortcut"},
    {"key": "setMultiplyShortcut", "label": "乗算オートアクション", "profile": "set_multiply_shortcut"},
    {"key": "toggleFolderChildrenShortcut", "label": "フォルダーと配下を開閉", "profile": "toggle_folder_children_shortcut"},
    {"key": "saveAsShortcut", "label": "別名で保存", "profile": "save_as_shortcut"},
)


def _with_speed_retry_guidance(message: str, speed_mode: str) -> str:
    if speed_mode == SPEED_MODE_TURBO:
        return (
            f"{message}\n再実行する場合はCLIPを初期状態へ戻してください。"
            "タイミングが原因と思われる場合は、速度を「高速」または「標準（安定優先）」へ変更できます。"
        )
    if speed_mode == SPEED_MODE_FAST:
        return (
            f"{message}\n再実行する場合はCLIPを初期状態へ戻してください。"
            "タイミングが原因と思われる場合は、速度を「標準（安定優先）」へ変更できます。"
        )
    return message


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
    initial_speed_mode: str | None = None,
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
        "xsheet-importerのGUIを起動できませんでした。\n\n"
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

        ctypes.windll.user32.MessageBoxW(None, message, "xsheet-importer", 0x10)
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
        initial_speed_mode: str | None = None,
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
        saved_speed_mode = self.profile.automation_speed_mode
        self.speed_mode = initial_speed_mode if initial_speed_mode in MODE_TO_SPEED_DISPLAY else saved_speed_mode

    def run(self) -> None:
        import webview

        self.webview = webview
        self.window = webview.create_window(
            f"xsheet-importer v{__version__}",
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
                "speedDisplay": MODE_TO_SPEED_DISPLAY.get(self.speed_mode, MODE_TO_SPEED_DISPLAY[SPEED_MODE_TURBO]),
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
        profile_to_save: WorkspaceProfile | None = None
        with self.lock:
            self.close_after_save = bool(payload.get("closeAfterSave"))
            speed_mode = str(payload.get("speedMode") or self.speed_mode)
            if speed_mode in MODE_TO_SPEED_DISPLAY:
                if speed_mode != self.profile.automation_speed_mode:
                    self.profile = replace(self.profile, automation_speed_mode=speed_mode)
                    profile_to_save = self.profile
                self.speed_mode = speed_mode
            save_path = payload.get("savePath")
            if isinstance(save_path, str):
                self.save_path = save_path
            self._prepare_progress_preview_locked()
        if profile_to_save is not None:
            try:
                save_workspace_profile(profile_to_save, self.profile_path)
            except (OSError, ValueError) as exc:
                self._set_notice("error", f"速度設定を保存できません: {exc}")
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
                message = _with_speed_retry_guidance(str(exc), speed_mode)
                log.error(message)
                log.write(manifest.operation_log_path)
                self._log_threadsafe(f"PAUSED: {message}")
                self._mark_progress_error_threadsafe()
                self._set_run_status_threadsafe("一時停止")
                self._set_notice_threadsafe("warning", message)
            except (AutomationError, ManifestError) as exc:
                message = _with_speed_retry_guidance(str(exc), speed_mode)
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


HTML = build_web_gui_html(
    _line_seed_font_face_css(),
    WORKSPACE_ASSET_URL,
    OLM_PEG_HOLE_STABILIZER_URL,
)
