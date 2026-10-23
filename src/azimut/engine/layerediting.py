"""Personal map layers, with editable markers kept outside the case's places.

The layer spec owns the working collection. Its snapshot keeps the original
file, and its icons and derived drawing use the existing map-layer lifecycle.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
import uuid
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from .. import layout
from ..workspace import Case
from . import iconlibrary, layerlinks, maplayers, satellite

EDITABLE = "editable"
# A layer's first group holds lines and areas as well as markers.
DEFAULT_GROUP = "Features"
WORK_FIELDS = ("title", "description", "document", "groups", "hidden", "marker_serial", "line_serial", "area_serial",
               "removed_features", "removed_batch", "track", "mymaps")
SYMBOLS = ("pin", "circle", "star", "flag") + tuple(f"badge-{icon}" for icon in (
    "image", "video", "audio", "user", "building", "car", "plane", "ship", "note", "alert",
    "shield", "flame", "crosshair", "compass", "bookmark", "globe", "phone", "mail", "clock", "flag",
    "radar", "radar-antenna", "telecom-antenna", "power-pylon", "tank", "armoured-vehicle",
    "truck", "pickup", "ambulance", "bomb", "missile", "artillery", "air-defence", "drone",
    "fpv-drone", "helicopter", "fighter", "house", "high-rise", "trench", "bunker", "checkpoint",
    "roadblock", "factory", "fuel-depot", "bridge", "crater", "hospital", "camp", "harbour",
    "railway", "power-station", "explosion", "clash", "casualty", "chemical", "nuclear", "soldier",
    "rocket-launcher", "attack-drone", "warship", "airfield",
))
#: What happened to the thing a marker shows, drawn as a stroke across its badge.
STATUSES = ("damaged", "destroyed")
#: How a layer draws and names the pictograms it holds, `{key: {"mode", "name"}}`
#: (`iconlibrary.MODES`). A key absent here came with an imported map: it is drawn
#: as it is, in its own colours.
ICON_META = "icon_meta"
#: How many addresses one marker cites.
MAX_LINKS = 10
MAX_LINK = 2000
_LINK = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
#: The marker fields an edit may clear by sending nothing for them.
#: How a feature is drawn beyond its colour and icon, each cleared by sending nothing:
#: its line's width and dash, an area's fill and its opacity, an arrow on a line's end,
#: a marker's size, its name on the map and that name's size.
STYLE_FIELDS = ("line_width", "line_dash", "line_arrow", "area_fill", "fill_opacity", "marker_size",
                "label", "label_size")
#: How sure the analyst is of a feature, which a dash says on the map.
CONFIDENCES = ("confirmed", "probable", "claimed")
CLEARABLE = ("date", "status", "bearing", "links", "provenance", "confidence", "credit") + STYLE_FIELDS
#: The group fields a feature inherits when it sets none of its own.
GROUP_STYLE = ("line_dash", "line_arrow", "area_fill", "fill_opacity")
#: What each choice-valued style field may hold.
STYLE_CHOICES: dict[str, tuple[str, ...]] = {
    "line_dash": ("dashed", "dotted"),
    "line_arrow": ("end", "both"),
    "area_fill": ("none", "hatch"),
    "label": ("on", "off"),
}
#: The bounds of each number-valued style field.
STYLE_RANGES: dict[str, tuple[float, float]] = {
    "line_width": (0.5, 12.0),
    "fill_opacity": (0.0, 1.0),
    "marker_size": (0.5, 3.0),
    "label_size": (6.0, 32.0),
}
MAX_CREDIT = 300
#: The case's named colours: "Side A" in one, "Side B" in another. Kept with the
#: case, offered in every layer's palette, read by the legend and the card.
PALETTE_KEY = "layer_palette"
MAX_PALETTE = 12
_HEX = re.compile(r"^#[0-9a-f]{6}$")


def palette(case: Case) -> list[dict[str, str]]:
    try:
        entries = json.loads(case.get_setting(PALETTE_KEY) or "[]")
    except ValueError:
        return []
    return [entry for entry in entries if isinstance(entry, dict)
            and _HEX.match(str(entry.get("colour", ""))) and str(entry.get("name", "")).strip()]


def set_palette(case: Case, entries: list[dict[str, str]]) -> list[dict[str, str]]:
    """Name up to `MAX_PALETTE` colours for the case, one name per colour."""
    kept: list[dict[str, str]] = []
    for entry in entries:
        name = str(entry.get("name", "")).strip()[:40]
        colour = str(entry.get("colour", "")).lower()
        if not name or not _HEX.match(colour):
            raise maplayers.LayerError("each named colour needs a name and a colour")
        if any(other["colour"] == colour or other["name"].casefold() == name.casefold() for other in kept):
            raise maplayers.LayerError("give each colour one name, and each name one colour")
        kept.append({"name": name, "colour": colour})
    if len(kept) > MAX_PALETTE:
        raise maplayers.LayerError(f"a case names at most {MAX_PALETTE} colours")
    case.set_setting(PALETTE_KEY, json.dumps(kept) if kept else None)
    return kept


def editable(spec: dict[str, Any]) -> bool:
    return (spec.get("source") or {}).get("kind") == EDITABLE


def _spec(case: Case, name: str) -> dict[str, Any]:
    spec = maplayers._read_spec(case, name)
    if not editable(spec):
        raise maplayers.LayerError("create an editable copy of this layer first")
    if not isinstance(spec.get("document"), dict):
        raise maplayers.LayerError("this layer's working copy is missing")
    if not isinstance(spec["document"].get("features"), list):
        raise maplayers.LayerError("this layer's working copy is invalid")
    for feature in spec["document"]["features"]:
        # Links were places only, under their own name, before any release.
        properties = feature.get("properties") or {}
        if properties.get("place_id") and not properties.get("entity_id"):
            properties["entity_id"] = properties.pop("place_id")
    _groups(spec)
    if checkpoint := spec.get("edit_checkpoint"):
        # Older checkpoints predate layer details; retain their current values.
        for field in ("title", "description"):
            checkpoint["before"].setdefault(field, spec.get(field, ""))
    return spec


def _groups(spec: dict[str, Any]) -> list[dict[str, Any]]:
    """Give older working copies and imported folders stable group identities."""
    groups: list[dict[str, Any]] = spec.setdefault("groups", [])
    by_name = {group["name"]: group for group in groups}
    by_id = {group["id"]: group for group in groups}
    for feature in spec["document"]["features"]:
        properties = feature["properties"]
        if properties.get("group") in by_id:
            continue
        name = properties.get("category") or DEFAULT_GROUP
        if name not in by_name:
            group = {"id": maplayers.digest(name.encode())[:16], "name": name,
                     "mode": "individual", "colour": "#0072b2", "symbol": "pin",
                     "size": properties.get("icon_scale", 1), "stroke": properties.get("stroke_width", 2)}
            groups.append(group)
            by_name[name] = group
            by_id[group["id"]] = group
        properties["group"] = by_name[name]["id"]
    if not groups:
        groups.append({"id": "markers", "name": DEFAULT_GROUP, "mode": "individual",
                       "colour": "#0072b2", "symbol": "pin"})
    for group in groups:
        group.setdefault("size", 1.0)
        group.setdefault("stroke", 2.0)
    return groups


def _group(spec: dict[str, Any], key: str | None) -> dict[str, Any]:
    groups = _groups(spec)
    if key is None:
        return groups[0]
    for group in groups:
        if group["id"] == key:
            return group
    raise maplayers.LayerError("this group is no longer in the layer")


def adopt_icon(case: Case, layer: str, spec: dict[str, Any], key: str, *, source: str | None = None) -> None:
    """Make sure the layer holds pictogram `key`, copying it in when it does not.

    From `source`, another layer of the case, when a point is copied out of it
    with its own icon; else from the analyst's library. The copy is what the
    case keeps: a bundle opened elsewhere draws it, and the library can lose it
    without a map changing. A pick from the library also brings the way the
    library draws it now, so switching an icon to a disc there and picking it
    again redraws this layer's markers that wear it.
    """
    if not iconlibrary.is_key(key):
        raise maplayers.LayerError("choose an icon from the layer palette")
    meta = spec.setdefault(ICON_META, {})
    held = maplayers.icon_members(case, layer)
    if source and source != layer:
        if key in held:
            return
        try:
            data = maplayers.icon(case, source, key)
        except maplayers.LayerError as exc:
            raise maplayers.LayerError("that layer no longer holds this icon") from exc
        look = (maplayers._read_spec(case, source).get(ICON_META) or {}).get(key) or {}
        meta[key] = {"mode": look.get("mode") if look.get("mode") in iconlibrary.MODES else "image",
                     "name": str(look.get("name") or "")}
    else:
        entry = iconlibrary.entry(key)
        if entry is None:
            if key in held:
                return
            raise maplayers.LayerError("this icon is no longer in your library")
        meta[key] = {"mode": entry["mode"], "name": entry["name"]}
        if key in held:
            return
        try:
            data = iconlibrary.png(key)
        except iconlibrary.IconError as exc:
            raise maplayers.LayerError(str(exc)) from exc
    spec.setdefault("snapshot", {})["icons"] = maplayers.add_icons(case, layer, {key: data})


def _restyle_icon(case: Case, layer: str, spec: dict[str, Any], targets: list[dict[str, Any]],
                  changes: dict[str, Any], *, group: bool = False) -> None:
    """What a pick does to the pictogram markers or a group wear.

    Picking an icon puts it on them, once the layer holds its own copy. Picking
    one of the app's symbols takes it off. A colour leaves it where it is: an
    icon drawn in a disc takes the colour, and one drawn as it is keeps its own,
    which the palette says. Losing a map's own icon to a colour pick was the one
    way a copied map's look went for good.
    """
    source = changes.pop("icon_from", None)
    if "icon" in changes:
        key = changes.pop("icon") or ""
        if key:
            adopt_icon(case, layer, spec, key, source=source)
    elif "symbol" in changes:
        key = ""
    else:
        return
    for target in targets:
        if key:
            target["icon"] = key
        elif group:
            target.pop("icon", None)
        else:
            target["icon"] = ""


def layer_icons(case: Case, name: str) -> list[dict[str, Any]]:
    """The pictograms a layer holds, most worn first, for a palette and for the library.

    Each says its `digest`, the hash of its bytes as stored, which a library
    icon taken from this layer remembers; how it is drawn; a `name`, the one it
    was given or the group that wears it most; and how many features wear it.
    """
    with case.lock:
        spec = maplayers._read_spec(case, name)
        members = maplayers.icon_members(case, name)
        if not members:
            return []
        meta = spec.get(ICON_META) or {}
        if editable(spec):
            features = spec["document"]["features"]
        else:
            features = json.loads(maplayers.drawing(case, name).read_text(encoding="utf-8")).get("features") or []
        worn: dict[str, dict[str, int]] = {}
        for feature in features:
            properties = feature.get("properties") or {}
            if properties.get("icon") in members:
                groups = worn.setdefault(properties["icon"], {})
                category = str(properties.get("category") or "")
                groups[category] = groups.get(category, 0) + 1
        out: list[dict[str, Any]] = []
        for key, data in members.items():
            look = meta.get(key) or {}
            counts = worn.get(key, {})
            commonest = max(counts, key=lambda category: counts[category]) if counts else ""
            out.append({"key": key, "digest": hashlib.sha256(data).hexdigest()[:iconlibrary.KEY_LENGTH],
                        "mode": look.get("mode") if look.get("mode") in iconlibrary.MODES else "image",
                        "name": str(look.get("name") or commonest or ""), "count": sum(counts.values())})
        out.sort(key=lambda icon: (-int(icon["count"]), str(icon["name"]).lower(), str(icon["key"])))
        return out


def icons_to_library(case: Case, name: str, keys: list[str]) -> dict[str, Any]:
    """Put some of a layer's pictograms in the analyst's library, filed under the layer's name."""
    with case.lock:
        spec = maplayers._read_spec(case, name)
        members = maplayers.icon_members(case, name)
        held = {icon["key"]: icon for icon in layer_icons(case, name)}
    title = str(spec.get("title") or name)
    items = [{"png": members[key], "name": held[key]["name"] or f"{title} icon", "group": title,
              "mode": held[key]["mode"], "alias": held[key]["digest"]}
             for key in dict.fromkeys(keys) if key in members]
    if not items:
        raise maplayers.LayerError("this layer holds none of those icons")
    try:
        return iconlibrary.add_pngs(items)
    except iconlibrary.IconError as exc:
        raise maplayers.LayerError(str(exc)) from exc


