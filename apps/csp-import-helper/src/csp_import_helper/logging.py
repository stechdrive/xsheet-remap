from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
import json
from typing import Any


@dataclass
class OperationLog:
    manifest_path: str
    dry_run: bool
    started_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    events: list[dict[str, Any]] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def add(self, event: str, **payload: Any) -> None:
        self.events.append(
            {
                "time": datetime.now(timezone.utc).isoformat(),
                "event": event,
                **payload,
            }
        )

    def error(self, message: str) -> None:
        self.errors.append(message)
        self.add("error", message=message)

    def write(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {
                    "manifestPath": self.manifest_path,
                    "dryRun": self.dry_run,
                    "startedAt": self.started_at,
                    "finishedAt": datetime.now(timezone.utc).isoformat(),
                    "events": self.events,
                    "errors": self.errors,
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
