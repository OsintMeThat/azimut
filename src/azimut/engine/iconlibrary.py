"""The analyst's own pictograms, kept app-wide so every case can use them.

An icon is imported once, in Settings → Icons, and every personal layer's
palette offers it from then on. The library lives beside settings.json rather
than in a case. What a case keeps is the copy a layer takes the moment one of
its markers wears an icon (`layerediting.adopt_icon`), so a case opened on
another machine draws the same marks without this library, and removing an
icon here breaks no map.

Every image is decoded, bounded, trimmed to its ink, sized to the weight the
source layers' pictograms are held to and re-encoded, so what the browser loads
is a PNG this process made. The browser turns an SVG into a PNG before sending
it, and this module never stores one: an SVG can carry a script.

An icon's key is the hash of the PNG stored for it, so the same picture
imported twice is one icon. One taken from a layer also remembers the hash its
bytes had there (`aliases`), which is how a palette knows that layer icon is
already in the library without decoding every one again.

An icon is drawn one of two ways. `disc` makes its silhouette the white glyph
of a coloured disc, as the app's own badges are, so it takes the marker's
colour; that suits a one-colour icon set. `image` draws it in its own colours,
as GeoConfirmed's are. The import guesses which from the pixels, and the
analyst can switch it.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import os
import re
import tempfile
import threading
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops

from .. import config
from . import maplayers

#: How many icons the library holds. A whole icon font is thousands; this is
#: room for the sets an analyst actually draws with, and it keeps a settings
#: backup, which carries every one, to a size a JSON file can be.
MAX_ICONS = 1000
#: What one imported file may weigh, the same as a layer's own icons.
MAX_FILE_BYTES = maplayers.MAX_ICON_BYTES
#: A stored icon is a PNG this module made at most `MAX_ICON_CANVAS` wide, so
#: anything far past this read back off the disk is not one of them.
MAX_STORED_BYTES = 512 * 1024
MAX_NAME = 80
MAX_GROUP = 60
MAX_ALIASES = 8
MODES = ("disc", "image")
DEFAULT_GROUP = "My icons"
KEY_LENGTH = 16
_KEY = re.compile(r"^[0-9a-f]{16}$")

#: An opaque picture whose four corners agree has a background, which is keyed
#: out: within `_FLAT` of the corner colour is gone, past `_SOLID` is kept whole,
#: and the edge between fades.
_CORNER_SPREAD = 24
_FLAT = 16
_SOLID = 64
#: An icon whose painted pixels are this close to one colour reads as a
#: silhouette, which a disc can wear.
_ONE_COLOUR = 48
_ONE_COLOUR_SHARE = 0.92

_lock = threading.Lock()


class IconError(ValueError):
    """An icon that cannot be taken, said in one sentence the panel can show."""


def library_dir() -> Path:
    return config.settings_dir() / "icons"


def _manifest_path() -> Path:
    return library_dir() / "icons.json"


def _png_path(key: str) -> Path:
    if not _KEY.match(key):
        raise IconError("that is not an icon of your library")
    return library_dir() / f"{key}.png"


def is_key(value: Any) -> bool:
    return isinstance(value, str) and bool(_KEY.match(value))


def key_of(png: bytes) -> str:
    return hashlib.sha256(png).hexdigest()[:KEY_LENGTH]


# ---------------------------------------------------------------------------
# Pixels
# ---------------------------------------------------------------------------


def _decode(raw: bytes, limit: int) -> Image.Image:
    if not raw:
        raise IconError("this file is empty")
    if len(raw) > limit:
        raise IconError(f"an icon file weighs at most {limit // 1024} KB")
    try:
        with Image.open(BytesIO(raw)) as opened:
            if opened.format not in ("PNG", "JPEG", "WEBP", "GIF", "BMP"):
                raise IconError("an icon is a PNG, JPEG, WebP, GIF or SVG file")
            if opened.width * opened.height > maplayers.MAX_ICON_AREA:
                raise IconError("this image is too large to be an icon")
            opened.load()
            image = opened.convert("RGBA")
    except IconError:
        raise
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise IconError("this file is not an image the app can read") from exc
    if not image.width or not image.height:
        raise IconError("this file is empty")
    return image


def _encode(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _key_out_background(image: Image.Image) -> Image.Image:
    """An opaque picture on a flat background loses the background.

    A JPEG icon is a glyph on white, and a white square is what the map would
    otherwise draw around it. Only an image with no transparency of its own and
    four corners of one colour is touched, so a photograph or a logo that bleeds
    to its edges stays as it came.
    """
    lowest, _ = image.getchannel("A").getextrema()
    if int(lowest) < 250:  # type: ignore[arg-type]  # one band: a (min, max) of ints
        return image
    width, height = image.size
    rgba = image.tobytes()
    corners = [tuple(rgba[(y * width + x) * 4:(y * width + x) * 4 + 3])
               for x, y in ((0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1))]
    base = corners[0]
    if any(max(abs(a - b) for a, b in zip(corner, base)) > _CORNER_SPREAD for corner in corners):
        return image
    red, green, blue = ImageChops.difference(image.convert("RGB"), Image.new("RGB", image.size, base)).split()
    distance = ImageChops.lighter(ImageChops.lighter(red, green), blue)
    span = _SOLID - _FLAT
    alpha = distance.point(lambda level: 0 if level <= _FLAT else 255 if level >= _SOLID else (level - _FLAT) * 255 // span)
    keyed = image.copy()
    keyed.putalpha(alpha)
    return keyed


def _trimmed(image: Image.Image) -> Image.Image:
    box = image.getchannel("A").point(lambda level: 255 if level > 8 else 0).getbbox()
    if box is None:
        raise IconError("this image has nothing painted in it")
    return image.crop(box)


def _square(image: Image.Image) -> Image.Image:
    side = max(image.size)
    if image.width == image.height:
        return image
    padded = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    padded.paste(image, ((side - image.width) // 2, (side - image.height) // 2))
    return padded


def guess_mode(image: Image.Image) -> str:
    """`disc` for a one-colour silhouette, `image` for anything painted in several."""
    sample = image.copy()
    sample.thumbnail((48, 48))
    data = sample.tobytes()
    painted = [tuple(data[at:at + 3]) for at in range(0, len(data), 4) if data[at + 3] > 128]
    if not painted:
        return "image"
    middle = tuple(sorted(channel)[len(channel) // 2] for channel in zip(*painted))
    near = sum(1 for pixel in painted if max(abs(a - b) for a, b in zip(pixel, middle)) <= _ONE_COLOUR)
    return "disc" if near / len(painted) >= _ONE_COLOUR_SHARE else "image"


def normalise(raw: bytes) -> tuple[bytes, str]:
    """An imported file → the PNG to store and the way it is first drawn.

    Its background keyed out, cut to what it paints, sized to the layers' icon
    weight and padded square, so every icon in the library sits the same way.
    """
    image = _trimmed(_key_out_background(_decode(raw, MAX_FILE_BYTES)))
    mode = guess_mode(image)
    image = _square(maplayers._resize_icon(image, 1.0))
    return _encode(image), mode


def reencoded(png: bytes) -> bytes:
    """A PNG somebody else wrote, as this process writes it, or `IconError`."""
    return _encode(_decode(png, MAX_FILE_BYTES))


# ---------------------------------------------------------------------------
# The library
# ---------------------------------------------------------------------------


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _text(value: Any, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def name_from_file(filename: str) -> str:
    """`t72_tank-v2.png` → "T72 tank v2": the stem with its separators spoken."""
    stem = str(filename or "").replace("\\", "/").rsplit("/", 1)[-1]
    stem = stem.rsplit(".", 1)[0] if "." in stem else stem
    words = _text(re.sub(r"[_\-.]+", " ", stem), MAX_NAME)
    return (words[:1].upper() + words[1:]) or "Icon"


def _entry(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not is_key(raw.get("key")):
        return None
    aliases = [alias for alias in raw.get("aliases") or [] if is_key(alias)][:MAX_ALIASES]
    return {
        "key": raw["key"],
        "name": _text(raw.get("name"), MAX_NAME) or "Icon",
        "group": _text(raw.get("group"), MAX_GROUP) or DEFAULT_GROUP,
        "mode": raw.get("mode") if raw.get("mode") in MODES else "image",
        "added": str(raw.get("added") or "")[:40],
        **({"aliases": aliases} if aliases else {}),
    }


def _load() -> list[dict[str, Any]]:
    try:
        data = json.loads(_manifest_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    entries, seen = [], set()
    for raw in (data.get("icons") if isinstance(data, dict) else None) or []:
        entry = _entry(raw)
        if entry and entry["key"] not in seen and _png_path(entry["key"]).is_file():
            seen.add(entry["key"])
            entries.append(entry)
    return entries[:MAX_ICONS]


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    config._restrict(path.parent, 0o700)
    fd, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        config._restrict(temporary, 0o600)
        config._replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def _save(entries: list[dict[str, Any]]) -> None:
    payload = json.dumps({"version": 1, "icons": entries}, indent=2, ensure_ascii=False) + "\n"
    _write_atomic(_manifest_path(), payload.encode("utf-8"))


def listing() -> dict[str, Any]:
    with _lock:
        return {"icons": _load(), "max": MAX_ICONS}


def entry(key: str) -> dict[str, Any] | None:
    with _lock:
        return next((icon for icon in _load() if icon["key"] == key), None)


def png(key: str) -> bytes:
    path = _png_path(key)
    try:
        with path.open("rb") as handle:
            data = handle.read(MAX_STORED_BYTES + 1)
    except OSError as exc:
        raise IconError("this icon is no longer in your library") from exc
    if len(data) > MAX_STORED_BYTES:
        raise IconError("this icon is no longer in your library")
    return data


def _put(entries: list[dict[str, Any]], data: bytes, *, name: str, group: str, mode: str,
         alias: str = "") -> tuple[dict[str, Any], bool]:
    """File one PNG under its own hash, or answer the icon already holding it."""
    key = key_of(data)
    for held in entries:
        if held["key"] == key or (alias and alias in held.get("aliases", [])):
            if alias and alias != held["key"] and alias not in held.get("aliases", []):
                held["aliases"] = [*held.get("aliases", []), alias][:MAX_ALIASES]
            return held, False
    if len(entries) >= MAX_ICONS:
        raise IconError(f"your library holds at most {MAX_ICONS} icons")
    _write_atomic(_png_path(key), data)
    added = _entry({"key": key, "name": name, "group": group, "mode": mode, "added": _now(),
                    "aliases": [alias] if alias and alias != key else []})
    assert added is not None
    entries.append(added)
    return added, True


def add_files(files: list[tuple[str, bytes, str]]) -> dict[str, Any]:
    """Imported files, `(filename, bytes, group)` each, filed one by one.

    One that cannot be read is skipped with its reason rather than refusing the
    rest: an icon pack is a folder of a hundred files, and one broken file in it
    is not a reason to have none.
    """
    added: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    already = 0
    with _lock:
        entries = _load()
        for filename, raw, group in files:
            name = name_from_file(filename)
            try:
                data, mode = normalise(raw)
                icon, new = _put(entries, data, name=name, group=group or DEFAULT_GROUP, mode=mode)
            except IconError as exc:
                skipped.append({"name": name, "reason": str(exc)})
                continue
            if new:
                added.append(icon)
            else:
                already += 1
        _save(entries)
    return {"added": added, "already": already, "skipped": skipped, "icons": entries}


def add_pngs(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Icons taken from a layer: `{png, name, group, mode, alias}` each.

    Kept as they were drawn there, padding and all, rather than trimmed again:
    a pin whose tip was centred on its point stays centred on it.
    """
    added: list[dict[str, Any]] = []
    already = 0
    with _lock:
        entries = _load()
        for item in items:
            try:
                data = reencoded(item["png"])
                mode = str(item.get("mode") or "")
                icon, new = _put(entries, data, name=str(item.get("name") or "Icon"),
                                 group=str(item.get("group") or DEFAULT_GROUP),
                                 mode=mode if mode in MODES else "image", alias=str(item.get("alias") or ""))
            except IconError:
                continue
            if new:
                added.append(icon)
            else:
                already += 1
        _save(entries)
    return {"added": added, "already": already, "icons": entries}


