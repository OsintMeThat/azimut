"""Personal map layers, with editable markers kept outside the case's places.

The layer spec owns the working collection. Its snapshot keeps the original
file, and its icons and derived drawing use the existing map-layer lifecycle.
"""

from __future__ import annotations

import copy
import json
import math
import uuid
from typing import Any

from .. import layout
from ..workspace import Case
from . import maplayers, satellite

EDITABLE = "editable"
WORK_FIELDS = ("document", "groups", "hidden", "marker_serial", "shape_serial", "removed_features", "removed_batch")
SYMBOLS = ("pin", "circle", "star", "flag") + tuple(f"badge-{icon}" for icon in (
    "image", "video", "audio", "user", "building", "car", "plane", "ship", "note", "alert",
    "shield", "flame", "crosshair", "compass", "bookmark", "globe", "phone", "mail", "clock", "flag",
    "radar", "radar-antenna", "telecom-antenna", "power-pylon", "tank", "armoured-vehicle",
    "truck", "pickup", "ambulance", "bomb", "missile", "artillery", "air-defence", "drone",
    "fpv-drone", "helicopter", "fighter", "house", "high-rise", "trench", "bunker", "checkpoint",
    "roadblock", "factory", "fuel-depot", "bridge", "crater", "hospital", "camp", "harbour",
    "railway", "power-station",
))


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
    _groups(spec)
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
    for feature in features:
        properties = feature["properties"]
        if case and properties.get("place_id"):
            place = case.get_entity(properties["place_id"])
            if not place or place["type"] != "place":
                properties.pop("place_id", None)
        group = groups[properties["group"]]
        properties["category"] = group["name"]
        properties["icon_scale"] = group["size"]
        properties["stroke_width"] = group["stroke"]
        if group["mode"] == "uniform":
            properties.update({"colour": group["colour"], "symbol": group["symbol"], "icon": ""})
    # The first group is on top, for points and shapes alike.
    ranks = {key: index for index, key in enumerate(groups)}
    features.sort(key=lambda feature: -ranks[feature["properties"]["group"]])
    return maplayers._collection(features, title=spec["title"], fmt="geojson")


def _work(spec: dict[str, Any]) -> dict[str, Any]:
    return {field: copy.deepcopy(spec[field]) for field in WORK_FIELDS if field in spec}


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
        return read(case, name)


def digest(spec: dict[str, Any]) -> str:
    data = json.dumps({"document": spec["document"], "groups": _groups(spec)},
                      ensure_ascii=False, sort_keys=True).encode()
    return maplayers.digest(data)


def render_digest(case: Case, spec: dict[str, Any]) -> str:
    """Invalidate membership labels after deleting or restoring a case place."""
    ids = sorted({f["properties"].get("place_id") for f in spec["document"]["features"]}
                 - {None, ""})
    alive = [entity_id for entity_id in ids if (place := case.get_entity(entity_id))
             and place["type"] == "place"]
    return maplayers.digest((digest(spec) + json.dumps(alive)).encode())


def _save(case: Case, name: str, spec: dict[str, Any]) -> dict[str, Any]:
    parsed = drawing(spec)
    # Group styles are a presentation override; individual styles stay recoverable.
    spec["document"] = maplayers._collection(spec["document"]["features"],
                                            title=spec["title"], fmt="geojson")["geojson"]
    spec["content_sha256"] = digest(spec)
    spec["summary"] = parsed["summary"]
    live = {group["name"] for group in _groups(spec)}
    spec["hidden"] = [group for group in spec.get("hidden", []) if group in live]
    spec["updated_at"] = maplayers._now()
    # The spec is authoritative; a missing or stale cache is rebuilt on read.
    maplayers._write_spec(case, name, spec)
    return _row(case, name, spec)


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
    return maplayers.row(name, spec, case=case)


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
            if place is None or place["type"] != "place":
                properties.pop("place_id", None)
        return {"layer": _row(case, name, spec), "document": document,
                "groups": copy.deepcopy(_groups(spec)),
                "checkpoint": (spec.get("edit_checkpoint") or {}).get("id")}


