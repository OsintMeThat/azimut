"""Personal map layers, with editable markers kept outside the case's places.

The layer spec owns the working collection. Its snapshot keeps the original
file, and its icons and derived drawing use the existing map-layer lifecycle.
"""

from __future__ import annotations

import copy
import json
import uuid
from typing import Any

from .. import layout
from ..workspace import Case
from . import maplayers, satellite

EDITABLE = "editable"
SYMBOLS = ("pin", "circle", "star", "flag")


def editable(spec: dict[str, Any]) -> bool:
    return (spec.get("source") or {}).get("kind") == EDITABLE


def _spec(case: Case, name: str) -> dict[str, Any]:
    spec = maplayers._read_spec(case, name)
    if not editable(spec):
        raise maplayers.LayerError("create an editable copy of this layer first")
    if not isinstance(spec.get("document"), dict):
        raise maplayers.LayerError("this layer's working copy is missing")
    return spec


def drawing(spec: dict[str, Any]) -> dict[str, Any]:
    """Rebuild a drawing from the working collection, including an empty one."""
    features = copy.deepcopy(spec["document"]["features"])
    return maplayers._collection(features, title=spec["title"], fmt="geojson")


def digest(spec: dict[str, Any]) -> str:
    data = json.dumps(spec["document"], ensure_ascii=False, sort_keys=True).encode()
    return maplayers.digest(data)


def _save(case: Case, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    parsed = drawing(spec)
    spec["document"] = parsed["geojson"]
    spec["content_sha256"] = digest(spec)
    spec["summary"] = parsed["summary"]
    live = {group["name"] for group in parsed["summary"]["categories"]}
    spec["hidden"] = [group for group in spec.get("hidden", []) if group in live]
    spec["updated_at"] = maplayers._now()
    # The spec is authoritative; a missing or stale cache is rebuilt on read.
    maplayers._write_spec(case, name, spec)
    return maplayers.row(name, spec)


def _create(
    case: Case,
    *,
    title: str,
    features: list[dict[str, Any]],
    original: bytes,
    origin: dict[str, Any] | None = None,
    images: dict[str, bytes] | None = None,
) -> dict[str, Any]:
    title = title.strip() or "My layer"
    features = copy.deepcopy(features)
    for feature in features:
        properties = feature["properties"]
        properties.pop("place_id", None)
        properties["key"] = uuid.uuid4().hex
    parsed = maplayers._collection(features, title=title, fmt="geojson")
    with case.lock:
        name = maplayers._free_name(case, title)
        now = maplayers._now()
        spec: dict[str, Any] = {
            "azimut_layer": maplayers.SPEC_VERSION,
            "title": title,
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
    return maplayers.row(name, spec)


def create(case: Case, title: str) -> dict[str, Any]:
    original = b'{"type":"FeatureCollection","features":[]}'
    return _create(case, title=title, features=[], original=original)


def from_file(case: Case, data: bytes, filename: str, title: str = "") -> dict[str, Any]:
    """Import a working copy without fetching external icons."""
    parsed = maplayers.parse(data, filename=filename, title=title)
    images = maplayers._pictograms(parsed, data, icons=True, web=False)
    origin = {
        "source": {"kind": "file", "name": filename, "format": parsed["summary"]["format"]},
        "sha256": maplayers.digest(data),
        "copied_at": maplayers._now(),
    }
    return _create(case, title=title or parsed["summary"]["title"],
                   features=parsed["geojson"]["features"], original=data,
                   origin=origin, images=images)


def copy_layer(case: Case, name: str, title: str = "") -> dict[str, Any]:
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
        return _create(case, title=title or f'{source["title"]} copy',
                       features=collection["features"], original=original,
                       origin=origin, images=images)


def read(case: Case, name: str) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, name)
        document = copy.deepcopy(spec["document"])
        # A deleted place does not turn a layer marker into a dead graph entity.
        for feature in document["features"]:
            properties = feature["properties"]
            place = case.get_entity(properties["place_id"]) if properties.get("place_id") else None
            if place is None:
                properties.pop("place_id", None)
        return {"layer": maplayers.row(name, spec), "document": document}


def add_marker(
    case: Case, layer: str, *, lat: float, lon: float, name: str,
    colour: str, symbol: str, description: str = "",
) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        features = spec["document"]["features"]
        if len(features) >= maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        key = uuid.uuid4().hex
        properties = maplayers._properties(
            name=name.strip() or f"Marker {len(features) + 1}", description=description,
            category="Markers", colour=colour,
        )
        properties.update({"key": key, "symbol": symbol})
        marker = {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                  "properties": properties}
        features.append(marker)
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker}


def _marker(spec: dict[str, Any], key: str) -> dict[str, Any]:
    for feature in spec["document"]["features"]:
        if feature["properties"].get("key") == key:
            return dict(feature)
    raise maplayers.LayerError("this marker is no longer in the layer")


def update_marker(case: Case, layer: str, key: str, changes: dict[str, Any]) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        marker = _marker(spec, key)
        properties = marker["properties"]
        for field, value in changes.items():
            if field == "name":
                properties[field] = maplayers._text(value, maplayers.MAX_NAME)
            elif field == "description":
                properties[field] = maplayers._rich_text(value, maplayers.MAX_DESCRIPTION)
            elif field in ("colour", "symbol"):
                properties[field] = value
        # Choosing an app symbol replaces the imported pictogram on this marker.
        if "symbol" in changes or "colour" in changes:
            properties["icon"] = ""
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker}


def promote(case: Case, layer: str, key: str) -> dict[str, Any]:
    """Explicitly save one point as a case place, reusing one already there."""
    with case.lock:
        spec = _spec(case, layer)
        marker = _marker(spec, key)
        if marker["geometry"]["type"] != "Point":
            raise maplayers.LayerError("only a point can be saved as a case place")
        lon, lat = marker["geometry"]["coordinates"][:2]
        properties = marker["properties"]
        place = case.get_entity(properties["place_id"]) if properties.get("place_id") else None
        if place is None:
            place = satellite.place_at(case, lat, lon, keyed_only=False)
        if place is None:
            extra = {"layer_origin": {"spec": layout.layer_spec_rel(layer), "feature": key,
                                      "origin": spec.get("origin")},
                     "notes": properties.get("description", "")}
            place = satellite.save_place(case, lat, lon, title=properties.get("name"),
                                         by="map-layers", extra_attrs=extra)
        properties["place_id"] = place["id"]
        row = _save(case, layer, spec)
        return {"layer": row, "marker": marker, "place": place}
