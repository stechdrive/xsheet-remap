from __future__ import annotations

import sys


def enable_windows_dpi_awareness() -> None:
    """Make UI automation coordinates match screenshot pixels on Windows."""

    if sys.platform != "win32":
        return
    try:
        import ctypes

        # Prefer per-monitor v2 awareness. Fall back to system awareness for
        # older Windows builds or hosts that reject changing the process mode.
        if ctypes.windll.user32.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4)):
            return
    except Exception:
        pass
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            import ctypes

            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            return
