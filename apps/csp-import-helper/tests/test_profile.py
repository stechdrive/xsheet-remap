from __future__ import annotations

from dataclasses import replace
from pathlib import Path
import tempfile
import unittest

from csp_import_helper.profile import (
    DEFAULT_PROFILE,
    PROFILE_SCHEMA_VERSION,
    Rect,
    apply_workspace_profile_speed,
    load_workspace_profile,
    save_workspace_profile,
    scale_profile_to_window,
    shortcut_from_display_text,
    shortcut_to_display_text,
    update_workspace_profile_shortcuts,
    workspace_profile_from_json,
)


class ProfileTests(unittest.TestCase):
    def test_saves_and_loads_workspace_profile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "profile.json"
            profile = update_workspace_profile_shortcuts(
                DEFAULT_PROFILE,
                timeline_toggle_shortcut="+y",
                select_layer_above_shortcut="+u",
                select_layer_below_shortcut="+j",
                new_timeline_shortcut="^%n",
                timeline_settings_shortcut="^+w",
                previous_timeline_shortcut="^+left",
                next_timeline_shortcut="^+right",
                save_as_shortcut="+%w",
            )

            saved_path = save_workspace_profile(profile, path)
            loaded = load_workspace_profile(saved_path)

            self.assertEqual(loaded.timeline_toggle_shortcut, "+y")
            self.assertEqual(loaded.select_layer_above_shortcut, "+u")
            self.assertEqual(loaded.select_layer_below_shortcut, "+j")
            self.assertEqual(loaded.new_timeline_shortcut, "^%n")
            self.assertEqual(loaded.timeline_settings_shortcut, "^+w")
            self.assertEqual(loaded.previous_timeline_shortcut, "^+left")
            self.assertEqual(loaded.next_timeline_shortcut, "^+right")
            self.assertEqual(loaded.save_as_shortcut, "+%w")
            self.assertEqual(loaded.layer_palette, DEFAULT_PROFILE.layer_palette)
            self.assertEqual(loaded.timeline_palette, DEFAULT_PROFILE.timeline_palette)
            self.assertEqual(loaded.timeline_menu_row, DEFAULT_PROFILE.timeline_menu_row)

    def test_scales_profile_to_current_csp_window_rect(self) -> None:
        calibrated = scale_profile_to_window(DEFAULT_PROFILE, Rect(100, 50, 2020, 1130))

        self.assertEqual(calibrated.file_menu.x, DEFAULT_PROFILE.file_menu.x + 100)
        self.assertEqual(calibrated.file_menu.y, DEFAULT_PROFILE.file_menu.y + 50)
        self.assertEqual(calibrated.layer_palette.left, DEFAULT_PROFILE.layer_palette.left + 100)
        self.assertEqual(calibrated.layer_palette.top, DEFAULT_PROFILE.layer_palette.top + 50)
        self.assertEqual(calibrated.timeline_palette.left, DEFAULT_PROFILE.timeline_palette.left + 100)
        self.assertEqual(calibrated.timeline_palette.top, DEFAULT_PROFILE.timeline_palette.top + 50)
        self.assertEqual(calibrated.row_height, DEFAULT_PROFILE.row_height)
        self.assertEqual(calibrated.reference_window_rect, Rect(100, 50, 2020, 1130))

    def test_scaling_does_not_keep_appending_calibration_suffixes(self) -> None:
        profile = replace(DEFAULT_PROFILE, name=f"{DEFAULT_PROFILE.name}-ocr-calibrated-1936x1048")

        calibrated = scale_profile_to_window(profile, Rect(100, 50, 2020, 1130))

        self.assertEqual(calibrated.name, f"{DEFAULT_PROFILE.name}-calibrated-1920x1080")

    def test_shortcut_update_falls_back_when_empty(self) -> None:
        profile = update_workspace_profile_shortcuts(
            DEFAULT_PROFILE,
            timeline_toggle_shortcut="",
            select_layer_above_shortcut="",
            select_layer_below_shortcut="",
            new_timeline_shortcut="",
            timeline_settings_shortcut="",
            previous_timeline_shortcut="",
            next_timeline_shortcut="",
            save_as_shortcut="",
        )

        self.assertEqual(profile.timeline_toggle_shortcut, DEFAULT_PROFILE.timeline_toggle_shortcut)
        self.assertEqual(profile.select_layer_above_shortcut, DEFAULT_PROFILE.select_layer_above_shortcut)
        self.assertEqual(profile.select_layer_below_shortcut, DEFAULT_PROFILE.select_layer_below_shortcut)
        self.assertEqual(profile.new_timeline_shortcut, DEFAULT_PROFILE.new_timeline_shortcut)
        self.assertEqual(profile.timeline_settings_shortcut, DEFAULT_PROFILE.timeline_settings_shortcut)
        self.assertEqual(profile.previous_timeline_shortcut, DEFAULT_PROFILE.previous_timeline_shortcut)
        self.assertEqual(profile.next_timeline_shortcut, DEFAULT_PROFILE.next_timeline_shortcut)
        self.assertEqual(profile.save_as_shortcut, DEFAULT_PROFILE.save_as_shortcut)

    def test_shortcut_display_uses_named_modifiers_and_uppercase_keys(self) -> None:
        self.assertEqual(shortcut_to_display_text("^%x"), "Ctrl+Alt+X")
        self.assertEqual(shortcut_to_display_text("^+q"), "Ctrl+Shift+Q")
        self.assertEqual(shortcut_to_display_text("%]"), "Alt+]")
        self.assertEqual(shortcut_to_display_text("%["), "Alt+[")

    def test_shortcut_update_accepts_display_text(self) -> None:
        profile = update_workspace_profile_shortcuts(
            DEFAULT_PROFILE,
            timeline_toggle_shortcut="Shift+T",
            select_layer_above_shortcut="Alt+]",
            select_layer_below_shortcut="Alt+[",
            new_timeline_shortcut="Ctrl+Alt+T",
            timeline_settings_shortcut="Ctrl+Shift+Q",
            previous_timeline_shortcut="Ctrl+Shift+A",
            next_timeline_shortcut="Ctrl+Shift+F",
            import_xdts_shortcut="Ctrl+Alt+X",
            import_image_shortcut="Ctrl+Alt+I",
            rasterize_shortcut="Ctrl+Alt+P",
            set_multiply_shortcut="Ctrl+Alt+L",
            toggle_folder_children_shortcut="Ctrl+Alt+F",
            save_as_shortcut="Ctrl+Shift+S",
        )

        self.assertEqual(profile.timeline_toggle_shortcut, "+t")
        self.assertEqual(profile.select_layer_above_shortcut, "%]")
        self.assertEqual(profile.select_layer_below_shortcut, "%[")
        self.assertEqual(profile.new_timeline_shortcut, "^%t")
        self.assertEqual(profile.timeline_settings_shortcut, "^+q")
        self.assertEqual(profile.import_xdts_shortcut, "^%x")
        self.assertEqual(profile.import_image_shortcut, "^%i")
        self.assertEqual(profile.save_as_shortcut, "^+s")
        self.assertEqual(shortcut_from_display_text("Ctrl+Shift+LEFT"), "^+left")

    def test_version_one_profile_migrates_old_default_shortcuts(self) -> None:
        profile = workspace_profile_from_json(
            {
                "schemaVersion": 1,
                "profile": {
                    "select_layer_above_shortcut": "+f",
                    "select_layer_below_shortcut": "+a",
                    "save_as_shortcut": "+%s",
                },
            }
        )

        self.assertEqual(PROFILE_SCHEMA_VERSION, 2)
        self.assertEqual(profile.select_layer_above_shortcut, "%]")
        self.assertEqual(profile.select_layer_below_shortcut, "%[")
        self.assertEqual(profile.save_as_shortcut, "^+s")

    def test_version_one_profile_preserves_custom_shortcuts(self) -> None:
        profile = workspace_profile_from_json(
            {
                "schemaVersion": 1,
                "profile": {
                    "select_layer_above_shortcut": "^up",
                    "select_layer_below_shortcut": "^down",
                    "save_as_shortcut": "^%s",
                },
            }
        )

        self.assertEqual(profile.select_layer_above_shortcut, "^up")
        self.assertEqual(profile.select_layer_below_shortcut, "^down")
        self.assertEqual(profile.save_as_shortcut, "^%s")

    def test_fast_speed_profile_shortens_waits_without_slowing_custom_values(self) -> None:
        fast = apply_workspace_profile_speed(DEFAULT_PROFILE, "fast")

        self.assertLess(fast.after_dialog_seconds, DEFAULT_PROFILE.after_dialog_seconds)
        self.assertLess(fast.after_xdts_import_seconds, DEFAULT_PROFILE.after_xdts_import_seconds)
        self.assertLess(fast.after_image_import_seconds, DEFAULT_PROFILE.after_image_import_seconds)
        self.assertLess(fast.after_batch_image_import_base_seconds, DEFAULT_PROFILE.after_batch_image_import_base_seconds)
        self.assertLess(fast.after_rasterize_seconds, DEFAULT_PROFILE.after_rasterize_seconds)
        self.assertLess(fast.after_save_as_seconds, DEFAULT_PROFILE.after_save_as_seconds)
        self.assertLess(fast.after_key_input_seconds, DEFAULT_PROFILE.after_key_input_seconds)
        self.assertLess(fast.after_text_paste_seconds, DEFAULT_PROFILE.after_text_paste_seconds)
        self.assertLess(fast.dialog_poll_interval_seconds, DEFAULT_PROFILE.dialog_poll_interval_seconds)
        turbo = apply_workspace_profile_speed(DEFAULT_PROFILE, "turbo")

        self.assertLess(turbo.after_dialog_seconds, fast.after_dialog_seconds)
        self.assertLess(turbo.after_xdts_import_seconds, fast.after_xdts_import_seconds)
        self.assertLess(turbo.after_image_import_seconds, fast.after_image_import_seconds)
        self.assertLess(turbo.after_batch_image_import_base_seconds, fast.after_batch_image_import_base_seconds)
        self.assertLess(turbo.after_rasterize_seconds, fast.after_rasterize_seconds)
        self.assertLess(turbo.after_save_as_seconds, fast.after_save_as_seconds)
        self.assertLess(turbo.after_key_input_seconds, fast.after_key_input_seconds)
        self.assertLess(turbo.after_text_paste_seconds, fast.after_text_paste_seconds)
        self.assertLess(turbo.dialog_poll_interval_seconds, fast.dialog_poll_interval_seconds)

        custom = replace(DEFAULT_PROFILE, after_dialog_seconds=0.01, after_rasterize_seconds=0.01, after_key_input_seconds=0.001)
        custom_fast = apply_workspace_profile_speed(custom, "turbo")

        self.assertEqual(custom_fast.after_dialog_seconds, 0.01)
        self.assertEqual(custom_fast.after_rasterize_seconds, 0.01)
        self.assertEqual(custom_fast.after_key_input_seconds, 0.001)
        self.assertIs(apply_workspace_profile_speed(DEFAULT_PROFILE, "standard"), DEFAULT_PROFILE)


if __name__ == "__main__":
    unittest.main()
