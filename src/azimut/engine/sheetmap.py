"""A sheet on a map: its rows that hold a place, as a personal layer that remembers the sheet.

One press makes it. The analyst says which column holds the place (and, when the place is
two columns of numbers, which holds the longitude), which names a point, which its card
shows, which colours it and which dates it; `lib/sheetMap.js` proposes each from the
sheet's own roles and `detectRole`, so nothing here guesses a role a second time.

**A place is read five ways, in this order**, and the layer counts each:

- two columns of numbers, a latitude and a longitude (``columns``);
- one cell holding both, as `sheetroles.parse_latlon` reads it, a register's `~` and its
  `(±450 m)` included (``coordinates``);
- an MGRS reference (``mgrs``);
- what the cell points at in the case, a link or a column's word, where the case puts it
  (``linked``, through `sheetroles.entity_points`);
- the name of a place the case holds, when exactly one place carries it (``named``).

A row none of them reads is **counted and listed with why**, never dropped in silence.

**The layer is an ordinary personal layer** (`engine/layerediting.py`): every map draws it,
its points are moved and restyled like any other, and it keeps a link to its sheet
(``spec["sheet"]``). Each point remembers its row (``sheet_row``) and what the sheet wrote
for it last (``sheet_said``). When the sheet changes, *Update the layer* is one press and
one change, undone by one Undo:

- a field the analyst left as the sheet wrote it takes the sheet's new value;
- a field the analyst changed on the map is **kept**: a moved point stays where they put
  it, a renamed one keeps its name, one put in another group stays there, and a point they
  took out of the layer stays out;
- a new row comes in, a row gone from the sheet (or no longer read as a place) goes;
- points the analyst drew themselves are never touched.

*Replace my edits* is the other press: every row's point back exactly as the sheet says.
"""

from __future__ import annotations

import copy
import hashlib
import json
import threading
import uuid
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from ..workspace import CaseError
from . import coords, layerediting, maplayers, notes_charts, sheetroles, sheets

if TYPE_CHECKING:
    from ..workspace import Case


class SheetMapError(ValueError):
    """A choice of columns, or a sheet, the map cannot be made from."""


#: The columns a point's card may show.
MAX_CARD = 8
#: Values of the colour column that each get a group; the rest share one.
MAX_GROUPS = 12
#: Rows the answer lists as not placed. The count stays exact past it.
MAX_LISTED = 200
#: The marker a point starts as, which its group can change.
SYMBOL = "circle"
#: The colour of a layer that is not coloured by a column.
DEFAULT_COLOUR = "#0072b2"
#: The group the values past `MAX_GROUPS` share.
OTHER_VALUES = "Other values"
#: Where a link sits in a layer spec.
LINK = "sheet"
#: What a point keeps of its row.
ROW = "sheet_row"
SAID = "sheet_said"

#: How a row's place was read, in the order the reader tries.
HOWS = ("columns", "coordinates", "mgrs", "linked", "named")
#: Why a row has no point, in the words the dialog lists it with.
REASONS = {
    "empty": "no place written",
    "unread": "not a place the map can read",
    "outside": "outside the map's bounds",
    "ambiguous": "two places of the case have this name",
}
#: The choice a layer is made with: the place, its longitude when apart, the point's
#: name, its card, its colour and its days.
CHOICE = ("place", "lon", "name", "card", "colour", "start", "end")


# -- the choice --------------------------------------------------------------------------


