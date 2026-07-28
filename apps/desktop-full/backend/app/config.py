"""Runtime configuration loaded from Electron-provided environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class Settings:
    host: str
    port: int
    token: str
    log_level: str
    database_path: Path | None

    @classmethod
    def from_environment(cls) -> "Settings":
        host = os.getenv("BUTLER_BACKEND_HOST", "127.0.0.1").strip()
        if host not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("The desktop backend must bind to a loopback address")

        raw_port = os.getenv("BUTLER_BACKEND_PORT", "8765")
        port = int(raw_port)
        if not 1 <= port <= 65535:
            raise ValueError("BUTLER_BACKEND_PORT must be between 1 and 65535")

        return cls(
            host=host,
            port=port,
            token=os.getenv("BUTLER_BACKEND_TOKEN", "").strip(),
            log_level=os.getenv("BUTLER_BACKEND_LOG_LEVEL", "INFO").upper(),
            database_path=(
                Path(value) if (value := os.getenv("BUTLER_DATABASE_PATH", "").strip()) else None
            ),
        )


settings = Settings.from_environment()

