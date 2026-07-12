from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
import time


REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER_SRC = REPO_ROOT / "apps" / "csp-import-helper" / "src"
if str(HELPER_SRC) not in sys.path:
    sys.path.insert(0, str(HELPER_SRC))

from csp_import_helper.automation import AutomationError, CspImportAutomation  # noqa: E402
from csp_import_helper.logging import OperationLog  # noqa: E402
from csp_import_helper.profile import apply_workspace_profile_speed, load_workspace_profile  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the active CSP document as PSD for development diagnostics.")
    parser.add_argument("--psd", required=True, help="Output PSD path")
    parser.add_argument("--profile", help="Optional CSP helper workspace profile JSON")
    parser.add_argument("--speed", choices=("standard", "fast", "turbo"), default="fast")
    parser.add_argument("--shortcut", required=True, help="Configured pywinauto shortcut for CSP PSD Save As")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    psd_path = Path(args.psd).expanduser().resolve()
    psd_path.parent.mkdir(parents=True, exist_ok=True)
    if psd_path.exists():
        psd_path.unlink()

    profile = apply_workspace_profile_speed(load_workspace_profile(args.profile), args.speed)
    automation = CspImportAutomation(profile, speed_mode=args.speed)
    log = OperationLog(manifest_path=str(psd_path), dry_run=False)

    try:
        automation._focus_csp(log)
        automation._send_shortcut(args.shortcut)
        time.sleep(profile.after_dialog_seconds)
        automation._submit_file_dialog_path(psd_path)
        dialogs_handled = _confirm_followup_dialogs(automation, psd_path)
        payload = {
            "ok": True,
            "psd": str(psd_path),
            "bytes": psd_path.stat().st_size,
            "dialogsHandled": dialogs_handled,
            "shortcut": args.shortcut,
        }
        _print(payload, args.json)
        return 0
    except Exception as exc:
        payload = {"ok": False, "error": str(exc), "psd": str(psd_path)}
        _print(payload, args.json)
        return 1


def _confirm_followup_dialogs(automation: CspImportAutomation, psd_path: Path) -> int:
    dialogs_handled = 0
    last_dialog_handle: int | None = None
    stable_size_count = 0
    last_size = -1
    deadline = time.monotonic() + 45.0
    while time.monotonic() < deadline:
        dialog = automation._find_csp_dialog()
        if dialog is not None:
            handle = _dialog_handle(dialog)
            if handle != last_dialog_handle:
                dialogs_handled += 1
                last_dialog_handle = handle
            try:
                automation._submit_dialog_with_enter(dialog)
            except Exception:
                try:
                    from pywinauto.keyboard import send_keys

                    dialog.set_focus()
                    send_keys("{ENTER}")
                except Exception:
                    pass
            stable_size_count = 0
            time.sleep(0.8)
            continue

        if psd_path.exists() and psd_path.stat().st_size > 0:
            size = psd_path.stat().st_size
            if size == last_size:
                stable_size_count += 1
            else:
                stable_size_count = 0
                last_size = size
            if stable_size_count >= 2:
                return dialogs_handled
        time.sleep(0.25)

    raise AutomationError(f"PSD export did not finish within 45 seconds: {psd_path}")


def _dialog_handle(dialog: object) -> int | None:
    try:
        return int(getattr(dialog, "handle"))
    except Exception:
        return None


def _print(payload: dict[str, object], as_json: bool) -> None:
    if as_json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    if payload.get("ok"):
        print(f"PSD exported: {payload.get('psd')} ({payload.get('bytes')} bytes)")
    else:
        print(f"PSD export failed: {payload.get('error')}", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main())