def drawing(spec: dict[str, Any], case: Case | None = None) -> dict[str, Any]:
    """Rebuild a drawing from the working collection, including an empty one."""
    groups = {group["id"]: group for group in _groups(spec)}
    features = copy.deepcopy(spec["document"]["features"])
    named = {entry["colour"]: entry["name"] for entry in palette(case)} if case else {}
    meta = spec.get(ICON_META) or {}
    if case:
        layerlinks.follow(case, features, rendered=True)
    for feature in features:
        properties = feature["properties"]
        group = groups[properties["group"]]
        properties["category"] = group["name"]
        properties["icon_scale"] = properties.get("marker_size") or group["size"]
        properties["stroke_width"] = properties.get("line_width") or group["stroke"]
        for field in GROUP_STYLE:
            if field not in properties and group.get(field) not in (None, ""):
                properties[field] = group[field]
        if (group.get("labels") and properties.get("label") != "off") or properties.get("label") == "on":
            properties["show_label"] = True
        # an event fades after its day on a tracked layer, where a lasting thing stays
        if group.get("events"):
            properties["event"] = True
        if group["mode"] == "uniform":
            properties.update({"colour": group["colour"], "symbol": group["symbol"], "icon": group.get("icon") or ""})
        if properties.get("icon"):
            look = meta.get(properties["icon"]) or {}
            properties["icon_mode"] = look.get("mode") if look.get("mode") in iconlibrary.MODES else "image"
            if look.get("name"):
                properties["icon_name"] = look["name"]
        if named.get(str(properties.get("colour") or "").lower()):
            properties["colour_name"] = named[str(properties["colour"]).lower()]
    # The first group is on top, for points and shapes alike.
    ranks = {key: index for index, key in enumerate(groups)}
    features.sort(key=lambda feature: -ranks[feature["properties"]["group"]])
    return maplayers._collection(features, title=spec["title"], fmt="geojson")


def _work(spec: dict[str, Any]) -> dict[str, Any]:
    return {field: copy.deepcopy(spec.get(field, "")) for field in WORK_FIELDS
            if field in spec or field == "description"}


def _revision(spec: dict[str, Any]) -> str:
    return maplayers.digest(json.dumps(_work(spec), sort_keys=True).encode())


def _row(case: Case, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    row = maplayers.row(name, spec, case=case)
    checkpoint = spec.get("edit_checkpoint")
    row.update(edit_revision=_revision(spec), edit_changed=bool(checkpoint
               and checkpoint["before"] != _work(spec)))
    return row


def begin_edit(case: Case, name: str) -> dict[str, Any]:
    """Keep one trusted checkpoint in the owned spec, including across restarts."""
    with case.lock:
        spec = _spec(case, name)
        if not spec.get("edit_checkpoint"):
            spec["edit_checkpoint"] = {"id": uuid.uuid4().hex, "before": _work(spec)}
            maplayers._write_spec(case, name, spec)
        return read(case, name)


def end_edit(case: Case, name: str, token: str, revision: str, *, discard: bool) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, name)
        title = spec["title"]
        checkpoint = spec.get("edit_checkpoint")
        if not checkpoint or checkpoint["id"] != token:
            raise maplayers.LayerError("this editing session is no longer available")
        if revision != _revision(spec):
            raise maplayers.LayerError("this layer changed elsewhere; reopen it before leaving")
        if discard:
            for field in WORK_FIELDS:
                spec.pop(field, None)
            spec.update(checkpoint["before"])
        spec.pop("edit_checkpoint", None)
        _save(case, name, spec)
        if spec["title"] != title:
            _sync_title(case, name, spec["title"])
        return read(case, name)


def digest(spec: dict[str, Any]) -> str:
    data = json.dumps({"document": spec["document"], "groups": _groups(spec)},
                      ensure_ascii=False, sort_keys=True).encode()
    return maplayers.digest(data)


def render_digest(case: Case, spec: dict[str, Any]) -> str:
    """Redraw when a linked entity moves, goes to the Trash or comes back, or an icon is drawn another way."""
    links = layerlinks.digest_part(case, spec["document"]["features"])
    # a layer with no icon looks keeps the fingerprint it had, so its cache is not rebuilt for nothing
    looks = json.dumps([links, palette(case)]) + (json.dumps(spec[ICON_META], sort_keys=True) if spec.get(ICON_META) else "")
    return maplayers.digest((digest(spec) + looks).encode())


def _save(case: Case, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    # The stored point of a linked marker is its last answer, kept current.
    layerlinks.follow(case, spec["document"]["features"], rendered=False)
    parsed = drawing(spec)
    # Group styles are a presentation override; individual styles stay recoverable.
    spec["document"] = maplayers._collection(spec["document"]["features"],
                                            title=spec["title"], fmt="geojson")["geojson"]
    spec["content_sha256"] = digest(spec)
    spec["summary"] = parsed["summary"]
    # A group drawn in one pictogram shows it in the legend, not only its colour.
    uniform = {group["name"]: group for group in _groups(spec) if group["mode"] == "uniform"}
    for entry in spec["summary"]["categories"]:
        if entry["name"] in uniform:
            group = uniform[entry["name"]]
            entry.update(symbol=group["symbol"], colour=group["colour"])
            if group.get("icon"):
                look = (spec.get(ICON_META) or {}).get(group["icon"]) or {}
                entry.update(icon=group["icon"], icon_mode=look.get("mode") or "image")
    # How many features wear each colour, which the legend names from the case palette.
    colours: dict[str, int] = {}
    for feature in parsed["geojson"]["features"]:
        colour = str(feature["properties"].get("colour") or "").lower()
        if colour:
            colours[colour] = colours.get(colour, 0) + 1
    spec["summary"]["colours"] = colours
    live = {group["name"] for group in _groups(spec)}
    spec["hidden"] = [group for group in spec.get("hidden", []) if group in live]
    spec["updated_at"] = maplayers._now()
    # The spec is authoritative; a missing or stale cache is rebuilt on read.
    maplayers._write_spec(case, name, spec)
    return _row(case, name, spec)


def _sync_title(case: Case, name: str, title: str) -> None:
    entity = case.find_entity(attr="spec", value=layout.layer_spec_rel(name))
    if entity and entity["label"] != title:
        case.update_entity(entity["id"], {"label": title})


def _create(
    case: Case,
    *,
    title: str,
    features: list[dict[str, Any]],
    original: bytes,
    origin: dict[str, Any] | None = None,
    images: dict[str, bytes] | None = None,
    description: str = "",
) -> dict[str, Any]:
    title = title.strip() or "My layer"
    features = copy.deepcopy(features)
    for feature in features:
        properties = feature["properties"]
        properties.pop("place_id", None)
        properties.pop("entity_id", None)
        properties.pop("synced", None)
        properties["key"] = uuid.uuid4().hex
    parsed = maplayers._collection(features, title=title, fmt="geojson")
    with case.lock:
        name = maplayers._free_name(case, title)
        now = maplayers._now()
        spec: dict[str, Any] = {
            "azimut_layer": maplayers.SPEC_VERSION,
            "title": title,
            "description": description.strip(),
            "source": {"kind": EDITABLE, "name": "working.geojson", "format": "geojson"},
            "origin": origin,
            "document": parsed["geojson"],
            "hidden": [],
            "source_icons": False,
            "created_at": now,
            "updated_at": now,
            "summary": parsed["summary"],
            "snapshot": maplayers._store(case, name, original, parsed, images or {}),
        }
        spec["content_sha256"] = digest(spec)
        maplayers._write_spec(case, name, spec)
        maplayers._file_entity(case, name, spec)
    return maplayers.row(name, spec, case=case)


def create(case: Case, title: str, description: str = "") -> dict[str, Any]:
    original = b'{"type":"FeatureCollection","features":[]}'
    return _create(case, title=title, description=description, features=[], original=original)


def from_file(case: Case, data: bytes, filename: str, title: str = "", description: str = "") -> dict[str, Any]:
    """Import a working copy without fetching external icons."""
    parsed = maplayers.parse(data, filename=filename, title=title)
    images = maplayers._pictograms(parsed, data, icons=True, web=False)
    origin = {
        "source": {"kind": "file", "name": filename, "format": parsed["summary"]["format"]},
        "sha256": maplayers.digest(data),
        "copied_at": maplayers._now(),
    }
    return _create(case, title=title or parsed["summary"]["title"], description=description,
                   features=parsed["geojson"]["features"], original=data,
                   origin=origin, images=images)


def from_my_maps(case: Case, url: str, title: str = "", description: str = "") -> dict[str, Any]:
    """Import a working copy of a My Maps, read once from its link.

    The link only serves this import: the layer keeps no feed and is never
    refreshed. Its web pictograms are fetched now, with the map itself.
    """
    address = str(url or "").strip()
    if not maplayers.my_maps_mid(address):
        raise maplayers.LayerError("this is not a Google My Maps link")
    data, filename = maplayers.fetch(address)
    parsed = maplayers.parse(data, filename=filename, title=title)
    images = maplayers._pictograms(parsed, data, icons=True)
    origin = {
        "source": {"kind": "my_maps", "name": parsed["summary"]["title"], "url": address,
                   "format": parsed["summary"]["format"]},
        "sha256": maplayers.digest(data),
        "copied_at": maplayers._now(),
    }
    return _create(case, title=title or parsed["summary"]["title"], description=description,
                   features=parsed["geojson"]["features"], original=data,
                   origin=origin, images=images)


def copy_layer(case: Case, name: str, title: str = "", description: str = "") -> dict[str, Any]:
    """Copy the saved source and pictograms locally; never refresh its feed."""
    with case.lock:
        source = maplayers._read_spec(case, name)
        path = maplayers.drawing(case, name)
        collection = json.loads(path.read_text(encoding="utf-8"))
        try:
            original = case.resolve_inside(layout.layer_snapshot_rel(name)).read_bytes()
        except OSError as exc:
            raise maplayers.LayerError("this layer's saved source is missing") from exc
        images = {}
        for key in {f["properties"].get("icon") for f in collection["features"]} - {"", None}:
            try:
                images[key] = maplayers.icon(case, name, key)
            except maplayers.LayerError:
                continue
        origin = copy.deepcopy(source.get("origin")) if editable(source) else {
            "source": copy.deepcopy(source["source"]),
            "sha256": source["snapshot"]["sha256"],
            "copied_at": maplayers._now(),
        }
        return _create(case, title=title or f'{source["title"]} copy', description=description,
                       features=collection["features"], original=original,
                       origin=origin, images=images)


def read(case: Case, name: str) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, name)
        document = copy.deepcopy(spec["document"])
        # An entity in the Trash does not turn a layer marker into a dead link.
        layerlinks.follow(case, document["features"], rendered=True)
        return {"layer": _row(case, name, spec), "document": document,
                "groups": copy.deepcopy(_groups(spec)),
                "icons": copy.deepcopy(spec.get(ICON_META) or {}),
                "checkpoint": (spec.get("edit_checkpoint") or {}).get("id")}


