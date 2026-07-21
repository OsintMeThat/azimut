"""Application configuration and workspace-root resolution.

Everything Azimut persists lives under one root directory (default ``~/Azimut``,
overridable with the ``AZIMUT_HOME`` environment variable):

    ~/Azimut/
    ├── cases/       # named investigations
    ├── scratch/     # one-shot sessions (promotable to cases)
    ├── runtime/     # newer scrapers fetched at runtime (engine/scrapers.py)
    ├── signature.png  # optional analyst logo, stamped onto proofs
    ├── settings.json
    └── templates.json  # reusable proof and post styles

No database server — plain files only (spec §4).
"""

from __future__ import annotations

import copy
import json
import logging
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

# On-disk schema for settings.json — the app-wide sibling of case.json's
# CASE_SCHEMA (workspace.py). An older file is migrated up to this on load; a
# newer file is left alone, since update() below preserves keys this Azimut
# doesn't know. Bump it in the same change that adds a SETTINGS_MIGRATIONS entry.
SETTINGS_SCHEMA = 1

DEFAULT_SETTINGS: dict[str, Any] = {
    # Schema version this build writes. Read back through _settings_schema() so
    # a future breaking rename is migrated rather than silently dropped.
    "schema": SETTINGS_SCHEMA,
    # Extra XYZ tile providers added by the user (spec §6 v1 notes).
    # Each: {"id", "label", "url" ({x}/{y}/{z} template), "attribution", "max_zoom"}
    "tile_providers": [],
    # Optional user-supplied API keys, keyed by provider id. Never required.
    # Built-in keyed providers (Mapbox, Google) read their token from here:
    # "mapbox": "pk....", "google": "AIza...".
    "api_keys": {},
    # Per-provider monthly tile-request counters: {"<provider_id>": {"YYYY-MM": count}}.
    # Local bookkeeping only, for billed keyed providers (Mapbox, Google).
    "usage": {},
    # Keyed-provider preferences (docs/IMAGERY_PROVIDERS.md):
    # - providers_enabled: {"mapbox": bool, "google": bool} — absent means enabled;
    #   a saved key can be kept while the basemap is hidden from the selector.
    # - usage_overrides: {"mapbox": bool, ...} — serve past the 90% soft block,
    #   accepting the provider's billing. Off by default.
    # - eco_zoom_fallback: at low zoom (≤ eco_max_zoom) the live map swaps a
    #   billed basemap for free imagery; paid detail only matters zoomed in.
    "providers_enabled": {},
    "usage_overrides": {},
    # Per-meter monthly free allowance, overriding config.FREE_TIER:
    # {"sentinelhub": 30000}. A free tier is a fact about the user's account,
    # not about the app — providers grant more than they document (and change
    # it), so the number the soft block measures against has to be theirs to
    # correct. Absent = the FREE_TIER default.
    "free_tiers": {},
    # Last known health of each keyed credential: {"<key_id>": {"ok": bool,
    # "detail": str, "at": iso}}. Written by the Settings key test and by
    # *auth-shaped* provider rejections (never plain network errors); cleared
    # when the key changes. A key marked bad withholds its basemap from the
    # selector until it tests good again — a dead map should not be on offer.
    "provider_status": {},
    "eco_zoom_fallback": True,
    "eco_max_zoom": 15,
    # Per-provider eco thresholds: {"<key_id>": zoom}. Overrides the provider's
    # own default and the global eco_max_zoom for that basemap; 0 = eco never
    # fires for it. Absent = inherit (provider default, else global). The
    # Maps JS widget is not configurable here — swapping it out and back
    # re-bills a map load, so eco is pinned off for it in engine/tiles.py.
    "eco_max_zooms": {},
    # Display preferences, app-wide (Settings → Preferences):
    # - coord_format: how every tool renders a latitude/longitude — "dd"
    #   (decimal degrees), "dms" (degrees/minutes/seconds), "mgrs" (grid ref).
    # - units: "metric" (m/km/ha) or "imperial" (ft/mi/acre) for measurements.
    # Presentation only: artifacts on disk always keep decimal degrees and
    # metres, so a case reads the same whatever the reader's preference.
    "coord_format": "dd",
    "units": "metric",
    # Where the Satellite tab opens before anything points it somewhere else
    # (a case artifact, a "go to coords" handoff). {"lat", "lon", "zoom"}.
    "home_view": {"lat": 48.8584, "lon": 2.2945, "zoom": 16},
    # The handle a new post draft is addressed to. Empty means no mention.
    "post_mention": "@GeoConfirmed",
    # The social composer a new post draft starts with. A saved draft keeps its
    # own target so a later preference change never rewrites it.
    "post_target": "x",
    # The handle stamped onto proofs when a proof/template enables it. Empty
    # means no account-handle slot can render.
    "signature_handle": "",
    # Pairing token for the capture browser extension (api/ingest.py). Minted
    # lazily on first use, shown once in Settings, pasted into the extension.
    # Empty means "not minted yet" — never a valid credential.
    "ingest_token": "",
    # App self-update pop-up (frontend App.svelte + engine/updates.py):
    # - update_check_on_start: ask GitHub for the latest release when the page
    #   loads, and pop a notice if one is newer. On by default so a binary user
    #   (no package manager behind them) hears about releases; the one network
    #   call Azimut makes on mount, and the toggle in Settings turns it off.
    # - update_dismissed_version: the release the user chose "don't show again"
    #   for. The pop-up stays quiet for that exact tag; a newer one shows again.
    "update_check_on_start": True,
    "update_dismissed_version": "",
}

