from __future__ import annotations

import argparse
import ctypes
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from pywinauto import Desktop, keyboard, mouse
from win32api import GetMonitorInfo, GetSystemMetrics, MonitorFromPoint
import win32gui

try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass

SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79
MONITOR_DEFAULTTONEAREST = 2


def main() -> int:
    parser = argparse.ArgumentParser(description="Safe mouse operations for xsheet-remap real DnD E2E.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    drag_parser = subparsers.add_parser("drag-screen", help="Drag between absolute screen coordinates.")
    drag_parser.add_argument("--from-x", type=int, required=True)
    drag_parser.add_argument("--from-y", type=int, required=True)
    drag_parser.add_argument("--to-x", type=int, required=True)
    drag_parser.add_argument("--to-y", type=int, required=True)
    drag_parser.add_argument("--app-pid", type=int)
    drag_parser.add_argument("--duration", type=float, default=0.8)

    down_parser = subparsers.add_parser("mouse-down-screen", help="Press the left mouse button at an absolute screen coordinate.")
    down_parser.add_argument("--x", type=int, required=True)
    down_parser.add_argument("--y", type=int, required=True)
    down_parser.add_argument("--app-pid", type=int)

    move_parser = subparsers.add_parser("mouse-move-screen", help="Move the mouse to an absolute screen coordinate.")
    move_parser.add_argument("--x", type=int, required=True)
    move_parser.add_argument("--y", type=int, required=True)
    move_parser.add_argument("--duration", type=float, default=0.2)

    up_parser = subparsers.add_parser("mouse-up-screen", help="Release the left mouse button at an absolute screen coordinate.")
    up_parser.add_argument("--x", type=int, required=True)
    up_parser.add_argument("--y", type=int, required=True)

    click_parser = subparsers.add_parser("click-screen", help="Click at an absolute screen coordinate.")
    click_parser.add_argument("--x", type=int, required=True)
    click_parser.add_argument("--y", type=int, required=True)
    click_parser.add_argument("--button", choices=["left", "right"], default="left")
    click_parser.add_argument("--app-pid", type=int)

    key_parser = subparsers.add_parser("key-press", help="Send keyboard input to the main app window.")
    key_parser.add_argument("--keys", required=True)
    key_parser.add_argument("--app-pid", type=int, required=True)

    explorer_parser = subparsers.add_parser("drag-explorer-item", help="Open Explorer, select a file/folder, and drag it to a screen coordinate.")
    explorer_parser.add_argument("--path", required=True)
    explorer_parser.add_argument("--allowed-root", required=True)
    explorer_parser.add_argument("--to-x", type=int, required=True)
    explorer_parser.add_argument("--to-y", type=int, required=True)
    explorer_parser.add_argument("--app-pid", type=int)
    explorer_parser.add_argument("--duration", type=float, default=1.0)
    explorer_parser.add_argument("--timeout", type=float, default=15.0)

    metrics_parser = subparsers.add_parser("window-client-metrics", help="Return the main app window client rectangle in physical screen coordinates.")
    metrics_parser.add_argument("--app-pid", type=int, required=True)

    args = parser.parse_args()
    if args.command == "drag-screen":
        if args.app_pid:
            focus_process_window(args.app_pid)
        drag_screen(args.from_x, args.from_y, args.to_x, args.to_y, args.duration)
        print_json({"ok": True, "command": args.command})
        return 0

    if args.command == "mouse-down-screen":
        if args.app_pid:
            focus_process_window(args.app_pid)
        mouse.move(coords=(args.x, args.y))
        time.sleep(0.05)
        mouse.press(button="left", coords=(args.x, args.y))
        print_json({"ok": True, "command": args.command, "point": [args.x, args.y]})
        return 0

    if args.command == "mouse-move-screen":
        mouse.move(coords=(args.x, args.y))
        time.sleep(max(0.0, args.duration))
        print_json({"ok": True, "command": args.command, "point": [args.x, args.y]})
        return 0

    if args.command == "mouse-up-screen":
        mouse.release(button="left", coords=(args.x, args.y))
        time.sleep(0.05)
        print_json({"ok": True, "command": args.command, "point": [args.x, args.y]})
        return 0

    if args.command == "click-screen":
        if args.app_pid:
            focus_process_window(args.app_pid)
        mouse.click(button=args.button, coords=(args.x, args.y))
        time.sleep(0.1)
        print_json({"ok": True, "command": args.command, "button": args.button, "point": [args.x, args.y]})
        return 0

    if args.command == "key-press":
        focus_process_window(args.app_pid)
        keyboard.send_keys(args.keys)
        time.sleep(0.1)
        print_json({"ok": True, "command": args.command, "keys": args.keys})
        return 0

    if args.command == "drag-explorer-item":
        source_path = resolved_path(args.path)
        allowed_root = resolved_path(args.allowed_root)
        assert_inside(source_path, allowed_root)
        start, explorer_rect, _item = explorer_item_center(source_path, args.timeout, (args.to_x, args.to_y))
        drag_screen(start[0], start[1], args.to_x, args.to_y, args.duration)
        time.sleep(0.4)
        if args.app_pid:
            focus_process_window(args.app_pid)
        print_json({
            "ok": True,
            "command": args.command,
            "source": str(source_path),
            "start": start,
            "target": [args.to_x, args.to_y],
            "explorerRect": explorer_rect,
        })
        return 0

    if args.command == "window-client-metrics":
        window = process_main_window(args.app_pid)
        handle = window.handle
        left, top = win32gui.ClientToScreen(handle, (0, 0))
        _, _, width, height = win32gui.GetClientRect(handle)
        rect = window.rectangle()
        print_json({
            "ok": True,
            "command": args.command,
            "client": {"x": left, "y": top, "width": width, "height": height},
            "window": {"left": rect.left, "top": rect.top, "right": rect.right, "bottom": rect.bottom},
        })
        return 0

    raise AssertionError(f"unhandled command: {args.command}")


def resolved_path(path: str) -> Path:
    return Path(path).expanduser().resolve(strict=True)


def assert_inside(path: Path, root: Path) -> None:
    try:
        path.relative_to(root)
    except ValueError as exc:
        raise RuntimeError(f"refusing to drag outside allowed root: {path} is not under {root}") from exc


def focus_process_window(process_id: int) -> None:
    deadline = time.monotonic() + 5
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            window = process_main_window(process_id)
            window.set_focus()
            time.sleep(0.15)
            return
        except Exception as exc:  # pywinauto raises backend-specific lookup exceptions.
            last_error = exc
        time.sleep(0.2)
    raise RuntimeError(f"could not focus process window: pid={process_id}, last_error={last_error}")


def process_main_window(process_id: int):
    desktop = Desktop(backend="uia")
    windows = [
        window
        for window in desktop.windows(process=process_id, visible_only=True)
        if window.is_visible()
    ]
    if not windows:
        raise RuntimeError(f"could not find a visible process window: pid={process_id}")
    return max(windows, key=window_area)


def window_area(window) -> int:
    try:
        rect = window.rectangle()
        return max(0, rect.width()) * max(0, rect.height())
    except Exception:
        return 0


def explorer_item_center(path: Path, timeout: float, avoid_point: tuple[int, int]):
    parent = path.parent
    name = path.name
    subprocess.Popen(["explorer.exe", str(parent)])
    time.sleep(0.2)
    subprocess.Popen(["explorer.exe", f"/select,{str(path)}"])
    desktop = Desktop(backend="uia")
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None

    while time.monotonic() < deadline:
        for window in desktop.windows(control_type="Window", visible_only=True):
            try:
                item = find_descendant_by_title(window, name, "ListItem")
                if item is None and not likely_explorer_window(window, parent):
                    continue
                explorer_rect = place_window_away_from_point(window, avoid_point)
                if item is None:
                    item = find_descendant_by_title(window, name, "ListItem")
                if item is None:
                    continue
                item.set_focus()
                item.click_input()
                rect = item.rectangle()
                return (int((rect.left + rect.right) / 2), int((rect.top + rect.bottom) / 2)), explorer_rect, item
            except Exception as exc:
                last_error = exc
        time.sleep(0.25)

    raise RuntimeError(f"could not locate Explorer item {name!r} under {parent}: {last_error}; candidates={explorer_debug_snapshot(desktop)}")


def place_window_away_from_point(window, point: tuple[int, int]) -> tuple[int, int, int, int] | None:
    try:
        x, y, width, height = explorer_window_rect_away_from_point(point)
        current = window.rectangle()
        if current.left == x and current.top == y and current.width() == width and current.height() == height:
            return (x, y, width, height)
        win32gui.MoveWindow(window.handle, x, y, width, height, True)
        time.sleep(0.25)
        return (x, y, width, height)
    except Exception:
        # Moving Explorer is a stability aid for the harness, not a prerequisite.
        return None


def explorer_window_rect_away_from_point(point: tuple[int, int]) -> tuple[int, int, int, int]:
    screen_x, screen_y, screen_w, screen_h = monitor_work_area_for_point(point)
    width = min(620, max(420, screen_w // 3))
    height = min(460, max(340, screen_h // 3))
    margin = 32
    candidates = [
        (screen_x + margin, screen_y + margin, width, height),
        (screen_x + screen_w - width - margin, screen_y + margin, width, height),
        (screen_x + margin, screen_y + screen_h - height - margin, width, height),
        (screen_x + screen_w - width - margin, screen_y + screen_h - height - margin, width, height),
    ]
    safe_candidates = [rect for rect in candidates if not rect_contains_point(rect, point)]
    best = max(safe_candidates or candidates, key=lambda rect: distance_sq(rect_center(rect), point))
    return tuple(int(value) for value in best)


def monitor_work_area_for_point(point: tuple[int, int]) -> tuple[int, int, int, int]:
    try:
        monitor = MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST)
        left, top, right, bottom = GetMonitorInfo(monitor)["Work"]
        return (left, top, right - left, bottom - top)
    except Exception:
        virtual_x = GetSystemMetrics(SM_XVIRTUALSCREEN)
        virtual_y = GetSystemMetrics(SM_YVIRTUALSCREEN)
        virtual_w = GetSystemMetrics(SM_CXVIRTUALSCREEN)
        virtual_h = GetSystemMetrics(SM_CYVIRTUALSCREEN)
        return (virtual_x, virtual_y, virtual_w, virtual_h)


def rect_contains_point(rect: tuple[int, int, int, int], point: tuple[int, int]) -> bool:
    x, y, width, height = rect
    return x <= point[0] <= x + width and y <= point[1] <= y + height


def rect_center(rect: tuple[int, int, int, int]) -> tuple[float, float]:
    x, y, width, height = rect
    return (x + width / 2, y + height / 2)


def distance_sq(a: tuple[float, float], b: tuple[int, int]) -> float:
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2


def likely_explorer_window(window, parent: Path) -> bool:
    try:
        title = window.window_text() or ""
    except Exception:
        title = ""
    if parent.name and parent.name.lower() in title.lower():
        return True
    # Explorer title text can be localized or shortened, so fall back to windows
    # that contain the selected item in their descendant tree.
    return bool(re.search(r"explorer|エクスプローラー", title, re.IGNORECASE))


def explorer_debug_snapshot(desktop) -> list[dict[str, object]]:
    snapshot: list[dict[str, object]] = []
    for window in desktop.windows(control_type="Window", visible_only=True):
        try:
            title = window.window_text() or ""
        except Exception:
            title = "<title-error>"
        try:
            items = []
            for item in window.descendants(control_type="ListItem")[:12]:
                try:
                    items.append(item.window_text())
                except Exception:
                    items.append("<item-error>")
        except Exception as exc:
            items = [f"<items-error: {exc}>"]
        if items or re.search(r"explorer|エクスプローラー|source|cut-folder", title, re.IGNORECASE):
            snapshot.append({"title": title, "items": items})
    return snapshot[:8]


def find_descendant_by_title(window, title: str, control_type: str):
    candidates = [title]
    stem = Path(title).stem
    if stem and stem != title:
        candidates.append(stem)
    try:
        for candidate in candidates:
            try:
                return window.child_window(title=candidate, control_type=control_type).wrapper_object()
            except Exception:
                continue
    except Exception:
        pass

    lower_candidates = [candidate.lower() for candidate in candidates]
    for item in window.descendants(control_type=control_type):
        try:
            item_title = item.window_text()
        except Exception:
            continue
        lower_item_title = item_title.lower()
        if any(lower_item_title == candidate or lower_item_title.startswith(f"{candidate} ") for candidate in lower_candidates):
            return item
    return None


def drag_screen(from_x: int, from_y: int, to_x: int, to_y: int, duration: float) -> None:
    steps = max(8, int(duration * 24))
    mouse.move(coords=(from_x, from_y))
    time.sleep(0.15)
    mouse.press(button="left", coords=(from_x, from_y))
    try:
        for step in range(1, steps + 1):
            ratio = step / steps
            x = round(from_x + (to_x - from_x) * ratio)
            y = round(from_y + (to_y - from_y) * ratio)
            mouse.move(coords=(x, y))
            time.sleep(max(0.01, duration / steps))
    finally:
        mouse.release(button="left", coords=(to_x, to_y))
    time.sleep(0.25)


def print_json(value: object) -> None:
    print(json.dumps(value, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print_json({"ok": False, "error": str(exc)})
        raise
