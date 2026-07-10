from __future__ import annotations

import argparse
import os
from pathlib import Path
import time
from typing import Any

from PIL import ImageStat

from .automation import AutomationError, probe_csp_window
from .profile import Rect, WorkspaceProfile, load_workspace_profile, scale_profile_to_window


def reset_test_clip(
    clip_path: Path,
    *,
    discard_open_document: bool,
    profile: WorkspaceProfile | None = None,
) -> None:
    profile = profile or load_workspace_profile()
    if not clip_path.exists():
        raise AutomationError(f"test CLIP was not found: {clip_path}")
    if clip_path.suffix.lower() != ".clip":
        raise AutomationError(f"test clip path must point to a .clip file: {clip_path}")

    if discard_open_document:
        _close_active_csp_document_without_saving(profile)

    os.startfile(str(clip_path))  # type: ignore[attr-defined]
    _wait_for_csp_window(profile)


def close_active_csp_document_without_saving(profile: WorkspaceProfile | None = None) -> None:
    profile = profile or load_workspace_profile()
    _close_active_csp_document_without_saving(profile)


def _close_active_csp_document_without_saving(profile: WorkspaceProfile) -> None:
    try:
        from pywinauto import Desktop
        from pywinauto.keyboard import send_keys
    except ImportError as exc:
        raise AutomationError("pywinauto is required to reset the CSP test clip") from exc

    window = Desktop(backend="uia").window(title_re=profile.csp_title_regex)
    if not window.exists(timeout=2):
        return

    process_id = window.process_id()
    _dismiss_blocking_csp_dialogs(process_id)
    window.set_focus()
    time.sleep(0.3)
    send_keys("^w")
    time.sleep(0.8)
    _dismiss_save_prompt(process_id)


def _dismiss_save_prompt(process_id: int) -> None:
    dialog = _find_save_prompt(process_id)
    if dialog is None:
        return

    for backend in ("uia", "win32"):
        try:
            candidate = dialog.child_window(title_re=".*(保存しない|Don't Save|No).*", control_type="Button")
            if candidate.exists(timeout=0.2):
                candidate.click_input()
                time.sleep(0.5)
                return
        except Exception:
            pass
        try:
            candidate = dialog.child_window(title_re=".*(保存しない|Don't Save|No).*", class_name="Button")
            if candidate.exists(timeout=0.2):
                candidate.click_input()
                time.sleep(0.5)
                return
        except Exception:
            pass

    text = _dialog_text(dialog)
    if _click_csp_custom_dont_save(dialog):
        time.sleep(0.8)
        return

    raise AutomationError(
        "CSP save confirmation appeared, but the 'do not save' button could not be found. "
        f"Dialog text: {text}"
    )


def _dismiss_blocking_csp_dialogs(process_id: int) -> None:
    try:
        from pywinauto.keyboard import send_keys
    except ImportError as exc:
        raise AutomationError("pywinauto is required to reset the CSP test clip") from exc

    for _ in range(3):
        dialog = _find_blocking_csp_dialog(process_id)
        if dialog is None:
            return
        try:
            dialog.set_focus()
            time.sleep(0.1)
            send_keys("{ESC}")
            time.sleep(0.4)
        except Exception:
            return


def _find_blocking_csp_dialog(process_id: int) -> Any | None:
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        raise AutomationError("pywinauto is required to reset the CSP test clip") from exc

    for backend in ("uia", "win32"):
        try:
            windows = Desktop(backend=backend).windows()
        except Exception:
            continue
        for window in windows:
            try:
                if int(window.process_id()) != process_id:
                    continue
                if not window.is_visible():
                    continue
                if _looks_like_csp_custom_modal(window):
                    return window
            except Exception:
                continue
    return None


def _looks_like_csp_custom_modal(window: Any) -> bool:
    try:
        title = window.window_text().strip()
        class_name = str(window.class_name())
        rect = window.rectangle()
    except Exception:
        return False
    if not title:
        return False
    if not class_name.startswith("742DEA58-ED6B-4402-BC11-20DFC6D08040-"):
        return False
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    return 200 <= width <= 900 and 80 <= height <= 600


