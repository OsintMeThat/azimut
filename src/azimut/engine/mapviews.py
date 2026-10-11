"""Case-owned map compositions reference live layers, without copying evidence."""

from __future__ import annotations

import json
import re
import uuid
from typing import Any

from .. import layout
from ..workspace import Case, write_text_atomic
from .maplayers import LayerError


def read(case: Case, name: str) -> dict[str, Any]:
    if not re.fullmatch(r"[a-f0-9]{32}", name):
        raise LayerError("this map composition is not available")
    entity = case.find_entity(attr="spec", value=layout.map_view_rel(name))
    if not entity or entity["type"] != "map-view":
        raise LayerError("this map composition is not available")
    try:
        view = dict(json.loads(case.resolve_inside(layout.map_view_rel(name)).read_text(encoding="utf-8")))
        view["title"] = entity["label"]
        return view
    except (OSError, ValueError, TypeError) as exc:
        raise LayerError("this map composition cannot be read") from exc


def listing(case: Case) -> list[dict[str, Any]]:
    result = []
    for entity in case.list_entities():
        if entity["type"] == "map-view":
            name = str(entity["attrs"].get("spec", "")).rsplit("/", 1)[-1].removesuffix(".json")
            try:
                result.append(read(case, name))
            except LayerError:
                continue
    return result


def save(case: Case, body: dict[str, Any]) -> dict[str, Any]:
    with case.lock:
        body = dict(body)
        body["title"] = body["title"].strip()
        if not body["title"]:
            raise LayerError("give this map composition a name")
        name = body.pop("id", None) or uuid.uuid4().hex
        if not isinstance(name, str) or not re.fullmatch(r"[a-f0-9]{32}", name):
            raise LayerError("this map composition is not available")
        existing = case.find_entity(attr="spec", value=layout.map_view_rel(name))
        if existing and existing["type"] != "map-view":
            raise LayerError("this file belongs to another item")
        if not existing and name.casefold() in case.trashed_stems(layout.MAP_VIEWS_DIR):
            raise LayerError("this map composition is in the Trash")
        saved = {"version": 1, "id": name, **body}
        case.subdir(layout.MAP_VIEWS_DIR)
        path = case.resolve_inside(layout.map_view_rel(name))
        write_text_atomic(path, json.dumps(saved, ensure_ascii=False, indent=2))
        attrs = {"spec": layout.map_view_rel(name)}
        if existing:
            case.update_entity(existing["id"], {"label": body["title"], "attrs": attrs})
        else:
            case.add_entity("map-view", body["title"], attrs=attrs, by="map")
        return saved