def clean_choice(raw: Any, columns: list[str]) -> dict[str, Any]:
    """The columns a layer is made with, checked against the sheet's own."""
    if not isinstance(raw, dict):
        raise SheetMapError("choose the column that holds the place")
    known = [name for name in columns if name.casefold() != sheets.ID_COLUMN]

    def column(key: str, *, needed: bool = False) -> str:
        value = raw.get(key)
        if value in (None, ""):
            if needed:
                raise SheetMapError("choose the column that holds the place")
            return ""
        if not isinstance(value, str) or value not in known:
            raise SheetMapError(f"the column “{value}” is not in this sheet")
        return value

    choice: dict[str, Any] = {key: column(key, needed=key == "place") for key in CHOICE if key != "card"}
    if choice["lon"] == choice["place"]:
        raise SheetMapError("the latitude and the longitude are two columns")
    if choice["end"] and not choice["start"]:
        raise SheetMapError("choose when a point starts before when it ends")
    if choice["end"] and choice["end"] == choice["start"]:
        raise SheetMapError("a point starts and ends in two columns")
    card = raw.get("card") or []
    if not isinstance(card, list):
        raise SheetMapError("a card lists columns")
    picked: list[str] = []
    for value in card:
        if not isinstance(value, str) or value not in known:
            raise SheetMapError(f"the column “{value}” is not in this sheet")
        if value not in picked:
            picked.append(value)
    if len(picked) > MAX_CARD:
        raise SheetMapError(f"a point's card shows at most {MAX_CARD} columns")
    choice["card"] = picked
    return choice


# -- reading the places ------------------------------------------------------------------


class _Places:
    """The case's answers for a column's cells, read once per sheet rather than per row."""

    def __init__(self, case: "Case", meta: dict[str, Any], column: str) -> None:
        self.case = case
        self.links = meta.get("links") or {}
        self.words = (meta.get("values") or {}).get(column) or {}
        self.column = column
        self._linked: dict[str, dict[str, float]] | None = None
        self._named: dict[str, set[tuple[float, float]]] | None = None

    def pointed(self, key: str, cell: str) -> str:
        """The entity this row's cell points at: its own link, else its column's word."""
        link = (self.links.get(key) or {}).get(self.column)
        return str(link or self.words.get(cell) or "")

    def linked(self, entity_id: str) -> tuple[float, float] | None:
        if self._linked is None:
            ids = [str(cells.get(self.column)) for cells in self.links.values() if cells.get(self.column)]
            ids += [str(entity_id) for entity_id in self.words.values()]
            self._linked = sheetroles.entity_points(self.case, ids)
        point = self._linked.get(entity_id)
        return (point["lat"], point["lon"]) if point else None

    def named(self, cell: str) -> set[tuple[float, float]]:
        if self._named is None:
            self._named = {}
            for entity in self.case.list_entities():
                if entity.get("type") != "place":
                    continue
                point = sheetroles._point_of(entity)
                label = str(entity.get("label") or "").strip().casefold()
                if point and label:
                    self._named.setdefault(label, set()).add(point)
        return self._named.get(cell.strip().casefold(), set())


def _number(cell: str) -> float | None:
    try:
        return float(cell.strip().replace(",", "."))
    except ValueError:
        return None


def read_place(cell: str, *, key: str = "", lon_cell: str | None = None,
               places: _Places | None = None) -> dict[str, Any]:
    """One row's place: ``{lat, lon, how, approx, radius}``, or ``{reason}``."""
    text = str(cell or "").strip()
    if lon_cell is not None:
        lat, lon = _number(text), _number(str(lon_cell or ""))
        if not text and not str(lon_cell or "").strip():
            return {"reason": "empty"}
        if lat is None or lon is None:
            return {"reason": "unread"}
        if abs(lat) > 90 or abs(lon) > 180:
            return {"reason": "outside"}
        return {"lat": lat, "lon": lon, "how": "columns", "approx": False, "radius": None}
    if not text:
        return {"reason": "empty"}
    point = sheetroles.parse_latlon(text)
    if point:
        if point["out_of_bounds"]:
            return {"reason": "outside"}
        return {"lat": point["lat"], "lon": point["lon"], "how": "coordinates",
                "approx": bool(point.get("approx")), "radius": point.get("radius")}
    grid = coords.parse_mgrs(text)
    if grid:
        return {"lat": grid[0], "lon": grid[1], "how": "mgrs", "approx": False, "radius": None}
    if places is not None:
        pointed = places.pointed(key, text)
        found = places.linked(pointed) if pointed else None
        if found:
            return {"lat": found[0], "lon": found[1], "how": "linked", "approx": False, "radius": None}
        named = places.named(text)
        if len(named) == 1:
            lat, lon = next(iter(named))
            return {"lat": lat, "lon": lon, "how": "named", "approx": False, "radius": None}
        if len(named) > 1:
            return {"reason": "ambiguous"}
    return {"reason": "unread"}