def _click_csp_custom_dont_save(dialog: Any) -> bool:
    try:
        from pywinauto.mouse import click

        rect = dialog.rectangle()
    except Exception:
        return False

    width = rect.right - rect.left
    height = rect.bottom - rect.top
    if width < 240 or height < 80:
        return False
    x = int(rect.left + width * 0.53)
    y = int(rect.top + height * 0.79)
    click(coords=(x, y))
    return True


def _find_save_prompt(process_id: int) -> Any | None:
    try:
        from pywinauto import Desktop
    except ImportError as exc:
        raise AutomationError("pywinauto is required to reset the CSP test clip") from exc

    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        for backend in ("uia", "win32"):
            try:
                windows = Desktop(backend=backend).windows()
            except Exception:
                continue
            for window in windows:
                try:
                    if int(window.process_id()) != process_id:
                        continue
                    if not window.is_visible():
                        continue
                    class_name = str(window.class_name())
                    title = window.window_text()
                except Exception:
                    continue
                if (class_name == "#32770" and _looks_like_save_prompt(window, title)) or (
                    _looks_like_csp_custom_save_prompt(window, title)
                ):
                    return window
        time.sleep(0.1)
    return None


def _looks_like_save_prompt(window: Any, title: str) -> bool:
    text = f"{title}\n{_dialog_text(window)}"
    lowered = text.lower()
    return "保存" in text or "save" in lowered


def _looks_like_csp_custom_save_prompt(window: Any, title: str) -> bool:
    try:
        rect = window.rectangle()
        class_name = str(window.class_name())
    except Exception:
        return False
    width = rect.right - rect.left
    height = rect.bottom - rect.top
    return (
        title == "CLIP STUDIO PAINT EX"
        and "742DEA58" in class_name
        and 240 <= width <= 700
        and 80 <= height <= 260
    )


def _dialog_text(window: Any) -> str:
    parts: list[str] = []
    try:
        descendants = window.descendants()
    except Exception:
        descendants = []
    for item in descendants:
        try:
            text = item.window_text().strip()
        except Exception:
            continue
        if text:
            parts.append(text)
    try:
        title = window.window_text().strip()
    except Exception:
        title = ""
    if title:
        parts.insert(0, title)
    return " | ".join(dict.fromkeys(parts))


def _wait_for_csp_window(profile: WorkspaceProfile) -> None:
    deadline = time.monotonic() + 20.0
    while time.monotonic() < deadline:
        probe = probe_csp_window(profile)
        if probe.found and probe.rect is not None:
            current_profile = scale_profile_to_window(profile, Rect(*probe.rect))
            if _csp_document_looks_open(current_profile):
                return
        time.sleep(0.25)
    raise AutomationError(
        "The CSP window was found, but the test CLIP did not become visible in the layer palette."
    )


def _csp_document_looks_open(profile: WorkspaceProfile) -> bool:
    try:
        from PIL import ImageGrab
    except ImportError as exc:
        raise AutomationError("Pillow is required to verify the CSP test clip state") from exc

    rect = profile.layer_palette
    image = ImageGrab.grab(bbox=(rect.left, rect.top, rect.right, rect.bottom)).convert("L")
    stats = ImageStat.Stat(image)
    histogram = image.histogram()
    total = sum(histogram) or 1
    bright_ratio = sum(histogram[100:]) / total
    return stats.stddev[0] >= 12.0 and bright_ratio >= 0.03


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Reset the CSP test CLIP for live helper tests")
    parser.add_argument("--clip", help="Path to the .clip file used as live test fixture")
    parser.add_argument(
        "--close-open-document",
        action="store_true",
        help="Close the active CSP document without saving and do not open a new CLIP",
    )
    parser.add_argument(
        "--discard-open-document",
        action="store_true",
        help="Close the active CSP document without saving before opening the test CLIP",
    )
    parser.add_argument("--quiet", action="store_true", help="Do not print status messages")
    args = parser.parse_args(argv)

    try:
        if args.close_open_document:
            close_active_csp_document_without_saving()
        else:
            if not args.clip:
                parser.error("--clip is required unless --close-open-document is used")
            reset_test_clip(Path(args.clip), discard_open_document=args.discard_open_document)
    except AutomationError as exc:
        print(f"error: {exc}")
        return 1
    if not args.quiet:
        if args.close_open_document:
            print("closed active CSP document without saving")
        else:
            print(f"opened test CLIP: {args.clip}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
