from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from csp_import_helper.profile import DEFAULT_PROFILE, load_workspace_profile, shortcut_to_display_text
from csp_import_helper.web_gui import (
    ALLOWED_EXTERNAL_URLS,
    HTML,
    CspImportHelperWebGui,
    OLM_PEG_HOLE_STABILIZER_URL,
    WORKSPACE_ASSET_URL,
    _with_speed_retry_guidance,
    _gui_startup_error_message,
    launch_gui,
    select_dropped_import_files,
)


FIXTURE_MANIFEST = (
    Path(__file__).resolve().parent
    / "fixtures"
    / "csp-import-v3-cut-group"
    / "xsheet-csp-import"
    / "csp-import.xci"
)


class WebGuiTests(unittest.TestCase):
    def test_speed_defaults_to_turbo_and_persists_user_choice(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "workspace-profile.json"
            app = CspImportHelperWebGui(profile_path=str(profile_path))

            self.assertEqual(app.get_state()["speedMode"], "turbo")
            state = app.set_options({"speedMode": "standard"})

            self.assertEqual(state["speedMode"], "standard")
            self.assertEqual(load_workspace_profile(profile_path).automation_speed_mode, "standard")
            restarted = CspImportHelperWebGui(profile_path=str(profile_path))
            self.assertEqual(restarted.get_state()["speedMode"], "standard")

    def test_explicit_speed_overrides_saved_choice_without_replacing_it(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            profile_path = Path(tmp) / "workspace-profile.json"
            app = CspImportHelperWebGui(profile_path=str(profile_path))
            app.set_options({"speedMode": "standard"})

            overridden = CspImportHelperWebGui(profile_path=str(profile_path), initial_speed_mode="fast")

            self.assertEqual(overridden.get_state()["speedMode"], "fast")
            self.assertEqual(load_workspace_profile(profile_path).automation_speed_mode, "standard")

    def test_error_guidance_requires_clean_retry_before_lowering_speed(self) -> None:
        message = _with_speed_retry_guidance("automation failed", "turbo")

        self.assertIn("CLIPを初期状態へ戻してください", message)
        self.assertIn("高速", message)
        self.assertIn("標準（安定優先）", message)
        self.assertEqual(_with_speed_retry_guidance("automation failed", "standard"), "automation failed")

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
            labels = {field["key"]: field["label"] for field in settings["fields"]}
            self.assertEqual(shortcuts["selectLayerAboveShortcut"], "Alt+]")
            self.assertEqual(shortcuts["selectLayerBelowShortcut"], "Alt+[")
            self.assertEqual(shortcuts["saveAsShortcut"], "Ctrl+Shift+S")
            self.assertEqual(labels["selectLayerAboveShortcut"], "編集対象にする＞上のレイヤー")
            self.assertEqual(labels["selectLayerBelowShortcut"], "編集対象にする＞下のレイヤー")
            shortcuts["importXdtsShortcut"] = "Ctrl+Alt+X"

            state = app.save_profile_settings({"shortcuts": shortcuts, "setMultiply": False})

            self.assertNotIn("notice", state)
            self.assertTrue(profile_path.exists())
            self.assertEqual(shortcut_to_display_text(app.profile.import_xdts_shortcut), "Ctrl+Alt+X")
            self.assertFalse(app.profile.set_imported_track_blend_mode_to_multiply)
            self.assertEqual(shortcut_to_display_text(DEFAULT_PROFILE.import_xdts_shortcut), "Ctrl+Alt+X")

    def test_external_help_links_are_allowlisted(self) -> None:
        app = CspImportHelperWebGui()

        self.assertEqual(
            WORKSPACE_ASSET_URL,
            "https://assets.clip-studio.com/ja-jp/detail?id=2285979",
        )
        with patch("csp_import_helper.web_gui.webbrowser.open") as open_mock:
            self.assertEqual(app.open_external_url(WORKSPACE_ASSET_URL), {"ok": True})
            self.assertEqual(
                app.open_external_url(OLM_PEG_HOLE_STABILIZER_URL), {"ok": True}
            )
            blocked = app.open_external_url("https://example.com/")

        self.assertEqual(
            ALLOWED_EXTERNAL_URLS,
            frozenset((WORKSPACE_ASSET_URL, OLM_PEG_HOLE_STABILIZER_URL)),
        )
        self.assertEqual(
            [call.args[0] for call in open_mock.call_args_list],
            [WORKSPACE_ASSET_URL, OLM_PEG_HOLE_STABILIZER_URL],
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
        self.assertIn('id="helpQuickTab"', HTML)
        self.assertIn('id="helpDetailedTab"', HTML)
        self.assertIn('aria-selected="true" aria-controls="helpQuickPanel"', HTML)
        self.assertIn('id="helpDetailedPanel" role="tabpanel"', HTML)
        self.assertIn('function setHelpView(view)', HTML)
        self.assertIn('aria-label="xsheet-importerの詳しい使い方の目次"', HTML)
        self.assertIn("全9章", HTML)
        self.assertEqual(HTML.count('data-help-chapter-target="'), 9)
        self.assertEqual(HTML.count('data-help-chapter="'), 9)
        self.assertIn('function setHelpChapter(index)', HTML)
        self.assertNotIn('id="helpButton">ヘルプ</button>', HTML)
        self.assertNotIn('id="helpCloseFooter"', HTML)
        self.assertNotIn('>閉じる</button>', HTML)
        self.assertNotIn("本体アプリ", HTML)
        self.assertIn("xsheet-remapまたはEditorで「CSP自動登録データを書き出す」を実行します", HTML)
        self.assertIn("xsheet-remapの「CSP自動登録データを書き出す」で作成した .xci", HTML)
        self.assertIn("PWA版ではZIP内にcsp-import.xci、XDTS、取得できた実際の画像素材", HTML)
        self.assertIn("ZIPを展開してからcsp-import.xciを選びます", HTML)
        self.assertIn("両方を同時にウィンドウへドロップできます", HTML)
        self.assertIn("処理後に作業中のCLIPファイルも閉じる場合だけ「保存後にCLIPを閉じる」をオン", HTML)
        self.assertNotIn("タイムシート/CSP自動登録", HTML)
        self.assertNotIn("素材参照が作られます", HTML)
        self.assertIn("初回のみ：クリスタ側の準備", HTML)
        self.assertIn("［ウィンドウ］＞［素材］から素材パレットを表示", HTML)
        self.assertIn("ワークスペースをキャンバスへドラッグ＆ドロップして読み込みます", HTML)
        self.assertIn("07｜実行前確認・進行・停止", HTML)
        self.assertIn("既存のアニメーションフォルダーがすべて非表示", HTML)
        self.assertIn("アニメーションフォルダーを1つずつ非表示にする必要はありません", HTML)
        self.assertIn("それらを含む親フォルダーを非表示にしても構いません", HTML)
        self.assertNotIn("読み込ませたCLIPファイル", HTML)
        self.assertIn("自動登録時のフォルダーの積み込みが崩れます", HTML)
        self.assertIn("同じCLIPファイルで、タイムライン編集が有効", HTML)
        self.assertIn("タイムライン編集が有効な状態を前提に処理を開始します", HTML)
        self.assertIn("クリスタは起動していなくても構いません", HTML)
        self.assertIn("作業対象以外のドキュメントを閉じ", HTML)
        self.assertIn(".clipファイルをダブルクリックしてクリスタで開ける状態", HTML)
        self.assertIn("08｜完了確認と失敗時のやり直し", HTML)
        self.assertIn("処理前のCLIPを使って最初から再実行", HTML)
        self.assertIn("13種類のショートカット", HTML)
        self.assertIn("選んだ速度は次回にも引き継がれます", HTML)
        self.assertIn("カットごとにタイムラインを作成して名前を付け", HTML)
        self.assertIn("乗算オートアクションを読み込んだ後", HTML)
        self.assertIn("乗算オートアクション", HTML)
        self.assertIn(WORKSPACE_ASSET_URL, HTML)
        self.assertIn("紙で作画された素材を扱うときのTips", HTML)
        self.assertLess(HTML.index("すぐ登録する5手順"), HTML.index("紙で作画された素材を扱うときのTips"))
        self.assertIn(OLM_PEG_HOLE_STABILIZER_URL, HTML)
        self.assertIn(">OLMペグホールスタビライザー</a>", HTML)
        self.assertNotIn("作業対象の.clipはコピーを使います", HTML)
        self.assertIn("open_external_url", HTML)
        self.assertIn("ワークスペースをAssetsで開く", HTML)
        self.assertIn("assets/xsheet-remap.laf", HTML)
        self.assertIn("オートアクションセットを読み込み", HTML)
        self.assertNotIn("乗算オートアクションをAssetsで開く", HTML)
        self.assertIn("ファイル &gt; ショートカットキー設定", HTML)
        self.assertIn("設定領域 &gt; オートアクション", HTML)
        self.assertIn("Ctrl+Alt+L", HTML)
        self.assertIn("ワークスペース読み込みだけではオートアクションのショートカットは自動設定されません", HTML)
        self.assertIn("同じ内容のオートアクションを自分で作っている場合", HTML)
        self.assertIn("white-space: pre-wrap", HTML)
        self.assertIn("white-space: pre-line", HTML)
        self.assertIn("親フォルダを非表示にしてから開始してください。\\n${emergency}", HTML)
        self.assertIn("してください。\n既存のアニメーションフォルダーは全て非表示", HTML)
        self.assertIn("開始してください。\n非常停止:", HTML)
        self.assertIn("LINE Seed JP", HTML)
        self.assertNotIn("Yu Gothic UI", HTML)
        self.assertNotIn("Consolas", HTML)
        self.assertNotIn("__LINE_SEED_FONT_FACE_CSS__", HTML)
        self.assertIn('<option value="turbo">最速（推奨）</option>', HTML)
        self.assertIn('<option value="standard">標準（安定優先）</option>', HTML)
        self.assertIn("grid-template-columns: minmax(0, 1fr) 176px", HTML)
        self.assertIn(".option-grid #speed { width: 100%; }", HTML)

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
        self.assertIn("ZIPのブロックを解除", message)
        self.assertIn("WebView2 Runtime", message)
        self.assertIn("RuntimeError: webview failed", message)


if __name__ == "__main__":
    unittest.main()