def update(key: str, changes: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        entries = _load()
        icon = next((held for held in entries if held["key"] == key), None)
        if icon is None:
            raise IconError("this icon is no longer in your library")
        if "name" in changes:
            icon["name"] = _text(changes["name"], MAX_NAME) or icon["name"]
        if "group" in changes:
            icon["group"] = _text(changes["group"], MAX_GROUP) or DEFAULT_GROUP
        if "mode" in changes:
            if changes["mode"] not in MODES:
                raise IconError("an icon is drawn in a disc or as it is")
            icon["mode"] = changes["mode"]
        _save(entries)
        return icon


def remove(keys: list[str]) -> dict[str, Any]:
    gone = {key for key in keys if is_key(key)}
    with _lock:
        entries = _load()
        kept = [icon for icon in entries if icon["key"] not in gone]
        _save(kept)
        for icon in entries:
            if icon["key"] in gone:
                _png_path(icon["key"]).unlink(missing_ok=True)
        return {"removed": len(entries) - len(kept), "icons": kept}


# ---------------------------------------------------------------------------
# Settings backup
# ---------------------------------------------------------------------------

#: The longest base64 a backed-up icon may be: a stored PNG, encoded.
MAX_BACKUP_B64 = (MAX_STORED_BYTES * 4) // 3 + 4


def backup() -> list[dict[str, Any]]:
    """Every icon with its picture, for `GET /settings/export`."""
    out = []
    for icon in listing()["icons"]:
        try:
            data = png(icon["key"])
        except IconError:
            continue
        out.append({**{field: icon[field] for field in ("name", "group", "mode")},
                    **({"aliases": icon["aliases"]} if icon.get("aliases") else {}),
                    "png_base64": base64.b64encode(data).decode("ascii")})
    return out


def restore(items: list[dict[str, Any]]) -> int:
    """Icons out of a backup, each re-encoded as an import would be; how many are new."""
    with _lock:
        entries = _load()
        count = 0
        for item in items:
            try:
                data = reencoded(base64.b64decode(str(item.get("png_base64") or ""), validate=True))
                icon, new = _put(entries, data, name=str(item.get("name") or "Icon"),
                                 group=str(item.get("group") or DEFAULT_GROUP),
                                 mode=str(item.get("mode") or "image"))
            except (IconError, ValueError, binascii.Error):
                continue
            for alias in item.get("aliases") or []:
                if is_key(alias) and alias != icon["key"] and alias not in icon.get("aliases", []):
                    icon["aliases"] = [*icon.get("aliases", []), alias][:MAX_ALIASES]
            count += int(new)
        _save(entries)
    return count
