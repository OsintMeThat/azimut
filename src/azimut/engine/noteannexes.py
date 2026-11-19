"""What a document adds after its sources: the annexes its style carries.

A report ends the way a paper does: the places it concluded on, the credits it owes,
the facts of how it was made, what its evidence cannot say, and its editions with what
each corrected. Which of these a document prints is its profile's to say
(`notelook.Profile`, decided once in `notelook.PROFILES`); what each says is read here,
once, after the text is laid out, from what the document cites (`notes_markdown.Cited`),
the case and the edition. The PDF and the HTML page print the same rows in the same
order, and an annex with nothing to say is not printed at all.

Nothing here is written by hand and nothing is guessed. "How this was made" says only
facts the case recorded: the tools its items came from, their days and counts, the
fingerprints and the archived copies, the edition and the Azimut that made it. The
analyst's own account of their method stays in the text, where they wrote it.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date
from typing import TYPE_CHECKING, Any, Iterable

from .. import __version__
from . import notes_style, notesources
from .notelook import ANNEXES, Profile
from .notesources import Source

if TYPE_CHECKING:
    from ..workspace import Case
    from .notes_markdown import Cited

#: What each annex is called, on the page and in the contents.
HEADINGS = {
    "geolocations": "Geolocations",
    "credits": "Credits",
    "method": "How this was made",
    "limits": "Limits",
    "editions": "Editions and corrections",
}
#: The map a geolocation's point opens on, as a proof's point links in the text.
MAP_LINK = "https://www.openstreetmap.org/?mlat={lat}&mlon={lon}#map=17/{lat}/{lon}"
#: The tool each road into the case names, by the sidecar's `type` or the record's.
TOOLS = {
    "proof": "Geo Proof", "inspect": "Inspect", "horizon": "Horizon", "compare": "Compare",
    "map-plate": "Map plate", "analysis-view": "Graph and Timeline", "satellite": "Satellite",
    "screenshot": "the capture extension", "capture": "Satellite",
}
#: What an edition was written as, by the format its record keeps.
FORMATS = {"pdf": "PDF", "html": "HTML page", "web": "Web page", "github": "Web page", "wordpress": "WordPress draft"}
#: What the document being made is called in its own words.
MADE_AS = {"pdf": "PDF", "html": "page", "web": "page", "wordpress": "post"}
#: How many rows an annex lists before it counts the rest.
MAX_ROWS = 200
#: The licence every face a note can be set in ships under (`pdffonts.FONTS`).
FACE_LICENCE = "SIL Open Font License"


@dataclass
class Place:
    """One proof the document cites, where it concluded and when."""

    number: int
    proof: str
    place: str = ""
    day: str = ""
    lat: float | None = None
    lon: float | None = None
    radius: str = ""
    posted: str = ""
    #: The point is where the material was filmed from, rounded as the page rounds it.
    pov: bool = False
    rounded: bool = False

    @property
    def coords(self) -> str:
        if self.lat is None or self.lon is None:
            return ""
        places = 4 if self.rounded else 5
        return f"{self.lat:.{places}f}, {self.lon:.{places}f}"

    @property
    def link(self) -> str:
        if self.lat is None or self.lon is None:
            return ""
        return MAP_LINK.format(lat=f"{self.lat:.6f}", lon=f"{self.lon:.6f}")

    @property
    def where(self) -> str:
        """The place and how far its point may be off, or where the material was filmed from."""
        said = ", ".join(part for part in (self.place, self.radius) if part)
        if self.pov:
            filmed = "where it was filmed, rounded" if self.rounded else "where it was filmed"
            return f"{said} ({filmed})" if said else filmed.capitalize()
        return said


@dataclass
class Limit:
    """One Limits box of the note: its words, its line, and its rank among the boxes."""

    text: str
    line: int | None
    index: int


@dataclass
class Edition:
    """One public edition of the note, or the one being made (``current``)."""

    day: str
    stamp: str
    what: str
    changes: str = ""
    sha256: str = ""
    current: bool = False

    @property
    def said(self) -> str:
        """`PDF, 2 January 2026. The berth number.`: what it was, and what it corrected."""
        said = f"{self.what}, {self.day}" if self.current else self.what
        if self.changes:
            said = f"{said}. {self.changes}"
        return said if said[-1:] in ".!?" else f"{said}."


@dataclass
class Annexes:
    """What each annex holds, in the order they print."""

    geolocations: list[Place] = field(default_factory=list)
    #: `(kind, words)`: Imagery, Terrain, Maps, Footage and posts, Typefaces.
    credits: list[tuple[str, str]] = field(default_factory=list)
    method: list[str] = field(default_factory=list)
    limits: list[Limit] = field(default_factory=list)
    editions: list[Edition] = field(default_factory=list)

    def present(self) -> list[str]:
        """The annexes with something to print, in their order."""
        return [key for key in ANNEXES if getattr(self, key)]

    def words(self) -> list[str]:
        """What the annexes print, for the fonts to cover."""
        said = list(HEADINGS.values())
        for place in self.geolocations:
            said.extend((place.proof, place.where, place.day, place.coords))
        said.extend(f"{kind} {words}" for kind, words in self.credits)
        said.extend(self.method)
        said.extend(limit.text for limit in self.limits)
        said.extend(f"{one.day} {one.what} {one.changes}" for one in self.editions)
        return said


def build(
    case: "Case | None",
    cited: "Cited",
    profile: Profile,
    *,
    day: date,
    public: bool,
    faces: Iterable[str] = (),
    earlier: Iterable[dict[str, Any]] = (),
    changes: str = "",
    made_as: str = "pdf",
    round_pov: bool = False,
) -> Annexes:
    """The annexes ``profile`` asks for, each read from the case and what the document cites.

    ``faces`` names the typefaces the document is set in, ``earlier`` the note's editions
    as its record keeps them and ``changes`` what this one corrected; ``made_as`` is the
    format being made (`pdf`, `html`, `web`). The maps' credits are known once they are
    drawn, and come in by `add_map_credit`.
    """
    entries = [entry.source for entry in cited.everything.entries] if cited.everything is not None else []
    numbers = ({entry.source.key: entry.number for entry in cited.annex.entries}
               if cited.annex is not None else {})
    out = Annexes()
    # a note with its own Geolocations or Method section keeps it as the only one unless
    # its look asks for the generated annex too (`notes_markdown.annex_listing`)
    if profile.geolocations and case is not None and cited.generates("geolocations"):
        out.geolocations = _geolocations(case, entries, numbers, round_pov=round_pov)
    # a document that cites nothing owes no credit but its type, and has no method to state
    if profile.credits and entries:
        out.credits = _credits(case, entries, faces=faces)
    if profile.method and entries and cited.generates("method"):
        out.method = _method(entries, day=day, public=public, made_as=made_as)
    if profile.limits and not cited.limits_section:
        out.limits = [Limit(" ".join(text.split()), line, index) for index, (text, line) in enumerate(cited.limits)
                      if text.strip()][:MAX_ROWS]
    if profile.editions:
        out.editions = _editions(earlier, changes=changes, day=day, made_as=made_as, public=public)
    return out


# -- geolocations -----------------------------------------------------------------


def _geolocations(case: "Case", entries: list[Source], numbers: dict[str, int], *, round_pov: bool) -> list[Place]:
    from . import satellite

    found: list[Place] = []
    for source in entries:
        if source.type != "proof" or not source.entity_id:
            continue
        record = case.get_entity(source.entity_id) or {}
        attrs = record.get("attrs") or {}
        try:
            points = [point for point in satellite.spec_points(_spec(case, attrs)) if not point.get("proposed")]
        except Exception:  # a spec the app cannot read says nothing more
            points = []
        # the place concluded on, else where the material was filmed from
        point = next((one for one in points if not one.get("pov")), points[0] if points else None)
        place, radius = _depicted(case, source.entity_id)
        row = Place(number=numbers.get(source.key, 0), proof=source.label or "Proof", place=place,
                    day=_when(str(attrs.get("when") or "")), radius=radius, posted=source.posted)
        if point is not None:
            try:
                lat, lon = float(point["lat"]), float(point["lon"])
            except (KeyError, TypeError, ValueError):
                lat = lon = math.nan
            if math.isfinite(lat) and math.isfinite(lon):
                row.pov = bool(point.get("pov"))
                row.rounded = row.pov and round_pov
                row.lat, row.lon = (round(lat, 3), round(lon, 3)) if row.rounded else (lat, lon)
            label = " ".join(str(point.get("label") or "").split())
            row.place = row.place or (label if _names_a_place(label) else "")
        found.append(row)
        if len(found) >= MAX_ROWS:
            break
    return found


#: A point's label that names nothing: `POV`, a timecode, coordinates.
_NO_NAME = re.compile(r"^~?\s*pov$", re.I)


def _names_a_place(label: str) -> bool:
    """Whether a point's label is a name (`Camp gate`), not `POV`, a timecode or coordinates."""
    return bool(label) and not _NO_NAME.match(label) and re.search(r"[^\W\d_]{3,}", label) is not None


