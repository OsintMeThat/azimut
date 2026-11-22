"""Steps from a layer: a note map's story steps made from one of its layers, on a press in
its card's Time tab (`editor/mapCard.js`, `POST /notes/maps/steps`).

The analyst picks a layer the map shows, an area (what the map shows, or a rectangle
dragged on it) and a period. Every dated mark of that layer inside the area and the period
counts, as the map draws it: a group the layer hides, or a plate's frame hides, never does,
and a mark followed over time counts once for each day it changes. One step a day, in date
order:

- its day, so the map shows that day when the step comes;
- its frame round that day's marks, with the area's own scale as the closest it looks, so a
  lone point keeps the land round it in view;
- its name and words, a lone mark's own name and the first words of its card, or for several
  marks the day said in words and their names (a name too long to be one, as a layer brought
  from elsewhere often writes its marks, becomes the words, the step named by its day);
- the pictures those marks show, which the step lights when it comes (`notes_maps.step_ids`).

What comes back are plain steps, written by the card as its `step:` lines and edited like any
other; nothing ties them to the layer afterwards. It reads the case alone and fetches nothing.
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING, Any, Iterator

from . import notes_maps, notesources

if TYPE_CHECKING:
    from ..workspace import Case

#: The frame a step is fitted to, as the map engine lays a note map out (`FRAME_W` × `FRAME_H`).
FRAME = (1200, 750)
#: How much closer than the whole area a step may look, in zoom levels: a lone point's frame.
CLOSER = 1.5
#: The words several marks of one day are named in, at most.
NAMED = 6
#: The longest name a step takes (`notes_maps.step_of_text`): a longer one is its words.
LABEL = 80


class StepsError(LookupError):
    """The layer is not one the map shows."""


def _pairs(coords: Any) -> Iterator[tuple[float, float]]:
    """Every ``(lon, lat)`` a shape's coordinates hold, however deep they nest."""
    if isinstance(coords, (list, tuple)) and len(coords) == 2 and all(isinstance(one, (int, float)) for one in coords):
        yield float(coords[0]), float(coords[1])
    elif isinstance(coords, (list, tuple)):
        for inner in coords:
            yield from _pairs(inner)


def _box(points: list[tuple[float, float]]) -> list[float]:
    return [min(lon for lon, _ in points), min(lat for _, lat in points),
            max(lon for lon, _ in points), max(lat for _, lat in points)]


def _meets(box: list[float], area: list[float]) -> bool:
    return box[0] <= area[2] and box[2] >= area[0] and box[1] <= area[3] and box[3] >= area[1]


def _clipped(box: list[float], area: list[float]) -> list[float]:
    return [max(box[0], area[0]), max(box[1], area[1]), min(box[2], area[2]), min(box[3], area[3])]


def _frame(layer: str, block: notes_maps.MapBlock, case: "Case") -> dict[str, Any] | None:
    """How the map draws ``layer``: a plate's frame for one of its layers, else as the layer is.
    Raises `StepsError` for a layer the map does not show."""
    if layer in block.hidden:
        raise StepsError("That layer is hidden on this map.")
    if block.plate:
        for name, frame in (notes_maps._plate(case, block.plate) or {}).get("layers") or []:
            if name == layer:
                return frame
    if layer in block.layers:
        return None
    raise StepsError("That layer is not on this map.")


def _names(labels: list[str]) -> str:
    named = [label for label in dict.fromkeys(labels) if label]
    if not named:
        return f"{len(labels)} marks"
    shown = named[:NAMED]
    more = len(named) - len(shown)
    if more:
        return f"{', '.join(shown)} and {more} more"
    return shown[0] if len(shown) == 1 else f"{', '.join(shown[:-1])} and {shown[-1]}"


def _named(found: list[dict[str, Any]], day: str) -> tuple[str, str]:
    """A step's name and words from the marks of its day."""
    if len(found) > 1:
        return notesources.spoken_day(day), _names([mark["label"] for mark in found])
    mark = found[0]
    if not mark["words"] and len(mark["label"]) > LABEL:
        return notesources.spoken_day(day), mark["title"] or mark["label"]
    return mark["label"], mark["words"]


