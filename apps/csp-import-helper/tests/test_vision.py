from __future__ import annotations

import unittest

from csp_import_helper.vision import (
    OcrLine,
    csp_layer_row_key,
    find_csp_layer_row_lines,
    find_import_stack_anchor,
    find_import_stack_marker,
    normalize_csp_name_text,
    normalize_ocr_text,
    _paddle_result_to_lines,
)


class VisionTests(unittest.TestCase):
    def test_normalizes_ocr_spacing_and_symbols(self) -> None:
        self.assertEqual(normalize_ocr_text("= XS H E ET IM PO RT E N D ="), "XSHEETIMPORTEND")

    def test_normalizes_csp_names_preserving_japanese(self) -> None:
        self.assertEqual(normalize_csp_name_text("BOOK2 組線 : 0"), "BOOK2組線0")

    def test_finds_import_stack_marker_from_split_ocr_line(self) -> None:
        marker = find_import_stack_marker(
            [
                OcrLine("M E MO 1 : 0", 0, 0, 100, 10),
                OcrLine("= XS H E ET IM PO RT E N D =", 0, 20, 100, 30),
            ],
            "===== XSHEET IMPORT START =====",
            "===== XSHEET IMPORT END =====",
        )

        self.assertIsNotNone(marker)
        self.assertEqual(marker.kind, "end")
        self.assertEqual(marker.line.center_y, 25)

    def test_ignores_short_ambiguous_marker_fragments(self) -> None:
        marker = find_import_stack_marker(
            [OcrLine("= XS H E", 0, 20, 100, 30)],
            "===== XSHEET IMPORT START =====",
            "===== XSHEET IMPORT END =====",
        )

        self.assertIsNone(marker)

    def test_anchor_detection_accepts_selected_row_xsheet_fragment(self) -> None:
        marker = find_import_stack_anchor(
            [OcrLine("= XS H E", 0, 20, 100, 30)],
            "===== XSHEET IMPORT START =====",
            "===== XSHEET IMPORT END =====",
        )

        self.assertIsNotNone(marker)
        self.assertEqual(marker.kind, "fragment")

    def test_finds_csp_layer_rows_by_name_ignoring_timeline_count(self) -> None:
        lines = [
            OcrLine("===== XSHEET IMPORT END ===== : 0", 0, 0, 100, 10),
            OcrLine("A : 0", 0, 20, 20, 30),
            OcrLine("BG : 0", 0, 40, 30, 50),
        ]

        self.assertEqual(csp_layer_row_key("A : 0"), "A")
        self.assertEqual(csp_layer_row_key("BOOK2 組線 : 0"), "BOOK2組線")
        self.assertEqual([line.text for line in find_csp_layer_row_lines(lines, "BG")], ["BG : 0"])

    def test_finds_csp_layer_rows_by_japanese_name(self) -> None:
        lines = [
            OcrLine("BOOK2組線 : 0", 0, 0, 100, 10),
            OcrLine("BOOK4 : 0", 0, 20, 100, 30),
        ]

        self.assertEqual([line.text for line in find_csp_layer_row_lines(lines, "BOOK2組線")], ["BOOK2組線 : 0"])

    def test_converts_paddleocr_result_to_lines(self) -> None:
        lines = _paddle_result_to_lines(
            [
                {
                    "rec_texts": ["ファイル(F)", "A : 0"],
                    "rec_scores": [0.99, 0.95],
                    "rec_boxes": [[40, 20, 160, 60], [80, 100, 180, 140]],
                }
            ],
            offset_x=10,
            offset_y=20,
            scale=2.0,
        )

        self.assertEqual([line.text for line in lines], ["ファイル(F)", "A : 0"])
        self.assertEqual(lines[0], OcrLine("ファイル(F)", 30, 30, 90, 50))
        self.assertEqual(lines[1], OcrLine("A : 0", 50, 70, 100, 90))


if __name__ == "__main__":
    unittest.main()