def _when(value: str) -> str:
    """A proof's day in words: `about 19 October 2026`, or a stated span, `10 to 14 November 2026`."""
    first, slash, last = value.partition("/")
    if not slash:
        return notesources.spoken_day(value)
    about = first.endswith("~") or last.endswith("~")
    start, end = _iso(first), _iso(last)
    if not start or not end:
        return notesources.spoken_day(first)
    said = _span([start, end], plain=True)
    return f"about {said}" if about else said


def _spec(case: "Case", attrs: dict[str, Any]) -> dict[str, Any]:
    import json

    relative = attrs.get("spec")
    if not isinstance(relative, str) or not relative:
        return {}
    try:
        path = case.resolve_inside(relative)
        if path.stat().st_size > 4 * 1024 * 1024:
            return {}
        loaded = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return loaded if isinstance(loaded, dict) else {}


def _depicted(case: "Case", proof_id: str) -> tuple[str, str]:
    """The place a proof depicts, by a confirmed edge, and how far its point may be off."""
    links_of = getattr(case, "links_of", None)
    if links_of is None:
        return "", ""
    try:
        edges = links_of(proof_id)
    except Exception:
        return "", ""
    for edge in edges:
        if edge.get("type") != "depicts" or edge.get("from") != proof_id:
            continue
        if (edge.get("provenance") or {}).get("status") == "suggested":
            continue
        place = case.get_entity(str(edge.get("to") or "")) or {}
        if place.get("type") != "place":
            continue
        radius = (place.get("attrs") or {}).get("radius_m")
        said = ""
        if isinstance(radius, (int, float)) and math.isfinite(radius) and radius > 0:
            said = f"within {radius / 1000:g} km" if radius >= 1000 else f"within {round(radius)} m"
        name = " ".join(str(place.get("label") or "").split())
        return (name if _names_a_place(name) else ""), said
    return "", ""


