from __future__ import annotations

import argparse
import json
import sys
import threading

from . import __version__
from .automation import AutomationError, AutomationPaused, CspImportAutomation, default_output_clip_path, probe_csp_window
from .emergency_stop import EmergencyHotkeys
from .web_gui import launch_gui
from .logging import OperationLog
from .manifest import ManifestError, build_import_plan, load_manifest, validate_manifest_files
from .profile import SPEED_MODES, apply_workspace_profile_speed, load_workspace_profile


def main(argv: list[str] | None = None) -> int:
    raw_argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="CSP import helper")
    parser.add_argument("manifest_path", nargs="?", help="Path to csp-import.xci. Used as GUI input when no CLI flags are passed.")
    parser.add_argument("--manifest", dest="manifest_option", help="Path to csp-import.xci")
    parser.add_argument("--gui", action="store_true", help="Launch the GUI confirmation window")
    parser.add_argument("--gui-auto-start", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--run", action="store_true", help="Actually operate CLIP STUDIO PAINT")
    parser.add_argument("--probe-window", action="store_true", help="Probe the current CSP window and exit")
    parser.add_argument("--profile", help="Path to a CSP helper workspace profile JSON")
    parser.add_argument("--version", action="store_true", help="Print the helper version and exit")
    parser.add_argument(
        "--calibrate-profile",
        action="store_true",
        help="Create/update a CSP helper workspace profile from the current CSP window",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    parser.add_argument("--limit", type=int, default=None, help="Limit number of cel imports during --run")
    parser.add_argument("--clip", help="Optional .clip file to open in CSP before running")
    parser.add_argument("--save-output", action="store_true", help="Save a finished .clip to the manifest asset root after import")
    parser.add_argument("--save-as", help="Full output .clip file path for CSP Save As after import")
    parser.add_argument("--close-after-save", action="store_true", help="Close the active CSP document after Save As")
    parser.add_argument("--stop-file", help="Pause safely when this file exists during --run")
    parser.add_argument("--speed", choices=SPEED_MODES, default=None, help="Automation speed preset")
    parser.add_argument("--no-emergency-hotkey", action="store_true", help="Disable Ctrl+Alt+F12 / Ctrl+Alt+Pause emergency stop hotkeys during --run")
    parser.add_argument("--no-pause-on-unhandled-dialog", action="store_true", help="Do not pause when an unknown CSP modal dialog appears")
    parser.add_argument(
        "--timeline-disabled-confirmed",
        action="store_true",
        help="Deprecated no-op. The helper disables the CSP timeline after XDTS import.",
    )
    args = parser.parse_args(raw_argv)

    manifest_path = args.manifest_option or args.manifest_path
    cli_requested = (
        args.manifest_option is not None
        or args.run
        or args.probe_window
        or args.profile is not None
        or args.calibrate_profile
        or args.version
        or args.json
        or args.limit is not None
        or args.clip is not None
        or args.save_output
        or args.save_as is not None
        or args.close_after_save
        or args.stop_file is not None
        or args.speed is not None
        or args.no_emergency_hotkey
        or args.no_pause_on_unhandled_dialog
        or args.timeline_disabled_confirmed
    )
    if args.gui or args.gui_auto_start or not cli_requested:
        initial_manifest = manifest_path
        initial_clip = args.clip
        if manifest_path and manifest_path.lower().endswith(".clip"):
            initial_manifest = None
            initial_clip = manifest_path
        if args.profile:
            return launch_gui(initial_manifest, args.profile, initial_clip, initial_speed_mode=args.speed, auto_start=args.gui_auto_start)
        return launch_gui(initial_manifest, initial_clip=initial_clip, initial_speed_mode=args.speed, auto_start=args.gui_auto_start)
    if args.version:
        _print(args.json, {"ok": True, "version": __version__})
        return 0
    if not manifest_path and not args.calibrate_profile and not args.probe_window:
        parser.error("--manifest is required in CLI mode")

    log: OperationLog | None = None
    try:
        profile = load_workspace_profile(args.profile)
        if args.calibrate_profile:
            from .calibration import calibrate_profile_from_csp_window

            result = calibrate_profile_from_csp_window(profile, save_path=args.profile)
            _print(
                args.json,
                {
                    "ok": True,
                    "profilePath": str(result.profile_path),
                    "helperVersion": __version__,
                    "cspTitle": result.csp_title,
                    "cspRect": result.csp_rect.__dict__,
                    "usedOcrAnchors": result.used_ocr_anchors,
                    "topMenuOcrLineCount": result.top_menu_ocr_line_count,
                    "rightPanelOcrLineCount": result.right_panel_ocr_line_count,
                    "timelinePanelOcrLineCount": result.timeline_panel_ocr_line_count,
                    "layerPaletteOcrLineCount": result.layer_palette_ocr_line_count,
                    "importStackMarker": result.import_stack_marker,
                    "warning": result.warning,
                },
            )
            return 0

        if args.probe_window:
            probe = probe_csp_window(profile)
            _print(
                args.json,
                {
                    "ok": probe.found,
                    "helperVersion": __version__,
                    "probe": probe.__dict__,
                },
            )
            return 0 if probe.found else 2

        if not manifest_path:
            parser.error("--manifest is required in CLI mode")
        speed_mode = args.speed or profile.automation_speed_mode
        profile = apply_workspace_profile_speed(profile, speed_mode)
        manifest = load_manifest(manifest_path)
        file_errors = validate_manifest_files(manifest)
        if file_errors:
            raise ManifestError("; ".join(file_errors))

        plan = build_import_plan(manifest)
        log = OperationLog(manifest_path=str(manifest.path), dry_run=not args.run)
        log.add(
            "plan.loaded",
            cutCount=len(manifest.cuts),
            assetRoot=str(manifest.assets_root),
            importCount=len(plan),
        )

        if not args.run:
            _print(
                args.json,
                {
                    "ok": True,
                    "dryRun": True,
                    "helperVersion": __version__,
                    "cuts": [
                        {
                            "cutId": cut.cut_id,
                            "cutNumber": cut.cut_number,
                            "timelineName": cut.timeline_name,
                            "durationFrames": cut.duration_frames,
                            "xdts": str(cut.xdts_path),
                        }
                        for cut in manifest.cuts
                    ],
                    "operationLog": str(manifest.operation_log_path),
                    "setupXdts": str(manifest.setup.xdts_path) if manifest.setup else None,
                    "importCount": len(plan),
                    "requiresTimelineEnabledForXdts": True,
                    "timelineDisabledBeforeAssetImport": len(plan) > 0,
                    "plan": plan,
                },
            )
            log.write(manifest.operation_log_path)
            return 0

        cancel_event = threading.Event()
        automation = CspImportAutomation(
            profile,
            cancel_event=cancel_event,
            stop_file=args.stop_file,
            pause_on_unhandled_dialog=not args.no_pause_on_unhandled_dialog,
            speed_mode=speed_mode,
        )
        save_as_path = args.save_as
        if save_as_path is None and args.save_output:
            save_as_path = str(default_output_clip_path(manifest))
        if args.no_emergency_hotkey:
            automation.run(
                manifest,
                log,
                import_limit=args.limit,
                clip_path=args.clip,
                save_as_path=save_as_path,
                close_after_save=args.close_after_save,
            )
        else:
            with EmergencyHotkeys(cancel_event) as hotkeys:
                log.add("automation.emergency_hotkeys", labels=hotkeys.registered_labels)
                automation.run(
                    manifest,
                    log,
                    import_limit=args.limit,
                    clip_path=args.clip,
                    save_as_path=save_as_path,
                    close_after_save=args.close_after_save,
                )
        log.write(manifest.operation_log_path)
        _print(
            args.json,
            {
                "ok": True,
                "dryRun": False,
                "helperVersion": __version__,
                "operationLog": str(manifest.operation_log_path),
            },
        )
        return 0
    except AutomationPaused as exc:
        if log is not None:
            log.error(str(exc))
            try:
                log.write(manifest.operation_log_path)
            except Exception:
                pass
        _print(args.json, {"ok": False, "paused": True, "error": str(exc), "operationLog": str(manifest.operation_log_path) if log is not None else None})
        return 3
    except (ManifestError, AutomationError, ValueError) as exc:
        if log is not None:
            log.error(str(exc))
            try:
                log.write(manifest.operation_log_path)
            except Exception:
                pass
        _print(args.json, {"ok": False, "error": str(exc)})
        return 1


def _print(as_json: bool, payload: dict[str, object]) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=True, indent=2))
        return
    if payload.get("ok"):
        if payload.get("version"):
            print(f"xsheet-csp-import-helper {payload['version']}")
            return
        if payload.get("dryRun"):
            print("dry-run import plan")
            if payload.get("setupXdts"):
                print(f"setup: {payload['setupXdts']}")
            for cut in payload["cuts"]:  # type: ignore[index]
                print(f"timeline: {cut['timelineName']} ({cut['cutNumber']}) / {cut['durationFrames']}f / {cut['xdts']}")
            print(f"imports: {payload['importCount']}")
            for item in payload["plan"]:  # type: ignore[index]
                print(f"- {item['xdtsTrackName']} / {item['cspCellName']} <- {item['assetPath']}")
            return
        print(f"operation log: {payload.get('operationLog')}")
        return
    print(f"error: {payload.get('error')}", file=sys.stderr)
