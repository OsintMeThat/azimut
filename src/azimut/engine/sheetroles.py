"""What the server has to know about a sheet's column roles.

The browser owns reading a role — the chips, the badges, the sort — because that is
presentation, and `lib/sheetRoles.js` is where it lives. This module is the other half:
the two things a role does that **only the server can do**, plus the vocabulary both
sides have to agree on.

Those two things are the columns the app fills in rather than the analyst:

``stamped``
    The date a row first appeared. Written once, into a cell that is still empty, and
    never touched again. It has to be here because the browser's clock is not the
    case's, and because a row that arrives by import has no browser behind it.

``computed``
    What the case knows about the row, restated on every read and every save.
    ``has_point`` asks whether the entity this row points at can be put on a map;
    ``point`` and ``relations`` answer with what the case actually holds about it, the
    coordinates and the far end of its edges. All three need the graph, so none of them
    can be answered in a tab holding only a table.

Both are **written into the CSV**, not kept beside it. That is deliberate and it is the
one place a role touches the file: `On map: YES/NO` is precisely the column a
collaborator opening the spreadsheet reads, and keeping it in the sidecar would make it
vanish at the moment the file is handed over.

The rest of what this module owns is arithmetic no side could do alone: an **offset**
read as seconds from a named anchor, which is what turns ten videos lined up on one shot
into ten absolute times the moment somebody dates that shot.

The role *vocabulary* is declared twice, once per side, and a test compares the two
lists (`tests/test_sheets.py`). One shared list in one language would mean the browser
fetching its own vocabulary before it could draw a chip.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from ..workspace import Case

#: Every role a column may hold. Mirrors `lib/sheetRoles.ROLE_KINDS`. The last three
#: arrived with the bridge to the case and each is read by something: ``url`` is the
#: column a promotion files as sources, ``row`` points at another row of the same
#: sheet, ``offset`` carries a time relative to a named anchor.
ROLE_KINDS = (
    "state",
    "choice",
    "boolean",
    "number",
    "latlon",
    "when",
    "picture",
    "url",
    "row",
    "offset",
    "stamped",
    "computed",
)

#: The state vocabulary a column starts with, in order. Mirrors
#: `lib/sheetRoles.STATE_DEFAULTS`. The order *is* the ranking the sort reads.
STATE_DEFAULTS = ("to do", "in progress", "done", "ruled out")

#: And the colour each of those four is painted, so a worklist reads at a glance before it
#: reads row by row. Mirrors `lib/sheetRoles.STATE_COLOURS`. Seeded at birth like the
#: words, and under them: what a role declares wins, so a colour cleared stays cleared.
STATE_COLOURS = {
    "to do": "grey",
    "in progress": "blue",
    "done": "green",
    "ruled out": "red",
}

#: The two words a boolean column starts with, yes first, so the sort puts what is true
#: above what is not. Mirrors `lib/sheetRoles.BOOLEAN_DEFAULTS`. The same pair a computed
#: column writes, so a file holds one spelling of yes whichever side filled it.
BOOLEAN_DEFAULTS = ("YES", "NO")

#: The three things a ``when`` column can hold, which are the three the binders write.
#: Mirrors `lib/sheetRoles.WHEN_SHAPES`. Declared rather than inferred, so a column that is
#: still empty can be told it holds times.
WHEN_SHAPES = ("date", "time", "datetime")

#: What a computed column may hold. Mirrors `lib/sheetRoles.COMPUTED_NATURES`.
#:
#: ``has_point``
#:     Whether what the row points at can be put on a map. Needs the graph.
#: ``filled_of``
#:     How many of the chosen columns this row has an answer in. The reading a
#:     comparison grid is built for: eleven candidates against six criteria, and the
#:     question is which rows are actually finished.
#: ``yes_of``
#:     How many of the chosen columns say yes. The score of that same grid.
#: ``point``
#:     Where the case puts what one column's cell points at, as ``lat, lon``.
#: ``relations``
#:     What the case has joined that same entity to, as the labels at the far end.
#:
#: The two counting ones are arithmetic over the row's own cells, so they could have been
#: read in the browser — they are here because a computed column is **written into the
#: CSV**, and the collaborator who opens the file is owed the number, not an empty column.
#:
#: The last two answer a different question from `has_point`, and it is the one that was
#: asked at the desk: a column pointed at the case says *that* the case knows the subject
#: and nothing about *what* it knows, so the coordinates and the parent unit went on being
#: copied by hand into the next column along. One hop, like `has_point`: the relations of
#: the relations answer a question nobody put.
COMPUTED_NATURES = ("has_point", "filled_of", "yes_of", "point", "relations")

#: The natures that count over a chosen set of columns rather than asking the graph.
COUNTING_NATURES = ("filled_of", "yes_of")

#: The natures that read one column's link and restate what the case holds at the end of
#: it. They take ``from``, which is the column whose cell points somewhere.
LINKED_NATURES = ("point", "relations")

#: What a yes looks like in a column nobody has declared a yes/no column. Mirrors
#: `lib/sheetRoles.YES_WORDS`: a declared column's own first value wins over this, and
#: this is what answers for the rest — a tick column drawn by hand holds `x`.
YES_WORDS = ("yes", "y", "true", "oui", "x", "1", "ok", "done")

#: How many columns one counting nature may be told to read. A score over sixty columns
#: is not a score, and the bound keeps a save linear in the table.
MAX_COUNTED_COLUMNS = 24

#: The one answer a number column's footer gives. Mirrors `lib/sheetRoles.NUMBER_SUMMARIES`.
#: Asked rather than assumed: a total is what a column of counts wants and nonsense on a
#: column of percentages.
NUMBER_SUMMARIES = ("none", "count", "sum", "mean", "range")

#: How long a unit may be. `%`, `€`, `km`, `rounds` — a label, not a sentence.
MAX_UNIT = 8

#: The colours a value's chip may be painted, which are the row colours. Mirrors
#: `engine/sheets.ROW_COLOURS` — imported rather than restated, because a second copy on
#: this side is the one that would go wrong.
def _row_colours() -> tuple[str, ...]:
    from .sheets import ROW_COLOURS

    return ROW_COLOURS

#: Words a computed column writes. The binders' own, in a spreadsheet's own casing, so
#: a filter set up on the old file still matches the new one.
COMPUTED_YES = "YES"
COMPUTED_NO = "NO"

#: How many values a vocabulary may hold. Mirrors the browser's own bound on the values
#: a filter menu offers.
MAX_ROLE_VALUES = 40

#: How long a synchronisation anchor may be named. `IGLA launch`, `second impact` — the
#: name is read in a heading and in a Claim's reasoning, so it is a phrase, not a note.
MAX_ANCHOR_NAME = 60

#: How many anchors one sheet may declare. An event has a handful of moments several
#: videos can all be lined up on; past that the sheet is a transcript.
MAX_ANCHORS = 12

#: How many values one ``relations`` cell writes out. The far end of an entity's edges is
#: a reading, not a dump: a subject joined to sixty things says nothing in a cell, and the
#: Graph is where that is looked at.
MAX_RELATION_VALUES = 8

#: What a ``relations`` cell separates its values with when the column says nothing.
#: The binders' own, and what a spreadsheet's own concatenation produces.
DEFAULT_SEPARATOR = ", "

#: Verbs that put their holder at a place: a recording where it was made, a structure
#: at its site, a statement at the place it is about. All three run *towards* the place,
#: so the holder is the ``from`` side.
PLACED_BY = ("located-at", "sited-at", "at")

#: What a statement is about. A subject with no point of its own is on the map when a
#: dated statement places it — which is how this ontology positions a vehicle or a
#: unit, since `located-at` is for collected media and `sited-at` for structures. The
#: walk stops there: two hops answers "this is placed", three would answer "something
#: near this is placed", which is not what the column says.
ABOUT = "about"

#: Edges a ``relations`` column does not restate. A chain edge says how a file was
#: produced rather than what the case joined; a `mentions` from the sheet itself would
#: make the column answer with the sheet the analyst is reading.
NOT_A_RELATION = ("derived-from", "depends-on", "mentions")


def clean_role(role: Any, columns: list[str] | None = None) -> dict[str, Any] | None:
    """One column's role, reduced to the fields its kind uses, or None.

    Fields a kind does not use are dropped rather than carried: a column that was a
    ``choice`` and became a ``when`` would otherwise keep a vocabulary nobody reads.

    ``columns`` is the table's own headings, and it is only read by the counting
    natures: a score told to read a column that has since been renamed must lose it,
    the same way a role loses its own column.
    """
    if not isinstance(role, dict) or role.get("kind") not in ROLE_KINDS:
        return None
    kind = str(role["kind"])
    clean: dict[str, Any] = {"kind": kind}
    if kind in ("state", "choice", "boolean"):
        raw = role.get("values")
        values: list[str] = []
        if isinstance(raw, list):
            for value in raw:
                text = str(value)
                if text and text not in values:
                    values.append(text)
        clean["values"] = values[:MAX_ROLE_VALUES]
        # A state column nobody has said anything about is born with the four words and
        # the four colours together: painting four chips by hand is what a default is for.
        born = kind == "state" and not clean["values"]
        if born:
            clean["values"] = list(STATE_DEFAULTS)
        # Exactly two: that is what makes one click a toggle rather than a menu.
        if kind == "boolean":
            clean["values"] = clean["values"][:2]
            while len(clean["values"]) < 2:
                clean["values"].append(BOOLEAN_DEFAULTS[len(clean["values"])])
            # How the grid draws the cell, and nothing more. A tick column is a yes/no
            # column: the file holds the same two words, so the CSV a collaborator opens
            # reads the same whether the grid drew chips or boxes.
            clean["tick"] = bool(role.get("tick"))
        # A colour per value, kept apart from the values: a value is what a cell is
        # matched against, so it stays exactly the word the file holds. What the role says
        # wins over the birth colours, value by value: a colour can be changed and a
        # colour can be removed.
        colours = role.get("colours")
        asked = dict(STATE_COLOURS) if born else {}
        if isinstance(colours, dict):
            asked.update(colours)
        clean["colours"] = {
            str(value): str(colour)
            for value, colour in asked.items()
            if value in clean["values"] and colour in _row_colours()
        }
    if kind == "choice":
        # A separator or nothing. Reading `2x S-125` as two of `S-125` was stored here
        # too and is gone: it kept a count in a column of values, and a count belongs in
        # a number column beside a column naming what is counted.
        multi = role.get("multi")
        clean["multi"] = multi if isinstance(multi, str) and multi else None
    if kind == "number":
        # What follows the number when it is written out — `%`, `€`, `km`. A unit rather
        # than a list of formats: a percentage and a currency differ by the sign after
        # the digits.
        unit = role.get("unit")
        clean["unit"] = str(unit).strip()[:MAX_UNIT] if isinstance(unit, str) else ""
        # Whether it is written after every cell as well as beside the heading. Asked
        # rather than assumed: `40 %` reads as the value on a column of shares, and a
        # column of distances repeated four hundred times reads as noise.
        clean["unitInCells"] = bool(role.get("unitInCells"))
        summary = role.get("summary")
        clean["summary"] = summary if summary in NUMBER_SUMMARIES else "sum"
        # A `whole` flag was stored here and read by nothing — no rounding, no editor
        # step, no footer. Dropped rather than finished, like the time zone below.
    if kind == "when":
        shape = role.get("shape")
        clean["shape"] = shape if shape in WHEN_SHAPES else WHEN_SHAPES[0]
        # A time zone was stored here and read by nothing: the file keeps the words, so a
        # date is never converted, and a field the sidecar carried without anyone acting
        # on it was a setting that appeared to do something. Dropped rather than finished.
        # Which number a slash date leads with. Guessing silently reverses twelve days
        # a month, and the binders read `dd/MM/yyyy`, so it is stated, not inferred.
        clean["dayFirst"] = True if role.get("dayFirst") is None else bool(role["dayFirst"])
    if kind == "row":
        # Which column's words name the other row. The binders wrote `Links with others`
        # holding unit names, so the pointer is the **word a reader recognises** and not a
        # key: a file whose links read `r7f3a` is a file the collaborator cannot follow,
        # and the validation that held those names is the one already broken to `#REF!`.
        target = role.get("of")
        known = columns is None or (isinstance(target, str) and target in columns)
        clean["of"] = str(target) if isinstance(target, str) and target and known else None
        # A brigade lists several companies, so a cell holds several names by default.
        multi = role.get("multi")
        clean["multi"] = multi if isinstance(multi, str) and multi else None
    if kind == "offset":
        # Which anchor the cell is counted from. One column per anchor and no syntax in
        # the cell: the binders already held `start synchro` *and* `end synchro`, so a
        # single anchor per sheet would not have survived the first real event. Named
        # rather than validated against the sidecar here — an anchor may be declared on a
        # column before anyone has dated it, which is the whole point of relative order.
        anchor = role.get("anchor")
        clean["anchor"] = str(anchor).strip()[:MAX_ANCHOR_NAME] if isinstance(anchor, str) else ""
    if kind == "computed":
        of = role.get("of")
        clean["of"] = of if of in COMPUTED_NATURES else COMPUTED_NATURES[0]
        if clean["of"] in COUNTING_NATURES:
            # Which columns it counts. Kept in the order the analyst chose them: the
            # number does not depend on it, but the panel lists them back and a list
            # that reshuffles itself reads as a different answer.
            raw = role.get("columns")
            counted: list[str] = []
            if isinstance(raw, list):
                for name in raw:
                    text = str(name)
                    known = columns is None or text in columns
                    if text and known and text not in counted:
                        counted.append(text)
            clean["columns"] = counted[:MAX_COUNTED_COLUMNS]
        if clean["of"] in LINKED_NATURES:
            # Which column's link it follows. Named rather than swept, because a sheet
            # may point at the case from more than one column — a subject and a place —
            # and a nature reading "whatever this row points at" would answer about
            # whichever of them the walk reached first.
            source = role.get("from")
            known = columns is None or (isinstance(source, str) and source in columns)
            clean["from"] = str(source) if isinstance(source, str) and source and known else None
        if clean["of"] == "relations":
            multi = role.get("multi")
            clean["multi"] = (
                multi if isinstance(multi, str) and multi else DEFAULT_SEPARATOR
            )
    return clean


def clean_roles(roles: Any, columns: list[str]) -> dict[str, Any]:
    """Every role a sheet declares, dropped where its column is gone."""
    if not isinstance(roles, dict):
        return {}
    known = set(columns)
    kept: dict[str, Any] = {}
    for column, role in roles.items():
        clean = clean_role(role, columns)
        if clean is not None and column in known:
            kept[str(column)] = clean
    return kept


# -- reading a point out of a cell --------------------------------------------
#
# The browser reads points too (`lib/sheetRoles.parseLatLon`) and for the same three
# shapes, because it draws the badge that says how precise a cell is. This copy exists
# because **promotion writes to the graph**: a place minted from a cell the server never
# read would be a point the case believes on the browser's word alone.

_DECIMAL_PAIR = re.compile(
    r"^\s*([+-]?\d{1,3}(?:[.,]\d+)?)\s*°?\s*([NnSs])?"
    r"(\s*[,;/]\s*|\s+)"
    r"([+-]?\d{1,3}(?:[.,]\d+)?)\s*°?\s*([EeWw])?\s*$"
)
_DMS = re.compile(r"(\d{1,3})\s*°\s*(\d{1,2})?\s*['′]?\s*([\d.]+)?\s*[\"″]?\s*([NnSsEeWw])")

#: One degree of latitude, in metres. The last decimal a cell was written to is how
#: precisely whoever wrote it was claiming to know the ground.
DEGREE_M = 111_320


def _decimals(text: str) -> int:
    body = str(text).replace(",", ".")
    at = body.find(".")
    return 0 if at == -1 else len(body) - at - 1


def _signed(value: str, hemisphere: str | None, negatives: str) -> float:
    """The number a cell wrote, negated when its hemisphere says south or west.

    The membership test is on a *list* rather than a string: `"" in "S"` is true, so a
    pair written without hemispheres — which is most of them — came out mirrored into
    the wrong hemisphere.
    """
    number = float(str(value).replace(",", "."))
    letter = str(hemisphere or "").upper()
    return -abs(number) if letter and letter in list(negatives) else number


def parse_latlon(text: Any) -> dict[str, Any] | None:
    """A cell read as a point, or None. Mirrors `lib/sheetRoles.parseLatLon`.

    Three shapes, because one binder column held all three: `48.8566, 2.3522`,
    `48.8566N 2.3522E`, and `48°51'24"N 2°21'08"E`.

    ``decimals`` is how precisely the cell was written, which is a claim about the
    ground rather than a detail of formatting: two decimals is about a kilometre.
    ``out_of_bounds`` is reported rather than refused here — the caller decides, and a
    transposed pair is a finding about the file.

    **A comma is a decimal mark.** That is the app's one reading of a comma in a number
    (`sheetpromote._NUMBER_NOISE` reads it the same way), so `48,8` is one number and not
    two coordinates. It separates a pair only where it cannot be decimal: a space after it,
    a hemisphere letter, or a full stop already doing the job.
    """
    body = str(text or "").strip()
    if not body:
        return None

    pair = _DECIMAL_PAIR.match(body)
    if pair:
        raw_lat, lat_hem, separator, raw_lon, lon_hem = pair.groups()
        if separator == "," and "." not in body and not (lat_hem or lon_hem):
            return None
        try:
            lat = _signed(raw_lat, lat_hem, "S")
            lon = _signed(raw_lon, lon_hem, "W")
        except ValueError:
            return None
        return {
            "lat": lat,
            "lon": lon,
            "decimals": min(_decimals(raw_lat), _decimals(raw_lon)),
            "out_of_bounds": abs(lat) > 90 or abs(lon) > 180,
        }

    parts = _DMS.findall(body)
    if len(parts) == 2:
        read: list[tuple[str, float]] = []
        for deg, minute, second, hem in parts:
            value = float(deg) + float(minute or 0) / 60 + float(second or 0) / 3600
            read.append((hem.upper(), _signed(str(value), hem, "SW")))
        north = next((value for hem, value in read if hem in "NS"), None)
        east = next((value for hem, value in read if hem in "EW"), None)
        if north is None or east is None:
            return None
        # Seconds resolve to about thirty metres, which is five decimal places of
        # confidence the writer did not claim; four is the honest reading.
        return {
            "lat": north,
            "lon": east,
            "decimals": 4,
            "out_of_bounds": abs(north) > 90 or abs(east) > 180,
        }
    return None


def precision_metres(places: int) -> int:
    """About how far apart two points written to this many decimals could be."""
    return round(DEGREE_M * 10 ** -max(0, int(places)))


# -- offsets, and the anchor they are counted from ----------------------------
#
# The binders held `start synchro` and `end synchro` in `-00:01:50` / `00:04:04`: ten
# videos lined up on one shot that is visible and audible in all of them. The relative
# order is usable straight away; the moment the anchor gets a time, every one of those
# videos has an absolute time to the second. Mirrors `lib/sheetRoles.parseOffset`.

_OFFSET = re.compile(r"^([+-]?)(?:(\d+):)?(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?$")
_BARE_SECONDS = re.compile(r"^([+-]?)(\d{1,5})(?:[.,](\d{1,3}))?\s*s?$", re.IGNORECASE)


def parse_offset(text: Any) -> float | None:
    """A cell read as seconds away from an anchor, or None.

    `-00:01:50`, `00:04:04`, `1:05` and a bare `-110` — the four spellings a video
    player and a spreadsheet between them produce. Negative means *before* the anchor,
    which is what the binders' leading minus already meant.
    """
    body = str(text or "").strip()
    if not body:
        return None
    match = _OFFSET.match(body)
    if match:
        sign, hours, minutes, seconds, fraction = match.groups()
        if int(seconds) > 59 or (hours is not None and int(minutes) > 59):
            return None
        total = int(hours or 0) * 3600 + int(minutes) * 60 + int(seconds)
        value = total + (float(f"0.{fraction}") if fraction else 0.0)
        return -value if sign == "-" else value
    bare = _BARE_SECONDS.match(body)
    if bare:
        sign, seconds, fraction = bare.groups()
        value = int(seconds) + (float(f"0.{fraction}") if fraction else 0.0)
        return -value if sign == "-" else value
    return None


def format_offset(seconds: float) -> str:
    """Seconds written back the way the binders write them, `-00:01:50`.

    One spelling out, several in: what the analyst typed stays in the cell, and this is
    only for the reasoning a Claim carries, where the offset has to be quoted.
    """
    sign = "-" if seconds < 0 else ""
    whole = int(abs(seconds))
    return f"{sign}{whole // 3600:02d}:{whole % 3600 // 60:02d}:{whole % 60:02d}"


_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?$")


def clean_anchor_at(text: Any) -> str:
    """An anchor's own time, normalised to a UTC timestamp, or empty.

    A **timestamp**, never a bare date: an anchor exists so ten videos can be given an
    absolute time to the second, and a date silently read as midnight would hand every
    one of them a moment nobody claimed. Empty is a real state and the common one — a
    shot is named and lined up long before anyone works out when it happened.
    """
    body = str(text or "").strip()
    if not body or not _TIMESTAMP.match(body):
        return ""
    return offset_moment(body, 0) or ""


def offset_moment(anchor_at: str, seconds: float) -> str | None:
    """The absolute instant an offset lands on, as the timestamp a Claim stores.

    The anchor's own time is what `engine/temporal` calls an instant, so this stays
    inside that profile: a UTC timestamp written to the second, which is the precision
    a synchronised video actually supports.

    None when the anchor has no time yet, which is a normal state rather than an error:
    relative order is worth having before anybody has dated the shot.
    """
    body = str(anchor_at or "").strip()
    if not body:
        return None
    try:
        moment = datetime.fromisoformat(body.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    shifted = moment.astimezone(UTC) + timedelta(seconds=round(seconds))
    return shifted.strftime("%Y-%m-%dT%H:%M:%SZ")


# -- dates and times ----------------------------------------------------------
#
# The browser reads these too (`lib/sheetRoles.parseWhen`) because it sorts by them and
# offers a picker in the column's own spelling. This copy exists for the same reason
# `parse_latlon` has one: **promotion writes to the graph**, and a Claim dated on the
# browser's reading of a cell would be a moment the case believes on the browser's word.

_CLOCK = re.compile(r"^(\d{1,2}):(\d{2})(?::(\d{2}))?$")
_SLASH = re.compile(
    r"^(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$"
)
_RFC = re.compile(
    r"^(?:\w{3},\s*)?(\d{1,2})\s+(\w{3})\w*\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?",
    re.IGNORECASE,
)
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec")


def _clock(hour: Any, minute: Any, second: Any) -> str:
    return f"{int(hour or 0):02d}:{int(minute or 0):02d}:{int(second or 0):02d}"


def _holds(hour: Any, minute: Any, second: Any) -> bool:
    """Whether this is a time of day rather than one that rolls into the next.

    Stated once because both shapes need it — a bare clock and a date carrying one — and
    the browser's mirror asks the same question in `lib/sheetRoles.clockHolds`.
    """
    return int(hour or 0) <= 23 and int(minute or 0) <= 59 and int(second or 0) <= 59


def parse_when(text: Any, role: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """A cell read as a moment, or None. Mirrors `lib/sheetRoles.parseWhen`.

    Everything the three binders wrote: `dd/MM/yyyy`, `yyyy-MM-dd`, a bare `hh:mm`,
    either of the first two with a time appended, and the full RFC form an email header
    carries.

    A bare clock stays a **time of day** rather than being pinned to some invented date:
    the binders' `Local time` column holds `01:57` for an event whose date lives in the
    sheet's title, and giving it a date here would be inventing evidence. ``shape`` says
    which of the two a reading is, and what a Claim does about the missing date is
    `claim_moment`'s business, out loud.
    """
    body = str(text or "").strip()
    if not body:
        return None
    day_first = True if (role or {}).get("dayFirst") is None else bool((role or {})["dayFirst"])

    clock = _CLOCK.match(body)
    if clock:
        hour, minute, second = (int(part or 0) for part in clock.groups())
        if not _holds(hour, minute, second):
            return None
        return {
            "shape": "time",
            "date": "",
            "clock": _clock(hour, minute, second),
            "text": f"{hour:02d}:{minute:02d}",
        }

    rfc = _RFC.match(body)
    if rfc and rfc.group(2).lower()[:3] in _MONTHS:
        month = _MONTHS.index(rfc.group(2).lower()[:3]) + 1
        return _moment(int(rfc.group(3)), month, int(rfc.group(1)), *rfc.groups()[3:])

    slash = _SLASH.match(body)
    if slash:
        one, two, three = slash.group(1), slash.group(2), slash.group(3)
        # A four-digit leading group can only be a year, whatever the column's convention.
        isoish = len(one) == 4
        year = int(one if isoish else (f"20{three}" if len(three) == 2 else three))
        day = int(three if isoish else (one if day_first else two))
        month = int(two if isoish else (two if day_first else one))
        return _moment(year, month, day, *slash.groups()[3:])
    return None


def _moment(
    year: int, month: int, day: int, hour: Any, minute: Any, second: Any
) -> dict[str, Any] | None:
    if not 1 <= month <= 12 or not 1 <= day <= 31:
        return None
    # The time of day, checked exactly as the bare-clock branch checks it. Without this
    # `03/01/2026 99:00` read as a moment whose clock was `99:00:00`, and the refusal
    # arrived one layer down as "the timestamp is not a valid Gregorian date and time" —
    # about a value the analyst never wrote, instead of about the cell they did.
    if hour is not None and not _holds(hour, minute, second):
        return None
    try:
        datetime(year, month, day)
    except ValueError:
        return None
    date = f"{year:04d}-{month:02d}-{day:02d}"
    clock = _clock(hour, minute, second) if hour is not None else ""
    return {
        "shape": "moment",
        "date": date,
        "clock": clock,
        "text": f"{date}T{clock[:5]}" if clock else date,
    }


def claim_moment(read: dict[str, Any] | None, *, day: str = "", zone: str = "") -> str | None:
    """One reading as the temporal value a Claim stores, or None when it cannot be one.

    Inside `engine/temporal`'s profile and no wider: a reduced date for a cell that named
    only a day, a timestamp for one that named an hour. ``zone`` is empty by default,
    which stores a **local** timestamp — the binders' column is called `Local time` and
    stamping it `Z` would move the evidence by however many hours the event was away.

    A bare clock with no ``day`` is None rather than today: the date is genuinely not in
    the file, and the sheet is where the analyst says which one it was.
    """
    if read is None:
        return None
    date = day if read["shape"] == "time" else read["date"]
    if not date:
        return None
    clock = read["clock"]
    return f"{date}T{clock}{zone}" if clock else date


def split_values(cell: Any, role: dict[str, Any] | None) -> list[str]:
    """A cell as the values it holds. One, unless the column says it is a list.

    Mirrors `lib/sheetRoles.splitValues`. Two kinds hold lists and for the same reason:
    a `choice` cell holds three pieces of equipment, a `row` cell holds the three
    companies of a brigade. Everything else is one value, whatever is in it.
    """
    body = str(cell or "")
    kind = (role or {}).get("kind")
    separator = (role or {}).get("multi") if kind in ("choice", "row") else None
    if not separator:
        return [body.strip()] if body.strip() else []
    return [part.strip() for part in body.split(separator) if part.strip()]


# -- one row pointing at another ----------------------------------------------


def row_targets(
    columns: list[str],
    rows: list[list[str]],
    column: str,
    role: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    """Which rows each row's ``row`` column names, by row key. Mirrors `lib/sheetRows.js`.

    The binders' `Links with others` held **names**, not keys, and that is kept: a file
    whose links read `r7f3a` is a file the collaborator opening it cannot follow. So a
    word points at a row when exactly one other row spells it that way in the named
    column, case and surrounding spaces aside.

    ``missing`` is the other half and is the reason the binder's own version broke: a
    word naming no row, or naming two, is reported rather than guessed. Theirs had
    already decayed to `#REF!` because a validation cannot survive a row moving; this
    one is re-read from the words every time, so it decays into a list of what to fix.
    """
    if column not in columns:
        return {}
    from .sheets import ID_COLUMN, key_index

    key_at = key_index(columns)
    at = columns.index(column)
    named = role.get("of") if isinstance(role, dict) else None
    if not isinstance(named, str) or named not in columns:
        named = next((name for name in columns if name.casefold() != ID_COLUMN), None)
    if named is None:
        return {}
    name_at = columns.index(named)

    # Every word the naming column holds, and the rows holding it: a word two rows share
    # names neither of them, which is a finding about the file rather than a coin toss.
    holders: dict[str, list[str]] = {}
    for row in rows:
        word = (row[name_at] if name_at < len(row) else "").strip().casefold()
        if word:
            holders.setdefault(word, []).append(row[key_at] if key_at < len(row) else "")

    answer: dict[str, dict[str, Any]] = {}
    for row in rows:
        identity = row[key_at] if key_at < len(row) else ""
        keys: list[str] = []
        missing: list[str] = []
        for word in split_values(row[at] if at < len(row) else "", role):
            found = [key for key in holders.get(word.casefold(), []) if key != identity]
            if len(found) == 1 and found[0] not in keys:
                keys.append(found[0])
            elif len(found) != 1:
                missing.append(word)
        if keys or missing:
            answer[identity] = {"keys": keys, "missing": missing}
    return answer


def _stamp_today() -> str:
    return datetime.now(UTC).date().isoformat()


def apply_stamped(
    columns: list[str], rows: list[list[str]], roles: dict[str, Any], *, today: str | None = None
) -> int:
    """Fill the empty cells of every ``stamped`` column with today's date.

    Written once and never rewritten: a stamp that moved on every save would say when
    the sheet was last touched, which the filesystem already says, instead of when the
    row appeared, which nothing else records.

    Only the date. The binders' column read "added by + date", and the *by* half is not
    written here because it cannot be known honestly: Azimut is one user on localhost so
    there is no identity to record, and by the time a save arrives the server cannot
    tell a pasted row from a typed one. A made-up provenance is worse than none.
    """
    at = [index for index, name in enumerate(columns) if roles.get(name, {}).get("kind") == "stamped"]
    if not at:
        return 0
    stamp = today or _stamp_today()
    filled = 0
    for row in rows:
        for index in at:
            if index < len(row) and not row[index].strip():
                row[index] = stamp
                filled += 1
    return filled


def _point_of(entity: dict[str, Any] | None) -> tuple[float, float] | None:
    attrs = (entity or {}).get("attrs") or {}
    try:
        lat, lon = float(attrs["lat"]), float(attrs["lon"])
    except (KeyError, TypeError, ValueError):
        return None
    return (lat, lon) if -90 <= lat <= 90 and -180 <= lon <= 180 else None


def _points_by_entity(case: "Case") -> dict[str, set[tuple[float, float]]]:
    """Every entity that can be put on a map, with the point or points that place it.

    Three ways to be, and they are the ontology's own: the entity holds a point; it
    points at a place through one of `PLACED_BY`; or a statement that sits at a place is
    *about* it. The third is not a nicety — `located-at` is reserved for collected media
    and `sited-at` for structures, so a vehicle or a unit is positioned by a dated Claim
    and by nothing else. Without that hop the column would answer NO for exactly the
    rows a unit registry is made of.

    Two hops and no more, which is why the second pass reads a **frozen** copy of the
    first: a statement that gained its place from a hop must not pass it on again, or the
    answer becomes "something near this is placed".

    Walked once per read rather than per row: a sheet may hold twenty thousand rows and
    the graph is the same graph for all of them.
    """
    own: dict[str, set[tuple[float, float]]] = {}
    for entity in case.list_entities():
        point = _point_of(entity)
        if point:
            own.setdefault(str(entity["id"]), set()).add(point)
    if not own:
        return own
    reached = {identity: set(points) for identity, points in own.items()}
    links = case.list_links()
    for link in links:
        held = own.get(str(link.get("to")))
        if held and link.get("type") in PLACED_BY:
            reached.setdefault(str(link.get("from")), set()).update(held)
    # Only now, and only from the statements the pass above reached.
    placed = {identity: set(points) for identity, points in reached.items()}
    for link in links:
        held = placed.get(str(link.get("from")))
        if held and link.get("type") == ABOUT:
            reached.setdefault(str(link.get("to")), set()).update(held)
    return reached


def entity_points(case: "Case", ids: list[str]) -> dict[str, dict[str, float]]:
    """Where the case puts each of these entities, for the cells that point at them.

    The half of a place column the geocoder should never have been asked about: a cell
    pointing at an entity the case has already placed has an answer that is exact,
    offline and instant, while Nominatim is guessing from a word at one request a second
    and cannot answer `3rd Bde` at all.

    **Exactly one point, or no answer.** An entity reached by two different points is an
    ambiguity, and picking one of them to fill a cell would be the same silent merge this
    app refuses when two entities share a name. The row stays for the analyst.
    """
    reached = _points_by_entity(case)
    answer: dict[str, dict[str, float]] = {}
    for identity in dict.fromkeys(ids):
        points = reached.get(identity)
        if points and len(points) == 1:
            lat, lon = next(iter(points))
            answer[identity] = {"lat": lat, "lon": lon}
    return answer


def _relations_by_entity(case: "Case") -> dict[str, list[str]]:
    """What the case has joined each entity to, as the labels at the far end.

    One hop, and read from both ends: "is part of" and "contains" are the same edge seen
    from its two sides, and a registry of companies wants the brigade whichever way round
    the analyst happened to state it.

    Chain edges and `mentions` are left out (`NOT_A_RELATION`): the first says how a file
    was produced rather than what the case joined, and the second would answer with the
    sheet being read.

    Sorted by their words and capped, because the cell is one line: a subject joined to
    sixty things says nothing in a column, and the Graph is where that is looked at.
    Walked once per read like the points — the graph is the same graph for every row.
    """
    labels = {
        str(entity["id"]): str(entity.get("label") or "").strip()
        for entity in case.list_entities()
    }
    joined: dict[str, set[str]] = {}
    for link in case.list_links():
        if link.get("type") in NOT_A_RELATION:
            continue
        ends = (str(link.get("from")), str(link.get("to")))
        for holder, other in (ends, ends[::-1]):
            if holder not in labels or not labels.get(other):
                continue
            joined.setdefault(holder, set()).add(labels[other])
    return {
        identity: sorted(names)[:MAX_RELATION_VALUES] for identity, names in joined.items()
    }


def _yes_words(columns: list[str], roles: dict[str, Any], index: int) -> set[str]:
    """What counts as a yes in the column at *index*, folded for comparison.

    A declared yes/no column answers with **its own first value**, because that is the
    word its own cells hold and the one its chips draw. Everything else falls back to the
    spellings the binders use: a tick column somebody typed by hand holds `x`, and a
    score that ignored it would read zero over a column that is plainly answered.
    """
    role = roles.get(columns[index]) or {}
    values = role.get("values") or []
    if role.get("kind") == "boolean" and values:
        return {str(values[0]).strip().casefold()}
    return set(YES_WORDS)


def apply_computed(
    case: "Case",
    columns: list[str],
    rows: list[list[str]],
    roles: dict[str, Any],
    links: dict[str, Any],
) -> int:
    """Restate every ``computed`` column from what the case, or the row, currently says.

    Read-only in the grid and rewritten here on every save, so the answer never drifts.
    Five natures, in three families:

    ``has_point``
        ``links`` is the sidecar's cell-to-entity table, and a row counts as placed when
        **any** of its linked cells points at something that can be mapped, because the
        row is the unit the column describes, not the cell.
    ``filled_of`` / ``yes_of``
        Counted over the row's own chosen columns. Written as the bare number, so the
        column sorts as a number and a spreadsheet can total it; the panel is where the
        denominator is said, since repeating `of 6` down four hundred rows would be four
        hundred copies of one fact. A nature told to read no columns writes nothing at
        all rather than a column of zeroes nobody chose.
    ``point`` / ``relations``
        What the case holds about the entity **one named column** points at. Where
        `has_point` answers whether the case knows, these answer what it knows — which is
        the question that was actually being retyped into the column alongside. The
        column is named rather than swept, because a sheet may point at the case from a
        subject column and a place column both, and "whatever this row points at" would
        answer about whichever the walk reached first.

    A nature whose answer cannot be had writes an **empty cell** rather than a word: a
    row whose subject the case does not place has no coordinates, and `unknown` spelled
    into four hundred cells is four hundred cells a filter would then have to unlearn.
    """
    at = [
        (index, name)
        for index, name in enumerate(columns)
        if roles.get(name, {}).get("kind") == "computed"
    ]
    if not at:
        return 0
    from .sheets import key_index

    key_at = key_index(columns)
    natures = {name: (roles.get(name) or {}).get("of", "has_point") for _, name in at}
    # The graph is walked once, and only for what a column actually asks: a sheet whose
    # only computed column is a score has no business listing every entity.
    wants_points = any(nature in ("has_point", "point") for nature in natures.values())
    reached = _points_by_entity(case) if wants_points else {}
    placed = set(reached)
    joined = _relations_by_entity(case) if "relations" in natures.values() else {}
    # Which cells each counting column reads, what a yes looks like in each of them, and
    # which column each linked nature follows. Resolved once rather than per row: twenty
    # thousand rows would otherwise re-read the same roles twenty thousand times.
    counted: dict[str, list[int]] = {}
    accepts: dict[str, list[set[str]]] = {}
    follows: dict[str, str] = {}
    for _index, name in at:
        role = roles.get(name) or {}
        if natures[name] in COUNTING_NATURES:
            wanted = [
                columns.index(column) for column in role.get("columns", []) if column in columns
            ]
            counted[name] = wanted
            accepts[name] = [_yes_words(columns, roles, column) for column in wanted]
        elif natures[name] in LINKED_NATURES:
            source = role.get("from")
            if isinstance(source, str) and source in columns:
                follows[name] = source

    written = 0
    for row in rows:
        identity = row[key_at] if key_at < len(row) else ""
        cells = links.get(identity) or {}
        mapped = COMPUTED_YES if any(str(target) in placed for target in cells.values()) else COMPUTED_NO
        for index, name in at:
            if index >= len(row):
                continue
            nature = natures[name]
            if nature == "has_point":
                answer = mapped
            elif nature in COUNTING_NATURES:
                answer = _counted(row, counted.get(name) or [], accepts.get(name) or [], nature)
            else:
                target = str(cells.get(follows.get(name, ""), ""))
                if nature == "point":
                    # Exactly one point, or nothing. An entity two different points reach
                    # is an ambiguity, and picking one to fill a cell would be the silent
                    # merge this app refuses when two entities share a name.
                    points = reached.get(target) or set()
                    lat, lon = next(iter(points)) if len(points) == 1 else (None, None)
                    answer = "" if lat is None else f"{lat:.5f}, {lon:.5f}"
                else:
                    separator = (roles.get(name) or {}).get("multi") or DEFAULT_SEPARATOR
                    answer = separator.join(joined.get(target) or [])
            if row[index] != answer:
                row[index] = answer
                written += 1
    return written


def _counted(
    row: list[str], columns: list[int], accepts: list[set[str]], nature: str
) -> str:
    """One counting nature's answer for one row, or nothing when it reads no columns."""
    if not columns:
        return ""
    if nature == "filled_of":
        return str(sum(1 for column in columns if row[column].strip()))
    return str(
        sum(
            1
            for column, words in zip(columns, accepts, strict=True)
            if row[column].strip().casefold() in words
        )
    )
