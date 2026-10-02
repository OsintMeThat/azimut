"""What a failure says to the analyst, as one clause they can act on.

An OSError's text carries an errno and a path, Pillow's names the buffer it was handed,
httpx's holds the URL and its key, and a KeyError is a bare quoted word. That text stays
in the log. The page gets a clause from here, written to follow "could not save the
image: " or to stand alone.

The app's own exceptions (CaseError, SheetError and the rest) already speak in
sentences, so they pass through unchanged.
"""

from __future__ import annotations

import errno
import logging
import subprocess
import zipfile
from typing import Any

import httpx
from PIL import UnidentifiedImageError

logger = logging.getLogger("azimut")

UNEXPECTED = "an unexpected error stopped it. Settings → System → Report an issue has its log"

# Python's own mistakes: their text is for whoever reads the code, never for the page.
_INTERNAL = (KeyError, IndexError, TypeError, AttributeError, AssertionError, NameError)


def explain(exc: BaseException) -> str:
    """One clause for a failure, lowercase, with no closing full stop."""
    if isinstance(exc, UnidentifiedImageError):
        return "this file is not a picture Azimut can read"
    if isinstance(exc, zipfile.BadZipFile):
        return "this file is not a readable archive"
    if isinstance(exc, subprocess.TimeoutExpired):
        return "it took too long and was stopped"
    if isinstance(exc, httpx.TimeoutException):
        return "the service did not answer in time"
    if isinstance(exc, httpx.HTTPStatusError):
        return f"the service answered {exc.response.status_code}"
    if isinstance(exc, httpx.HTTPError):
        return "the service could not be reached"
    if isinstance(exc, OSError):
        return _disk(exc)
    if isinstance(exc, _INTERNAL):
        logger.warning("unexpected %s: %s", type(exc).__name__, exc)
        return UNEXPECTED
    text = str(exc).strip()
    return text.rstrip(".") if text else UNEXPECTED


def _disk(exc: OSError) -> str:
    if isinstance(exc, PermissionError) or exc.errno in (errno.EACCES, errno.EPERM):
        return "the system refused access to that file or folder"
    if isinstance(exc, FileNotFoundError):
        return "a file it needed is no longer there"
    if exc.errno == errno.ENOSPC:
        return "the disk is full"
    if exc.errno == errno.EROFS:
        return "that folder is read-only"
    if exc.errno == errno.ENAMETOOLONG:
        return "a file name or path is too long for this system"
    return "the file system refused it"


def validation_sentence(errors: list[dict[str, Any]]) -> str:
    """A request the schema refused, said the way a form says it: "Name is too long
    (80 characters at most)". The first three problems, joined."""
    parts = [_one(error) for error in errors[:3]]
    sentence = "; ".join(part for part in parts if part)
    return sentence or "The request did not hold what this action needs"


def _one(error: dict[str, Any]) -> str:
    loc = [part for part in error.get("loc", ()) if part not in ("body", "query", "path")]
    names = [str(part) for part in loc if isinstance(part, str)]
    field = names[-1].replace("_", " ").capitalize() if names else ""
    ctx = error.get("ctx") or {}
    kind = str(error.get("type", ""))
    if kind == "missing":
        reason = "is required"
    elif kind == "string_too_long":
        reason = f"is too long ({ctx.get('max_length')} characters at most)"
    elif kind == "string_too_short":
        reason = "cannot be empty" if ctx.get("min_length") == 1 else f"needs at least {ctx.get('min_length')} characters"
    elif kind == "too_long":
        reason = f"holds too many items ({ctx.get('max_length')} at most)"
    elif kind == "too_short":
        reason = f"needs at least {ctx.get('min_length')} items"
    elif kind in ("greater_than_equal", "greater_than"):
        reason = f"must be at least {ctx.get('ge', ctx.get('gt'))}"
    elif kind in ("less_than_equal", "less_than"):
        reason = f"must be at most {ctx.get('le', ctx.get('lt'))}"
    elif kind == "string_pattern_mismatch":
        reason = "holds characters it cannot take"
    elif kind == "literal_error":
        reason = f"must be one of {ctx.get('expected')}"
    elif kind in ("int_parsing", "float_parsing", "int_type", "float_type", "int_from_float"):
        reason = "must be a number"
    elif kind == "bool_parsing":
        reason = "must be yes or no"
    elif kind == "json_invalid":
        return "The request was not valid JSON"
    elif kind == "extra_forbidden":
        reason = "is not a field this action takes"
    else:
        reason = str(error.get("msg", "")).removeprefix("Value error, ")
        return f"{field}: {reason}" if field else reason
    return f"{field} {reason}" if field else reason[0].upper() + reason[1:]
