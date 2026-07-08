from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from csp_import_helper.manifest import ManifestError, build_import_plan, load_manifest, validate_manifest_files


FIXTURE_MANIFEST = (
    Path(__file__).parent
    / "fixtures"
    / "csp-import-v2-shared-cuts"
    / "xsheet-csp-import"
    / "csp-import.xci"
)


class ManifestTests(unittest.TestCase):
    def test_loads_v2_shared_cut_fixture_and_builds_union_import_plan(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)

        self.assertEqual(validate_manifest_files(manifest), [])
        self.assertEqual(manifest.schema_version, 2)
        self.assertEqual(manifest.asset_root.name, "csp-import-v2-shared-cuts")
        self.assertIsNotNone(manifest.setup)
        self.assertEqual(manifest.stack_reference_xdts_path.name, "_setup.xdts")
        self.assertEqual([cut.cut_number for cut in manifest.cuts], ["C101A", "C101B", "C101C"])
        self.assertEqual([cut.timeline_name for cut in manifest.cuts], ["101A", "101B", "101C"])
        self.assertEqual([cut.duration_frames for cut in manifest.cuts], [24, 36, 48])

        plan = build_import_plan(manifest)
        self.assertEqual(
            [item["trackId"] for item in plan],
            [
                "slot_A",
                "slot_A",
                "slot_B",
                "slot_B",
                "slot_C",
                "slot_D",
                "slot_E",
                "slot_enshutsu_A",
                "slot_enshutsu_E",
                "slot_enshutsu_D",
                "slot_sakkan_A",
                "slot_sakkan_C",
                "slot_sakkan_B",
            ],
        )
        self.assertEqual(
            [item["cspCellName"] for item in plan],
            [
                "A_01",
                "A_02",
                "B_01",
                "B_02",
                "C_01",
                "D_01",
                "E_01",
                "A_03_e",
                "E_02_e",
                "D_02_e",
                "A_04_s",
                "C_02_s",
                "B_03_s",
            ],
        )
        self.assertTrue(str(plan[0]["assetPath"]).endswith("materials\\A_01.png") or str(plan[0]["assetPath"]).endswith("materials/A_01.png"))

    def test_sorts_cuts_by_xdts_file_natural_order(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (root / "A_01.png").write_bytes(b"a")
            for name in ("C10.xdts", "C2.xdts"):
                (package / name).write_text("xdts", encoding="utf-8")
            manifest_path = package / "csp-import.xci"
            manifest_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 2,
                        "assetRoot": "..",
                        "cuts": [
                            _cut("cut_10", "C10", "C10.xdts"),
                            _cut("cut_2", "C2", "C2.xdts"),
                        ],
                    }
                ),
                encoding="utf-8",
            )

            manifest = load_manifest(manifest_path)

            self.assertEqual([cut.cut_number for cut in manifest.cuts], ["C2", "C10"])

    def test_reports_missing_files_before_automation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (package / "C001.xdts").write_text("xdts", encoding="utf-8")
            manifest_path = package / "csp-import.xci"
            manifest_path.write_text(
                json.dumps({"schemaVersion": 2, "assetRoot": "..", "cuts": [_cut("cut_1", "C001", "C001.xdts")]}),
                encoding="utf-8",
            )

            manifest = load_manifest(manifest_path)

            self.assertEqual(len(validate_manifest_files(manifest)), 1)

    def test_reports_asset_file_stems_that_do_not_match_csp_cell_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (package / "C001.xdts").write_text("xdts", encoding="utf-8")
            (root / "rough.png").write_bytes(b"a")
            cut = _cut("cut_1", "C001", "C001.xdts")
            cut["tracks"][0]["cels"][0]["assetPath"] = "rough.png"
            manifest_path = package / "csp-import.xci"
            manifest_path.write_text(
                json.dumps({"schemaVersion": 2, "assetRoot": "..", "cuts": [cut]}),
                encoding="utf-8",
            )

            manifest = load_manifest(manifest_path)
            errors = validate_manifest_files(manifest)

            self.assertEqual(len(errors), 1)
            self.assertIn("manifest asset file stem must match cspCellName", errors[0])

    def test_loads_japanese_manifest_paths_and_names(self) -> None:
        with tempfile.TemporaryDirectory(prefix="日本語 パス ") as tmp:
            root = Path(tmp)
            package = root / "自動登録 パッケージ"
            assets = root / "素材 画像"
            package.mkdir()
            assets.mkdir()
            (package / "兼用カット 001.xdts").write_text("xdts", encoding="utf-8")
            (assets / "あ_01.png").write_bytes(b"a")
            cut = _cut("cut_日本語", "C日本語001", "兼用カット 001.xdts")
            cut["displayName"] = "日本語カット"
            cut["timelineName"] = "日本語001"
            cut["tracks"][0]["xdtsTrackName"] = "あ"
            cut["tracks"][0]["targetFolderPath"] = ["あ"]
            cut["tracks"][0]["cels"][0]["cspCellName"] = "あ_01"
            cut["tracks"][0]["cels"][0]["assetPath"] = "あ_01.png"
            manifest_path = package / "csp-import.xci"
            manifest_path.write_text(
                json.dumps({"schemaVersion": 2, "assetRoot": "../素材 画像", "cuts": [cut]}, ensure_ascii=False),
                encoding="utf-8",
            )

            manifest = load_manifest(manifest_path)

            self.assertEqual(validate_manifest_files(manifest), [])
            self.assertEqual(manifest.primary_cut.timeline_name, "日本語001")
            self.assertEqual(manifest.importable_tracks[0].xdts_track_name, "あ")
            self.assertEqual(manifest.importable_tracks[0].cels[0].asset_path.name, "あ_01.png")

    def test_rejects_schema_v1_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest_path = Path(tmp) / "csp-import.xci"
            manifest_path.write_text(json.dumps({"schemaVersion": 1}), encoding="utf-8")

            with self.assertRaisesRegex(ManifestError, "unsupported schemaVersion"):
                load_manifest(manifest_path)


def _cut(cut_id: str, cut_number: str, xdts: str) -> dict[str, object]:
    return {
        "cutId": cut_id,
        "cutNumber": cut_number,
        "displayName": cut_number,
        "timelineName": cut_number,
        "durationFrames": 24,
        "fps": 24,
        "files": {"xdts": xdts, "operationLog": f"{cut_number}-csp-import-log.json"},
        "importStack": {
            "enabled": True,
            "startSeparator": "===== XSHEET IMPORT START =====",
            "endSeparator": "===== XSHEET IMPORT END =====",
        },
        "tracks": [
            {
                "trackId": "slot_A",
                "kind": "cell",
                "xdtsTrackName": "A",
                "stackOrder": 10,
                "cels": [{"cspCellName": "A_01", "assetPath": "A_01.png"}],
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
