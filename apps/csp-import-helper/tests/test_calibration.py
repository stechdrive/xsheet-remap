from __future__ import annotations

import unittest

from csp_import_helper.calibration import _profile_from_ocr_lines
from csp_import_helper.profile import DEFAULT_PROFILE, Rect
from csp_import_helper.vision import OcrLine


class CalibrationTests(unittest.TestCase):
    def test_ocr_anchors_override_whole_window_scaling(self) -> None:
        csp_rect = Rect(100, 50, 3940, 2210)
        top_lines = [
            OcrLine("ファイル(F)", 122, 70, 182, 88),
            OcrLine("アニメーション(A)", 480, 70, 610, 88),
            OcrLine("レイヤ-(L)", 690, 70, 770, 88),
            OcrLine("レイヤー", 3500, 128, 3560, 148),
        ]
        right_lines = [
            OcrLine("レイヤー", 3420, 110, 3488, 128),
        ]
        timeline_lines = [
            OcrLine("タイムライン", 160, 1430, 250, 1450),
            OcrLine("タイムライン1", 178, 1490, 310, 1510),
        ]

        profile = _profile_from_ocr_lines(DEFAULT_PROFILE, csp_rect, top_lines, right_lines, timeline_lines)

        self.assertIsNotNone(profile)
        assert profile is not None
        self.assertEqual(profile.file_menu.x, 152)
        self.assertEqual(profile.animation_menu.x, 545)
        self.assertEqual(profile.layer_menu.x, 730)
        self.assertGreater(profile.layer_palette.left, 3350)
        self.assertLess(profile.layer_palette.left, 3420)
        self.assertGreater(profile.layer_palette.right, csp_rect.right - 40)
        self.assertGreater(profile.row_click_x, profile.layer_palette.left)
        self.assertEqual(profile.timeline_palette.left, csp_rect.left)
        self.assertGreater(profile.timeline_palette.top, 1400)
        self.assertLess(profile.timeline_palette.top, 1430)
        self.assertLess(profile.timeline_palette.right, profile.layer_palette.left)
        self.assertGreater(profile.timeline_palette.bottom, csp_rect.bottom - 40)
        self.assertEqual(profile.reference_window_rect, csp_rect)

    def test_timeline_dialog_labels_do_not_anchor_the_timeline_panel(self) -> None:
        csp_rect = Rect(0, 0, 1920, 1080)
        top_lines = [
            OcrLine("ファイル(F)", 12, 20, 72, 38),
            OcrLine("アニメーション(A)", 210, 20, 330, 38),
            OcrLine("レイヤー(L)", 360, 20, 440, 38),
        ]
        right_lines = [
            OcrLine("レイヤー", 1500, 88, 1548, 106),
        ]
        timeline_lines = [
            OcrLine("タイムライン名(N):", 1130, 820, 1260, 842),
            OcrLine("設定変更", 1280, 900, 1350, 922),
        ]

        profile = _profile_from_ocr_lines(DEFAULT_PROFILE, csp_rect, top_lines, right_lines, timeline_lines)

        self.assertIsNotNone(profile)
        assert profile is not None
        self.assertEqual(profile.timeline_palette, DEFAULT_PROFILE.timeline_palette)

    def test_ocr_profile_requires_top_menu_and_layer_palette_anchors(self) -> None:
        csp_rect = Rect(0, 0, 1920, 1080)

        self.assertIsNone(
            _profile_from_ocr_lines(
                DEFAULT_PROFILE,
                csp_rect,
                [OcrLine("ファイル(F)", 12, 20, 72, 38)],
                [OcrLine("レイヤー", 1500, 88, 1548, 106)],
                [OcrLine("タイムライン", 80, 674, 125, 686)],
            )
        )
        self.assertIsNone(
            _profile_from_ocr_lines(
                DEFAULT_PROFILE,
                csp_rect,
                [
                    OcrLine("ファイル(F)", 12, 20, 72, 38),
                    OcrLine("アニメーション(A)", 210, 20, 330, 38),
                    OcrLine("レイヤー(L)", 360, 20, 440, 38),
                ],
                [],
                [OcrLine("タイムライン", 80, 674, 125, 686)],
            )
        )


if __name__ == "__main__":
    unittest.main()