# -- the plan ----------------------------------------------------------------------------


@dataclass
class Plan:
    """What a sheet puts on a map with one choice of columns."""

    title: str
    rows: int
    features: list[dict[str, Any]] = field(default_factory=list)
    unplaced: list[dict[str, Any]] = field(default_factory=list)
    #: ``{value, colour, count}`` per group, in the order the legend lists them.
    groups: list[dict[str, Any]] = field(default_factory=list)
    hows: dict[str, int] = field(default_factory=dict)
    #: Points with a readable start, and the ones a start column could not date.
    dated: int = 0
    undated: int = 0
    first: str = ""
    last: str = ""

    def digest(self) -> str:
        said = [[feature["row"], _said(feature)] for feature in self.features]
        paint = [[group["value"], group["colour"]] for group in self.groups]
        return hashlib.sha256(json.dumps([said, paint], sort_keys=True).encode()).hexdigest()[:32]

    def answer(self) -> dict[str, Any]:
        """The plan as the dialog reads it, before anything is made."""
        return {
            "title": self.title, "rows": self.rows, "placed": len(self.features),
            "unplaced": self.unplaced[:MAX_LISTED], "unplaced_count": len(self.unplaced),
            "groups": self.groups, "hows": self.hows,
            "dated": self.dated, "undated": self.undated, "first": self.first, "last": self.last,
            "bbox": _bbox(self.features),
        }


def _said(feature: dict[str, Any]) -> dict[str, Any]:
    """What the sheet writes for one point, which a point keeps to tell the analyst's edits apart."""
    return {"name": feature["name"], "description": feature["description"], "group": feature["group"],
            "date": feature["date"], "date_end": feature["date_end"],
            "point": [round(feature["lon"], 7), round(feature["lat"], 7)]}


def _bbox(features: list[dict[str, Any]]) -> list[float] | None:
    if not features:
        return None
    lons = [feature["lon"] for feature in features]
    lats = [feature["lat"] for feature in features]
    return [min(lons), min(lats), max(lons), max(lats)]


def _cell(row: list[str], columns: list[str], name: str) -> str:
    if not name or name not in columns:
        return ""
    at = columns.index(name)
    return str(row[at]).strip() if at < len(row) else ""


def _day(cell: str, role: dict[str, Any] | None) -> str:
    """The day a cell dates its point by; a month or a year alone dates none, as a layer's
    point is dated to the day."""
    read = sheetroles.parse_when(cell, role)
    return maplayers.iso_day(read["date"]) if read and read.get("shape") == "moment" else ""


def _card(row: list[str], columns: list[str], choice: dict[str, Any], place: dict[str, Any]) -> str:
    """The point's card: one `Column: value` line per column chosen, the place's own words
    first when they hedge or name it rather than give it."""
    lines: list[str] = []
    cell = _cell(row, columns, choice["place"])
    if place["how"] in ("mgrs", "linked", "named") or place.get("approx") or place.get("radius"):
        lines.append(f"{choice['place']}: {cell}")
    for name in choice["card"]:
        value = _cell(row, columns, name)
        if value and name != choice["name"]:
            lines.append(f"{name}: {value}")
    return "\n".join(lines)


def _paints(values: list[str], case: "Case") -> dict[str, str]:
    """Each value's colour, as a chart and a table of the case paint it: its named colour,
    else its grade's, else the next of the fixed order (`notes_charts.value_paints`)."""
    theme = notes_charts.theme_for("report")
    return notes_charts.value_paints(values, theme=theme, palette=notes_charts.case_palette(case))


