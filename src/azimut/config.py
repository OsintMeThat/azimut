"""Application configuration and workspace-root resolution.

Everything Azimut persists lives under one root directory (default ``~/Azimut``,
overridable with the ``AZIMUT_HOME`` environment variable):

    ~/Azimut/
    ├── cases/       # named investigations
    ├── scratch/     # one-shot sessions (promotable to cases)
    ├── runtime/     # newer scrapers fetched at runtime (engine/scrapers.py)
    ├── signature.png  # optional analyst logo, stamped onto proofs
    └── settings.json

No database server — plain files only (spec §4).
"""

from __future__ import annotations

import copy
import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS: dict[str, Any] = {
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
    # Pairing token for the capture browser extension (api/ingest.py). Minted
    # lazily on first use, shown once in Settings, pasted into the extension.
    # Empty means "not minted yet" — never a valid credential.
    "ingest_token": "",
}

# Accepted values for the display preferences above — mirror of
# frontend/src/lib/coords.js and frontend/src/lib/measure.js.
COORD_FORMATS = ("dd", "dms", "mgrs")
UNIT_SYSTEMS = ("metric", "imperial")

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


# Refuse anything larger as a signature: a logo is a small badge on a composite,
# and the file is read into memory to be validated and served.
SIGNATURE_MAX_BYTES = 2 * 1024 * 1024
# PNG only — the format's alpha channel is what lets a logo sit over imagery.
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def ensure_workspace() -> None:
    """Create the workspace skeleton if missing (idempotent)."""
    cases_dir().mkdir(parents=True, exist_ok=True)
    scratch_dir().mkdir(parents=True, exist_ok=True)
    if not settings_path().exists():
        save_settings(DEFAULT_SETTINGS)


def load_settings() -> dict[str, Any]:
    # deep copies: callers mutate nested dicts (usage counters, prefs), and a
    # shallow copy would let that leak into DEFAULT_SETTINGS itself
    try:
        data = json.loads(settings_path().read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return copy.deepcopy(DEFAULT_SETTINGS)
    merged = copy.deepcopy(DEFAULT_SETTINGS)
    merged.update(data)
    return merged


def save_settings(settings: dict[str, Any]) -> None:
    settings_path().parent.mkdir(parents=True, exist_ok=True)
    settings_path().write_text(
        json.dumps(settings, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )


def month_key(when: datetime | None = None) -> str:
    """The usage-counter bucket for a moment in time: "YYYY-MM" (UTC)."""
    return (when or datetime.now(timezone.utc)).strftime("%Y-%m")


_usage_lock = threading.Lock()  # tile proxy bumps the counter from many threads


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
    return bool(status) and not status.get("ok", True)


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
