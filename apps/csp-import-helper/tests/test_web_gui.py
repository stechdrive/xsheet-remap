from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from csp_import_helper.profile import DEFAULT_PROFILE, shortcut_to_display_text
from csp_import_helper.web_gui import (
    ALLOWED_EXTERNAL_URLS,
    HTML,
    CspImportHelperWebGui,
    MULTIPLY_ACTION_ASSET_URL,
    WORKSPACE_ASSET_URL,
    _gui_startup_error_message,
    launch_gui,
    select_dropped_import_files,
)


FIXTURE_MANIFEST = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "csp-import-v2-shared-cuts"
    / "xsheet-csp-import"
    / "csp-import.xci"
)


class WebGuiTests(unittest.TestCase):
    def test_drop_selection_uses_first_xci_and_first_clip(self) -> None:
        manifest_path, clip_path = select_dropped_import_files(
            (
                Path("ignored.txt"),
                Path("first.xci"),
                Path("second.xci"),
                Path("target.clip"),
                Path("other.clip"),
            )
        )

        self.assertEqual(manifest_path, Path("first.xci"))
        self.assertEqual(clip_path, Path("target.clip"))

    def test_load_manifest_updates_summary_and_progress_preview(self) -> None:
        app = CspImportHelperWebGui(initial_clip="C:/work/target.clip")

        state = app.load_manifest_path(str(FIXTURE_MANIFEST))

        self.assertNotIn("notice", state)
        self.assertEqual(state["summary"], "カット: 3件 / 素材: 13件 / セル列: 11件")
        self.assertEqual(state["metrics"], {"cuts": 3, "assets": 13, "tracks": 11})
        self.assertIn("101A (24f)", state["cutSummary"])
        self.assertTrue(state["canStart"])
        self.assertGreater(state["progress"]["total"], 0)
        self.assertEqual(state["progress"]["status"], "開始できます")

    def test_handle_drop_accepts_japanese_paths(self) -> None:
        app = CspImportHelperWebGui()
        clip_path = Path("C:/作業/兼用カット.clip")

        state = app.handle_drop([str(FIXTURE_MANIFEST), str(clip_path)])

        self.assertIn("csp-import.xci", state["manifestPathDisplay"])
        self.assertEqual(state["clipPath"], str(clip_path))

    def test_non_import_drop_is_shown_in_progress_detail(self) -> None:
        app = CspImportHelperWebGui()

        state = app.handle_drop(["C:/work/readme.txt"])

        self.assertEqual(state["progress"]["status"], "要確認")
        self.assertIn(".xci または .clip", state["progress"]["detail"])
        self.assertEqual(state["progress"]["errorReason"], "")

    def test_error_reason_is_exposed_for_full_progress_display(self) -> None:
        app = CspImportHelperWebGui()
        message = (
            "CSP layer selection state is unavailable for keyboard-only import. "
            "Open the CLIP with the timeline enabled, keep imported parent folders closed, "
            "and retry from a clean document. Track: petals (_花びら撮処理)"
        )

        app._set_notice("error", message)
        state = app.get_state()

        self.assertTrue(state["progress"]["error"])
        self.assertEqual(state["progress"]["detail"], message)
        self.assertEqual(state["progress"]["errorReason"], message)

    def test_profile_settings_can_be_saved_without_webview_runtime(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "workspace-profile.json"
            app = CspImportHelperWebGui(profile_path=str(profile_path))
            settings = app.get_profile_settings()
            shortcuts = {field["key"]: field["value"] for field in settings["fields"]}
            shortcuts["importXdtsShortcut"] = "Ctrl+Alt+X"

            state = app.save_profile_settings({"shortcuts": shortcuts, "setMultiply": False})

            self.assertNotIn("notice", state)
            self.assertTrue(profile_path.exists())
            self.assertEqual(shortcut_to_display_text(app.profile.import_xdts_shortcut), "Ctrl+Alt+X")
            self.assertFalse(app.profile.set_imported_track_blend_mode_to_multiply)
            self.assertEqual(shortcut_to_display_text(DEFAULT_PROFILE.import_xdts_shortcut), "Ctrl+Alt+X")

    def test_external_help_links_are_allowlisted(self) -> None:
        app = CspImportHelperWebGui()

        with patch("csp_import_helper.web_gui.webbrowser.open") as open_mock:
            self.assertEqual(app.open_external_url(WORKSPACE_ASSET_URL), {"ok": True})
            self.assertEqual(app.open_external_url(MULTIPLY_ACTION_ASSET_URL), {"ok": True})
            blocked = app.open_external_url("https://example.com/")

        self.assertEqual(ALLOWED_EXTERNAL_URLS, frozenset((WORKSPACE_ASSET_URL, MULTIPLY_ACTION_ASSET_URL)))
        self.assertEqual(
            [call.args[0] for call in open_mock.call_args_list],
            [WORKSPACE_ASSET_URL, MULTIPLY_ACTION_ASSET_URL],
        )
        self.assertFalse(blocked["ok"])

    def test_web_ui_does_not_poll_backend_state(self) -> None:
        self.assertNotIn("setInterval", HTML)
        self.assertNotIn("安全停止", HTML)
        self.assertNotIn('id="notice"', HTML)
        self.assertNotIn("noticeClose", HTML)
        self.assertIn(">停止</button>", HTML)
        self.assertIn('id="closeButton">終了</button>', HTML)
        self.assertIn('id="progressErrorReason"', HTML)
        self.assertIn('aria-label="ヘルプを開く"', HTML)
        self.assertIn('aria-label="ヘルプを閉じる"', HTML)
        self.assertNotIn('id="helpButton">ヘルプ</button>', HTML)
        self.assertNotIn('id="helpCloseFooter"', HTML)
        self.assertNotIn('>閉じる</button>', HTML)
        self.assertNotIn("本体アプリ", HTML)
        self.assertIn("xsheet-remapで「タイムシート/CSP自動登録」を書き出します", HTML)
        self.assertIn("xsheet-remapの「タイムシート/CSP自動登録」で書き出した .xci", HTML)
        self.assertIn("既存のアニメーションフォルダーが全て非表示", HTML)
        self.assertIn("自動登録のフォルダ積み込みが崩れます", HTML)
        self.assertIn("乗算オートアクションを読み込んだ後", HTML)
        self.assertIn("乗算オートアクション", HTML)
        self.assertIn(WORKSPACE_ASSET_URL, HTML)
        self.assertIn(MULTIPLY_ACTION_ASSET_URL, HTML)
        self.assertIn("open_external_url", HTML)
        self.assertIn("ワークスペースをAssetsで開く", HTML)
        self.assertIn("乗算オートアクションをAssetsで開く", HTML)
        self.assertIn("ファイル &gt; ショートカットキー設定", HTML)
        self.assertIn("設定領域 &gt; オートアクション", HTML)
        self.assertIn("Ctrl+Alt+L", HTML)
        self.assertIn("ワークスペース読み込みだけではオートアクションのショートカットは自動設定されません", HTML)
        self.assertIn("自分でレイヤー合成モードを乗算にするオートアクション", HTML)
        self.assertIn("white-space: pre-wrap", HTML)
        self.assertIn("white-space: pre-line", HTML)
        self.assertIn("親フォルダを非表示にしてから開始してください。\\n${emergency}", HTML)
        self.assertIn("してください。\n既存のアニメーションフォルダーは全て非表示", HTML)
        self.assertIn("開始してください。\n非常停止:", HTML)
        self.assertIn("LINE Seed JP", HTML)
        self.assertNotIn("Yu Gothic UI", HTML)
        self.assertNotIn("Consolas", HTML)
        self.assertNotIn("__LINE_SEED_FONT_FACE_CSS__", HTML)

    def test_launch_gui_reports_webview_backend_failure(self) -> None:
        with (
            patch.object(CspImportHelperWebGui, "run", side_effect=RuntimeError("webview failed")),
            patch("csp_import_helper.web_gui._show_gui_startup_error") as show_error,
        ):
            self.assertEqual(
                launch_gui(
                    "C:/cut/csp-import.xci",
                    "C:/profile/workspace-profile.json",
                    "C:/cut/work.clip",
                    initial_speed_mode="turbo",
                    auto_start=True,
                ),
                1,
            )

        show_error.assert_called_once()

    def test_gui_startup_error_message_points_to_packaged_runtime(self) -> None:
        message = _gui_startup_error_message(RuntimeError("webview failed"))

        self.assertIn("GUIを起動できませんでした", message)
        self.assertIn("同梱ランタイム", message)
        self.assertIn("WebView2 Runtime", message)
        self.assertIn("RuntimeError: webview failed", message)


if __name__ == "__main__":
    unittest.main()