def add_marker(
    case: Case, layer: str, *, lat: float, lon: float, name: str,
    colour: str, symbol: str, description: str = "",
    group: str | None = None,
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
                geometry = validate_geometry(value)
                if geometry["type"] != marker["geometry"]["type"]:
                    raise maplayers.LayerError("keep the feature's geometry type")
                marker["geometry"] = geometry
                stored = next(f for f in spec["document"]["features"]
                              if f["properties"]["key"] == key)
                stored["geometry"] = geometry
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
        place = case.get_entity(properties["place_id"]) if properties.get("place_id") else None
        if place is None or place["type"] != "place":
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


def edit_selection(case: Case, layer: str, keys: list[str], *, changes: dict[str, Any],
                   offset: list[float] | None, remove: bool) -> dict[str, Any]:
    """Apply one atomic edit to selected features, without touching case entities."""
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
            batch = {"id": uuid.uuid4().hex, "items": [{"index": i, "feature": f}
                     for i, f in enumerate(features) if f["properties"]["key"] in chosen]}
            spec["removed_batch"] = batch
            spec["document"]["features"] = [f for f in features if f["properties"]["key"] not in chosen]
            _save(case, layer, spec)
            return {**read(case, layer), "batch": batch["id"]}

        def shifted(node: Any) -> Any:
            if not offset:
                return node
            if isinstance(node, list) and node and isinstance(node[0], (int, float)):
                point = [node[0] + offset[0], node[1] + offset[1], *node[2:]]
                if not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90:
                    raise maplayers.LayerError("keep the selection inside valid coordinates")
                return point
            return [shifted(child) for child in node]

        for key in keys:
            feature = by_key[key]
            props = feature["properties"]
            if offset:
                feature["geometry"]["coordinates"] = shifted(feature["geometry"]["coordinates"])
            for field, value in changes.items():
                if field == "group" and target:
                    props.update(group=target["id"], category=target["name"])
                elif field == "name":
                    props[field] = maplayers._text(value, maplayers.MAX_NAME)
                elif field == "description":
                    props[field] = maplayers._rich_text(value, maplayers.MAX_DESCRIPTION)
                elif field in ("colour", "symbol"):
                    props[field] = value
            if "symbol" in changes or "colour" in changes:
                props["icon"] = ""
        _save(case, layer, spec)
        return read(case, layer)


def restore_selection(case: Case, layer: str, batch_id: str) -> dict[str, Any]:
    with case.lock:
        spec = _spec(case, layer)
        batch = spec.get("removed_batch")
        if not batch or batch["id"] != batch_id:
            raise maplayers.LayerError("this removed selection is no longer available")
        features = spec["document"]["features"]
        if len(features) + len(batch["items"]) > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        groups = _groups(spec)
        ids = {group["id"] for group in groups}
        for item in batch["items"]:
            if item["feature"]["properties"].get("group") not in ids:
                item["feature"]["properties"]["group"] = groups[0]["id"]
            features.insert(min(item["index"], len(features)), item["feature"])
        spec.pop("removed_batch")
        _save(case, layer, spec)
        return read(case, layer)


def validate_geometry(value: Any) -> dict[str, Any]:
    """Bound editable geometry and refuse malformed coordinates before writing."""
    if not isinstance(value, dict) or value.get("type") not in ("Point", "LineString", "Polygon"):
        raise maplayers.LayerError("choose a point, line or area")
    coordinates = value.get("coordinates")
    kind = value["type"]
    if not isinstance(coordinates, list):
        raise maplayers.LayerError("this geometry has invalid coordinates")
    rings = [coordinates] if kind == "LineString" else coordinates if kind == "Polygon" else [[coordinates]]
    if not rings or any(not isinstance(ring, list) for ring in rings):
        raise maplayers.LayerError("this geometry has invalid coordinates")
    def finite(number: Any) -> bool:
        try:
            return not isinstance(number, bool) and isinstance(number, (int, float)) and math.isfinite(number)
        except OverflowError:
            return False
    count = 0
    for ring in rings:
        if len(ring) < (4 if kind == "Polygon" else 2 if kind == "LineString" else 1):
            raise maplayers.LayerError("add more points to this shape")
        for point in ring:
            count += 1
            if count > 4096:
                raise maplayers.LayerError("an editable shape can hold at most 4,096 points")
            if (not isinstance(point, list) or len(point) not in (2, 3)
                    or any(not finite(v) for v in point)
                    or not -180 <= point[0] <= 180 or not -90 <= point[1] <= 90):
                raise maplayers.LayerError("this geometry has invalid coordinates")
        if kind == "Polygon" and (ring[0] != ring[-1] or len({tuple(p[:2]) for p in ring}) < 3):
            raise maplayers.LayerError("an area needs a closed ring with three different corners")
        if kind == "LineString" and len({tuple(p[:2]) for p in ring}) < 2:
            raise maplayers.LayerError("a line needs two different points")
    return {"type": kind, "coordinates": copy.deepcopy(coordinates)}


def add_shape(case: Case, layer: str, *, geometry: dict[str, Any], name: str,
              colour: str, description: str, group: str | None) -> dict[str, Any]:
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
        properties = maplayers._properties(name=name.strip() or f'{"Line" if geometry["type"] == "LineString" else "Area"} {sequence}',
                                           description=description, colour=colour, category=target["name"])
        properties.update(key=uuid.uuid4().hex, group=target["id"], symbol="pin")
        features.append({"type": "Feature", "geometry": geometry, "properties": properties})
        spec["hidden"] = [item for item in spec.get("hidden", []) if item != target["name"]]
        _save(case, layer, spec)
        return read(case, layer)


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


def add_places(case: Case, layer: str, ids: list[str], group: str | None) -> dict[str, Any]:
    """Share existing place identities, keeping a local point and independent style."""
    with case.lock:
        spec = _spec(case, layer)
        target = _group(spec, group)
        spec["hidden"] = [name for name in spec.get("hidden", []) if name != target["name"]]
        features = spec["document"]["features"]
        existing = {f["properties"].get("place_id") for f in features}
        points = []
        for entity_id in dict.fromkeys(ids):
            place = case.get_entity(entity_id)
            if not place or place["type"] != "place":
                raise maplayers.LayerError("one of these case places is no longer available")
            try:
                lat, lon = (float(place["attrs"][field]) for field in ("lat", "lon"))
            except (KeyError, TypeError, ValueError) as exc:
                raise maplayers.LayerError("this case place has no valid coordinates") from exc
            if not (math.isfinite(lat) and math.isfinite(lon)
                    and -90 <= lat <= 90 and -180 <= lon <= 180):
                raise maplayers.LayerError("this case place has no valid coordinates")
            if entity_id in existing:
                continue
            properties = maplayers._properties(name=place["label"], description="",
                                               category=target["name"], colour=target["colour"])
            properties.update({"key": uuid.uuid4().hex, "place_id": entity_id,
                               "group": target["id"], "symbol": target["symbol"]})
            points.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]},
                           "properties": properties})
        if len(features) + len(points) > maplayers.MAX_FEATURES:
            raise maplayers.LayerError("this layer has reached its feature limit")
        features.extend(points)
        _save(case, layer, spec)
        return read(case, layer)


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
            if any(f["properties"].get("place_id") == entity_id for f in spec["document"]["features"]):
                layers.append({"name": row["name"], "title": row["title"]})
        return {"place": place, "related": list(related.values()), "layers": layers}