def apply_fields(properties: dict[str, Any], changes: dict[str, Any]) -> None:
    """Check and set what a feature says beyond its name and style.

    Each field is absent rather than empty when unset, and an edit clears one by
    sending nothing for it: `date` is a day, `status` one of `STATUSES`, `bearing`
    degrees from north, `links` the addresses it rests on, and `provenance` says
    "external" for a point somebody else geolocated.
    """
    if "date" in changes:
        day = maplayers.iso_day(changes["date"] or "")
        if changes["date"] and not day:
            raise maplayers.LayerError("write the date as a day, YYYY-MM-DD")
        if day:
            properties["date"] = day
            if str(properties.get("date_end") or "") <= day:
                properties.pop("date_end", None)
        else:
            properties.pop("date", None)
            properties.pop("date_end", None)
    if "status" in changes:
        status = changes["status"] or ""
        if status and status not in STATUSES:
            raise maplayers.LayerError("a status is damaged or destroyed")
        if status:
            properties["status"] = status
        else:
            properties.pop("status", None)
    if "bearing" in changes:
        bearing = changes["bearing"]
        if bearing is None or bearing == "":
            properties.pop("bearing", None)
        else:
            try:
                value = float(bearing)
            except (TypeError, ValueError) as exc:
                raise maplayers.LayerError("a direction is degrees from north") from exc
            if not math.isfinite(value):
                raise maplayers.LayerError("a direction is degrees from north")
            properties["bearing"] = round(value % 360, 1)
    if "links" in changes:
        links: list[str] = []
        for link in changes["links"] or []:
            text = str(link).strip()
            if not text or text in links:
                continue
            if len(text) > MAX_LINK or not _LINK.match(text):
                raise maplayers.LayerError("a link is a web address starting with http")
            links.append(text)
        if len(links) > MAX_LINKS:
            raise maplayers.LayerError(f"a marker cites at most {MAX_LINKS} links")
        if links:
            properties["links"] = links
        else:
            properties.pop("links", None)
    if "provenance" in changes:
        provenance = changes["provenance"] or ""
        if provenance not in ("", "external"):
            raise maplayers.LayerError("a point is either yours or external")
        if provenance:
            properties["provenance"] = provenance
        else:
            properties.pop("provenance", None)
    if "confidence" in changes:
        confidence = changes["confidence"] or ""
        if confidence and confidence not in CONFIDENCES:
            raise maplayers.LayerError("a feature is confirmed, probable or claimed")
        if confidence:
            properties["confidence"] = confidence
        else:
            properties.pop("confidence", None)
    if "credit" in changes:
        credit = maplayers._text(changes["credit"] or "", MAX_CREDIT)
        if credit:
            properties["credit"] = credit
        else:
            properties.pop("credit", None)
    apply_style(properties, changes)


def apply_style(target: dict[str, Any], changes: dict[str, Any]) -> None:
    """Check and set how a feature, or a group, is drawn (`STYLE_FIELDS`)."""
    for field, choices in STYLE_CHOICES.items():
        if field not in changes:
            continue
        value = changes[field] or ""
        if value and value not in choices:
            raise maplayers.LayerError(f"{field.replace('_', ' ')} is one of {', '.join(choices)}")
        if value:
            target[field] = value
        else:
            target.pop(field, None)
    for field, (low, high) in STYLE_RANGES.items():
        if field not in changes:
            continue
        value = changes[field]
        if value is None or value == "":
            target.pop(field, None)
            continue
        try:
            number = float(value)
        except (TypeError, ValueError) as exc:
            raise maplayers.LayerError(f"{field.replace('_', ' ')} is a number") from exc
        if not math.isfinite(number) or not low <= number <= high:
            raise maplayers.LayerError(f"{field.replace('_', ' ')} is between {low:g} and {high:g}")
        target[field] = round(number, 2)


# -- a layer followed over time ------------------------------------------------------
#
# A tracked layer keeps what each feature was at each moment instead of only what
# it is now. A feature's `states` are `{at, geometry, status?}` or `{at, gone}`,
# sorted by `at`; the feature's own geometry, status and days mirror them, so
# everything that reads a layer without asking about time (the exports, Compare,
# Detect, the hit tests) reads its latest shape. A feature with no states is what
# it always was: there from its day, or always when it has none.
#
# `at` is the moment on the layer's own clock: a day, `YYYY-MM-DD`, or a day and a
# time, `YYYY-MM-DDTHH:MM`, and "" for "since always". One zone per layer means
# these sort as plain strings, and a day sorts before every time of that day,
# which is the rule: a state dated to a day holds from that day's start.

#: How finely a tracked layer dates its states.
PRECISIONS = ("day", "time")
#: The most days an event can be kept on the map after its own; with no window it stays.
MAX_WINDOW = 365
#: The states one feature keeps.
MAX_STATES = 500
_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$")
_KEEP = object()


def track(spec: dict[str, Any]) -> dict[str, Any] | None:
    """The layer's time settings while it is followed over time, else None."""
    settings = spec.get("track")
    return settings if isinstance(settings, dict) and settings.get("on") else None


def zone_of(name: str) -> str:
    """A clock a layer can be read on: UTC, or an IANA zone this machine knows."""
    text = str(name or "").strip() or "UTC"
    if text == "UTC":
        return text
    try:
        ZoneInfo(text)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise maplayers.LayerError("choose a time zone from the list") from exc
    return text


def set_track(spec: dict[str, Any], changes: dict[str, Any]) -> None:
    """Switch time tracking on or off, or change its precision, its clock, or how
    many days its events stay on the map after their own ("always" for good, which
    is also what a layer that never said reads as).

    Off hides the history and never deletes it: switched back on, every state is
    where it was.
    """
    settings = dict(spec.get("track") or {"on": False, "precision": "day", "zone": "UTC"})
    if "on" in changes:
        settings["on"] = bool(changes["on"])
    if "precision" in changes:
        if changes["precision"] not in PRECISIONS:
            raise maplayers.LayerError("date states by the day, or by the day and the time")
        settings["precision"] = changes["precision"]
    if "zone" in changes:
        settings["zone"] = zone_of(changes["zone"])
    if "window" in changes:
        window = changes["window"]
        if window == "always":
            settings.pop("window", None)
        elif isinstance(window, int) and not isinstance(window, bool) and 0 <= window <= MAX_WINDOW:
            settings["window"] = window
        else:
            raise maplayers.LayerError(f"keep events for good, or 0 to {MAX_WINDOW} days")
    spec["track"] = settings


def instant(value: Any) -> str:
    """A moment on the layer's clock, checked: a day, a day and a time, or ""."""
    text = str(value or "").strip()
    if not text:
        return ""
    if not _INSTANT.match(text):
        raise maplayers.LayerError("write the moment as YYYY-MM-DD, or YYYY-MM-DDTHH:MM")
    try:
        datetime.fromisoformat(text)
    except ValueError as exc:
        raise maplayers.LayerError("this day does not exist") from exc
    return text


def _seeded(feature: dict[str, Any]) -> list[dict[str, Any]]:
    """The feature's states, or the one it implies before it has any."""
    properties = feature["properties"]
    states = properties.get("states")
    if isinstance(states, list) and states:
        return states
    seed: dict[str, Any] = {"at": str(properties.get("date") or ""), "geometry": copy.deepcopy(feature["geometry"])}
    if properties.get("status"):
        seed["status"] = properties["status"]
    return [seed]


def in_force(states: list[dict[str, Any]], at: str) -> dict[str, Any] | None:
    """The state a feature is in at `at`: the last one written at or before it."""
    found = None
    for state in states:
        if state["at"] > at:
            break
        found = state
    return found


def _live_before(states: list[dict[str, Any]], at: str) -> dict[str, Any]:
    """The last state at or before `at` the feature was there in, or its first."""
    live = [state for state in states if state["at"] <= at and not state.get("gone")]
    return live[-1] if live else next(state for state in states if not state.get("gone"))


