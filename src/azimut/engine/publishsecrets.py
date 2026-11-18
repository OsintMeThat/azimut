"""The credentials Azimut publishes with, kept on this machine and nowhere else.

A WordPress application password (and, later, a GitHub token) writes to the
analyst's own site. It is a live write credential, so it lives in a file of its
own, ``publishing.json`` beside ``settings.json`` (``config.settings_dir()``):
owner-only (0600), written whole or not at all, and never in a settings backup,
for the reason ``cookies.txt`` stays behind too: a live credential stays on the
machine that made it. What goes with it and is no secret (the site's address,
the username) is an ordinary setting, which the backup carries.

The browser never reads a secret back. ``status`` answers whether one is set and
its last four characters, which is all Settings shows.

    {"wordpress": {"password": "abcd EFGH 1234 ijkl MNOP 6789"}}
"""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from .. import config

#: Each service and the one field its secret is kept under.
FIELDS = {"wordpress": "password", "github": "token"}
#: How long a secret may be: an application password is 24 letters and digits with
#: spaces, a GitHub token under a hundred characters.
MAX_SECRET = 256
#: How many of its last characters a secret shows, and only once it is longer than that.
HINT = 4

_turn = threading.Lock()


class SecretError(ValueError):
    """A secret this store will not keep."""


def path() -> Path:
    return config.settings_dir() / "publishing.json"


def _load() -> dict[str, Any]:
    try:
        data = json.loads(path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def _save(data: dict[str, Any]) -> None:
    payload = json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
    config.write_private(path(), payload.encode("utf-8"))


def read(service: str) -> str:
    """The secret kept for ``service``, or "" when none is."""
    field = FIELDS[service]
    entry = _load().get(service)
    value = entry.get(field) if isinstance(entry, dict) else None
    return value if isinstance(value, str) else ""


def write(service: str, secret: str) -> None:
    """Keep ``secret`` for ``service``, or forget it when it is empty."""
    field = FIELDS[service]
    secret = secret.strip()
    if len(secret) > MAX_SECRET or any(char in secret for char in "\r\n\t\0"):
        raise SecretError("that does not read as a password or a token")
    with _turn:
        data = _load()
        if secret:
            data[service] = {field: secret}
        else:
            data.pop(service, None)
        if data:
            _save(data)
        else:
            path().unlink(missing_ok=True)


def forget(service: str) -> None:
    write(service, "")


def status(service: str) -> dict[str, Any]:
    """Whether a secret is set, and its last characters: never the secret itself."""
    secret = read(service).replace(" ", "")
    if not secret:
        return {"set": False, "hint": ""}
    return {"set": True, "hint": f"…{secret[-HINT:]}" if len(secret) > HINT * 2 else ""}
