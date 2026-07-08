from __future__ import annotations

import ctypes
from ctypes import wintypes
import threading
from typing import Protocol


class CancellationToken(Protocol):
    def set(self) -> None:
        ...


class EmergencyHotkeys:
    """Register process-local Windows global hotkeys for emergency stop.

    CSP owns focus during automation, so Tk bindings or terminal input are not
    reliable emergency controls. RegisterHotKey keeps the stop gesture global
    while this helper process is alive.
    """

    HOTKEYS = (
        (1, 0x0002 | 0x0001, 0x7B, "Ctrl+Alt+F12"),
        (2, 0x0002 | 0x0001, 0x13, "Ctrl+Alt+Pause"),
    )

    def __init__(self, cancel_event: CancellationToken) -> None:
        self.cancel_event = cancel_event
        self.registered_labels: list[str] = []
        self._ready = threading.Event()
        self._closed = threading.Event()
        self._thread_id: int | None = None
        self._thread = threading.Thread(target=self._run, name="csp-helper-emergency-hotkeys", daemon=True)

    def __enter__(self) -> EmergencyHotkeys:
        self.start()
        return self

    def __exit__(self, _exc_type: object, _exc: object, _tb: object) -> None:
        self.close()

    def start(self) -> None:
        self._thread.start()
        self._ready.wait(timeout=1.0)

    def close(self) -> None:
        self._closed.set()
        if self._thread_id is not None:
            ctypes.windll.user32.PostThreadMessageW(self._thread_id, 0x0012, 0, 0)
        self._thread.join(timeout=1.0)

    def _run(self) -> None:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        self._thread_id = int(kernel32.GetCurrentThreadId())
        registered_ids: list[int] = []
        for hotkey_id, modifiers, virtual_key, label in self.HOTKEYS:
            if user32.RegisterHotKey(None, hotkey_id, modifiers, virtual_key):
                registered_ids.append(hotkey_id)
                self.registered_labels.append(label)
        self._ready.set()
        try:
            msg = wintypes.MSG()
            while not self._closed.is_set():
                result = user32.GetMessageW(ctypes.byref(msg), None, 0, 0)
                if result <= 0:
                    break
                if msg.message == 0x0312:
                    self.cancel_event.set()
        finally:
            for hotkey_id in registered_ids:
                user32.UnregisterHotKey(None, hotkey_id)