def plan(case: "Case", sheet: dict[str, Any], choice: dict[str, Any]) -> Plan:
    """What `sheet` (as `sheets.read` answers) puts on a map with `choice`."""
    columns: list[str] = sheet["columns"]
    rows: list[list[str]] = sheet["rows"]
    meta: dict[str, Any] = sheet["meta"]
    roles = meta.get("roles") or {}
    key_at = sheets.key_index(columns)
    places = _Places(case, meta, choice["place"])
    built = Plan(title=str(sheet.get("title") or "Sheet"), rows=len(rows))
    colour_of = choice["colour"]
    values: list[str] = []
    for number, row in enumerate(rows, start=1):
        key = str(row[key_at]) if key_at < len(row) else ""
        cell = _cell(row, columns, choice["place"])
        place = read_place(cell, key=key, places=places,
                           lon_cell=_cell(row, columns, choice["lon"]) if choice["lon"] else None)
        name = _cell(row, columns, choice["name"])
        if "reason" in place:
            built.unplaced.append({"row": key, "number": number, "name": name, "text": cell,
                                   "reason": place["reason"], "said": REASONS[place["reason"]]})
            continue
        built.hows[place["how"]] = built.hows.get(place["how"], 0) + 1
        start = _day(_cell(row, columns, choice["start"]), roles.get(choice["start"])) if choice["start"] else ""
        end = _day(_cell(row, columns, choice["end"]), roles.get(choice["end"])) if choice["end"] else ""
        value = _cell(row, columns, colour_of) if colour_of else ""
        values.append(value)
        built.features.append({
            "row": key, "number": number, "name": name or f"Row {number}",
            "description": _card(row, columns, choice, place),
            "value": value, "group": "", "date": start, "date_end": end if start and end > start else "",
            "lat": place["lat"], "lon": place["lon"], "how": place["how"],
        })
        if choice["start"]:
            if start:
                built.dated += 1
                built.first = min(built.first or start, start)
                built.last = max(built.last, end if start and end > start else start)
            else:
                built.undated += 1
    _group(built, values, colour_of, case)
    return built


def _group(built: Plan, values: list[str], colour_of: str, case: "Case") -> None:
    """Give each point its group: one per value of the colour column, the rarest past
    `MAX_GROUPS` sharing one, and the points with no value one of their own."""
    if not colour_of:
        for feature in built.features:
            feature["group"] = built.title
        if built.features:
            built.groups = [{"value": built.title, "colour": DEFAULT_COLOUR, "count": len(built.features)}]
        return
    spelled: dict[str, str] = {}
    counts: dict[str, int] = {}
    for value in values:
        if value:
            spelled.setdefault(value.casefold(), value)
            counts[value.casefold()] = counts.get(value.casefold(), 0) + 1
    paints = _paints([value for value in values if value], case)
    graded = sum(1 for key in spelled if notes_charts.grade_of(key)) * 2 >= max(1, len(spelled))
    ranks = {grade.key: index for index, grade in enumerate(notes_charts.GRADES)}

    def rank(key: str) -> tuple[Any, ...]:
        grade = notes_charts.grade_of(key) if graded else None
        return (ranks.get(grade.key, 99) if grade else 99, -counts[key], key)

    ordered = sorted(spelled, key=rank)
    kept = ordered[: MAX_GROUPS - 1] if len(ordered) > MAX_GROUPS else ordered
    other = [key for key in ordered if key not in kept]
    names = {key: maplayers._text(spelled[key], maplayers.MAX_NAME) for key in kept}
    blank = f"No {colour_of}"[: maplayers.MAX_NAME]
    for feature in built.features:
        key = feature["value"].casefold()
        feature["group"] = names.get(key) or (OTHER_VALUES if key else blank)
    groups = [{"value": names[key], "colour": paints.get(key) or DEFAULT_COLOUR, "count": counts[key]} for key in kept]
    if other:
        groups.append({"value": OTHER_VALUES, "colour": "#8a8a8a", "count": sum(counts[key] for key in other)})
    empty = sum(1 for feature in built.features if not feature["value"])
    if empty:
        groups.append({"value": blank, "colour": "#b0b0b0", "count": empty})
    built.groups = groups


# -- the sheet's file, stamped -----------------------------------------------------------