# -- credits --------------------------------------------------------------------


def _credits(case: "Case | None", entries: list[Source], *, faces: Iterable[str]) -> list[tuple[str, str]]:
    imagery: list[str] = []
    terrain: list[str] = []
    plates: list[str] = []
    footage: dict[str, list[str]] = {}
    for source in _every(entries):
        if source.kind == notesources.IMAGERY:
            for reading in source.readings:
                if reading.provider:
                    _keep(imagery, reading.provider)
            if source.attribution:
                for part in source.attribution.split(" · "):
                    _keep(imagery, part)
        elif source.noun == notesources.PLATE_NOUN and source.attribution:
            _keep(plates, source.attribution)
        elif source.attribution:
            _keep(terrain, source.attribution)
        if source.kind == notesources.POST and source.address:
            site = notesources.outlet(source.address)
            who = notesources._author(source)
            names = footage.setdefault(site, [])
            if who:
                _keep(names, who)
        if source.type == "proof" and case is not None and source.entity_id:
            credits = ((case.get_entity(source.entity_id) or {}).get("attrs") or {}).get("imagery_credits")
            if isinstance(credits, str):
                for part in credits.split(" · "):
                    _keep(imagery, part)
    out: list[tuple[str, str]] = []
    if imagery:
        out.append(("Imagery", "; ".join(imagery)))
    if terrain:
        out.append(("Terrain", "; ".join(terrain)))
    if plates:
        out.append(("Maps", "; ".join(plates)))
    if footage:
        said = [f"{site}: {', '.join(names)}" if names else site for site, names in footage.items()]
        out.append(("Footage and posts", "; ".join(said)))
    named = list(dict.fromkeys(name for name in faces if name))
    if named and out:
        out.append(("Typefaces", f"{_listed(named)}, {FACE_LICENCE}"))
    return out