def latest(feature: dict[str, Any]) -> str:
    """The moment of the state a feature is drawn in now."""
    states = _seeded(feature)
    return [state for state in states if not state.get("gone")][-1]["at"]


def _mirror(feature: dict[str, Any]) -> None:
    """What the rest of the app reads off a tracked feature: its latest shape and status, and its days."""
    properties = feature["properties"]
    states = properties["states"]
    live = [state for state in states if not state.get("gone")]
    feature["geometry"] = copy.deepcopy(live[-1]["geometry"])
    if live[-1].get("status"):
        properties["status"] = live[-1]["status"]
    else:
        properties.pop("status", None)
    if states[0]["at"]:
        properties["date"] = states[0]["at"][:10]
    else:
        properties.pop("date", None)
    if states[-1].get("gone"):
        properties.pop("end_unknown", None)
    if states[-1].get("gone") and states[-1]["at"][:10] > str(properties.get("date") or ""):
        properties["date_end"] = states[-1]["at"][:10]
    else:
        properties.pop("date_end", None)


def write_state(feature: dict[str, Any], at: str, *, geometry: dict[str, Any] | None = None,
                status: Any = _KEEP, gone: bool = False) -> None:
    """Say what a feature was from `at` on: a new state there, or the one already there rewritten.

    A new state starts as the one in force before it, so moving a line on the
    12th keeps its status, and marking a building destroyed on the 20th keeps
    its outline.
    """
    properties = feature["properties"]
    states = _seeded(feature)
    at = instant(at)
    existing = next((state for state in states if state["at"] == at), None)
    if gone:
        if existing is states[0] or at < states[0]["at"]:
            raise maplayers.LayerError("a feature can only be gone after it first appears")
        target: dict[str, Any] = existing if existing is not None else {"at": at}
        target.clear()
        target.update({"at": at, "gone": True})
    else:
        base = _live_before(states, at)
        target = existing if existing is not None else {"at": at}
        if target.get("gone") or "geometry" not in target:
            target.pop("gone", None)
            target["geometry"] = copy.deepcopy(base["geometry"])
            if base.get("status"):
                target["status"] = base["status"]
        if geometry is not None:
            target["geometry"] = copy.deepcopy(geometry)
        if status is not _KEEP:
            if status:
                target["status"] = status
            else:
                target.pop("status", None)
    if existing is None:
        if len(states) >= MAX_STATES:
            raise maplayers.LayerError(f"a feature keeps at most {MAX_STATES} states")
        states.append(target)
        states.sort(key=lambda state: state["at"])
    properties["states"] = states
    _mirror(feature)


def drop_state(feature: dict[str, Any], at: str) -> None:
    """Take one state out of a feature's history; its last one goes with the feature only."""
    properties = feature["properties"]
    states = [state for state in properties.get("states") or [] if state["at"] != at]
    if len(states) == len(properties.get("states") or []):
        raise maplayers.LayerError("this state is no longer in the feature's history")
    if not states:
        raise maplayers.LayerError("a feature keeps at least one state; remove the feature instead")
    if states[0].get("gone"):
        raise maplayers.LayerError("a feature can only be gone after it first appears")
    properties["states"] = states
    _mirror(feature)
    _plain_again(feature)


def _plain_again(feature: dict[str, Any]) -> None:
    """One state dated to a day, or always, is a plain feature again."""
    states = feature["properties"].get("states") or []
    if len(states) == 1 and "T" not in states[0]["at"]:
        feature["properties"].pop("states")


_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _said(at: str) -> str:
    """A moment as a sentence names it: `12 Oct 2026`, or `12 Oct 2026, 14:00`."""
    day = datetime.fromisoformat(at[:10])
    text = f"{day.day} {_MONTHS[day.month - 1]} {day.year}"
    return f"{text}, {at[11:]}" if "T" in at else text


def set_start(feature: dict[str, Any], at: str) -> None:
    """Say when a feature first shows: "" for always, else a moment before its next change.

    A plain feature's start is its day. One started at a time of day, or one with
    a history, has its first state moved.
    """
    properties = feature["properties"]
    at = instant(at)
    if not properties.get("states") and "T" not in at:
        if at:
            properties["date"] = at
            if str(properties.get("date_end") or "") <= at:
                properties.pop("date_end", None)
        else:
            properties.pop("date", None)
        return
    states = _seeded(feature)
    if not properties.get("states") and properties.get("date_end"):
        # a plain feature's end is its last day; a history says it is gone the day after
        last = datetime.fromisoformat(properties["date_end"]).toordinal() + 1
        states.append({"at": datetime.fromordinal(last).date().isoformat(), "gone": True})
    if len(states) > 1 and at >= states[1]["at"]:
        raise maplayers.LayerError(f"start it before {_said(states[1]['at'])}")
    states[0]["at"] = at
    properties["states"] = states
    _mirror(feature)
    _plain_again(feature)


def set_end(feature: dict[str, Any], at: str) -> None:
    """Say when a feature leaves the map: "" for still there, else a moment after its last change."""
    properties = feature["properties"]
    at = instant(at)
    properties.pop("end_unknown", None)
    states = properties.get("states") or []
    ended = bool(states) and bool(states[-1].get("gone"))
    if not at:
        if ended:
            drop_state(feature, states[-1]["at"])
        properties.pop("date_end", None)
        return
    last = [state for state in _seeded(feature) if not state.get("gone")][-1]["at"]
    if at <= last:
        raise maplayers.LayerError(f"end it after {_said(last)}")
    if ended:
        states.pop()
    properties.pop("date_end", None)
    write_state(feature, at, gone=True)


def set_end_unknown(feature: dict[str, Any]) -> None:
    """Say nobody knows when a feature left the map. It has no end, so it is drawn
    as one still there, and says its end is unknown rather than claiming it."""
    set_end(feature, "")
    feature["properties"]["end_unknown"] = True


def as_of(feature: dict[str, Any], at: str) -> dict[str, Any] | None:
    """The feature as it stood at `at`, or None when it was not there.

    A feature with no history is there from its day through its last one, and
    always when it states none.
    """
    properties = feature["properties"]
    states = properties.get("states")
    if not states:
        start, end = str(properties.get("date") or ""), str(properties.get("date_end") or "")
        if (start and start > at) or (end and end < at[:10]):
            return None
        return feature
    state = in_force(states, at)
    if state is None or state.get("gone"):
        return None
    answer = {**feature, "geometry": copy.deepcopy(state["geometry"]),
              "properties": {key: value for key, value in properties.items() if key not in ("states", "status")}}
    if state.get("status"):
        answer["properties"]["status"] = state["status"]
    return answer


def _timed(spec: dict[str, Any], feature: dict[str, Any], at: str | None) -> str | None:
    """The moment an edit to this feature is written at, or None for an edit with no date.

    With no date, a feature with a history on a tracked layer changes on every day
    it has (`_undated`); on a layer no longer tracked an edit corrects its latest
    state, the history kept as it was.
    """
    if at is not None:
        if not track(spec):
            raise maplayers.LayerError("switch “Track over time” on to date an edit")
        return instant(at)
    if feature["properties"].get("states") and not track(spec):
        return latest(feature)
    return None


def _undated(feature: dict[str, Any], *, geometry: dict[str, Any] | None = None, status: Any = _KEEP) -> None:
    """Change a feature with a history on every day it has.

    Only what never changed by date can be: a shape that moved on a day is moved
    from a day, and a status that changed on one is set from a day.
    """
    properties = feature["properties"]
    live = [state for state in properties["states"] if not state.get("gone")]
    name = properties.get("name") or "this feature"
    if geometry is not None:
        moved = next((state for state in live[1:] if state["geometry"] != live[0]["geometry"]), None)
        if moved is not None:
            raise maplayers.LayerError(f"“{name}” moves on {_said(moved['at'])}: pick a day on the bar to move it")
        for state in live:
            state["geometry"] = copy.deepcopy(geometry)
    if status is not _KEEP:
        changed = next((state for state in live[1:] if state.get("status", "") != live[0].get("status", "")), None)
        if changed is not None:
            raise maplayers.LayerError(f"“{name}” changes status on {_said(changed['at'])}: pick a day on the bar to set it")
        for state in live:
            if status:
                state["status"] = status
            else:
                state.pop("status", None)
    _mirror(feature)


def _time_fields(feature: dict[str, Any]) -> dict[str, Any]:
    """What an undo puts back of a feature's history."""
    properties = feature["properties"]
    return {field: copy.deepcopy(properties[field]) for field in ("states", "date", "date_end", "status", "end_unknown")
            if field in properties}


def _born(spec: dict[str, Any], feature: dict[str, Any], at: str | None) -> None:
    """A feature added while a tracked layer is read at a moment appears at that moment."""
    moment = _timed(spec, feature, at) if at else None
    if not moment:
        return
    state: dict[str, Any] = {"at": moment, "geometry": copy.deepcopy(feature["geometry"])}
    if feature["properties"].get("status"):
        state["status"] = feature["properties"]["status"]
    feature["properties"]["states"] = [state]
    _mirror(feature)


_MYMAPS = re.compile(r"^https://(www\.)?google\.[a-z.]+/maps/d/[^\s]*$", re.IGNORECASE)


def mymaps_address(value: Any) -> str:
    """The My Maps a layer is sent to, as its editor's address, or "" for none."""
    text = str(value or "").strip()
    if text and (len(text) > MAX_LINK or not _MYMAPS.match(text)):
        raise maplayers.LayerError("paste the address of a My Maps, starting with https://www.google.com/maps/d/")
    return text


def _refuse_history(features: list[dict[str, Any]], act: str) -> None:
    if any(feature["properties"].get("states") for feature in features):
        raise maplayers.LayerError(f"{act} works on features with no history yet")


def add_marker(
    case: Case, layer: str, *, lat: float, lon: float, name: str,
    colour: str, symbol: str, description: str = "",
    group: str | None = None, at: str | None = None, icon: str = "", icon_from: str | None = None,
    **fields: Any,
) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        if icon:
            adopt_icon(case, layer, spec, icon, source=icon_from)
        spec["hidden"] = [name for name in spec.get("hidden", []) if name != target["name"]]
        features = spec["document"]["features"]
        if len(features) >= maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        key = uuid.uuid4().hex
        numbered = [label[7:] for f in features
                    if (label := str(f["properties"].get("name", ""))).startswith("Marker ")]
        sequence = max([int(spec.get("marker_serial", len(features))),
                        *(int(value) for value in numbered if value.isdecimal())]) + 1
        spec["marker_serial"] = sequence
        properties = maplayers._properties(
            name=name.strip() or f"Marker {sequence}", description=description,
            category=target["name"], colour=colour,
        )
        properties.update({"key": key, "symbol": symbol, "group": target["id"], "icon": icon})
        apply_fields(properties, fields)
        marker = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                  "properties": properties}
        _born(spec, marker, at)
        features.append(marker)
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker, "groups": _groups(spec), "icons": spec.get(ICON_META) or {}}


