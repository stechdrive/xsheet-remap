from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import tempfile
import unittest

from PIL import Image

from csp_import_helper.automation import (
    AutomationError,
    AutomationPaused,
    CspImportAutomation,
    default_output_clip_path,
    _format_file_dialog_paths,
    _looks_like_windows_file_dialog,
    _looks_like_csp_custom_dialog,
    _load_xdts_track_names,
    _resolve_save_as_clip_path,
    _resolve_xdts_stack_target_index,
    _timeline_menu_check_area_stats,
    _visual_delta_from_xdts_indices,
)
from csp_import_helper.logging import OperationLog
from csp_import_helper.manifest import load_manifest
from csp_import_helper.profile import DEFAULT_PROFILE
from csp_import_helper.progress_plan import build_import_execution_plan


FIXTURE_MANIFEST = (
    Path(__file__).parent
    / "fixtures"
    / "csp-import-v3-cut-group"
    / "xsheet-csp-import"
    / "csp-import.xci"
)


class FakeAutomation(CspImportAutomation):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[str] = []

    def _focus_csp(self, log: OperationLog) -> None:
        self.calls.append("focus")
        log.add("test.focus")

    def _move_to_first_timeline(self, manifest, log: OperationLog) -> None:
        self.calls.append("move_first")
        log.add("test.move_first")

    def _ensure_timeline_enabled(self, log: OperationLog, *, reason: str) -> None:
        self.calls.append("ensure_timeline_enabled")
        log.add("test.ensure_timeline_enabled", reason=reason)

    def _ensure_timeline_disabled(self, log: OperationLog, *, reason: str) -> None:
        self.calls.append("ensure_timeline_disabled")
        log.add("test.ensure_timeline_disabled", reason=reason)

    def _import_setup_xdts(self, manifest, log: OperationLog) -> None:
        if manifest.setup is None:
            return
        self.calls.append(f"import_setup:{manifest.setup.xdts_path.stem}")
        log.add("test.import_setup", path=str(manifest.setup.xdts_path))

    def _create_new_timeline(self, cut, index: int, log: OperationLog) -> None:
        self.calls.append(f"create_timeline:{cut.cut_number}")
        log.add("test.create_timeline", cutNumber=cut.cut_number, index=index)

    def _import_xdts(self, manifest, log: OperationLog, *, verify_layer_stack: bool = True) -> None:
        self.calls.append(f"import_xdts:{manifest.xdts_path.stem}")
        log.add("test.import_xdts", path=str(manifest.xdts_path), verifyLayerStack=verify_layer_stack)

    def _rename_current_timeline(self, cut, log: OperationLog) -> None:
        self.calls.append(f"rename_timeline:{cut.timeline_name}")
        log.add("test.rename_timeline", cutNumber=cut.cut_number, timelineName=cut.timeline_name)

    def _restore_timeline_enabled(self, log: OperationLog, *, reason: str) -> None:
        self.calls.append("restore_timeline_enabled")
        log.add("test.restore_timeline_enabled", reason=reason)

    def _select_track(self, track, manifest, log: OperationLog) -> None:
        self.calls.append(f"select:{track.track_id}")
        log.add("test.select", trackId=track.track_id)

    def _import_images(
        self,
        image_paths: tuple[Path, ...],
        log: OperationLog,
        track_id: str,
        csp_cell_names: tuple[str, ...],
    ) -> None:
        self.calls.append(f"import_images:{track_id}:{','.join(csp_cell_names)}")
        log.add(
            "test.import_images",
            trackId=track_id,
            cspCellNames=list(csp_cell_names),
            paths=[str(path) for path in image_paths],
        )

    def _finish_imported_track_folder(self, track, manifest, log: OperationLog) -> None:
        self.calls.append(f"finish:{track.track_id}")
        log.add("test.finish", trackId=track.track_id)