def _every(entries: list[Source]) -> Iterable[Source]:
    """Each source and what it was made from, each once."""
    seen: set[str] = set()
    for source in entries:
        for one in source.lineage():
            if one.key not in seen:
                seen.add(one.key)
                yield one


def _keep(found: list[str], value: str) -> None:
    value = " ".join(value.split())
    if value and value not in found:
        found.append(value)


# -- how this was made --------------------------------------------------------------


#: What a source is counted as, by its kind or what it is.
_COUNTED = (("page", "web page", "web pages"), ("post", "post", "posts"), ("imagery", "map capture", "map captures"),
            ("proof", "proof", "proofs"), ("made", "item made in the case", "items made in the case"),
            ("file", "file", "files"), ("account", "account", "accounts"))


def _method(entries: list[Source], *, day: date, public: bool, made_as: str) -> list[str]:
    edition = "public" if public else "internal"
    said = [f"This {MADE_AS.get(made_as, 'PDF')} is the {edition} edition, made with Azimut {__version__} "
            f"on {notes_style.long_date(day)}."]
    if not entries:
        return said
    every = list(_every(entries))
    counts: dict[str, int] = {}
    for source in every:
        if source.type == "proof":
            what = "proof"
        elif source.kind in (notesources.PAGE, notesources.POST, notesources.IMAGERY, notesources.ACCOUNT):
            what = source.kind
        else:
            what = "made" if source.derived else "file"
        counts[what] = counts.get(what, 0) + 1
    parts = [f"{counts[key]} {one if counts[key] == 1 else many}" for key, one, many in _COUNTED if counts.get(key)]
    said.append(f"It rests on {len(every)} source{'s' if len(every) != 1 else ''}: {_listed(parts)}.")
    posted = sorted(stamp for stamp in (_iso(one.published) for one in every) if stamp)
    if posted:
        said.append(f"What it cites was posted {_span(posted)}.")
    collected = sorted(stamp for stamp in (_iso(one.collected) for one in every) if stamp)
    if collected:
        said.append(f"Its sources came into the case {_span(collected)}.")
    outside = [one for one in every if one.address and one.kind in (notesources.PAGE, notesources.POST)]
    if outside:
        kept, count = sum(1 for one in outside if one.archive), len(outside)
        addresses = f"outside address{'es' if count != 1 else ''}"
        if kept == 0:
            said.append(f"None of its {count} {addresses} has an archived copy." if count > 1
                        else "Its outside address has no archived copy.")
        elif kept == count:
            said.append(f"All {count} of its {addresses} have an archived copy." if count > 1
                        else "Its outside address has an archived copy.")
        else:
            said.append(f"{kept} of its {count} {addresses} {'has' if kept == 1 else 'have'} an archived copy.")
    providers = list(dict.fromkeys(reading.provider for one in every for reading in one.readings if reading.provider))
    days = sorted(stamp for stamp in (_iso(reading.day) for one in every for reading in one.readings) if stamp)
    if providers:
        when = f", dated {_span(days, plain=True)}" if days else ""
        said.append(f"Its imagery is {_listed(providers)}{when}.")
    fingerprinted = sum(1 for one in every if one.sha256)
    if fingerprinted:
        said.append(f"{fingerprinted} file{'s carry' if fingerprinted != 1 else ' carries'} its SHA-256 fingerprint "
                    "in the sources.")
    tools = list(dict.fromkeys(TOOLS[key] for one in every for key in (one.type, one.route) if key in TOOLS))
    if tools:
        said.append(f"Made in the case with {_listed(tools)}.")
    return said


