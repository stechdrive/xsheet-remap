from __future__ import annotations

from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from csp_import_helper.automation import WindowProbe
from csp_import_helper.profile import DEFAULT_PROFILE, Rect
from csp_import_helper.test_clip import _wait_for_csp_window, reset_test_clip


class TestClipTests(unittest.TestCase):
    def test_reset_uses_saved_workspace_profile_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            clip_path = Path(tmp) / "fixture.clip"
            clip_path.touch()

            with (
                patch("csp_import_helper.test_clip.load_workspace_profile", return_value=DEFAULT_PROFILE) as load_profile,
                patch("csp_import_helper.test_clip.os.startfile", create=True) as startfile,
                patch("csp_import_helper.test_clip._wait_for_csp_window") as wait_for_window,
            ):
                reset_test_clip(clip_path, discard_open_document=False)

        load_profile.assert_called_once_with()
        startfile.assert_called_once_with(str(clip_path))
        wait_for_window.assert_called_once_with(DEFAULT_PROFILE)

    def test_open_document_check_scales_profile_to_current_window(self) -> None:
        current_rect = Rect(-8, -8, 1928, 1040)
        scaled_profile = DEFAULT_PROFILE
        probe = WindowProbe(True, "CLIP STUDIO PAINT", 1, 2, (-8, -8, 1928, 1040), {})

        with (
            patch("csp_import_helper.test_clip.probe_csp_window", return_value=probe),
            patch("csp_import_helper.test_clip.scale_profile_to_window", return_value=scaled_profile) as scale_profile,
            patch("csp_import_helper.test_clip._csp_document_looks_open", return_value=True) as looks_open,
        ):
            _wait_for_csp_window(DEFAULT_PROFILE)

        scale_profile.assert_called_once_with(DEFAULT_PROFILE, current_rect)
        looks_open.assert_called_once_with(scaled_profile)


if __name__ == "__main__":
    unittest.main()