def _sheet(case: "Case", sheet_id: str) -> dict[str, Any]:
    try:
        return sheets.read(case, sheet_id)
    except CaseError as exc:
        raise SheetMapError("its sheet is no longer in the case") from exc


def _stamp(case: "Case", entity: dict[str, Any]) -> str:
    """The sheet's file and its sidecar as they stand: a cell or a link changed moves it."""
    try:
        path, meta_path = sheets._paths(case, entity)
    except CaseError:
        return ""
    return f"{sheets.stamp(path)}|{sheets.stamp(meta_path)}"


_digests: OrderedDict[str, str] = OrderedDict()
_digests_lock = threading.Lock()
_DIGESTS_MAX = 256


def _current_digest(case: "Case", entity: dict[str, Any], choice: dict[str, Any], stamp: str) -> str:
    """The plan's digest for the sheet as it stands, kept while its files do not move."""
    key = json.dumps([str(case.tool_root), entity["id"], stamp, choice], sort_keys=True)
    with _digests_lock:
        if key in _digests:
            _digests.move_to_end(key)
            return _digests[key]
    sheet = _sheet(case, str(entity["id"]))
    digest = plan(case, sheet, clean_choice(choice, sheet["columns"])).digest()
    with _digests_lock:
        _digests[key] = digest
        while len(_digests) > _DIGESTS_MAX:
            _digests.popitem(last=False)
    return digest


def status(case: "Case", spec: dict[str, Any]) -> dict[str, Any] | None:
    """What a layer made from a sheet says of it: its title, and whether the sheet has
    moved on (``changed``), left the case (``gone``) or lost a column (``problem``)."""
    link = spec.get(LINK)
    if not isinstance(link, dict) or not link.get("id"):
        return None
    entity = case.get_entity(str(link["id"]))
    if entity is None or entity.get("type") != "sheet":
        return {"id": link["id"], "title": str(link.get("title") or ""), "gone": True, "changed": False}
    answer = {"id": link["id"], "title": str(entity.get("label") or ""), "gone": False, "changed": False}
    stamp = _stamp(case, entity)
    if stamp == link.get("stamp"):
        return answer
    try:
        answer["changed"] = _current_digest(case, entity, link.get("choice") or {}, stamp) != link.get("digest")
    except SheetMapError as exc:
        answer.update(changed=True, problem=str(exc))
    return answer


def made_from(case: "Case", sheet_id: str) -> list[dict[str, Any]]:
    """The layers of the case made from this sheet, as the panel lists them."""
    return [row for row in maplayers.listing(case) if (row.get("sheet") or {}).get("id") == sheet_id]


# -- making the layer --------------------------------------------------------------------


def preview(case: "Case", sheet_id: str, raw: Any) -> dict[str, Any]:
    """What a choice of columns would put on the map, said before anything is made."""
    sheet = _sheet(case, sheet_id)
    built = plan(case, sheet, clean_choice(raw, sheet["columns"]))
    return {**built.answer(), "layers": made_from(case, sheet_id)}


def _new_group(value: str, colour: str) -> dict[str, Any]:
    """A group for one value of the colour column. ``sheet_value`` is the value it stands
    for, so a group the analyst renames goes on taking that value's new rows."""
    return {"id": uuid.uuid4().hex[:16], "name": value, "mode": "colour", "colour": colour,
            "symbol": SYMBOL, "size": 1.0, "stroke": 2.0, "sheet_value": value}


def _value_of(group: dict[str, Any]) -> str:
    return str(group.get("sheet_value") or group.get("name") or "")


def _feature(planned: dict[str, Any], group: dict[str, Any]) -> dict[str, Any]:
    properties = maplayers._properties(name=planned["name"], description=planned["description"],
                                       category=group["name"], colour=group["colour"],
                                       date=planned["date"], date_end=planned["date_end"])
    properties.update({"key": uuid.uuid4().hex, "symbol": SYMBOL, "group": group["id"],
                       ROW: planned["row"], SAID: _said(planned)})
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [planned["lon"], planned["lat"]]},
            "properties": properties}