def _iso(value: str) -> str:
    """The day of a reading (`2026-03-12~`, `2026-03-12T10:22:00Z`), or ""."""
    text = (value or "").rstrip("~")[:10]
    try:
        return date.fromisoformat(text).isoformat()
    except ValueError:
        return ""


def _span(days: list[str], *, plain: bool = False) -> str:
    """`on 12 March 2026`, or `between 9 September and 16 November 2026`."""
    first, last = date.fromisoformat(days[0]), date.fromisoformat(days[-1])
    if first == last:
        return notes_style.long_date(first) if plain else f"on {notes_style.long_date(first)}"
    if (first.year, first.month) == (last.year, last.month):
        start = str(first.day)
    elif first.year == last.year:
        start = f"{first.day} {notes_style.MONTHS[first.month - 1]}"
    else:
        start = notes_style.long_date(first)
    if plain:
        return f"{start} to {notes_style.long_date(last)}"
    return f"between {start} and {notes_style.long_date(last)}"


def _listed(parts: list[str]) -> str:
    if len(parts) <= 2:
        return " and ".join(parts)
    return f"{', '.join(parts[:-1])} and {parts[-1]}"


# -- editions -------------------------------------------------------------------


def _editions(earlier: Iterable[dict[str, Any]], *, changes: str, day: date, made_as: str,
              public: bool) -> list[Edition]:
    """This edition, then each public text the note was published as before, newest first:
    the same text exported again, in another format or on another day, is one row, dated by
    its first publication, its formats and what it corrected said together."""
    out: list[Edition] = []
    said = " ".join(changes.split())[:300]
    if public:
        out.append(Edition(day=notes_style.long_date(day), stamp=day.isoformat(), what=FORMATS.get(made_as, "PDF"),
                           changes=said, current=True))
    texts: dict[str, Edition] = {}
    for record in earlier:
        if record.get("edition") != "public":
            continue
        stamp = str(record.get("at") or "")[:10]
        try:
            when = notes_style.long_date(date.fromisoformat(stamp))
        except ValueError:
            continue
        words = record.get("changes")
        what = FORMATS.get(str(record.get("format") or "pdf"), "PDF")
        corrected = " ".join(words.split())[:300] if isinstance(words, str) else ""
        text = str(record.get("text_sha256") or record.get("sha256") or record.get("pdf_sha256") or stamp)
        held = texts.get(text)
        if held is None:
            if len(texts) >= MAX_ROWS:
                continue
            texts[text] = Edition(day=when, stamp=stamp, what=what, changes=corrected,
                                  sha256=str(record.get("sha256") or record.get("pdf_sha256") or ""))
            continue
        # newest first: what comes later is older, so the text's first day and its correction
        if stamp <= held.stamp:
            held.day, held.stamp = when, stamp
            held.changes = corrected or held.changes
        if what not in held.what.split(" and "):
            held.what = f"{held.what} and {what}"
    out.extend(texts.values())
    # an edition alone, the one being made with nothing corrected, is no record worth a page
    if len(out) == 1 and out[0].current and not out[0].changes:
        return []
    return out


def add_map_credit(annexes: Annexes, words: str) -> None:
    """A credit a map of the document owes, once it is drawn, under Maps."""
    words = " ".join(words.split())
    if not words:
        return
    for position, (kind, said) in enumerate(annexes.credits):
        if kind == "Maps":
            if words not in said.split("; "):
                annexes.credits[position] = (kind, f"{said}; {words}")
            return
    # Maps follow the imagery and the terrain, before the footage and the typefaces
    at = next((position for position, (kind, _) in enumerate(annexes.credits)
               if kind not in ("Imagery", "Terrain")), len(annexes.credits))
    annexes.credits.insert(at, ("Maps", words))


def face_names(*families: str) -> list[str]:
    """The typefaces a document is set in, named as their makers name them."""
    from . import pdffonts

    names = {pdffonts.SERIF: "Noto Serif", pdffonts.SANS: "Noto Sans"}
    for font in pdffonts.FONTS:
        names.setdefault(font.body, font.label)
        names.setdefault(font.headings, font.label)
    return [names[family] for family in dict.fromkeys(families) if family in names]