# Accepted values for the display preferences above — mirror of
# frontend/src/lib/coords.js and frontend/src/lib/measure.js.
COORD_FORMATS = ("dd", "dms", "mgrs")
UNIT_SYSTEMS = ("metric", "imperial")
POST_TARGETS = ("x", "bluesky", "mastodon")

# Documented monthly free allowances per meter, in billed requests (verified
# 2026-07: Google 2D Map Tiles 100k then $0.60/1k, and ≤15k/day; Mapbox Static
# Tiles 200k then $0.50/1k; Sentinel Hub 30k requests *and* 30k processing units
# for a Copernicus General account, and its 512px tiles are 1 PU each — see
# docs/IMAGERY_PROVIDERS.md, which is why tiles are a faithful unit here).
# A yardstick, not a guarantee — mirror of frontend/src/lib/usage.js FREE_TIER.
# google_js counts *map loads* (Maps JavaScript API dynamic maps), not tiles:
# 10k free/month on the 2025 Essentials tier, then ~$7/1k. One load per widget
# instantiation; pan/zoom on an open map is free, so the unit is coarse but honest.
#
# These are *defaults*, not facts: a free tier is per-account and providers move
# it without touching their docs (Copernicus still documents 10k while actually
# provisioning 30k — observed 2026-07). `free_tiers` in settings.json overrides
# any of them, which is what free_tier() below resolves; a hardcoded number
# would make the counter lie about someone else's account.
FREE_TIER = {"mapbox": 200_000, "google": 100_000, "google_js": 10_000, "sentinelhub": 30_000}
# Share of the free tier past which metered providers stop serving unless the
# user flips the per-provider override in Settings.
BLOCK_SHARE = 0.9
# Eco mode default: visual zoom at or below which free imagery replaces a
# billed basemap. The live value is the user's settings.json `eco_max_zoom`.
ECO_MAX_ZOOM = 15


def workspace_root() -> Path:
    root = Path(os.environ.get("AZIMUT_HOME", "~/Azimut")).expanduser()
    return root


def cases_dir() -> Path:
    return workspace_root() / "cases"


def scratch_dir() -> Path:
    return workspace_root() / "scratch"


def runtime_dir() -> Path:
    """Where updated scrapers land (engine/scrapers.py).

    In the workspace rather than beside the program because that's the one
    directory we know is user-writable: the frozen binary can sit in
    /usr/local/bin or Program Files, and its own contents are read-only.
    """
    return workspace_root() / "runtime"


def settings_path() -> Path:
    return workspace_root() / "settings.json"


def signature_path() -> Path:
    """The analyst's optional logo, stamped onto proofs they choose to sign.

    App-wide like the API keys, and under the same rule: it lives beside
    settings.json and is never copied into a case folder or an export bundle.
    Only the rendered proof PNG ever carries it.
    """
    return workspace_root() / "signature.png"


def templates_path() -> Path:
    """Reusable proof-style and post-thread presets, app-wide.

    A "house style" spans every case, so it lives beside settings.json rather
    than inside a case — same rule as the signature. Kept out of settings.json
    itself so the secrets file stays small and single-purpose.
    """
    return workspace_root() / "templates.json"