def _link(sheet: dict[str, Any], choice: dict[str, Any], built: Plan, stamp: str) -> dict[str, Any]:
    return {"id": sheet["id"], "title": built.title, "choice": choice, "stamp": stamp, "digest": built.digest(),
            "rows": [feature["row"] for feature in built.features], "at": maplayers._now()}


def _counts(built: Plan) -> dict[str, Any]:
    return {"points": len(built.features), "unplaced": len(built.unplaced), "dated": built.dated,
            "undated": built.undated}


def make(case: "Case", sheet_id: str, raw: Any, *, title: str = "") -> dict[str, Any]:
    """A personal layer of the sheet's rows that hold a place, linked to the sheet."""
    with case.lock:
        sheet = _sheet(case, sheet_id)
        entity = case.get_entity(sheet_id) or {}
        choice = clean_choice(raw, sheet["columns"])
        built = plan(case, sheet, choice)
        if not built.features:
            raise SheetMapError("no row of this sheet holds a place the map can read")
        made = layerediting.create(case, (title or "").strip() or built.title,
                                   description=f"From the sheet “{built.title}”.")
        name = made["name"]
        spec = layerediting._spec(case, name)
        groups = {group["value"]: _new_group(group["value"], group["colour"]) for group in built.groups}
        spec["groups"] = list(groups.values())
        spec["document"]["features"] = [_feature(planned, groups[planned["group"]]) for planned in built.features]
        spec[LINK] = _link(sheet, choice, built, _stamp(case, entity))
        spec["origin"] = {"source": {"kind": "sheet", "name": built.title}, "copied_at": maplayers._now()}
        row = layerediting._save(case, name, spec)
        return {**row, "made": _counts(built), "unplaced": built.unplaced[:MAX_LISTED]}


# -- keeping it in step ------------------------------------------------------------------


def _point(feature: dict[str, Any]) -> list[float]:
    lon, lat = feature["geometry"]["coordinates"][:2]
    return [round(float(lon), 7), round(float(lat), 7)]


def update(case: "Case", name: str, *, replace: bool = False) -> dict[str, Any]:
    """Bring a layer level with its sheet, in one change. See the module's docstring for
    what is kept; ``replace`` keeps nothing of the analyst's edits to the sheet's points."""
    with case.lock:
        spec = layerediting._spec(case, name)
        link = spec.get(LINK)
        if not isinstance(link, dict) or not link.get("id"):
            raise SheetMapError("this layer is not made from a sheet")
        if spec.get("edit_checkpoint"):
            raise SheetMapError("finish editing this layer first")
        sheet = _sheet(case, str(link["id"]))
        entity = case.get_entity(str(link["id"])) or {}
        choice = clean_choice(link.get("choice") or {}, sheet["columns"])
        built = plan(case, sheet, choice)
        before = {"document": copy.deepcopy(spec["document"]), "groups": copy.deepcopy(spec.get("groups") or []),
                  "link": {key: value for key, value in copy.deepcopy(link).items() if key != "undo"}}

        groups = layerediting._groups(spec)
        by_name = {group["name"].casefold(): group for group in groups}
        by_name.update({_value_of(group).casefold(): group for group in groups if group.get("sheet_value")})
        for planned in built.groups:
            if planned["value"].casefold() not in by_name:
                group = _new_group(planned["value"], planned["colour"])
                groups.append(group)
                by_name[planned["value"].casefold()] = group
            elif replace:
                by_name[planned["value"].casefold()]["colour"] = planned["colour"]
        ids = {group["id"]: group for group in groups}

        features = spec["document"]["features"]
        by_row = {str(f["properties"][ROW]): f for f in features if f["properties"].get(ROW)}
        wanted = {planned["row"] for planned in built.features}
        earlier = set(link.get("rows") or [])
        tally = {"added": 0, "changed": 0, "removed": 0, "kept": 0, "left_out": 0}
        kept: list[dict[str, Any]] = []
        for feature in features:
            row = feature["properties"].get(ROW)
            if row and str(row) not in wanted:
                tally["removed"] += 1
                continue
            kept.append(feature)
        for planned in built.features:
            target = by_name[planned["group"].casefold()]
            feature = by_row.get(planned["row"])
            if feature is None:
                if planned["row"] in earlier and not replace:
                    tally["left_out"] += 1  # the analyst took it out of the layer
                    continue
                kept.append(_feature(planned, target))
                tally["added"] += 1
                continue
            changed, held = _follow(feature, planned, target, ids, replace=replace)
            tally["changed"] += changed
            tally["kept"] += held
        spec["document"]["features"] = kept
        # a group the sheet made and nothing wears any more goes, the analyst's own stay
        worn = {feature["properties"].get("group") for feature in kept}
        spec["groups"] = [group for group in groups if group["id"] in worn or not group.get("sheet_value")] or groups[:1]
        token = uuid.uuid4().hex
        spec[LINK] = {**_link(sheet, choice, built, _stamp(case, entity)), "undo": {"id": token, **before}}
        layerediting._save(case, name, spec)
        spec[LINK]["undo"]["after"] = spec["content_sha256"]
        maplayers._write_spec(case, name, spec)
        return {**maplayers.read(case, name), "updated": tally, "undo": token,
                "unplaced": built.unplaced[:MAX_LISTED], "unplaced_count": len(built.unplaced)}