class FakeImageImportAutomation(CspImportAutomation):
    def __init__(self) -> None:
        super().__init__(
            replace(
                DEFAULT_PROFILE,
                after_dialog_seconds=0,
                after_image_import_seconds=0,
                after_batch_image_import_base_seconds=0,
                after_batch_image_import_per_file_seconds=0,
            )
        )
        self.calls: list[str] = []

    def _open_file_import_image_dialog(self) -> None:
        self.calls.append("open_import_image")

    def _click(self, x: int, y: int) -> None:
        self.calls.append(f"click:{x},{y}")

    def _submit_file_dialog_paths(self, paths: tuple[Path, ...], **_kwargs: object) -> None:
        self.calls.append("submit:" + ",".join(path.name for path in paths))

    def _rasterize_selected_imported_layers(
        self,
        log: OperationLog,
        track_id: str,
        csp_cell_names: tuple[str, ...],
    ) -> None:
        self.calls.append(f"rasterize:{track_id}:{','.join(csp_cell_names)}")
        log.add("test.rasterize", trackId=track_id, cspCellNames=list(csp_cell_names))

    def _select_parent_folder_after_asset_import(
        self,
        log: OperationLog,
        track_id: str,
        csp_cell_names: tuple[str, ...],
    ) -> None:
        self.calls.append(f"select_parent:{track_id}:{','.join(csp_cell_names)}")
        log.add("test.select_parent", trackId=track_id, cspCellNames=list(csp_cell_names))


class FakeRasterizeAutomation(CspImportAutomation):
    def __init__(self, enabled: bool) -> None:
        super().__init__(replace(DEFAULT_PROFILE, rasterize_after_image_import=enabled, after_rasterize_seconds=0))
        self.calls: list[str] = []

    def _open_layer_rasterize_command(self) -> None:
        self.calls.append("open_layer_rasterize")


class FakeBlendModeAutomation(CspImportAutomation):
    def __init__(self, enabled: bool) -> None:
        super().__init__(
            replace(
                DEFAULT_PROFILE,
                set_imported_track_blend_mode_to_multiply=enabled,
                after_blend_mode_change_seconds=0,
            )
        )
        self.calls: list[str] = []

    def _close_selected_imported_track_folder(self, track, log: OperationLog) -> None:
        self.calls.append(f"close:{track.track_id}")
        log.add("test.close", trackId=track.track_id)

    def _set_selected_layer_blend_mode_to_multiply(
        self,
        log: OperationLog,
        track_id: str,
        target_name: str,
    ) -> None:
        self.calls.append(f"multiply:{track_id}")
        log.add("test.multiply", trackId=track_id, target=target_name)


class FakeTimelineStateAutomation(CspImportAutomation):
    def __init__(self, states: list[bool]) -> None:
        super().__init__(DEFAULT_PROFILE)
        self.states = states
        self.calls: list[str] = []

    def _read_timeline_enabled_from_menu(self, log: OperationLog, *, reason: str, attempt: int) -> bool:
        self.calls.append(f"read:{attempt}:{reason}")
        return self.states.pop(0)

    def _send_timeline_toggle(self, log: OperationLog, attempt: int) -> None:
        self.calls.append(f"shortcut:{attempt}")
        log.add("test.shortcut_toggle", attempt=attempt)


class FakeStackSelectionAutomation(CspImportAutomation):
    def __init__(self, *, close_imported_track_folder: bool = True) -> None:
        super().__init__(
            replace(
                DEFAULT_PROFILE,
                close_imported_track_folder_after_image_import=close_imported_track_folder,
            )
        )
        self.calls: list[str] = []
        self._selected_stack_index = 7

    def _refresh_import_stack_anchor_for_selection(self, manifest, log: OperationLog) -> None:
        self.calls.append("refresh_anchor")

    def _click(self, x: int, y: int) -> None:
        self.calls.append(f"click:{x},{y}")

    def _send_layer_selection_delta(self, visual_delta: int) -> None:
        self.calls.append(f"delta:{visual_delta}")


class FakeSaveAsAutomation(CspImportAutomation):
    def __init__(self, *, fail: bool = False) -> None:
        super().__init__(
            replace(
                DEFAULT_PROFILE,
                after_save_as_seconds=0,
                file_dialog_timeout_seconds=0.05,
                dialog_poll_interval_seconds=0.01,
            )
        )
        self.fail = fail
        self.calls: list[str] = []

    def _send_shortcut(self, shortcut: str) -> None:
        self.calls.append(f"shortcut:{shortcut}")

    def _submit_file_dialog_path(self, path: Path, **_kwargs: object) -> None:
        self.calls.append(f"submit:{path.name}")
        if self.fail:
            raise AutomationError("save failed")
        path.write_text("new", encoding="utf-8")


class FakeRect:
    def __init__(self, left: int, top: int, right: int, bottom: int) -> None:
        self.left = left
        self.top = top
        self.right = right
        self.bottom = bottom


