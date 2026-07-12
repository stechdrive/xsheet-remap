from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from csp_import_helper.manifest import load_manifest
from csp_import_helper.progress_plan import build_import_execution_plan, build_track_import_batches


FIXTURE_MANIFEST = (
    Path(__file__).parent
    / "fixtures"
    / "csp-import-v3-cut-group"
    / "xsheet-csp-import"
    / "csp-import.xci"
)


class ProgressPlanTests(unittest.TestCase):
    def test_progress_plan_uses_shared_manifest_tracks_for_variable_step_count(self) -> None:
        manifest = load_manifest(FIXTURE_MANIFEST)

        plan = build_import_execution_plan(
            manifest,
            clip_path=Path("C:/work/test.clip"),
            save_as_path=Path("C:/out/result.clip"),
            close_after_save=True,
        )

        self.assertEqual(plan.progress_labels[0], "クリスタファイルを開く: test.clip")
        self.assertIn("セットアップXDTS読み込み: _setup.xdts", plan.progress_labels)
        self.assertEqual(
            [label for label in plan.progress_labels if label.startswith("素材登録:")],
            [
                "素材登録: LO/作画 / A (2件)",
                "素材登録: LO/作画 / B (2件)",
                "素材登録: LO/作画 / C (1件)",
                "素材登録: LO/作画 / D (1件)",
                "素材登録: LO/作画 / E (1件)",
                "素材登録: LO/演出 / A (1件)",
                "素材登録: LO/演出 / E (1件)",
                "素材登録: LO/演出 / D (1件)",
                "素材登録: LO/作監 / A (1件)",
                "素材登録: LO/作監 / C (1件)",
                "素材登録: LO/作監 / B (1件)",
            ],
        )
        self.assertEqual(len(plan.progress_labels), 29)
        self.assertEqual(plan.import_count, 13)

    def test_track_batch_labels_keep_same_xdts_name_separate_by_process_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            package = root / "xsheet-csp-import"
            package.mkdir()
            (root / "A_01.png").write_bytes(b"a")
            manifest_path = package / "csp-import.xci"
            (package / "C001.xdts").write_text("xdts", encoding="utf-8")
            manifest_path.write_text(
                json.dumps(
                    {
                        "schemaVersion": 4,
                        "assetRoot": "..",
                        "cuts": [
                            {
                                "cutId": "cut_1",
                                "order": 0,
                                "cutNumber": "C001",
                                "displayName": "C001",
                                "timelineName": "001",
                                "durationFrames": 24,
                                "fps": 24,
                                "files": {"xdts": "C001.xdts", "operationLog": "C001-log.json"},
                                "importStack": {
                                    "enabled": True,
                                    "startSeparator": "===== XSHEET IMPORT START =====",
                                    "endSeparator": "===== XSHEET IMPORT END =====",
                                },
                                "tracks": [
                                    _track("sakuga.A", "作画", ["LO", "作画"], 2),
                                    _track("enshutsu.A", "演出", ["LO", "演出"], 4),
                                ],
                            }
                        ],
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            manifest = load_manifest(manifest_path)
            labels = [batch.label for batch in build_track_import_batches(manifest)]

        self.assertEqual(labels, ["素材登録: LO/作画 / A (1件)", "素材登録: LO/演出 / A (1件)"])


def _track(track_id: str, stage_label: str, target_folder_path: list[str], stack_order: int) -> dict[str, object]:
    return {
        "trackId": track_id,
        "kind": "cell",
        "xdtsTrackName": "A",
        "stackOrder": stack_order,
        "stageLabel": stage_label,
        "targetFolderPath": target_folder_path,
        "cels": [{
            "cspCellName": "A_01",
            "firstFrame": 0,
            "material": {"assetId": "asset_A_01", "pathKind": "asset-root-relative", "path": "A_01.png"},
        }],
    }


if __name__ == "__main__":
    unittest.main()
