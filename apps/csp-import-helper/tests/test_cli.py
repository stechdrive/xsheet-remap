from __future__ import annotations

import unittest
from unittest.mock import patch

from csp_import_helper import __version__
from csp_import_helper import cli
from csp_import_helper.profile import SPEED_MODE_STANDARD, SPEED_MODE_TURBO


class CliTests(unittest.TestCase):
    def test_positional_manifest_launches_gui(self) -> None:
        with patch.object(cli, "launch_gui", return_value=0) as launch_gui:
            self.assertEqual(cli.main(["C:\\cut\\csp-import.xci"]), 0)
            launch_gui.assert_called_once_with(
                "C:\\cut\\csp-import.xci",
                initial_clip=None,
                initial_speed_mode=SPEED_MODE_STANDARD,
                auto_start=False,
            )

    def test_no_args_launches_gui_picker(self) -> None:
        with patch.object(cli, "launch_gui", return_value=0) as launch_gui:
            self.assertEqual(cli.main([]), 0)
            launch_gui.assert_called_once_with(
                None,
                initial_clip=None,
                initial_speed_mode=SPEED_MODE_STANDARD,
                auto_start=False,
            )

    def test_positional_clip_launches_gui_with_clip_input(self) -> None:
        with patch.object(cli, "launch_gui", return_value=0) as launch_gui:
            self.assertEqual(cli.main(["C:\\cut\\work.clip"]), 0)
            launch_gui.assert_called_once_with(
                None,
                initial_clip="C:\\cut\\work.clip",
                initial_speed_mode=SPEED_MODE_STANDARD,
                auto_start=False,
            )

    def test_gui_flag_passes_manifest_and_clip_inputs_to_gui(self) -> None:
        with patch.object(cli, "launch_gui", return_value=0) as launch_gui:
            self.assertEqual(
                cli.main(["--gui", "--manifest", "C:\\cut\\csp-import.xci", "--clip", "C:\\cut\\work.clip"]),
                0,
            )
            launch_gui.assert_called_once_with(
                "C:\\cut\\csp-import.xci",
                initial_clip="C:\\cut\\work.clip",
                initial_speed_mode=SPEED_MODE_STANDARD,
                auto_start=False,
            )

    def test_gui_auto_start_passes_speed_to_gui(self) -> None:
        with patch.object(cli, "launch_gui", return_value=0) as launch_gui:
            self.assertEqual(
                cli.main([
                    "--gui",
                    "--gui-auto-start",
                    "--speed",
                    "turbo",
                    "--manifest",
                    "C:\\cut\\csp-import.xci",
                    "--clip",
                    "C:\\cut\\work.clip",
                ]),
                0,
            )
            launch_gui.assert_called_once_with(
                "C:\\cut\\csp-import.xci",
                initial_clip="C:\\cut\\work.clip",
                initial_speed_mode=SPEED_MODE_TURBO,
                auto_start=True,
            )

    def test_version_flag_prints_helper_version(self) -> None:
        with patch("builtins.print") as print_mock:
            self.assertEqual(cli.main(["--version"]), 0)

        print_mock.assert_called_once_with(f"xsheet-csp-import-helper {__version__}")


if __name__ == "__main__":
    unittest.main()