def steps_from_layer(case: "Case", block: notes_maps.MapBlock, layer: str, *,
                     within: list[float] | None = None, start: str = "", end: str = "") -> dict[str, Any]:
    """The steps ``layer`` makes on the map ``block`` writes, from its dated marks inside
    ``within`` (``[w, s, e, n]``, every mark when None) between ``start`` and ``end`` (days,
    either open): ``{steps, marks, days, undated, more, first, last}``. ``marks`` and ``days``
    count what makes the steps, ``undated`` the marks in the area that have no day, ``more`` the
    days past the steps a map holds, ``first`` and ``last`` the layer's own span."""
    frame = _frame(layer, block, case)
    read = notes_maps._layer_features(case, layer, 0, frame, notes_maps._Icons(case))
    if read is None:
        raise StepsError("That layer is no longer in the case.")
    # each mark once, as the map draws it: the parts of one shape on one day are one mark
    marks: dict[str, dict[str, Any]] = {}
    for feature in read[0]:
        key = str(feature["id"]).split("p")[0]
        points = list(_pairs(feature.get("coords")))
        if not points:
            continue
        mark = marks.setdefault(key, {"day": str(feature.get("from") or "")[:10], "points": [],
                                      "label": str(feature.get("label") or ""),
                                      "title": str((feature.get("card") or {}).get("title") or ""),
                                      "words": str((feature.get("card") or {}).get("text") or ""),
                                      "picture": str(feature.get("picture") or feature.get("entity") or "")})
        mark["points"].extend(points)
    dated = sorted(mark["day"] for mark in marks.values() if notes_maps.DAY.match(mark["day"]))
    if start and end and end < start:
        start, end = end, start
    days: dict[str, list[dict[str, Any]]] = {}
    undated = 0
    for mark in marks.values():
        box = _box(mark["points"])
        if within is not None:
            if not _meets(box, within):
                continue
            box = _clipped(box, within)
        mark["box"] = box
        day = mark["day"]
        if not notes_maps.DAY.match(day):
            undated += 1
            continue
        if (start and day < start) or (end and day > end):
            continue
        days.setdefault(day, []).append(mark)
    area = within or (_box([point for one in days.values() for mark in one for point in mark["points"]]) if days else None)
    closest = min(notes_maps.fit_view(area, *FRAME)[2] + CLOSER, 16.0) if area else 16.0
    steps = []
    for day in sorted(days)[:notes_maps.MAX_STEPS]:
        found = days[day]
        lat, lon, zoom = notes_maps.fit_view(_box([corner for mark in found for corner in
                                                   ((mark["box"][0], mark["box"][1]), (mark["box"][2], mark["box"][3]))]),
                                             *FRAME, pad=0.15)
        pictures = list(dict.fromkeys(mark["picture"] for mark in found if mark["picture"]))
        label, words = _named(found, day)
        steps.append({
            "day": day,
            "label": label,
            "view": [round(lat, 5), round(lon, 5), round(min(zoom, closest), 2)],
            "proof": ", ".join(one for one in pictures[:notes_maps.MAX_STEP_IDS]
                               if notes_maps.ENTITY_ID.match(one)),
            "words": notes_maps._cut(" ".join(words.split()), notes_maps.MAX_STEP_WORDS),
        })
    return {"steps": steps, "marks": sum(len(one) for one in days.values()), "days": len(days), "undated": undated,
            "more": max(0, len(days) - notes_maps.MAX_STEPS), "first": dated[0] if dated else "",
            "last": dated[-1] if dated else ""}


def finite_box(values: list[float]) -> bool:
    """Whether ``[w, s, e, n]`` is a part of the world, west before east and south before north."""
    if len(values) != 4 or not all(math.isfinite(value) for value in values):
        return False
    west, south, east, north = values
    return -180 <= west < east <= 180 and -90 <= south < north <= 90