class FakeWindow:
    def __init__(
        self,
        *,
        title: str,
        class_name: str,
        rect: FakeRect,
        children: tuple[object, ...] = (),
        visible: bool = True,
    ) -> None:
        self._title = title
        self._class_name = class_name
        self._rect = rect
        self._children = children
        self._visible = visible

    def window_text(self) -> str:
        return self._title

    def class_name(self) -> str:
        return self._class_name

    def rectangle(self) -> FakeRect:
        return self._rect

    def is_visible(self) -> bool:
        return self._visible

    def descendants(self, **kwargs: str) -> list[object]:
        result: list[object] = []
        for child in self._children:
            class_name = kwargs.get("class_name")
            if class_name is not None and getattr(child, "class_name")() != class_name:
                continue
            control_type = kwargs.get("control_type")
            if control_type is not None and getattr(child, "element_info").control_type != control_type:
                continue
            result.append(child)
        return result


class FakeControl:
    def __init__(self, *, class_name: str, control_type: str | None = None, visible: bool = True) -> None:
        self._class_name = class_name
        self._visible = visible
        self.element_info = type("ElementInfo", (), {"control_type": control_type or class_name})()

    def window_text(self) -> str:
        return ""

    def class_name(self) -> str:
        return self._class_name

    def is_visible(self) -> bool:
        return self._visible