def _marker(spec: dict[str, Any], key: str) -> dict[str, Any]:
    for feature in spec["document"]["features"]:
        if feature["properties"].get("key") == key:
            return dict(feature)
    raise maplayers.LayerError("this marker is no longer in the layer")


def update_marker(case: Case, layer: str, key: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Change one feature. On a tracked layer `at` dates the change of shape or
    status, and `drop_state` takes the state at `at` out of its history.
    `start` and `end` say when it first shows and when it leaves the map, ""
    for always and still there; `end_unknown` says nobody knows when it left.

    With no `at`, a feature with a history changes on every day it has, which
    only what never changed by date can (`_undated`); on a layer no longer
    tracked its latest state is corrected.
    """
    with case.lock:
        spec = _spec(case, layer)
        # an unlinked marker keeps the point its case item stands on now
        layerlinks.follow(case, spec["document"]["features"], rendered=False)
        _marker(spec, key)
        stored = next(f for f in spec["document"]["features"] if f["properties"]["key"] == key)
        properties = stored["properties"]
        changes = dict(changes)
        start, end = changes.pop("start", None), changes.pop("end", None)
        unknown = bool(changes.pop("end_unknown", None))
        if (start is not None or end is not None or unknown) and not track(spec):
            raise maplayers.LayerError("switch “Track over time” on to say when it shows")
        moment = _timed(spec, stored, changes.pop("at", None))
        drop = bool(changes.pop("drop_state", False))
        _restyle_icon(case, layer, spec, [properties], changes)
        if moment is not None and properties.get("states") and "date" in changes:
            raise maplayers.LayerError("this feature's days are its history; change them there")
        shape = None
        for field, value in changes.items():
            if field == "name":
                properties[field] = maplayers._text(value, maplayers.MAX_NAME)
            elif field == "description":
                properties[field] = maplayers._rich_text(value, maplayers.MAX_DESCRIPTION)
            elif field in ("colour", "symbol"):
                properties[field] = value
            elif field == "group":
                target = _group(spec, value)
                properties.update({"group": target["id"], "category": target["name"]})
            elif field == "geometry":
                if properties.get("entity_id"):
                    raise maplayers.LayerError("this marker follows the item it was added from; unlink it to move it")
                geometry = validate_geometry(value)
                if geometry["type"] != stored["geometry"]["type"]:
                    raise maplayers.LayerError("keep the feature's geometry type")
                if moment is None and not properties.get("states"):
                    stored["geometry"] = geometry
                else:
                    shape = geometry
            elif field == "unlink" and value:
                properties.pop("entity_id", None)
        fields = {field: value for field, value in changes.items() if field in CLEARABLE}
        # A tracked feature's status is part of what it was at a moment.
        status: Any = _KEEP
        if (moment is not None or properties.get("states")) and "status" in fields:
            status = fields.pop("status") or ""
        if status is not _KEEP and status not in ("", *STATUSES):
            raise maplayers.LayerError("a status is damaged or destroyed")
        apply_fields(properties, fields)
        if moment is not None and drop:
            drop_state(stored, moment)
        elif moment is not None and (shape is not None or status is not _KEEP):
            write_state(stored, moment, geometry=shape, status=status)
        elif drop:
            raise maplayers.LayerError("date the change on a layer tracked over time")
        elif shape is not None or status is not _KEEP:
            _undated(stored, geometry=shape, status=status)
        if start is not None:
            set_start(stored, start)
        if end is not None:
            set_end(stored, end)
        if unknown:
            set_end_unknown(stored)
        row = _save(case, layer, spec)
        return {"layer": row, "marker": copy.deepcopy(stored), "groups": _groups(spec),
                "icons": spec.get(ICON_META) or {}}


def promote(case: Case, layer: str, key: str) -> dict[str, Any]:
    """Explicitly save one point as a case place, reusing one already there."""
    with case.lock:
        spec = _spec(case, layer)
        marker = _marker(spec, key)
        if marker["geometry"]["type"] != "Point":
            raise maplayers.LayerError("only a point can be saved as a case place")
        try:
            lon, lat = (float(value) for value in marker["geometry"]["coordinates"][:2])
        except (TypeError, ValueError) as exc:
            raise maplayers.LayerError("this point has invalid coordinates") from exc
        if not (math.isfinite(lon) and math.isfinite(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
            raise maplayers.LayerError("this point has invalid coordinates")
        properties = marker["properties"]
        place = case.get_entity(properties["entity_id"]) if properties.get("entity_id") else None
        if place is None or place["type"] != "place":
            place = satellite.place_at(case, lat, lon, keyed_only=False)
        if place is None:
            extra = {"layer_origin": {"spec": layout.layer_spec_rel(layer), "feature": key,
                                      "origin": spec.get("origin")},
                     "notes": properties.get("description", "")}
            place = satellite.save_place(case, lat, lon, title=properties.get("name"),
                                         by="map-layers", extra_attrs=extra)
        properties["entity_id"] = place["id"]
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker, "place": place}


def add_group(case: Case, layer: str, name: str) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        groups = _groups(spec)
        if len(groups) >= 2000:
            raise maplayers.LayerError("this layer has reached its group limit")
        name = name.strip()
        if not name or any(group["name"] == name for group in groups):
            raise maplayers.LayerError("choose a different group name")
        group = {"id": uuid.uuid4().hex, "name": name, "mode": "uniform",
                 "colour": "#0072b2", "symbol": "pin"}
        groups.append(group)
        _save(case, layer, spec)
        return {**read(case, layer), "group": group}


def update_group(case: Case, layer: str, key: str, changes: dict[str, Any]) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        group = _group(spec, key)
        if "name" in changes:
            name = changes["name"].strip()
            if not name or any(g["id"] != key and g["name"] == name for g in _groups(spec)):
                raise maplayers.LayerError("choose a different group name")
            old = group["name"]
            group["name"] = name
            spec["hidden"] = [name if item == old else item for item in spec.get("hidden", [])]
        for field in ("mode", "colour", "symbol", "size", "stroke"):
            if field in changes:
                group[field] = changes[field]
        _restyle_icon(case, layer, spec, [group], changes, group=True)
        apply_style(group, {field: changes[field] for field in GROUP_STYLE if field in changes})
        if "labels" in changes:
            if changes["labels"]:
                group["labels"] = True
            else:
                group.pop("labels", None)
        if "events" in changes:
            if changes["events"]:
                group["events"] = True
            else:
                group.pop("events", None)
        _save(case, layer, spec)
        return read(case, layer)


def update_details(case: Case, layer: str, changes: dict[str, Any]) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        before = spec["title"]
        if "title" in changes:
            title = changes["title"].strip()
            if not title:
                raise maplayers.LayerError("enter a layer name")
            spec["title"] = title
        if "description" in changes:
            spec["description"] = changes["description"].strip()
        if isinstance(changes.get("track"), dict):
            set_track(spec, changes["track"])
        if "mymaps" in changes:
            spec["mymaps"] = mymaps_address(changes["mymaps"])
            if not spec["mymaps"]:
                spec.pop("mymaps")
        _save(case, layer, spec)
        if spec["title"] != before:
            _sync_title(case, layer, spec["title"])
        return read(case, layer)


def reorder_features(case: Case, layer: str, keys: list[str], group: str,
                     before: str | None = None) -> dict[str, Any]:
    """Move a visual-order block into a group without changing its geometry."""
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        by_group: dict[str, list[dict[str, Any]]] = {item["id"]: [] for item in _groups(spec)}
        for feature in reversed(spec["document"]["features"]):
            by_group[feature["properties"]["group"]].append(feature)
        ordered = [feature for item in _groups(spec) for feature in by_group[item["id"]]]
        indexed = {feature["properties"]["key"]: feature for feature in ordered}
        moving = set(keys)
        if not moving or len(moving) != len(keys) or not moving <= indexed.keys():
            raise maplayers.LayerError("choose existing features exactly once")
        remaining = [feature for feature in ordered if feature["properties"]["group"] == group
                     and feature["properties"]["key"] not in moving]
        if before is not None and before not in {feature["properties"]["key"] for feature in remaining}:
            raise maplayers.LayerError("the drop position is no longer in this group")
        block = [feature for feature in ordered if feature["properties"]["key"] in moving]
        at = next((index for index, feature in enumerate(remaining)
                   if feature["properties"]["key"] == before), len(remaining))
        for feature in block:
            feature["properties"].update(group=group, category=target["name"])
        by_group = {item["id"]: [] for item in _groups(spec)}
        for feature in ordered:
            if feature["properties"]["key"] not in moving:
                by_group[feature["properties"]["group"]].append(feature)
        by_group[group] = remaining[:at] + block + remaining[at:]
        spec["document"]["features"] = [feature for item in reversed(_groups(spec))
                                        for feature in reversed(by_group[item["id"]])]
        _save(case, layer, spec)
        return read(case, layer)


def reorder_groups(case: Case, layer: str, ids: list[str]) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        groups = {group["id"]: group for group in _groups(spec)}
        if len(ids) != len(groups) or set(ids) != set(groups):
            raise maplayers.LayerError("include every group exactly once")
        spec["groups"] = [groups[key] for key in ids]
        _save(case, layer, spec)
        return read(case, layer)


def _undo(spec: dict[str, Any], *, removed: list[dict[str, Any]] | None = None,
          added: list[str] | None = None, before: list[dict[str, Any]] | None = None) -> str:
    """Keep what one edit to several features takes back, for its Undo.

    One slot per layer: the toast that offers the undo is the only door to it,
    and it closes long before a second edit would need its own. `removed` are
    the features taken out, with their index; `added` the keys an edit made;
    `before` the geometries it changed.
    """
    batch = {"id": uuid.uuid4().hex, "items": removed or [], "added": added or [],
             "geometry": before or []}
    spec["removed_batch"] = batch
    return str(batch["id"])


def edit_selection(case: Case, layer: str, keys: list[str], *, changes: dict[str, Any],
                   offset: list[float] | None, remove: bool, at: str | None = None) -> dict[str, Any]:
    """Apply one atomic edit to selected features, without touching case entities.

    A move skips the markers that follow a case item, since their point is that
    item's, and says how many it left where they were. On a tracked layer `at`
    dates a move or a status, as for one feature (`update_marker`), and `start`
    and `end` give every feature the same first and last day, or `end_unknown`
    the same unknown end; one that cannot take it refuses the whole edit.
    """
    changes = dict(changes)
    start, end = changes.pop("start", None), changes.pop("end", None)
    unknown = bool(changes.pop("end_unknown", None))
    with case.lock:
        spec = _spec(case, layer)
        if (start is not None or end is not None or unknown) and not track(spec):
            raise maplayers.LayerError("switch “Track over time” on to say when it shows")
        features = spec["document"]["features"]
        chosen = set(keys)
        by_key = {f["properties"]["key"]: f for f in features}
        if len(chosen) != len(keys) or not chosen.issubset(by_key):
            raise maplayers.LayerError("select existing features exactly once")
        if "geometry" in changes:
            raise maplayers.LayerError("move a selection with its handle")
        target = _group(spec, changes["group"]) if "group" in changes else None
        if remove:
            batch = _undo(spec, removed=[{"index": i, "feature": f}
                                         for i, f in enumerate(features) if f["properties"]["key"] in chosen])
            spec["document"]["features"] = [f for f in features if f["properties"]["key"] not in chosen]
            _save(case, layer, spec)
            return {**read(case, layer), "batch": batch}

        def shifted(node: Any) -> Any:
            if not offset:
                return node
            if isinstance(node, list) and node and isinstance(node[0], (int, float)):
                point = [node[0] + offset[0], node[1] + offset[1], *node[2:]]
                if not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90:
                    raise maplayers.LayerError("keep the selection inside valid coordinates")
                return point
            return [shifted(child) for child in node]

        _restyle_icon(case, layer, spec, [by_key[key]["properties"] for key in keys], changes)
        moving = [key for key in keys if offset and not by_key[key]["properties"].get("entity_id")]
        undo = _undo(spec, before=[{"key": key, "geometry": copy.deepcopy(by_key[key]["geometry"]),
                                    "time": _time_fields(by_key[key])}
                                   for key in moving]) if moving else None
        moments = {key: _timed(spec, by_key[key], at) for key in keys}
        for key in moving:
            feature = by_key[key]
            dated = moments[key]
            if dated is None and not feature["properties"].get("states"):
                feature["geometry"]["coordinates"] = shifted(feature["geometry"]["coordinates"])
                continue
            if dated is None:
                # with no date it moves on every day, which only a shape that never moved can
                base = copy.deepcopy(next(state for state in feature["properties"]["states"] if not state.get("gone"))["geometry"])
                base["coordinates"] = shifted(base["coordinates"])
                _undated(feature, geometry=base)
                continue
            base = copy.deepcopy(_live_before(_seeded(feature), dated)["geometry"])
            base["coordinates"] = shifted(base["coordinates"])
            write_state(feature, dated, geometry=base)
        for key in keys:
            props = by_key[key]["properties"]
            moment = moments[key]
            if moment is not None and "status" in changes:
                write_state(by_key[key], moment, status=changes["status"] or "")
            elif props.get("states") and "status" in changes:
                _undated(by_key[key], status=changes["status"] or "")
            for field, value in changes.items():
                if field == "group" and target:
                    props.update(group=target["id"], category=target["name"])
                elif field == "name":
                    props[field] = maplayers._text(value, maplayers.MAX_NAME)
                elif field == "description":
                    props[field] = maplayers._rich_text(value, maplayers.MAX_DESCRIPTION)
                elif field in ("colour", "symbol"):
                    props[field] = value
            apply_fields(props, {field: value for field, value in changes.items() if field in CLEARABLE
                                 and not ((moment is not None or props.get("states")) and field == "status")
                                 and not (props.get("states") and field == "date")})
            if start is not None:
                set_start(by_key[key], start)
            if end is not None:
                set_end(by_key[key], end)
            if unknown:
                set_end_unknown(by_key[key])
        _save(case, layer, spec)
        answer = read(case, layer)
        if offset:
            answer.update(batch=undo, kept=len(keys) - len(moving))
        return answer


def _group_back(raw: dict[str, Any]) -> dict[str, Any]:
    """A group as an undo puts it back, from what the editor held of it, checked as an edit would be."""
    group: dict[str, Any] = {"id": raw["id"], "name": maplayers._text(raw["name"], maplayers.MAX_NAME),
                             "mode": raw.get("mode") if raw.get("mode") in ("uniform", "individual") else "individual",
                             "colour": raw.get("colour") or "#0072b2", "symbol": raw.get("symbol") or "pin",
                             **({"icon": raw["icon"]} if iconlibrary.is_key(raw.get("icon")) else {}),
                             "size": min(3.0, max(0.5, float(raw.get("size") or 1))),
                             "stroke": min(12.0, max(0.5, float(raw.get("stroke") or 2)))}
    if not group["name"]:
        raise maplayers.LayerError("a group put back carries its name")
    apply_style(group, {field: raw[field] for field in GROUP_STYLE if raw.get(field) not in (None, "")})
    for flag in ("labels", "events"):
        if raw.get(flag):
            group[flag] = True
    return group


def revert(case: Case, layer: str, put: list[dict[str, Any]], drop: list[str],
           groups_back: list[dict[str, Any]] | None = None, drop_groups: list[str] | None = None) -> dict[str, Any]:
    """Put features back as they were and take out the ones an edit made: the editor's undo.

    `put` are whole features as the layer held them before an edit (or after it, for a
    redo), each found by its key and replaced, or added back at the end; `drop` the
    keys of features to take out. Every geometry is checked as a drawn one is, and a
    feature whose group is gone joins the first.

    `groups_back` are groups an edit took out, each put back at its place `at` before
    the features return to it; `drop_groups` the ids of groups an edit made, taken out
    once the features have left them. The layer always keeps one group.
    """
    with case.lock:
        spec = _spec(case, layer)
        features = [f for f in spec["document"]["features"] if f["properties"]["key"] not in set(drop)]
        groups = _groups(spec)
        for raw in sorted(groups_back or [], key=lambda item: int(item.get("at") or 0)):
            if any(group["id"] == raw["id"] for group in groups):
                continue
            back = _group_back(raw)
            if any(group["name"] == back["name"] for group in groups):
                raise maplayers.LayerError(f"another group is named {back['name']}; rename it first")
            groups.insert(min(max(0, int(raw.get("at") or 0)), len(groups)), back)
        ids = {group["id"]: group for group in groups}
        by_key = {f["properties"]["key"]: index for index, f in enumerate(features)}
        for raw in put:
            properties = raw.get("properties") if isinstance(raw, dict) else None
            if not isinstance(properties, dict) or not isinstance(properties.get("key"), str) or not properties["key"]:
                raise maplayers.LayerError("each feature put back carries its key")
            kept: dict[str, Any] = copy.deepcopy(properties)
            if kept.get("group") not in ids:
                kept["group"] = groups[0]["id"]
            kept["category"] = ids[kept["group"]]["name"]
            feature = {"type": "Feature", "geometry": validate_geometry(raw.get("geometry")), "properties": kept}
            key = kept["key"]
            if key in by_key:
                features[by_key[key]] = feature
            else:
                by_key[key] = len(features)
                features.append(feature)
        if len(features) > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        for key in drop_groups or []:
            gone = next((group for group in groups if group["id"] == key), None)
            if gone is None or len(groups) == 1:
                continue
            groups.remove(gone)
            for feature in features:
                if feature["properties"].get("group") == key:
                    feature["properties"].update(group=groups[0]["id"], category=groups[0]["name"])
        spec["document"]["features"] = features
        _save(case, layer, spec)
        return read(case, layer)


def restore_selection(case: Case, layer: str, batch_id: str) -> dict[str, Any]:
    """Take back the last removal, move, merge or split."""
    with case.lock:
        spec = _spec(case, layer)
        batch = spec.get("removed_batch")
        if not batch or batch["id"] != batch_id:
            raise maplayers.LayerError("this edit can no longer be undone")
        added = set(batch.get("added") or [])
        features = [f for f in spec["document"]["features"] if f["properties"]["key"] not in added]
        if len(features) + len(batch["items"]) > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        by_key = {f["properties"]["key"]: f for f in features}
        for entry in batch.get("geometry") or []:
            if entry["key"] in by_key:
                by_key[entry["key"]]["geometry"] = entry["geometry"]
                if "time" in entry:
                    properties = by_key[entry["key"]]["properties"]
                    for field in ("states", "date", "date_end", "status", "end_unknown"):
                        properties.pop(field, None)
                    properties.update(copy.deepcopy(entry["time"]))
        groups = _groups(spec)
        ids = {group["id"] for group in groups}
        for item in batch["items"]:
            if item["feature"]["properties"].get("group") not in ids:
                item["feature"]["properties"]["group"] = groups[0]["id"]
            features.insert(min(item["index"], len(features)), item["feature"])
        spec["document"]["features"] = features
        spec.pop("removed_batch")
        _save(case, layer, spec)
        return read(case, layer)


#: Two line ends this close are one point, and the lines are joined there.
JOIN_METRES = 1.0


def _kind(geometry: dict[str, Any]) -> str:
    kind = str(geometry.get("type") or "")
    return "line" if "LineString" in kind else "area" if "Polygon" in kind else "point"


def _parts(geometry: dict[str, Any]) -> list[Any]:
    return geometry["coordinates"] if geometry["type"].startswith("Multi") else [geometry["coordinates"]]


def _chain(lines: list[list[list[float]]]) -> list[list[list[float]]]:
    """Join lines that meet end to end, in whichever direction each was drawn."""
    def meets(first: list[float], second: list[float]) -> bool:
        return layerlinks._distance((first[0], first[1]), (second[0], second[1])) <= JOIN_METRES

    waiting = [list(line) for line in lines]
    chains = []
    while waiting:
        chain = waiting.pop(0)
        grown = True
        while grown:
            grown = False
            for index, line in enumerate(waiting):
                if meets(chain[-1], line[0]):
                    chain = chain + line[1:]
                elif meets(chain[-1], line[-1]):
                    chain = chain + line[::-1][1:]
                elif meets(chain[0], line[-1]):
                    chain = line[:-1] + chain
                elif meets(chain[0], line[0]):
                    chain = line[::-1][:-1] + chain
                else:
                    continue
                waiting.pop(index)
                grown = True
                break
        chains.append(chain)
    return chains


def merge(case: Case, layer: str, keys: list[str]) -> dict[str, Any]:
    """Make several lines, or several areas, one feature.

    Lines that meet end to end become one line; the rest stay parts of a
    multi-line. Areas become parts of one feature, never a union. The first key
    keeps its name, group and style, and the others are taken out with an undo.
    """
    with case.lock:
        spec = _spec(case, layer)
        features = spec["document"]["features"]
        by_key = {f["properties"]["key"]: f for f in features}
        if len(keys) < 2 or len(set(keys)) != len(keys) or not set(keys) <= by_key.keys():
            raise maplayers.LayerError("select two or more features to merge")
        chosen = [by_key[key] for key in keys]
        _refuse_history(chosen, "Merging")
        kinds = {_kind(feature["geometry"]) for feature in chosen}
        if kinds == {"point"} or len(kinds) != 1:
            raise maplayers.LayerError("merge lines with lines, or areas with areas")
        parts = [part for feature in chosen for part in _parts(feature["geometry"])]
        if kinds == {"line"}:
            joined = _chain(parts)
            geometry = ({"type": "LineString", "coordinates": joined[0]} if len(joined) == 1
                        else {"type": "MultiLineString", "coordinates": joined})
        else:
            geometry = {"type": "MultiPolygon", "coordinates": parts}
        geometry = validate_geometry(geometry)
        survivor = chosen[0]
        gone = set(keys[1:])
        batch = _undo(spec, removed=[{"index": i, "feature": f} for i, f in enumerate(features)
                                     if f["properties"]["key"] in gone],
                      before=[{"key": keys[0], "geometry": copy.deepcopy(survivor["geometry"])}])
        survivor["geometry"] = geometry
        spec["document"]["features"] = [f for f in features if f["properties"]["key"] not in gone]
        _save(case, layer, spec)
        return {**read(case, layer), "batch": batch, "key": keys[0]}


def split(case: Case, layer: str, key: str, at: int | None = None) -> dict[str, Any]:
    """Make a feature of every part of a multi-part one, or cut a line at a vertex.

    The first part keeps the feature; each other one is a copy of it, numbered
    after it, so the group and the style come along.
    """
    with case.lock:
        spec = _spec(case, layer)
        features = spec["document"]["features"]
        index = next((i for i, f in enumerate(features) if f["properties"]["key"] == key), None)
        if index is None:
            raise maplayers.LayerError("this feature is no longer in the layer")
        feature = features[index]
        _refuse_history([feature], "Splitting")
        geometry = feature["geometry"]
        single = {"MultiLineString": "LineString", "MultiPolygon": "Polygon"}.get(geometry["type"])
        if single:
            pieces = [{"type": single, "coordinates": part} for part in geometry["coordinates"]]
        elif geometry["type"] == "LineString" and at is not None:
            line = geometry["coordinates"]
            if not 0 < at < len(line) - 1:
                raise maplayers.LayerError("cut a line at one of its middle points")
            pieces = [{"type": "LineString", "coordinates": line[:at + 1]},
                      {"type": "LineString", "coordinates": line[at:]}]
        else:
            raise maplayers.LayerError("only a line, or a feature made of several parts, can be split")
        if len(pieces) < 2:
            raise maplayers.LayerError("this feature has one part only")
        if len(features) + len(pieces) - 1 > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        pieces = [validate_geometry(piece) for piece in pieces]
        name = str(feature["properties"].get("name") or "")
        copies = []
        for number, piece in enumerate(pieces[1:], start=2):
            twin = copy.deepcopy(feature)
            twin["geometry"] = piece
            twin["properties"]["key"] = uuid.uuid4().hex
            twin["properties"]["name"] = maplayers._text(f"{name} {number}".strip(), maplayers.MAX_NAME)
            copies.append(twin)
        batch = _undo(spec, added=[twin["properties"]["key"] for twin in copies],
                      before=[{"key": key, "geometry": copy.deepcopy(geometry)}])
        feature["geometry"] = pieces[0]
        features[index + 1:index + 1] = copies
        _save(case, layer, spec)
        return {**read(case, layer), "batch": batch, "keys": [key, *(twin["properties"]["key"] for twin in copies)]}


#: The geometries an editable layer holds: a multi-part one is what a merge makes.
GEOMETRIES = ("Point", "LineString", "Polygon", "MultiLineString", "MultiPolygon")


def validate_geometry(value: Any) -> dict[str, Any]:
    """Bound editable geometry and refuse malformed coordinates before writing.

    The 4,096-point cap holds for the whole feature, across all its parts.
    """
    if not isinstance(value, dict) or value.get("type") not in GEOMETRIES:
        raise maplayers.LayerError("choose a point, line or area")
    coordinates = value.get("coordinates")
    kind = value["type"]
    if not isinstance(coordinates, list):
        raise maplayers.LayerError("this geometry has invalid coordinates")
    single = kind.removeprefix("Multi")
    parts = coordinates if kind.startswith("Multi") else [coordinates]
    if not parts:
        raise maplayers.LayerError("this geometry has invalid coordinates")
    def finite(number: Any) -> bool:
        try:
            return not isinstance(number, bool) and isinstance(number, (int, float)) and math.isfinite(number)
        except OverflowError:
            return False
    count = 0
    for part in parts:
        if not isinstance(part, list):
            raise maplayers.LayerError("this geometry has invalid coordinates")
        rings = [part] if single == "LineString" else part if single == "Polygon" else [[part]]
        if not rings or any(not isinstance(ring, list) for ring in rings):
            raise maplayers.LayerError("this geometry has invalid coordinates")
        for ring in rings:
            if len(ring) < (4 if single == "Polygon" else 2 if single == "LineString" else 1):
                raise maplayers.LayerError("add more points to this shape")
            for point in ring:
                count += 1
                if count > 4096:
                    raise maplayers.LayerError("an editable shape can hold at most 4,096 points")
                if (not isinstance(point, list) or len(point) not in (2, 3)
                        or any(not finite(v) for v in point)
                        or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
                    raise maplayers.LayerError("this geometry has invalid coordinates")
            if single == "Polygon" and (ring[0] != ring[-1] or len({tuple(p[:2]) for p in ring}) < 3):
                raise maplayers.LayerError("an area needs a closed ring with three different corners")
            if single == "LineString" and len({tuple(p[:2]) for p in ring}) < 2:
                raise maplayers.LayerError("a line needs two different points")
    return {"type": kind, "coordinates": copy.deepcopy(coordinates)}


def add_shape(case: Case, layer: str, *, geometry: dict[str, Any], name: str,
              colour: str, description: str, group: str | None, at: str | None = None,
              **fields: Any) -> dict[str, Any]:
    geometry = validate_geometry(geometry)
    if geometry["type"] == "Point":
        raise maplayers.LayerError("add a marker for a point")
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        features = spec["document"]["features"]
        if len(features) >= maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        # lines and areas count apart, so the first area is "Area 1" whatever lines came before
        word = "Line" if _kind(geometry) == "line" else "Area"
        serial = f"{word.lower()}_serial"
        numbered = [label[len(word) + 1:] for f in features
                    if (label := str(f["properties"].get("name", ""))).startswith(f"{word} ")]
        sequence = max([int(spec.get(serial, 0)), *(int(value) for value in numbered if value.isdecimal())]) + 1
        spec[serial] = sequence
        properties = maplayers._properties(name=name.strip() or f"{word} {sequence}",
                                           description=description, colour=colour, category=target["name"])
        properties.update(key=uuid.uuid4().hex, group=target["id"], symbol="pin")
        apply_fields(properties, fields)
        shape = {"type": "Feature", "geometry": geometry, "properties": properties}
        _born(spec, shape, at)
        features.append(shape)
        spec["hidden"] = [item for item in spec.get("hidden", []) if item != target["name"]]
        _save(case, layer, spec)
        return {**read(case, layer), "key": properties["key"]}


def remove_group(case: Case, layer: str, key: str) -> dict[str, Any]:
    """Remove a group while keeping its features in a surviving group."""
    with case.lock:
        spec = _spec(case, layer)
        removed = _group(spec, key)
        if len(spec["groups"]) == 1:
            raise maplayers.LayerError("keep at least one group in the layer")
        # Freeze the removed group's visible style before moving its members.
        styled = {f["properties"]["key"]: f for f in drawing(spec)["geojson"]["features"]}
        spec["groups"].remove(removed)
        target = spec["groups"][0]
        for feature in spec["document"]["features"]:
            properties = feature["properties"]
            if properties.get("group") == key:
                for field in ("colour", "symbol", "icon"):
                    if field in styled[properties["key"]]["properties"]:
                        properties[field] = styled[properties["key"]]["properties"][field]
                properties.update({"group": target["id"], "category": target["name"]})
        _save(case, layer, spec)
        return read(case, layer)


def add_links(case: Case, layer: str, items: list[dict[str, Any]], group: str | None, *,
              symbol: str | None = None, colour: str | None = None, status: str = "",
              icon: str = "") -> dict[str, Any]:
    """Add markers that follow case items, in the group's style unless given one.

    Each item names an entity and the point it was picked at, which picks one of
    the places an entity stands on. **One geolocation is one marker**: a file a
    proof places on that point is added as that proof (`layerlinks.anchor`), and
    an item already shown on that point, as itself or as its proof or footage, is
    not added twice; the marker it has follows the proof from then on. A marker
    says what its item says (`layerlinks.prefill`), kept in step by
    `sync_followers`. `status` is what a new marker says of what it shows:
    intact when empty, or one of `STATUSES`.
    """
    if status and status not in STATUSES:
        raise maplayers.LayerError("a status is damaged or destroyed")
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        if icon:
            adopt_icon(case, layer, spec, icon)
        spec["hidden"] = [name for name in spec.get("hidden", []) if name != target["name"]]
        features = spec["document"]["features"]
        layerlinks.follow(case, features, rendered=False)
        points: list[dict[str, Any]] = []
        kin: dict[str, set[str]] = {}
        changed = False
        for item in items:
            picked, (lon, lat) = layerlinks.resolve(case, str(item["id"]), float(item["lat"]), float(item["lon"]))
            entity = layerlinks.anchor(case, picked, (lon, lat))
            if entity["id"] not in kin:
                kin[entity["id"]] = layerlinks.family(case, entity)
            shown = [f for f in features + points if f["geometry"]["type"] == "Point"
                     and f["properties"].get("entity_id") in kin[entity["id"]]
                     and layerlinks._distance(tuple(f["geometry"]["coordinates"][:2]), (lon, lat)) <= layerlinks.SAME_SPOT]
            if shown:
                for feature in shown:
                    changed |= _follow_item(case, feature, entity, labels={picked.get("label") or ""})
                continue
            properties = maplayers._properties(category=target["name"], colour=colour or target["colour"])
            properties.update({"key": uuid.uuid4().hex, "entity_id": entity["id"], "group": target["id"],
                               "symbol": symbol or target["symbol"],
                               "icon": icon if icon or symbol else target.get("icon") or ""})
            feature = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                       "properties": properties}
            _follow_item(case, feature, entity)
            apply_fields(properties, {"status": status or None})
            points.append(feature)
        if len(features) + len(points) > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        if points or changed:
            features.extend(points)
            _save(case, layer, spec)
        return {**read(case, layer), "added": len(points)}


#: What a marker following a case item takes from it, written again whenever the
#: item is saved.
SYNCED = ("name", "description", "date", "date_end", "links")


def _item_values(case: Case, entity: dict[str, Any], point: tuple[float, float]) -> dict[str, Any]:
    """What a marker following `entity` at `point` says, checked as a marker stores it."""
    said = layerlinks.prefill(case, entity, point)
    checked = maplayers._properties(name=said["name"], description=said["description"],
                                    date=said["date"], date_end=said["date_end"])
    cited = [link for link in said["links"] if len(link) <= MAX_LINK]
    return {"name": checked["name"], "description": checked["description"],
            "date": checked.get("date", ""), "date_end": checked.get("date_end", ""),
            "links": cited[:MAX_LINKS]}


def _follow_item(case: Case, feature: dict[str, Any], entity: dict[str, Any],
                 labels: set[str] | None = None) -> bool:
    """Make a marker follow `entity` and say what it says, field by field.

    A field still holding what the item wrote last (`synced`) takes the item's new
    value; one the analyst rewrote by hand stays theirs. A marker followed before
    `synced` was kept counts a field as the item's when it is empty, a title of the
    item (`labels`) or the notes it was once given from it. Returns whether the
    marker changed.
    """
    properties = feature["properties"]
    before = case.get_entity(properties["entity_id"]) if properties.get("entity_id") else None
    changed = properties.get("entity_id") != entity["id"]
    properties["entity_id"] = entity["id"]
    point = tuple(feature["geometry"]["coordinates"][:2])
    values = _item_values(case, entity, (float(point[0]), float(point[1])))
    last = properties.get("synced")
    earlier = {str(one.get("label") or "") for one in (before, entity) if one} | (labels or set())
    notes = {str((one.get("attrs") or {}).get("notes") or "") for one in (before, entity) if one}
    for field in SYNCED:
        empty: Any = [] if field == "links" else ""
        current = properties.get(field, empty)
        # on a tracked layer a marker's days mirror its dated states (`_mirror`)
        if current == values[field] or (field in ("date", "date_end") and properties.get("states")):
            continue
        if isinstance(last, dict):
            theirs = current != last.get(field, empty)
        else:
            theirs = bool(current) and not (field == "name" and current in earlier) \
                and not (field == "description" and current in notes)
        if theirs:
            continue
        if values[field] or field in ("name", "description"):
            properties[field] = values[field]
        else:
            properties.pop(field, None)
        changed = True
    if not properties.get("states") and str(properties.get("date_end") or "") <= str(properties.get("date") or ""):
        changed |= properties.pop("date_end", None) is not None
    if last != values:
        properties["synced"] = values
        changed = True
    return changed


def sync_followers(case: Case, entity_id: str) -> list[str]:
    """Write a saved item into the markers that follow it, in every layer.

    Called when a proof or a file is saved. A proof also takes in the markers that
    followed its footage on one of its points, since they show the same
    geolocation, and a file's save reaches the markers of the proofs placing it,
    which cite its address. Where a layer ends up with one geolocation twice, the
    second marker goes, kept for Undo like any removed feature. Returns the layers
    changed.
    """
    with case.lock:
        entity = case.get_entity(entity_id)
        if entity is None or entity.get("type") not in layerlinks.LINKABLE_TYPES:
            return []
        items = {entity_id: entity}
        footage: set[str] = set()
        spots: list[tuple[float, float]] = []
        if entity["type"] == "proof":
            footage = layerlinks.family(case, entity) - {entity_id}
            spots = layerlinks.entity_points(case, entity)
        elif entity["type"] == "media":
            for other in layerlinks.family(case, entity) - {entity_id}:
                proof = case.get_entity(other)
                if proof is not None:
                    items[other] = proof
        changed: list[str] = []
        for row in maplayers.listing(case):
            if not row["editable"]:
                continue
            try:
                spec = _spec(case, row["name"])
            except maplayers.LayerError:
                continue
            features = spec["document"]["features"]
            if not any(f["properties"].get("entity_id") in items.keys() | footage for f in features):
                continue
            layerlinks.follow(case, features, rendered=False)
            dirty = False
            for feature in features:
                properties = feature["properties"]
                followed = properties.get("entity_id")
                if feature["geometry"]["type"] != "Point" or not followed:
                    continue
                at = tuple(feature["geometry"]["coordinates"][:2])
                if followed in footage and any(layerlinks._distance(at, spot) <= layerlinks.SAME_SPOT for spot in spots):
                    dirty |= _follow_item(case, feature, entity)
                elif followed in items:
                    dirty |= _follow_item(case, feature, items[followed])
            seen: set[tuple[Any, ...]] = set()
            twice: list[int] = []
            for index, feature in enumerate(features):
                followed = feature["properties"].get("entity_id")
                if followed not in items or feature["geometry"]["type"] != "Point":
                    continue
                place = (followed, *(round(v, 5) for v in feature["geometry"]["coordinates"][:2]))
                if place in seen:
                    twice.append(index)
                seen.add(place)
            history = spec.setdefault("removed_features", [])
            for index in reversed(twice):
                history.append({"feature": features.pop(index), "index": index})
                dirty = True
            spec["removed_features"] = history[-20:]
            if dirty:
                _save(case, row["name"], spec)
                changed.append(row["name"])
        return changed


def remove_marker(case: Case, layer: str, key: str) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        marker = _marker(spec, key)
        features = spec["document"]["features"]
        index = next(i for i, f in enumerate(features) if f["properties"]["key"] == key)
        features.pop(index)
        # Bounded, case-owned undo history travels with the layer's working copy.
        history = spec.setdefault("removed_features", [])
        history.append({"feature": marker, "index": index})
        spec["removed_features"] = history[-20:]
        _save(case, layer, spec)
        return {**read(case, layer), "removed": key}


def restore_marker(case: Case, layer: str, key: str) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        history = spec.get("removed_features", [])
        item = next((item for item in history if item["feature"]["properties"]["key"] == key), None)
        if item is None:
            raise maplayers.LayerError("this feature is no longer available to undo")
        features = spec["document"]["features"]
        if len(features) >= maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        properties = item["feature"]["properties"]
        if properties.get("group") not in {g["id"] for g in spec["groups"]}:
            target = spec["groups"][0]
            properties.update({"group": target["id"], "category": target["name"]})
        features.insert(min(item["index"], len(features)), item["feature"])
        history.remove(item)
        _save(case, layer, spec)
        return read(case, layer)


def layer_targets(case: Case, entity_id: str | None = None) -> list[dict[str, Any]]:
    """The analyst's layers a case item can join, and its markers already in each.

    One row per editable layer, in listing order, with the groups a new marker
    can join, the marker styles it already shows (at most twelve, as drawn) and,
    when ``entity_id`` names an item, the markers that show it at the point they
    stand on now, a proof's own or its footage's (`layerlinks.family`). A layer
    whose working copy cannot be read is left out rather than failing the others.
    """
    with case.lock:
        item = case.get_entity(entity_id) if entity_id else None
        kin = layerlinks.family(case, item) if item else set()
        rows = []
        for row in maplayers.listing(case):
            if not row["editable"]:
                continue
            try:
                spec = _spec(case, row["name"])
            except maplayers.LayerError:
                continue
            linked = [copy.deepcopy(f) for f in spec["document"]["features"]
                      if f["properties"].get("entity_id") in kin and f["geometry"]["type"] == "Point"]
            layerlinks.follow(case, linked, rendered=False)
            groups = {group["id"]: group for group in _groups(spec)}
            styles: list[dict[str, str]] = []
            for feature in spec["document"]["features"]:
                if feature["geometry"]["type"] != "Point" or len(styles) >= 12:
                    continue
                properties = feature["properties"]
                group = groups.get(properties.get("group")) or {}
                drawn = group if group.get("mode") == "uniform" else properties
                style = {"symbol": drawn.get("symbol") or "pin",
                         "colour": str(drawn.get("colour") or group.get("colour") or "#0072b2").lower()}
                if drawn.get("icon"):
                    look = (spec.get(ICON_META) or {}).get(drawn["icon"]) or {}
                    style.update(icon=drawn["icon"], icon_mode=look.get("mode") or "image")
                if style not in styles:
                    styles.append(style)
            rows.append({
                "name": row["name"], "title": row["title"],
                "groups": [{**{field: group.get(field) for field in ("id", "name", "mode", "colour", "symbol")},
                            **({"icon": group["icon"]} if group.get("icon") else {})}
                           for group in _groups(spec)],
                "icons": copy.deepcopy(spec.get(ICON_META) or {}),
                "markers": [{"key": f["properties"]["key"], "group": f["properties"].get("group"),
                             "lon": f["geometry"]["coordinates"][0], "lat": f["geometry"]["coordinates"][1]}
                            for f in linked],
                "styles": styles,
            })
        return rows


def place_usage(case: Case, entity_id: str) -> dict[str, Any]:
    """Show direct relations and layer memberships before a case-wide deletion."""
    with case.lock:
        place = case.get_entity(entity_id)
        if not place or place["type"] != "place":
            raise maplayers.LayerError("this case place is no longer available")
        related = {}
        for link in case.list_links():
            other = link["to"] if link["from"] == entity_id else (
                link["from"] if link["to"] == entity_id else None)
            entity = case.get_entity(other) if other else None
            if entity:
                related[entity["id"]] = {"id": entity["id"], "label": entity["label"],
                                         "type": entity["type"]}
        layers = []
        for row in maplayers.listing(case):
            if not row["editable"]:
                continue
            spec = _spec(case, row["name"])
            if any(f["properties"].get("entity_id") == entity_id for f in spec["document"]["features"]):
                layers.append({"name": row["name"], "title": row["title"]})
        return {"place": place, "related": list(related.values()), "layers": layers}