def _follow(feature: dict[str, Any], planned: dict[str, Any], target: dict[str, Any],
            groups: dict[str, dict[str, Any]], *, replace: bool) -> tuple[int, int]:
    """Write what the sheet says now into one point, field by field. Returns whether it
    changed, and whether a field of the analyst's was kept."""
    properties = feature["properties"]
    said = properties.get(SAID) if isinstance(properties.get(SAID), dict) else {}
    new = _said(planned)
    current_group = _value_of(groups.get(properties.get("group")) or {})
    history = bool(properties.get("states"))
    now = {"name": properties.get("name", ""), "description": properties.get("description", ""),
           "group": current_group, "date": properties.get("date", ""), "date_end": properties.get("date_end", ""),
           "point": _point(feature)}
    changed = held = False
    for field_name, value in new.items():
        if now[field_name] == value:
            continue
        # a point made before it kept what the sheet said counts as the sheet's
        theirs = bool(said) and now[field_name] != said.get(field_name)
        # a dated history is the analyst's, its point and days with it
        if history and field_name in ("point", "date", "date_end"):
            theirs = True
        if theirs and not replace:
            held = True
            continue
        if history and field_name in ("point", "date", "date_end"):
            continue
        changed = True
        if field_name == "point":
            feature["geometry"] = {"type": "Point", "coordinates": [planned["lon"], planned["lat"]]}
        elif field_name == "group":
            properties.update(group=target["id"], category=target["name"], colour=target["colour"])
        elif field_name in ("date", "date_end"):
            if value:
                properties[field_name] = value
            else:
                properties.pop(field_name, None)
        else:
            properties[field_name] = value
    if str(properties.get("date_end") or "") <= str(properties.get("date") or ""):
        properties.pop("date_end", None)
    properties[SAID] = new
    return int(changed), int(held)


def undo(case: "Case", name: str, token: str) -> dict[str, Any]:
    """Put the layer back as it was before its last update, while nothing has moved since."""
    with case.lock:
        spec = layerediting._spec(case, name)
        held = spec.get(LINK)
        link: dict[str, Any] = held if isinstance(held, dict) else {}
        slot = link.get("undo") or {}
        if not slot or slot.get("id") != token:
            raise SheetMapError("this update can no longer be undone")
        if layerediting.digest(spec) != slot.get("after"):
            raise SheetMapError("the layer changed since this update; undo that first")
        spec["document"] = slot["document"]
        spec["groups"] = slot["groups"]
        spec[LINK] = slot["link"]
        layerediting._save(case, name, spec)
        return maplayers.read(case, name)


def sheet_of(spec: dict[str, Any]) -> str:
    """The sheet a layer spec is made from, or ""."""
    link = spec.get(LINK)
    return str(link.get("id") or "") if isinstance(link, dict) else ""

