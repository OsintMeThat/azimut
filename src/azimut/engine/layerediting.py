"""Personal map layers, with editable markers kept outside the case's places.

The layer spec owns the working collection. Its snapshot keeps the original
file, and its icons and derived drawing use the existing map-layer lifecycle.
"""

from __future__ import annotations

import copy
import json
import math
import re
import uuid
from typing import Any

from .. import layout
from ..workspace import Case
from . import layerlinks, maplayers, satellite

EDITABLE = "editable"
WORK_FIELDS = ("title", "description", "document", "groups", "hidden", "marker_serial", "shape_serial", "removed_features", "removed_batch")
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
#: How many addresses one marker cites.
MAX_LINKS = 10
MAX_LINK = 2000
_LINK = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
#: The marker fields an edit may clear by sending nothing for them.
CLEARABLE = ("date", "status", "bearing", "links", "provenance")
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
        name = properties.get("category") or "Markers"
        if name not in by_name:
            group = {"id": maplayers.digest(name.encode())[:16], "name": name,
                     "mode": "individual", "colour": "#0072b2", "symbol": "pin",
                     "size": properties.get("icon_scale", 1), "stroke": properties.get("stroke_width", 2)}
            groups.append(group)
            by_name[name] = group
            by_id[group["id"]] = group
        properties["group"] = by_name[name]["id"]
    if not groups:
        groups.append({"id": "markers", "name": "Markers", "mode": "individual",
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


def drawing(spec: dict[str, Any], case: Case | None = None) -> dict[str, Any]:
    """Rebuild a drawing from the working collection, including an empty one."""
    groups = {group["id"]: group for group in _groups(spec)}
    features = copy.deepcopy(spec["document"]["features"])
    named = {entry["colour"]: entry["name"] for entry in palette(case)} if case else {}
    if case:
        layerlinks.follow(case, features, rendered=True)
    for feature in features:
        properties = feature["properties"]
        group = groups[properties["group"]]
        properties["category"] = group["name"]
        properties["icon_scale"] = group["size"]
        properties["stroke_width"] = group["stroke"]
        if group.get("labels"):
            properties["show_label"] = True
        if group["mode"] == "uniform":
            properties.update({"colour": group["colour"], "symbol": group["symbol"], "icon": ""})
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
    """Redraw when a linked entity moves, goes to the Trash or comes back."""
    links = layerlinks.digest_part(case, spec["document"]["features"])
    return maplayers.digest((digest(spec) + json.dumps([links, palette(case)])).encode())


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
            entry.update(symbol=uniform[entry["name"]]["symbol"], colour=uniform[entry["name"]]["colour"])
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


def add_marker(
    case: Case, layer: str, *, lat: float, lon: float, name: str,
    colour: str, symbol: str, description: str = "",
    group: str | None = None, **fields: Any,
) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
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
        properties.update({"key": key, "symbol": symbol, "group": target["id"]})
        apply_fields(properties, fields)
        marker = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                  "properties": properties}
        features.append(marker)
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker, "groups": _groups(spec)}


def _marker(spec: dict[str, Any], key: str) -> dict[str, Any]:
    for feature in spec["document"]["features"]:
        if feature["properties"].get("key") == key:
            return dict(feature)
    raise maplayers.LayerError("this marker is no longer in the layer")