# Refuse anything larger as a signature: a logo is a small badge on a composite,
# and the file is read into memory to be validated and served.
SIGNATURE_MAX_BYTES = 2 * 1024 * 1024
# PNG only — the format's alpha channel is what lets a logo sit over imagery.
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def ensure_workspace() -> None:
    """Create the workspace skeleton if missing (idempotent)."""
    cases_dir().mkdir(parents=True, exist_ok=True)
    scratch_dir().mkdir(parents=True, exist_ok=True)
    # The workspace holds API keys and the pairing token — keep it owner-only
    # so another account on a shared machine can't read them. Best-effort:
    # Windows ignores POSIX modes, which is fine (its ACLs already scope $HOME).
    _restrict(workspace_root(), 0o700)
    if not settings_path().exists():
        save_settings(DEFAULT_SETTINGS)
        return
    # Upgrade an older settings.json in place, once, so the file on disk matches
    # the shape the rest of the app expects. load_settings() also migrates in
    # memory, so a read is safe even before this runs.
    try:
        raw = json.loads(settings_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if _settings_schema(raw) < SETTINGS_SCHEMA:
        save_settings(migrate_settings(raw))


def _restrict(path: Path, mode: int) -> None:
    """chmod, ignoring platforms/filesystems that don't support it."""
    try:
        os.chmod(path, mode)
    except OSError:
        pass


# from_version -> function(data) returning settings reshaped for from_version+1.
# The runner (migrate_settings) stamps the new number, so a migration only
# rewrites fields. Empty while we're on the first schema.
SETTINGS_MIGRATIONS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {}


def _settings_schema(data: dict[str, Any]) -> int:
    """The schema a loaded settings.json declares. Files predating the tag are
    the first schema."""
    value = data.get("schema")
    return value if isinstance(value, int) else 1


def migrate_settings(data: dict[str, Any]) -> dict[str, Any]:
    """Upgrade a raw settings dict to ``SETTINGS_SCHEMA`` in memory.

    A newer file is returned untouched — update() in load_settings keeps keys
    this build doesn't recognise, so there is nothing to lose by loading it.
    Pure: it never writes. ensure_workspace() persists the result once at start.
    """
    version = _settings_schema(data)
    for step in range(version, SETTINGS_SCHEMA):
        data = SETTINGS_MIGRATIONS[step](data)
        data["schema"] = step + 1
    return data


def load_settings() -> dict[str, Any]:
    # deep copies: callers mutate nested dicts (usage counters, prefs), and a
    # shallow copy would let that leak into DEFAULT_SETTINGS itself
    try:
        data = json.loads(settings_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return copy.deepcopy(DEFAULT_SETTINGS)
    merged = copy.deepcopy(DEFAULT_SETTINGS)
    merged.update(migrate_settings(data))
    return merged


def save_settings(settings: dict[str, Any]) -> None:
    path = settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _restrict(path.parent, 0o700)
    payload = json.dumps(settings, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        _restrict(tmp_path, 0o600)
        os.replace(tmp_path, path)
        # Holds the user's API keys and pairing token — owner-read/write only.
        _restrict(path, 0o600)
    finally:
        tmp_path.unlink(missing_ok=True)


def month_key(when: datetime | None = None) -> str:
    """The usage-counter bucket for a moment in time: "YYYY-MM" (UTC)."""
    return (when or datetime.now(timezone.utc)).strftime("%Y-%m")


_usage_lock = threading.Lock()  # tile proxy bumps the counter from many threads


def update_settings(mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Load → mutate → save settings.json under the writer lock.

    Every read-modify-write of the file must go through this (or take
    ``_usage_lock`` itself): the tile proxy bumps counters from worker threads,
    and an unlocked save can drop either the counter bump or the caller's
    change (last writer wins on the whole file).
    """
    with _usage_lock:
        settings = load_settings()
        mutate(settings)
        save_settings(settings)
        return settings


# Reusable presets file (templates.json). The two families a template can be:
# "proof" (a proof's house style) and "post" (a thread skeleton).
TEMPLATE_KINDS = ("proof", "post")
DEFAULT_TEMPLATES: dict[str, Any] = {"schema": 1, "proof": [], "post": []}
_templates_lock = threading.Lock()


def load_templates() -> dict[str, Any]:
    try:
        data = json.loads(
            templates_path().read_text(encoding="utf-8"),
            parse_constant=lambda value: (_ for _ in ()).throw(
                ValueError(f"invalid JSON constant: {value}")
            ),
        )
    except FileNotFoundError:
        return copy.deepcopy(DEFAULT_TEMPLATES)
    except (OSError, json.JSONDecodeError, ValueError) as exc:
        logger.warning("Ignoring unreadable templates.json: %s", exc)
        return copy.deepcopy(DEFAULT_TEMPLATES)
    if not isinstance(data, dict) or data.get("schema", 1) != 1:
        logger.warning("Ignoring templates.json with an unsupported root or schema")
        return copy.deepcopy(DEFAULT_TEMPLATES)
    merged = copy.deepcopy(DEFAULT_TEMPLATES)
    for kind in TEMPLATE_KINDS:
        value = data.get(kind)
        if not isinstance(value, list):
            continue
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, dict):
                continue
            template_id = item.get("id")
            name = item.get("name")
            template_data = item.get("data")
            updated_at = item.get("updated_at")
            if (
                not isinstance(template_id, str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", template_id)
                or template_id in seen
                or not isinstance(name, str)
                or not name.strip()
                or len(name.strip()) > 120
                or not isinstance(template_data, dict)
                or (updated_at is not None and not isinstance(updated_at, str))
                or (isinstance(updated_at, str) and len(updated_at) > 64)
            ):
                logger.warning("Ignoring malformed %s template record", kind)
                continue
            record = {"id": template_id, "name": name.strip(), "data": template_data}
            if updated_at is not None:
                record["updated_at"] = updated_at
            merged[kind].append(record)
            seen.add(template_id)
    return merged


def save_templates(templates: dict[str, Any]) -> None:
    path = templates_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    _restrict(path.parent, 0o700)
    payload = json.dumps(
        templates, indent=2, ensure_ascii=False, allow_nan=False
    ) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        _restrict(tmp_path, 0o600)
        os.replace(tmp_path, path)
        _restrict(path, 0o600)
    finally:
        tmp_path.unlink(missing_ok=True)


def update_templates(mutate: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Load → mutate → save templates.json under a writer lock."""
    with _templates_lock:
        templates = load_templates()
        mutate(templates)
        save_templates(templates)
        return templates


def record_usage(meter: str, count: int = 1, when: datetime | None = None) -> int:
    """Bump a provider's tile counter for the month; returns the new total.

    Local bookkeeping only (docs/IMAGERY_PROVIDERS.md): billed keyed providers
    (Mapbox, Google) get a per-month tally so the user can watch their quota.
    No telemetry — the counter never leaves settings.json.
    """
    with _usage_lock:
        settings = load_settings()
        per_month = settings.setdefault("usage", {}).setdefault(meter, {})
        bucket = month_key(when)
        per_month[bucket] = int(per_month.get(bucket, 0)) + int(count)
        save_settings(settings)
        return per_month[bucket]


def month_usage(meter: str, settings: dict[str, Any] | None = None) -> int:
    """This month's tile tally for a meter."""
    settings = settings or load_settings()
    return int((settings.get("usage", {}).get(meter) or {}).get(month_key(), 0))


def free_tier(meter: str, settings: dict[str, Any] | None = None) -> int | None:
    """This account's monthly free allowance for a meter: the user's own figure
    when they corrected it in Settings, else the documented default.

    None means "unmetered" — no allowance is known, so nothing to block on.
    """
    settings = settings or load_settings()
    override = (settings.get("free_tiers") or {}).get(meter)
    if isinstance(override, (int, float)) and int(override) > 0:
        return int(override)
    return FREE_TIER.get(meter)


def free_tiers(settings: dict[str, Any] | None = None) -> dict[str, int]:
    """Every meter's live allowance — what the UI mirrors (api/settings.py)."""
    settings = settings or load_settings()
    resolved = {}
    for meter in FREE_TIER:
        value = free_tier(meter, settings)
        if value:
            resolved[meter] = value
    return resolved


def usage_blocked(meter: str, settings: dict[str, Any] | None = None) -> bool:
    """True when a metered provider passed BLOCK_SHARE of its free tier and the
    user hasn't opted into overage billing for it (docs/IMAGERY_PROVIDERS.md)."""
    settings = settings or load_settings()
    free = free_tier(meter, settings)
    if not free:
        return False
    if settings.get("usage_overrides", {}).get(meter):
        return False
    return month_usage(meter, settings) >= free * BLOCK_SHARE


def record_provider_status(key_id: str, ok: bool, detail: str = "") -> None:
    """Persist a keyed credential's last known health (DEFAULT_SETTINGS note).

    Only call this for *auth-shaped* verdicts — a key test, or a provider
    rejection that names the key/account (Google's PERMISSION_DENIED, Sentinel
    Hub's "Invalid instance id"). A timeout or DNS hiccup says nothing about
    the key and must never bench a basemap.
    """
    with _usage_lock:  # same file as the counters — same writer lock
        settings = load_settings()
        settings.setdefault("provider_status", {})[key_id] = {
            "ok": bool(ok),
            "detail": str(detail)[:300],
            "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        }
        save_settings(settings)


def provider_key_bad(key_id: str, settings: dict[str, Any] | None = None) -> bool:
    """True when the key's last recorded verdict was a failure."""
    settings = settings or load_settings()
    status = (settings.get("provider_status") or {}).get(key_id)
    return bool(status) and not (status or {}).get("ok", True)


def ingest_token(rotate: bool = False) -> str:
    """The capture extension's pairing token — minted lazily, kept in settings.json.

    Guards /api/ingest/* (api/ingest.py): the server binds localhost, so the
    token's job is to stop *other local pages and processes* from filing
    images into cases, not to survive a hostile network. ``rotate=True``
    mints a fresh one (Settings), instantly orphaning every paired extension.
    """
    import secrets

    with _usage_lock:  # same file as the counters — same writer lock
        settings = load_settings()
        if rotate or not settings.get("ingest_token"):
            settings["ingest_token"] = secrets.token_urlsafe(24)
            save_settings(settings)
        return settings["ingest_token"]
