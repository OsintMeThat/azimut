"""The place a note offers for the site's map, when it names one obvious point.

An article may stand somewhere on a map of the analyst's site (`notelook.NotePlace`), and most
never do: a guide to a tool or a method stands nowhere. So the publish dialog never fills a place
by itself. It offers one, as a press the analyst may ignore, only when the note leaves no doubt:

**The rule.** The one place the note names, else the view of its one map.

- A note names what its own public text points at with `[[entity:…]]`, `[[media:…]]` or a link
  to `azimut://entity/…`, outside code fences and internal passages. Its chapters are not read.
- A place (`place`) stands at its own point, under its own name.
- A proof stands where its Geolocations row says it concluded (`noteannexes.concluded_point`),
  named by the place it depicts (a confirmed edge) or by its point's own label. A proof that
  depicts a place counts as that place, so a note naming the place and three proofs of it names
  one place. A proof known only by where it was filmed from offers nothing: that point is the one
  a public edition may round away.
- With no place named at all, a note holding exactly one `::: map` offers where it looks: its
  `view`, else the middle of its `frame`, with no name.

Two places named, or none and two maps, offer nothing. The answer says which of the three it is
(``from``) and what it was read from (``label``), so the dialog can say its rule.
"""

from __future__ import annotations

import math
import re
from typing import TYPE_CHECKING, Any

from pydantic import ValidationError

from . import notes_maps, notes_markdown, notetext
from .noteannexes import concluded_point, depicted_place, names_a_place
from .notelook import PLACE_NAME_MAX, NotePlace

if TYPE_CHECKING:
    from ..workspace import Case

#: A written link to a record of the case.
ENTITY_LINK = re.compile(r"\]\(azimut://entity/([A-Za-z0-9_-]+)\)")


def suggest(case: "Case", note_id: str) -> dict[str, Any] | None:
    """The point the note offers for the site's map, as ``{lat, lon, name, from, label}``, or None
    when the rule above finds none. Reads the case only."""
    read = notes_markdown.read_note(case, note_id)
    if read is None:
        return None
    text = notes_markdown.strip_internal(read[1])[0]
    found: dict[str, dict[str, Any]] = {}
    for entity_id in named_ids(text):
        point = _point_of(case, entity_id)
        if point is not None:
            found.setdefault(point.pop("key"), point)
    if found:
        return _drawable(next(iter(found.values()))) if len(found) == 1 else None
    return _one_map(text)


def named_ids(text: str) -> list[str]:
    """The records a note's text points at, in the order it names them, once each, none in a code fence."""
    fenced = notes_markdown.fenced_spans(text)
    found: list[tuple[int, str]] = []
    for pattern in (notetext.ENTITY_REF, notetext.MEDIA_REF, ENTITY_LINK):
        for match in pattern.finditer(text):
            if not any(start <= match.start() < end for start, end in fenced):
                found.append((match.start(), match.group(1)))
    return list(dict.fromkeys(entity_id for _, entity_id in sorted(found)))


def _point_of(case: "Case", entity_id: str) -> dict[str, Any] | None:
    """Where a named record stands, with the key it counts under: a place's own id, the id of the
    place a proof depicts, else the proof's own; None for a record that stands nowhere."""
    record = case.get_entity(entity_id) or {}
    kind = record.get("type")
    if kind == "place":
        return _place_point(record)
    if kind != "proof":
        return None
    depicted = depicted_place(case, entity_id)
    if depicted is not None and (point := _place_point(depicted)) is not None:
        return point
    concluded = concluded_point(case, record.get("attrs") or {})
    if concluded is None or concluded.get("pov"):
        return None
    lat, lon = _number(concluded.get("lat")), _number(concluded.get("lon"))
    if lat is None or lon is None:
        return None
    # named as its Geolocations row names it: the place it depicts, else its point's own label
    name = _label(depicted) if depicted is not None else ""
    if not names_a_place(name):
        name = " ".join(str(concluded.get("label") or "").split())
    return _offered(entity_id, lat, lon, name if names_a_place(name) else "", "proof", _label(record))


def _place_point(record: dict[str, Any]) -> dict[str, Any] | None:
    attrs = record.get("attrs") or {}
    lat, lon = _number(attrs.get("lat")), _number(attrs.get("lon"))
    if lat is None or lon is None:
        return None
    name = _label(record)
    return _offered(str(record.get("id") or ""), lat, lon, name if names_a_place(name) else "", "place", name)


def _one_map(text: str) -> dict[str, Any] | None:
    """Where the note's one map looks: its view, else the middle of its frame; None for no map or several."""
    blocks = notes_maps.blocks_in(text)
    if len(blocks) != 1:
        return None
    block = blocks[0]
    if block.view is not None:
        lat, lon = block.view[0], block.view[1]
    elif block.frame is not None:
        west, south, east, north = block.frame
        lat, lon = (south + north) / 2, (west + east) / 2
    else:
        return None
    return _drawable({"lat": lat, "lon": lon, "name": "", "from": "map", "label": " ".join(block.title.split())})


def _offered(key: str, lat: float, lon: float, name: str, source: str, label: str) -> dict[str, Any]:
    return {"key": key, "lat": lat, "lon": lon, "name": name, "from": source, "label": label}


def _drawable(point: dict[str, Any]) -> dict[str, Any] | None:
    """The point as the dialog is offered it, held to what a place may be; None when web maps
    cannot draw it, so a note's one place too far north offers nothing rather than another."""
    try:
        place = NotePlace(lat=point["lat"], lon=point["lon"], name=point["name"][:PLACE_NAME_MAX].strip())
    except ValidationError:
        return None
    return {**place.model_dump(mode="json"), "from": point["from"], "label": point["label"][:200]}


def _label(record: dict[str, Any]) -> str:
    return " ".join(str(record.get("label") or "").split())


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None