def update_marker(case: Case, layer: str, key: str, changes: dict[str, Any]) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        # an unlinked marker keeps the point its case item stands on now
        layerlinks.follow(case, spec["document"]["features"], rendered=False)
        marker = _marker(spec, key)
        properties = marker["properties"]
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
                if geometry["type"] != marker["geometry"]["type"]:
                    raise maplayers.LayerError("keep the feature's geometry type")
                marker["geometry"] = geometry
                stored = next(f for f in spec["document"]["features"]
                              if f["properties"]["key"] == key)
                stored["geometry"] = geometry
            elif field == "unlink" and value:
                properties.pop("entity_id", None)
        apply_fields(properties, {field: value for field, value in changes.items() if field in CLEARABLE})
        # Choosing an app symbol replaces the imported pictogram on this marker.
        if "symbol" in changes or "colour" in changes:
            properties["icon"] = ""
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker, "groups": _groups(spec)}


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
        if "labels" in changes:
            if changes["labels"]:
                group["labels"] = True
            else:
                group.pop("labels", None)
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
                   offset: list[float] | None, remove: bool) -> dict[str, Any]:
    """Apply one atomic edit to selected features, without touching case entities.

    A move skips the markers that follow a case item, since their point is that
    item's, and says how many it left where they were.
    """
    with case.lock:
        spec = _spec(case, layer)
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

        moving = [key for key in keys if offset and not by_key[key]["properties"].get("entity_id")]
        undo = _undo(spec, before=[{"key": key, "geometry": copy.deepcopy(by_key[key]["geometry"])}
                                   for key in moving]) if moving else None
        for key in moving:
            feature = by_key[key]
            feature["geometry"]["coordinates"] = shifted(feature["geometry"]["coordinates"])
        for key in keys:
            props = by_key[key]["properties"]
            for field, value in changes.items():
                if field == "group" and target:
                    props.update(group=target["id"], category=target["name"])
                elif field == "name":
                    props[field] = maplayers._text(value, maplayers.MAX_NAME)
                elif field == "description":
                    props[field] = maplayers._rich_text(value, maplayers.MAX_DESCRIPTION)
                elif field in ("colour", "symbol"):
                    props[field] = value
            apply_fields(props, {field: value for field, value in changes.items() if field in CLEARABLE})
            if "symbol" in changes or "colour" in changes:
                props["icon"] = ""
        _save(case, layer, spec)
        answer = read(case, layer)
        if offset:
            answer.update(batch=undo, kept=len(keys) - len(moving))
        return answer


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
              colour: str, description: str, group: str | None, **fields: Any) -> dict[str, Any]:
    geometry = validate_geometry(geometry)
    if geometry["type"] == "Point":
        raise maplayers.LayerError("add a marker for a point")
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        features = spec["document"]["features"]
        if len(features) >= maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        sequence = int(spec.get("shape_serial", 0)) + 1
        spec["shape_serial"] = sequence
        properties = maplayers._properties(name=name.strip() or f'{"Line" if _kind(geometry) == "line" else "Area"} {sequence}',
                                           description=description, colour=colour, category=target["name"])
        properties.update(key=uuid.uuid4().hex, group=target["id"], symbol="pin")
        apply_fields(properties, fields)
        features.append({"type": "Feature", "geometry": geometry, "properties": properties})
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
              symbol: str | None = None, colour: str | None = None) -> dict[str, Any]:
    """Add markers that follow case items, in the group's style unless given one.

    Each item names an entity and the point it was picked at, which picks one of
    the places an entity stands on. One entity at one point is added once.
    """
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        spec["hidden"] = [name for name in spec.get("hidden", []) if name != target["name"]]
        features = spec["document"]["features"]
        layerlinks.follow(case, features, rendered=False)
        held = {(f["properties"].get("entity_id"), tuple(round(v, 6) for v in f["geometry"]["coordinates"][:2]))
                for f in features if f["properties"].get("entity_id")}
        points = []
        for item in items:
            entity, (lon, lat) = layerlinks.resolve(case, str(item["id"]), float(item["lat"]), float(item["lon"]))
            spot = (entity["id"], (round(lon, 6), round(lat, 6)))
            if spot in held:
                continue
            held.add(spot)
            properties = maplayers._properties(name=entity.get("label") or "", description="",
                                               category=target["name"], colour=colour or target["colour"])
            properties.update({"key": uuid.uuid4().hex, "entity_id": entity["id"],
                               "group": target["id"], "symbol": symbol or target["symbol"]})
            points.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                           "properties": properties})
        if len(features) + len(points) > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        features.extend(points)
        _save(case, layer, spec)
        return {**read(case, layer), "added": len(points)}


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
    when ``entity_id`` names an item, the markers that follow it at the point
    they stand on now. A layer whose working copy cannot be read is left out
    rather than failing the others.
    """
    with case.lock:
        rows = []
        for row in maplayers.listing(case):
            if not row["editable"]:
                continue
            try:
                spec = _spec(case, row["name"])
            except maplayers.LayerError:
                continue
            linked = [copy.deepcopy(f) for f in spec["document"]["features"]
                      if entity_id and f["properties"].get("entity_id") == entity_id
                      and f["geometry"]["type"] == "Point"]
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
                if style not in styles:
                    styles.append(style)
            rows.append({
                "name": row["name"], "title": row["title"],
                "groups": [{field: group.get(field) for field in ("id", "name", "mode", "colour", "symbol")}
                           for group in _groups(spec)],
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