class AutomationTests(unittest.TestCase):
    def test_imports_all_xdts_and_renames_timelines_before_asset_import(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        log = OperationLog(manifest_path=str(FIXTURE_MANIFEST), dry_run=False)

        automation = FakeAutomation()
        automation.run(manifest, log)

        self.assertEqual(
            automation.calls,
            [
                "focus",
                "move_first",
                "ensure_timeline_enabled",
                "import_setup:_setup",
                "import_xdts:C101A",
                "rename_timeline:101A",
                "create_timeline:C101B",
                "import_xdts:C101B",
                "rename_timeline:101B",
                "create_timeline:C101C",
                "import_xdts:C101C",
                "rename_timeline:101C",
                "move_first",
                "ensure_timeline_disabled",
                "select:slot_A",
                "import_images:slot_A:A_01,A_02",
                "finish:slot_A",
                "select:slot_B",
                "import_images:slot_B:B_01,B_02",
                "finish:slot_B",
                "select:slot_C",
                "import_images:slot_C:C_01",
                "finish:slot_C",
                "select:slot_D",
                "import_images:slot_D:D_01",
                "finish:slot_D",
                "select:slot_E",
                "import_images:slot_E:E_01",
                "finish:slot_E",
                "select:slot_enshutsu_A",
                "import_images:slot_enshutsu_A:A_03_e",
                "finish:slot_enshutsu_A",
                "select:slot_enshutsu_E",
                "import_images:slot_enshutsu_E:E_02_e",
                "finish:slot_enshutsu_E",
                "select:slot_enshutsu_D",
                "import_images:slot_enshutsu_D:D_02_e",
                "finish:slot_enshutsu_D",
                "select:slot_sakkan_A",
                "import_images:slot_sakkan_A:A_04_s",
                "finish:slot_sakkan_A",
                "select:slot_sakkan_C",
                "import_images:slot_sakkan_C:C_02_s",
                "finish:slot_sakkan_C",
                "select:slot_sakkan_B",
                "import_images:slot_sakkan_B:B_03_s",
                "finish:slot_sakkan_B",
                "restore_timeline_enabled",
            ],
        )

    def test_progress_events_follow_shared_execution_plan(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        log = OperationLog(manifest_path=str(FIXTURE_MANIFEST), dry_run=False)
        events: list[tuple[str, dict[str, object]]] = []

        automation = FakeAutomation()
        automation.progress_callback = lambda event, payload: events.append((event, payload))
        automation.run(manifest, log)

        done_labels = [str(payload["label"]) for event, payload in events if event == "step.done"]
        self.assertEqual(done_labels, build_import_execution_plan(manifest).progress_labels)
        self.assertEqual(events[0][0], "run.started")
        self.assertEqual(events[0][1]["stepCount"], len(done_labels))

    def test_selects_tracks_by_current_stack_position_from_import_end(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        tracks = {track.track_id: track for track in manifest.tracks}
        log = OperationLog(manifest_path=str(FIXTURE_MANIFEST), dry_run=False)
        automation = FakeStackSelectionAutomation()

        automation._select_track(tracks["slot_A"], manifest, log)
        automation._select_track(tracks["slot_B"], manifest, log)

        self.assertNotIn("refresh_anchor", automation.calls)
        self.assertEqual(
            automation.calls,
            [
                "delta:5",
                "delta:-1",
            ],
        )
        selected_events = [event for event in log.events if event["event"] == "track.selected"]
        self.assertEqual(selected_events[0]["method"], "current-stack-relative")
        self.assertEqual(selected_events[1]["method"], "current-stack-relative")
        self.assertEqual(selected_events[1]["currentIndex"], 2)
        self.assertEqual(selected_events[1]["targetIndex"], 3)

    def test_current_stack_position_selection_forces_closed_imported_folders(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        tracks = {track.track_id: track for track in manifest.tracks}
        log = OperationLog(manifest_path=str(FIXTURE_MANIFEST), dry_run=False)
        automation = FakeStackSelectionAutomation(close_imported_track_folder=False)

        automation._select_track(tracks["slot_A"], manifest, log)

        self.assertTrue(automation.profile.close_imported_track_folder_after_image_import)
        self.assertEqual(automation.calls, ["delta:5"])
        self.assertFalse(any(event["event"] == "track.current_relative.disabled" for event in log.events))

    def test_default_output_clip_path_uses_asset_root_and_timeline_names(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)

        self.assertEqual(default_output_clip_path(manifest), manifest.assets_root / "CSP_Import_Fixture_101_101A_101B_101C.clip")

    def test_default_output_clip_path_uses_manifest_output_clip_file_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (package / "C001.xdts").write_text("xdts", encoding="utf-8")
            manifest_path = _write_manifest(package, [_track()], output_clip_file_name="SAMPLE_05_C001.clip")
            manifest = load_manifest(manifest_path)

            self.assertEqual(default_output_clip_path(manifest), root / "SAMPLE_05_C001.clip")

    def test_default_output_clip_path_sanitizes_manifest_output_clip_file_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (package / "C001.xdts").write_text("xdts", encoding="utf-8")
            manifest_path = _write_manifest(package, [_track()], output_clip_file_name="bad:name")
            manifest = load_manifest(manifest_path)

            self.assertEqual(default_output_clip_path(manifest), root / "bad_name.clip")

    def test_save_as_output_path_must_not_be_an_existing_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            output_dir = root / "output"
            output_dir.mkdir()

            with self.assertRaisesRegex(AutomationError, "must include a .clip file name"):
                _resolve_save_as_clip_path(output_dir)

            self.assertEqual(_resolve_save_as_clip_path(root / "finished"), root / "finished.clip")

    def test_stages_asset_file_names_to_match_csp_cell_names_before_import(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (package / "C001.xdts").write_text("xdts", encoding="utf-8")
            (root / "rough.png").write_bytes(b"a")
            manifest_path = _write_manifest(package, [_track(cels=[_cel("A_01", "rough.png")])])
            manifest = load_manifest(manifest_path)
            log = OperationLog(manifest_path=str(manifest_path), dry_run=False)

            automation = FakeAutomation()
            automation.run(manifest, log)

            self.assertIn("import_images:A:A_01", automation.calls)
            staged = [event for event in log.events if event["event"] == "asset.staged_for_csp_name"]
            self.assertEqual(len(staged), 1)
            self.assertEqual(staged[0]["cspCellName"], "A_01")

    def test_formats_multiple_file_dialog_paths_for_windows_common_dialog(self) -> None:
        self.assertEqual(_format_file_dialog_paths((Path(r"D:\cut\A_01.png"),)), r"D:\cut\A_01.png")
        self.assertEqual(
            _format_file_dialog_paths((Path(r"D:\cut\A 01.png"), Path(r"D:\cut\A_02.png"))),
            r'"D:\cut\A 01.png" "D:\cut\A_02.png"',
        )
        self.assertEqual(
            _format_file_dialog_paths((Path(r"D:\素材 フォルダ\あ_01.png"), Path(r"D:\素材 フォルダ\い 02.png"))),
            r'"D:\素材 フォルダ\あ_01.png" "D:\素材 フォルダ\い 02.png"',
        )
        with self.assertRaisesRegex(AutomationError, "at least one"):
            _format_file_dialog_paths(())

    def test_menu_check_area_stats_detects_bright_checkmark_on_dark_row(self) -> None:
        image = Image.new("RGB", (20, 20), (35, 35, 35))
        for index in range(20):
            image.putpixel((index, index), (230, 230, 230))

        stats = _timeline_menu_check_area_stats(image)

        self.assertGreater(stats["darkRatio"], 0.9)
        self.assertGreater(stats["checkmarkScore"], 0.04)

    def test_timeline_enabled_ready_check_uses_operator_contract(self) -> None:
        automation = FakeTimelineStateAutomation([False])
        log = OperationLog(manifest_path="manifest.json", dry_run=False)

        automation._ensure_timeline_enabled(log, reason="xdts import")

        self.assertEqual(automation.calls, [])
        self.assertEqual(log.events[-1]["event"], "timeline.ready_state_assumed")
        self.assertTrue(log.events[-1]["requestedEnabled"])
        self.assertIn("operator", log.events[-1]["contract"])

    def test_timeline_disabled_sends_one_toggle_after_xdts(self) -> None:
        automation = FakeTimelineStateAutomation([False])
        log = OperationLog(manifest_path="manifest.json", dry_run=False)

        automation._ensure_timeline_disabled(log, reason="asset import")

        self.assertEqual(
            automation.calls,
            [
                "shortcut:1",
            ],
        )
        self.assertEqual(log.events[-1]["event"], "timeline.state_changed")
        self.assertFalse(log.events[-1]["requestedEnabled"])
        self.assertFalse(log.events[-1]["verified"])

    def test_timeline_restore_sends_one_toggle_after_asset_import(self) -> None:
        automation = FakeTimelineStateAutomation([True])
        log = OperationLog(manifest_path="manifest.json", dry_run=False)

        automation._restore_timeline_enabled(log, reason="finish")

        self.assertEqual(
            automation.calls,
            [
                "shortcut:1",
            ],
        )
        self.assertEqual(log.events[-1]["event"], "timeline.restore_sent")
        self.assertTrue(log.events[-1]["requestedEnabled"])
        self.assertFalse(log.events[-1]["verified"])

    def test_stop_file_pauses_before_next_csp_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            stop_file = Path(tmp) / "stop"
            stop_file.write_text("stop", encoding="utf-8")
            automation = CspImportAutomation(stop_file=stop_file)
            log = OperationLog(manifest_path="manifest.json", dry_run=False)

            with self.assertRaisesRegex(AutomationPaused, "stop file"):
                automation._check_control(log, "test phase")

            self.assertEqual(log.events[-1]["event"], "automation.paused")

    def test_detects_csp_custom_dialog_window(self) -> None:
        self.assertTrue(
            _looks_like_csp_custom_dialog(
                FakeWindow(
                    title="設定変更",
                    class_name="742DEA58-ED6B-4402-BC11-20DFC6D08040-6571DDC4-B3AA-45e4-9D35-57C0C1E90AD5",
                    rect=FakeRect(1154, 775, 1610, 1032),
                )
            )
        )
        self.assertFalse(
            _looks_like_csp_custom_dialog(
                FakeWindow(
                    title="CLIP STUDIO PAINT",
                    class_name="742DEA58-ED6B-4402-BC11-20DFC6D08040",
                    rect=FakeRect(-8, -8, 1928, 1040),
                )
            )
        )

    def test_detects_windows_file_dialog_by_control_structure(self) -> None:
        dialog = FakeWindow(
            title="文字化けしてもよい",
            class_name="#32770",
            rect=FakeRect(0, 0, 1500, 1065),
            children=(
                FakeControl(class_name="Edit"),
                FakeControl(class_name="Edit"),
                FakeControl(class_name="Button"),
                FakeControl(class_name="Button"),
                FakeControl(class_name="ComboBox"),
            ),
        )

        self.assertTrue(_looks_like_windows_file_dialog(dialog))

    def test_rejects_plain_modal_as_file_dialog_without_common_dialog_controls(self) -> None:
        dialog = FakeWindow(
            title="確認",
            class_name="#32770",
            rect=FakeRect(100, 100, 680, 420),
            children=(
                FakeControl(class_name="Button"),
                FakeControl(class_name="Button"),
            ),
        )

        self.assertFalse(_looks_like_windows_file_dialog(dialog))

    def test_save_as_restores_existing_output_when_csp_save_fails(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "result.clip"
            target.write_text("old", encoding="utf-8")
            log = OperationLog(manifest_path="manifest.json", dry_run=False)
            automation = FakeSaveAsAutomation(fail=True)

            with self.assertRaisesRegex(AutomationError, "save failed"):
                automation._save_as_clip(target, log)

            self.assertEqual(target.read_text(encoding="utf-8"), "old")
            self.assertFalse(list(Path(tmp).glob("*.backup-*.clip")))
            self.assertIn("clip.save_as_existing_restored", [event["event"] for event in log.events])

    def test_save_as_removes_backup_after_successful_overwrite(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "result.clip"
            target.write_text("old", encoding="utf-8")
            log = OperationLog(manifest_path="manifest.json", dry_run=False)
            automation = FakeSaveAsAutomation()

            automation._save_as_clip(target, log)

            self.assertEqual(target.read_text(encoding="utf-8"), "new")
            self.assertFalse(list(Path(tmp).glob("*.backup-*.clip")))
            self.assertEqual(log.events[-1]["event"], "clip.saved_as")

    def test_resolves_duplicate_xdts_track_by_stage_separator_context(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (root / "A_01.png").write_bytes(b"a")
            (package / "C001.xdts").write_text(
                "exchangeDigitalTimeSheet Save Data\n"
                + json.dumps(
                    {
                        "timeTables": [
                            {
                                "timeTableHeaders": [
                                    {
                                        "fieldId": 0,
                                        "names": [
                                            "===== XSHEET IMPORT START =====",
                                            "===== 作画 =====",
                                            "A",
                                            "===== 演出 =====",
                                            "A",
                                            "===== XSHEET IMPORT END =====",
                                        ],
                                    }
                                ]
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = _write_manifest(
                package,
                [
                    _track("sakuga.A", stage_label="作画", target_folder_path=["LO", "作画"]),
                    _track("enshutsu.A", stack_order=20, stage_label="演出", target_folder_path=["LO", "演出"]),
                ],
            )
            manifest = load_manifest(manifest_path)
            stack_names = _load_xdts_track_names(manifest.xdts_path)

            self.assertEqual(stack_names[2], "A")
            self.assertEqual(stack_names[4], "A")
            self.assertEqual(_resolve_xdts_stack_target_index(manifest.tracks[0], manifest, stack_names), 2)
            self.assertEqual(_resolve_xdts_stack_target_index(manifest.tracks[1], manifest, stack_names), 4)
            self.assertEqual(_visual_delta_from_xdts_indices(5, 2), 3)
            self.assertEqual(_visual_delta_from_xdts_indices(0, 2), -2)

    def test_resolves_shared_cut_process_fixture_duplicates_by_process_context(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        stack_names = _load_xdts_track_names(manifest.stack_reference_xdts_path)
        tracks = {track.track_id: track for track in manifest.tracks}

        self.assertEqual(stack_names[6], "E")
        self.assertEqual(stack_names[10], "E")
        self.assertEqual(stack_names[8], "A")
        self.assertEqual(stack_names[12], "A")
        self.assertEqual(_resolve_xdts_stack_target_index(tracks["slot_enshutsu_E"], manifest, stack_names), 10)
        self.assertEqual(_resolve_xdts_stack_target_index(tracks["slot_sakkan_A"], manifest, stack_names), 12)

    def test_resolves_japanese_only_xdts_track_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (root / "A_01.png").write_bytes(b"a")
            (package / "C001.xdts").write_text(
                "exchangeDigitalTimeSheet Save Data\n"
                + json.dumps(
                    {
                        "timeTables": [
                            {
                                "timeTableHeaders": [
                                    {
                                        "fieldId": 0,
                                        "names": [
                                            "===== XSHEET IMPORT START =====",
                                            "_花びら撮処理",
                                            "===== XSHEET IMPORT END =====",
                                        ],
                                    }
                                ]
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            manifest_path = _write_manifest(
                package,
                [
                    _track(
                        "petals",
                        xdts_track_name="_花びら撮処理",
                        stack_order=1,
                        stage_label="撮処理",
                    )
                ],
            )
            manifest = load_manifest(manifest_path)
            stack_names = _load_xdts_track_names(manifest.xdts_path)

            self.assertEqual(_resolve_xdts_stack_target_index(manifest.tracks[0], manifest, stack_names), 1)

    def test_import_images_rasterizes_selected_layers_before_logging_imported_assets(self) -> None:
        automation = FakeImageImportAutomation()
        log = OperationLog(manifest_path="manifest.json", dry_run=False)

        automation._import_images((Path("A_01.png"), Path("A_02.png")), log, "A", ("A_01", "A_02"))

        self.assertEqual(
            automation.calls,
            [
                "open_import_image",
                "submit:A_01.png,A_02.png",
                "rasterize:A:A_01,A_02",
                "select_parent:A:A_01,A_02",
            ],
        )
        event_names = [event["event"] for event in log.events]
        self.assertLess(event_names.index("test.rasterize"), event_names.index("asset.imported"))
        self.assertLess(event_names.index("test.select_parent"), event_names.index("asset.imported"))
        self.assertIn("asset.batch_imported", event_names)

    def test_rasterize_is_forced_even_when_profile_disables_it(self) -> None:
        automation = FakeRasterizeAutomation(enabled=False)
        log = OperationLog(manifest_path="manifest.json", dry_run=False)

        automation._rasterize_selected_imported_layers(log, "A", ("A_01",))

        self.assertTrue(automation.profile.rasterize_after_image_import)
        self.assertEqual(automation.calls, ["open_layer_rasterize"])
        self.assertEqual(log.events[-1]["event"], "asset.batch_rasterized")

    def test_rasterize_uses_configured_command_when_enabled(self) -> None:
        automation = FakeRasterizeAutomation(enabled=True)
        log = OperationLog(manifest_path="manifest.json", dry_run=False)

        automation._rasterize_selected_imported_layers(log, "A", ("A_01", "A_02"))

        self.assertEqual(automation.calls, ["open_layer_rasterize"])
        self.assertEqual(log.events[-1]["event"], "asset.batch_rasterized")

    def test_finish_imported_track_folder_closes_folder_and_sets_multiply(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        log = OperationLog(manifest_path=str(FIXTURE_MANIFEST), dry_run=False)
        automation = FakeBlendModeAutomation(enabled=True)

        automation._finish_imported_track_folder(manifest.tracks[0], manifest, log)

        self.assertEqual(automation.calls, ["close:slot_A", "multiply:slot_A"])
        self.assertEqual(log.events[-1]["event"], "test.multiply")

    def test_finish_imported_track_folder_can_skip_multiply_by_profile(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)
        log = OperationLog(manifest_path=str(FIXTURE_MANIFEST), dry_run=False)
        automation = FakeBlendModeAutomation(enabled=False)

        automation._finish_imported_track_folder(manifest.tracks[0], manifest, log)

        self.assertEqual(automation.calls, ["close:slot_A"])
        self.assertEqual(log.events[-1]["event"], "track.blend_mode_skipped")


def _write_manifest(package: Path, tracks: list[dict[str, object]], *, output_clip_file_name: str | None = None) -> Path:
    manifest_path = package / "csp-import.xci"
    manifest: dict[str, object] = {
        "schemaVersion": 4,
        "assetRoot": "..",
        "cuts": [
            {
                "cutId": "cut_1",
                "order": 0,
                "cutNumber": "C001",
                "displayName": "C001",
                "timelineName": "C001",
                "durationFrames": 24,
                "fps": 24,
                "files": {"xdts": "C001.xdts", "operationLog": "C001-csp-import-log.json"},
                "importStack": {
                    "enabled": True,
                    "startSeparator": "===== XSHEET IMPORT START =====",
                    "endSeparator": "===== XSHEET IMPORT END =====",
                },
                "tracks": tracks,
            }
        ],
    }
    if output_clip_file_name is not None:
        manifest["outputClipFileName"] = output_clip_file_name
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False),
        encoding="utf-8",
    )
    return manifest_path


def _track(
    track_id: str = "A",
    *,
    xdts_track_name: str = "A",
    stack_order: int = 10,
    stage_label: str | None = None,
    target_folder_path: list[str] | None = None,
    cels: list[dict[str, object]] | None = None,
) -> dict[str, object]:
    return {
        "trackId": track_id,
        "kind": "cell",
        "xdtsTrackName": xdts_track_name,
        "stackOrder": stack_order,
        "stageLabel": stage_label,
        "targetFolderPath": target_folder_path or [],
        "cels": cels if cels is not None else [_cel("A_01", "A_01.png")],
    }


def _cel(csp_cell_name: str, path: str) -> dict[str, object]:
    return {
        "cspCellName": csp_cell_name,
        "firstFrame": 0,
        "material": {"assetId": f"asset_{csp_cell_name}", "pathKind": "asset-root-relative", "path": path},
    }


if __name__ == "__main__":
    unittest.main()
