"""Reading a map file somebody else made, into something the map can draw.

Three formats arrive in an analyst's inbox — GeoJSON, KML and its zipped form
KMZ, and GPX off a handset — and one shape comes out: a GeoJSON
FeatureCollection whose every feature carries the four things a foreign layer is
worth drawing for.

    name          what the source calls this feature
    description   what the source says about it, as plain text
    category      which group it belongs to, and therefore its legend row
    colour        what the source painted it, honoured rather than replaced
    icon          which of the source's own pictograms it asked for, if any

**The browser never sees the original.** KML is untrusted XML and KMZ is an
untrusted zip, so both are read here, bounded here, and handed on as JSON the
frontend can parse with `JSON.parse` and nothing else. That is also what keeps
one parser rather than one per format: `parse` sniffs, dispatches, and every
path returns through `_collection`.

Where a category comes from, because the legend is the filter and a source
rarely states one outright:

- **KML/KMZ** — the enclosing `<Folder>`. That is how a My Maps is built (its
  layers *are* folders), and how anyone organising a KML by hand does it.
  Nested folders join with a slash; a Placemark under no folder falls back to
  the document's own name.
- **GPX** — what the element is: a waypoint, a track or a route.
- **GeoJSON** — the file is one category, named after itself. A plain
  FeatureCollection states no grouping, and inventing one out of whichever
  property happens to look categorical would make the legend lie about the
  source.

**The browser never fetches an icon either.** A My Maps points its placemarks at
Google-hosted PNGs, and letting the map follow those hrefs would be one
third-party request per icon on every render, from the analyst's own browser. So
the whole of it happens here, once, and only when the analyst ticked the box:
each distinct icon is read (out of the KMZ, or off the web), decoded, tinted the
colour its style asked for, resized, re-encoded as a PNG *this* process produced,
and stored beside the snapshot. What the map loads is a file on localhost.

A layer added without that box, or one whose icons could not be read, draws the
app's own pictogram per geometry kind
(`frontend/src/lib/map/addedLayer.js`) in the source's colour — which is most of
the meaning either way, since creators group by colour far more than by icon.
"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterator
from urllib.parse import unquote

import httpx
from PIL import Image

# The parser is `defusedxml`'s; `Element` is only the type its tree is made of,
# and the stdlib is where that name lives.
from defusedxml.ElementTree import ParseError, fromstring as parse_xml
from xml.etree.ElementTree import Element

from .. import layout
from .tiles import USER_AGENT

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..workspace import Case

# -- what will not be read ---------------------------------------------------
#
# Every bound is here rather than at the call sites, and every one of them is
# refused with a sentence rather than a truncation: a layer that silently drew
# the first ten thousand of forty thousand features would be a map making a
# claim about a place it had only partly read.

#: The largest source file that will be read at all. A My Maps export of a few
#: thousand placemarks is well under a megabyte; this leaves room for a national
#: dataset somebody dropped in by mistake to be refused rather than swallowed.
MAX_SOURCE_BYTES = 64 * 1024 * 1024

#: Features in one layer. The GL renderer is comfortable far past this — the
#: limit is about the case, not the frame rate: past this it is a dataset, and a
#: dataset belongs behind a service rather than snapshotted into a case folder.
MAX_FEATURES = 100_000

#: Points in one geometry, which is what a traced coastline arrives as.
MAX_GEOMETRY_POINTS = 500_000

#: How deep the XML may nest. KML folders nest a handful deep in practice; this
#: is the stack guard, not a modelling opinion.
MAX_XML_DEPTH = 100

#: KMZ is a zip, and a zip is three separate lies it can tell.
MAX_ZIP_MEMBERS = 2_000
MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200

#: How much description survives. A My Maps description can hold a whole article
#: with markup; the popup shows what the source says, not a web page.
MAX_DESCRIPTION = 4_000
MAX_NAME = 300
#: The longest icon address that will be read at all.
MAX_HREF = 2_000

#: How many distinct pictograms one layer stores. A source declares one style per
#: (icon, colour) pair its creator used, which is a couple of dozen for a busy My
#: Maps and a few hundred for GeoConfirmed's Ukraine map, one per faction and
#: event type. Past this the rest fall back to the app's own shapes rather than
#: the layer being refused: the marks are the map, the icons are how it was
#: dressed.
MAX_ICONS = 512

#: …and how many of them may be read off the web, one request each. An icon inside
#: a KMZ costs a zip lookup; one at an address is a request to somebody else's
#: server, and that is what this bounds.
MAX_FETCHED_ICONS = 64

#: What one icon may weigh on the wire, and what a layer's icons may weigh
#: together. Both are checked as the bytes arrive, because a server is free to
#: lie about either.
MAX_ICON_BYTES = 512 * 1024
MAX_ICONS_BYTES = 8 * 1024 * 1024

#: …and how many pixels one may decode to, which is the bound a small file that
#: expands to a large bitmap has to answer.
MAX_ICON_AREA = 4096 * 4096

#: How much *painted* pictogram is stored, before the padding that centres its
#: hotspot, and the floor and ceiling a source's own `<scale>` is held between.
#: Every icon's ink coming out the same size is what lets the map draw them all
#: at one `icon-size` and get one visual weight, rather than a 26px glyph beside
#: a 64px square.
ICON_SIDE = 64
MIN_ICON_SIDE = 16
MAX_ICON_SIDE = 128

#: …and the widest the image around that ink may get. An icon is mostly its own
#: transparency in a My Maps archive, and scaling the ink up scales the sheet it
#: floats in with it.
MAX_ICON_CANVAS = 256

#: How much an icon's *fill* is allowed to say about its size.
#:
#: The bounding box is not the weight. A My Maps container set holds a square
#: filled corner to corner beside a disc that paints 80% of its box and a star
#: that paints under half of one — so sizing them all by the box draws the square
#: with nearly twice the ink of the disc next to it, which is what "the squares
#: look bigger" is. 0 is the box alone; 0.5 holds the painted area itself equal,
#: which blows a sparse star out to half again its neighbours. This sits between.
ICON_FILL_WEIGHT = 0.35

#: …and the emptiest an icon is taken to be, so a thin arrow is not stretched
#: across the map in the name of matching a disc's ink.
MIN_ICON_FILL = 0.4

#: How long one icon may take. Shorter than a feed's timeout on purpose: a slow
#: icon host must not hold up a layer that is otherwise ready to draw.
ICON_TIMEOUT = 15

#: How much of the descriptor's hash names the stored image. Long enough that two
#: different icons cannot collide into one, short enough to read in a URL.
ICON_KEY_LENGTH = 16

#: What a layer is named when the source names nothing.
UNTITLED = "Untitled layer"
#: …and the category a feature lands in when its source states no grouping.
UNGROUPED = "Features"


class LayerError(ValueError):
    """A source that will not be drawn, with the reason an analyst reads."""


# ---------------------------------------------------------------------------
# Sniffing
# ---------------------------------------------------------------------------

#: The formats, and the extensions that suggest each. The suffix is a hint the
#: bytes then confirm or overrule: files arrive renamed, and a `.geojson` that
#: is really a KML should draw rather than fail on its first brace.
FORMATS = ("geojson", "kml", "kmz", "gpx")

_SUFFIXES = {
    ".geojson": "geojson",
    ".json": "geojson",
    ".kml": "kml",
    ".kmz": "kmz",
    ".gpx": "gpx",
}

_ZIP_MAGIC = b"PK\x03\x04"


def sniff(data: bytes, filename: str = "") -> str:
    """Which of `FORMATS` these bytes are, whatever the name promised."""
    if data[:4] == _ZIP_MAGIC:
        return "kmz"
    head = data[:4096].lstrip()
    if head[:1] in (b"{", b"["):
        return "geojson"
    if head[:1] == b"<":
        lowered = head.lower()
        if b"<gpx" in lowered:
            return "gpx"
        if b"<kml" in lowered or b"<placemark" in lowered or b"<document" in lowered:
            return "kml"
        raise LayerError("this XML file is neither KML nor GPX")
    suffix = _SUFFIXES.get(_suffix(filename))
    if suffix:
        return suffix
    raise LayerError("unrecognised file: expected GeoJSON, KML, KMZ or GPX")


def _suffix(filename: str) -> str:
    name = str(filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return f".{name.rsplit('.', 1)[-1].lower()}" if "." in name else ""


# ---------------------------------------------------------------------------
# The one entry point
# ---------------------------------------------------------------------------


#: A publisher's own reading of its file, run over the features before the legend
#: is counted: it may rename, regroup and recolour them in place, and returns the
#: icon descriptions to keep. GeoConfirmed's is `engine/geoconfirmed.reading`.
Reading = Callable[[list[dict[str, Any]], dict[str, dict[str, Any]]], dict[str, dict[str, Any]]]


def parse(
    data: bytes, *, filename: str = "", title: str = "", reading: Reading | None = None
) -> dict[str, Any]:
    """Bytes as received → `{geojson, summary, icons}`, or `LayerError` with a reason.

    Pure: it reads no file, reaches no network and writes nothing. A caller
    stores the bytes it was given and can rebuild this result from them at any
    time, which is what makes the parsed form a cache rather than a record.

    `icons` is the *descriptions* of the pictograms the source asked for — an
    address, a colour, a scale, an anchor — and never an image. Turning those
    into pixels is what may reach out, so it lives in `icon_images` behind the
    analyst's own tick, and this stays something that can be run on anything.
    """
    if not data:
        raise LayerError("the file is empty")
    if len(data) > MAX_SOURCE_BYTES:
        raise LayerError(
            f"the file is {_megabytes(len(data))} — the limit is "
            f"{_megabytes(MAX_SOURCE_BYTES)}"
        )
    fmt = sniff(data, filename)
    if fmt == "kmz":
        data, inner = _kml_out_of_kmz(data)
        if len(data) > MAX_SOURCE_BYTES:
            raise LayerError(
                f"the KML inside this KMZ is over {_megabytes(MAX_SOURCE_BYTES)}"
            )
        filename = inner or filename
        fmt = "kml"
        source_format = "kmz"
    else:
        source_format = fmt

    icons: dict[str, dict[str, Any]] = {}
    if fmt == "geojson":
        features, name = _from_geojson(data, filename)
    elif fmt == "kml":
        features, name, icons = _from_kml(data)
    else:
        features, name = _from_gpx(data)

    if not features:
        raise LayerError("the file holds no points, lines or areas")
    if reading is not None:
        icons = reading(features, icons)
    return _collection(
        features, title=title or name or _stem(filename), fmt=source_format, icons=icons
    )


def digest(data: bytes) -> str:
    """The snapshot's sha256, as a media's is — what says two fetches agreed."""
    return hashlib.sha256(data).hexdigest()


def _megabytes(size: int) -> str:
    return f"{size / (1024 * 1024):.0f} MB"


def _stem(filename: str) -> str:
    name = str(filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return name.rsplit(".", 1)[0] if "." in name else name


# ---------------------------------------------------------------------------
# The normalised shape
# ---------------------------------------------------------------------------

def _collection(
    features: list[dict[str, Any]],
    *,
    title: str,
    fmt: str,
    icons: dict[str, dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """The FeatureCollection plus the summary the panel row is built from.

    The summary is what the legend is: one row per category, with its colour,
    its count and which pictograms it draws.
    """
    categories: dict[str, dict[str, Any]] = {}
    for index, feature in enumerate(features):
        properties = feature["properties"]
        name = properties["category"]
        entry = categories.setdefault(
            name, {"name": name, "count": 0, "colours": Counter(), "kinds": set()}
        )
        entry["count"] += 1
        entry["kinds"].add(_kind(feature["geometry"]))
        if properties["colour"]:
            entry["colours"][properties["colour"]] += 1
        # A feature that drew the short straw in a contested spot is one whose
        # neighbours arrived first. Sorting by file order at least makes that
        # deterministic, which "whichever the engine placed" is not.
        feature["id"] = index
        properties["index"] = index

    # Only the icons something actually draws: a KML commonly declares styles for
    # shapes it no longer holds, and fetching one nothing asked for would be a
    # request made on nobody's behalf.
    used = {feature["properties"]["icon"] for feature in features}
    ordered = [
        {
            "name": entry["name"],
            "count": entry["count"],
            # What this group is painted in the source, where a group is painted
            # one colour at all: the commonest wins, and a group the source left
            # unstyled comes back blank for the renderer's own palette.
            "colour": _dominant(entry["colours"]),
            "kinds": sorted(entry["kinds"]),
        }
        for entry in sorted(categories.values(), key=lambda e: (-e["count"], e["name"]))
    ]
    return {
        "geojson": {"type": "FeatureCollection", "features": features},
        "summary": {
            "title": (title or UNTITLED)[:MAX_NAME],
            "format": fmt,
            "features": len(features),
            "categories": ordered,
            "bbox": _bbox(features),
        },
        "icons": {
            key: descriptor for key, descriptor in (icons or {}).items() if key in used
        },
    }


def _dominant(colours: "Counter[str]") -> str:
    if not colours:
        return ""
    best = max(colours.values())
    return sorted(colour for colour, count in colours.items() if count == best)[0]


def _kind(geometry: dict[str, Any]) -> str:
    """The pictogram family: a point, a line or an area. Nothing finer.

    The renderer registers one image per kind, so this is the whole vocabulary
    the legend and the GL layers share.
    """
    type_ = str(geometry.get("type") or "")
    if "Point" in type_:
        return "point"
    if "Line" in type_:
        return "line"
    return "area"


def _bbox(features: list[dict[str, Any]]) -> list[float] | None:
    """Where the layer is, so adding one can move the map to it."""
    west = south = float("inf")
    east = north = float("-inf")
    for feature in features:
        for lon, lat in _coordinates(feature["geometry"]):
            west, east = min(west, lon), max(east, lon)
            south, north = min(south, lat), max(north, lat)
    if west > east:
        return None
    return [west, south, east, north]


def _coordinates(geometry: dict[str, Any]) -> Iterator[tuple[float, float]]:
    def walk(node: Any) -> Iterator[tuple[float, float]]:
        if isinstance(node, (list, tuple)):
            if node and isinstance(node[0], (int, float)) and len(node) >= 2:
                yield float(node[0]), float(node[1])
                return
            for child in node:
                yield from walk(child)

    if geometry.get("type") == "GeometryCollection":
        for child in geometry.get("geometries") or []:
            yield from _coordinates(child)
        return
    yield from walk(geometry.get("coordinates"))


def _properties(
    *,
    name: str = "",
    description: str = "",
    category: str = "",
    colour: str = "",
    icon: str = "",
    date: str = "",
) -> dict[str, Any]:
    """The five fields every feature carries, whatever it was read from, and a
    sixth when the source dated it.

    `icon` names a stored pictogram rather than holding an address: the browser
    is told which image to draw, never where the source kept it. `date` is a day,
    `YYYY-MM-DD`, which is what the row's time filter compares; absent rather
    than empty, since most layers state none and a map may hold 100,000 features.
    """
    properties = {
        "name": _text(name, MAX_NAME),
        "description": _rich_text(description, MAX_DESCRIPTION),
        "category": _text(category, MAX_NAME) or UNGROUPED,
        "colour": colour or "",
        "icon": icon or "",
    }
    day = iso_day(date)
    if day:
        properties["date"] = day
    return properties


_ISO_DAY = re.compile(r"^\s*(\d{4}-\d{2}-\d{2})")


def iso_day(value: Any) -> str:
    """The day a timestamp falls on, `YYYY-MM-DD`, or "" for anything else.

    Read off the front of the string, so `2024-05-10T14:03:00Z` is that day as
    written: a source's own clock is not second-guessed into another timezone.
    """
    match = _ISO_DAY.match(str(value or ""))
    if not match:
        return ""
    try:
        return date.fromisoformat(match.group(1)).isoformat()
    except ValueError:
        return ""


_HEX = re.compile(r"^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _hex(value: Any) -> str:
    """A CSS colour a source wrote, as `#rrggbb`, or nothing.

    Only hex is read. A source that named a colour in words or in `rgb()` is
    rare enough, and the cost of getting it wrong — a legend row painted a
    colour the source never used — is worse than a row painted from our own
    palette and honest about it.
    """
    text = str(value or "").strip()
    match = _HEX.match(text)
    if not match:
        return ""
    digits = match.group(1).lower()
    if len(digits) == 3:
        digits = "".join(digit * 2 for digit in digits)
    return f"#{digits}"


_TAGS = re.compile(r"<[^>]+>")
_SPACES = re.compile(r"[ \t\r\f\v]+")
_BLANK_LINES = re.compile(r"\n{3,}")

#: Where one line of a description ends. A My Maps writes its columns as a
#: table, and a table stripped of its tags is one run-on sentence — the labels
#: the source wrote are only labels while the rows they head are still lines.
_HTML_BREAK = re.compile(r"(?i)<br\s*/?>|</(?:p|div|tr|li|h[1-6]|table|blockquote)\s*>")
#: …and where a row's label ends and its value begins.
_HTML_CELL = re.compile(r"(?i)</t[dh]\s*>\s*<t[dh]\b[^>]*>")
#: A link, which is worth more than the words it was written under: the popup
#: shows text, so an address that lives only in an `href` would be lost.
_HTML_LINK = re.compile(
    r"(?is)<a\b[^>]*\bhref\s*=\s*[\"']([^\"']+)[\"'][^>]*>(.*?)</a\s*>"
)


def _text(value: Any, limit: int) -> str:
    """A source's own words, as text.

    A KML description is arbitrary HTML — a My Maps writes tables, images and
    links into it — and the popup shows what the source says rather than
    rendering someone else's markup inside the app. Tags are dropped here, at
    the boundary, so nothing downstream has to decide whether a string is safe.
    """
    if value is None:
        return ""
    text = _TAGS.sub(" ", str(value))
    text = (
        text.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
    )
    text = _SPACES.sub(" ", text)
    text = _BLANK_LINES.sub("\n\n", text)
    text = "\n".join(line.strip() for line in text.splitlines()).strip()
    return text[:limit]


def _rich_text(value: Any, limit: int) -> str:
    """The same, for a description — the one field a source writes markup into.

    Tags still go, but not before what they *said* is written down as text: a
    row becomes a line, the two cells of a row become `label: value`, and a
    link keeps the address it pointed at. Stripping the markup first turns a My
    Maps table into one run-on paragraph with the URLs missing, which is the
    popup in the screenshot nobody could read.

    Kept apart from `_text` because a name and a category are one line each and
    must stay that way; only a description is allowed to arrive shaped.
    """
    if value is None:
        return ""
    text = _HTML_LINK.sub(_link_text, str(value))
    text = _HTML_CELL.sub(": ", text)
    text = _HTML_BREAK.sub("\n", text)
    return _text(text, limit)


def _link_text(match: "re.Match[str]") -> str:
    """An anchor as text: its words, plus its address when they are not it."""
    href = _TAGS.sub(" ", match.group(1)).replace("&amp;", "&").strip()
    words = _TAGS.sub(" ", match.group(2)).strip()
    if not href:
        return words
    if not words or href in words:
        return href
    return f"{words} {href}"


# ---------------------------------------------------------------------------
# GeoJSON
# ---------------------------------------------------------------------------

_GEOMETRY_TYPES = frozenset(
    {
        "Point", "MultiPoint", "LineString", "MultiLineString",
        "Polygon", "MultiPolygon", "GeometryCollection",
    }
)

#: Properties a GeoJSON commonly carries the feature's own name under. Read in
#: order, first hit wins — unlike the category, a name is not a grouping, so
#: guessing wrong costs a popup heading rather than a wrong legend.
_NAME_KEYS = ("name", "title", "Name", "NAME", "label")
_DESCRIPTION_KEYS = ("description", "Description", "desc", "comment", "notes")


def _from_geojson(data: bytes, filename: str) -> tuple[list[dict[str, Any]], str]:
    try:
        document = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LayerError(f"this is not valid JSON: {exc}") from exc
    if not isinstance(document, dict):
        raise LayerError("a GeoJSON file is an object, not a list")

    type_ = document.get("type")
    if type_ == "FeatureCollection":
        raw = document.get("features")
        if not isinstance(raw, list):
            raise LayerError("this FeatureCollection has no features array")
    elif type_ == "Feature":
        raw = [document]
    elif type_ in _GEOMETRY_TYPES:
        raw = [{"type": "Feature", "geometry": document, "properties": {}}]
    else:
        raise LayerError(f"unsupported GeoJSON type '{type_}'")

    category = _text(document.get("name") or _stem(filename), MAX_NAME) or UNGROUPED
    features: list[dict[str, Any]] = []
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        geometry = _geometry(entry.get("geometry"))
        if geometry is None:
            continue
        _bound(features)
        source = entry.get("properties")
        source = source if isinstance(source, dict) else {}
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": _properties(
                    name=_first(source, _NAME_KEYS),
                    description=_first(source, _DESCRIPTION_KEYS),
                    category=_text(source.get("category"), MAX_NAME) if document.get("azimut_detect_layer") == 1 else category,
                    date=source.get("pass_date", "") if document.get("azimut_detect_layer") == 1 else "",
                    # simplestyle-spec, which is what every tool that writes a
                    # styled GeoJSON — geojson.io included — puts the colour in
                    colour=_hex(source.get("marker-color") or source.get("stroke")
                                or source.get("fill")),
                ),
            }
        )
        if document.get("azimut_detect_layer") == 1:
            features[-1]["properties"].update({key: _text(source.get(key), MAX_NAME)
                for key in ("pass_date", "detector", "area_name", "run_id")})
    return features, _text(document.get("name"), MAX_NAME)


def _first(source: dict[str, Any], keys: tuple[str, ...]) -> str:
    for key in keys:
        value = source.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _geometry(geometry: Any) -> dict[str, Any] | None:
    """A geometry we will draw, or None for one we will not.

    Null geometry is legal GeoJSON and common in exports — a row with attributes
    and no position. It is not an error; there is simply nothing to put on a map.
    """
    if not isinstance(geometry, dict):
        return None
    type_ = geometry.get("type")
    if type_ not in _GEOMETRY_TYPES:
        return None
    if type_ == "GeometryCollection":
        children = []
        for entry in geometry.get("geometries") or []:
            drawn = _geometry(entry)
            if drawn is not None:
                children.append(drawn)
        return {"type": "GeometryCollection", "geometries": children} if children else None
    coordinates = geometry.get("coordinates")
    if not isinstance(coordinates, list) or not coordinates:
        return None
    points = sum(1 for _ in _coordinates(geometry))
    if points > MAX_GEOMETRY_POINTS:
        raise LayerError(
            f"one shape in this file has {points:,} points — the limit is "
            f"{MAX_GEOMETRY_POINTS:,}"
        )
    return {"type": type_, "coordinates": coordinates}


def _bound(features: list[dict[str, Any]]) -> None:
    if len(features) >= MAX_FEATURES:
        raise LayerError(
            f"this file holds more than {MAX_FEATURES:,} features — past that it "
            "is a dataset, not a layer"
        )


# ---------------------------------------------------------------------------
# KML, and the KMZ it may arrive zipped in
# ---------------------------------------------------------------------------


def _kml_out_of_kmz(data: bytes) -> tuple[bytes, str]:
    """The one KML inside a KMZ, with the zip's three lies checked first.

    Nothing is written to disk — the member is read into memory — so zip-slip is
    not a file-writing risk here. The names are still refused, because a member
    called `../doc.kml` says the archive was built to escape something, and an
    archive that lies about where its files go is not one to read the contents of.
    """
    try:
        archive = zipfile.ZipFile(BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise LayerError("this KMZ is not a readable zip archive") from exc

    with archive:
        entries = archive.infolist()
        if len(entries) > MAX_ZIP_MEMBERS:
            raise LayerError(f"this KMZ holds more than {MAX_ZIP_MEMBERS:,} files")
        total = 0
        for entry in entries:
            if _escapes(entry.filename):
                raise LayerError(f"this KMZ names a file outside itself: {entry.filename}")
            total += entry.file_size
            if total > MAX_UNCOMPRESSED_BYTES:
                raise LayerError(
                    f"this KMZ unpacks to more than {_megabytes(MAX_UNCOMPRESSED_BYTES)}"
                )
            if entry.compress_size and entry.file_size / entry.compress_size > MAX_COMPRESSION_RATIO:
                raise LayerError("this KMZ is compressed far past anything a map file needs")

        member = _main_kml(entries)
        if member is None:
            raise LayerError("this KMZ holds no KML file")
        with archive.open(member) as handle:
            return handle.read(MAX_SOURCE_BYTES + 1), member.filename


def _escapes(name: str) -> bool:
    """Whether a zip member name climbs out of its own archive."""
    cleaned = name.replace("\\", "/")
    if cleaned.startswith("/") or re.match(r"^[A-Za-z]:", cleaned):
        return True
    return any(part == ".." for part in cleaned.split("/"))


def _main_kml(entries: list[zipfile.ZipInfo]) -> zipfile.ZipInfo | None:
    """`doc.kml` by convention, else the first KML at the shallowest depth."""
    candidates = [
        entry
        for entry in entries
        if not entry.is_dir() and entry.filename.lower().endswith(".kml")
    ]
    if not candidates:
        return None
    for entry in candidates:
        if entry.filename.lower() == "doc.kml":
            return entry
    return min(candidates, key=lambda e: (e.filename.count("/"), e.filename))


_KML_NS = re.compile(r"^\{[^}]*\}")


def _tag(element: Element) -> str:
    return _KML_NS.sub("", element.tag)


def _child(element: Element, name: str) -> Element | None:
    for child in element:
        if _tag(child) == name:
            return child
    return None


def _child_text(element: Element, name: str) -> str:
    child = _child(element, name)
    return child.text or "" if child is not None else ""


def _xml(data: bytes) -> Element:
    """Parse untrusted XML with the entity machinery switched off.

    `defusedxml` is what refuses the external entity and the expansion bomb; the
    depth walk below is what refuses the third shape, a document nested deep
    enough to exhaust the stack of whatever walks it.
    """
    try:
        root = parse_xml(data)
    except ParseError as exc:
        raise LayerError(f"this XML will not parse: {exc}") from exc
    except ValueError as exc:  # defusedxml raises its own refusals as these
        raise LayerError(f"this file was refused: {exc}") from exc
    _check_depth(root)
    return root


def _check_depth(root: Element) -> None:
    stack = [(root, 1)]
    while stack:
        element, depth = stack.pop()
        if depth > MAX_XML_DEPTH:
            raise LayerError(f"this file nests deeper than {MAX_XML_DEPTH} levels")
        for child in element:
            stack.append((child, depth + 1))


def _from_kml(data: bytes) -> tuple[list[dict[str, Any]], str, dict[str, dict[str, Any]]]:
    root = _xml(data)
    inner = _child(root, "Document") if _tag(root) == "kml" else None
    document = root if inner is None else inner
    styles = _kml_styles(root)
    title = _text(_child_text(document, "name"), MAX_NAME)

    features: list[dict[str, Any]] = []
    #: key → what that pictogram is, in the order the file first asks for it, so
    #: the cap below falls on the groups a creator added last.
    icons: dict[str, dict[str, Any]] = {}
    _walk_kml(document, [], styles, features, title, icons)
    return features, title, icons


def _walk_kml(
    element: Element,
    folders: list[str],
    styles: dict[str, dict[str, Any]],
    features: list[dict[str, Any]],
    title: str,
    icons: dict[str, dict[str, Any]],
) -> None:
    """Depth-first, carrying the folder path that names each placemark's category."""
    for child in element:
        tag = _tag(child)
        if tag in ("Folder", "Document"):
            name = _text(_child_text(child, "name"), MAX_NAME)
            _walk_kml(
                child,
                [*folders, name] if name else folders,
                styles,
                features,
                title,
                icons,
            )
        elif tag == "Placemark":
            _placemark(child, folders, styles, features, title, icons)
        elif tag in ("kml", "GroundOverlay", "NetworkLink", "ScreenOverlay"):
            continue


def _placemark(
    element: Element,
    folders: list[str],
    styles: dict[str, dict[str, Any]],
    features: list[dict[str, Any]],
    title: str,
    icons: dict[str, dict[str, Any]],
) -> None:
    geometries = list(_kml_geometries(element))
    if not geometries:
        return
    name = _text(_child_text(element, "name"), MAX_NAME)
    description = _child_text(element, "description")
    if not description:
        description = _kml_extended_data(element)
    style = _kml_style(element, styles)
    colour = str(style.get("colour") or "")
    day = _kml_day(element)
    icon = _icon_of(style)
    key = ""
    if icon is not None:
        key, descriptor = icon
        icons.setdefault(key, descriptor)
    category = " / ".join(folders) if folders else (title or UNGROUPED)
    for geometry in geometries:
        _bound(features)
        features.append(
            {
                "type": "Feature",
                "geometry": geometry,
                "properties": _properties(
                    name=name,
                    description=description,
                    category=category,
                    colour=colour,
                    # only a point draws a pictogram; a line and an area are
                    # drawn by their own stroke and fill
                    icon=key if _kind(geometry) == "point" else "",
                    date=day,
                ),
            }
        )


def _kml_day(element: Element) -> str:
    """When a placemark says it happened: a TimeStamp, else where a TimeSpan starts."""
    stamp = _child(element, "TimeStamp")
    if stamp is not None:
        return iso_day(_child_text(stamp, "when"))
    span = _child(element, "TimeSpan")
    if span is not None:
        return iso_day(_child_text(span, "begin"))
    return ""


def _kml_extended_data(element: Element) -> str:
    """A My Maps puts its columns here rather than in the description."""
    data = _child(element, "ExtendedData")
    if data is None:
        return ""
    rows = []
    for child in data:
        if _tag(child) != "Data":
            continue
        label = child.get("name") or ""
        value = _child_text(child, "value")
        if label and value:
            rows.append(f"{label}: {value}")
    return "\n".join(rows)


def _kml_styles(root: Element) -> dict[str, dict[str, Any]]:
    """`#styleId` → what that style draws, following one level of StyleMap.

    A My Maps writes a StyleMap per placemark with a normal and a highlight
    pair; the normal one is what the map draws, so that is the one read.
    """
    direct: dict[str, dict[str, Any]] = {}
    maps: dict[str, str] = {}
    for element in root.iter():
        tag = _tag(element)
        identifier = element.get("id")
        if not identifier:
            continue
        if tag == "Style":
            style = _style(element)
            if style:
                direct[identifier] = style
        elif tag == "StyleMap":
            for pair in element:
                if _tag(pair) != "Pair" or _child_text(pair, "key").strip() != "normal":
                    continue
                target = _child_text(pair, "styleUrl").strip().lstrip("#")
                if target:
                    maps[identifier] = target
    for identifier, target in maps.items():
        if target in direct:
            direct[identifier] = direct[target]
    return direct


def _style(style: Element) -> dict[str, Any]:
    """A style as the two things it can say: a colour, and a pictogram.

    Empty when it says neither, so a `<Style>` holding only a label size does not
    take precedence over the one a StyleMap points at.
    """
    icon_style = _child(style, "IconStyle")
    read = {
        "colour": _style_colour(style),
        "href": _icon_href(icon_style),
        "scale": _icon_scale(icon_style),
        "hotspot": _hotspot(icon_style),
    }
    return read if read["colour"] or read["href"] else {}


def _style_colour(style: Element) -> str:
    """A style's colour, preferring what fills a mark over what outlines a shape."""
    for name in ("IconStyle", "PolyStyle", "LineStyle", "LabelStyle"):
        child = _child(style, name)
        if child is None:
            continue
        colour = _kml_abgr(_child_text(child, "color"))
        if colour:
            return colour
    return ""


def _icon_href(icon_style: Element | None) -> str:
    """Where the source keeps this pictogram — an address, or a name in a KMZ.

    Read as a string and nothing more. Whether it is worth following, and whether
    following it is allowed at all, is `icon_images`' question.
    """
    if icon_style is None:
        return ""
    icon = _child(icon_style, "Icon")
    href = _child_text(icon, "href").strip() if icon is not None else ""
    return href[:MAX_HREF]


def _icon_scale(icon_style: Element | None) -> float:
    """How much bigger than usual the source drew this one. 1 when it said nothing."""
    if icon_style is None:
        return 1.0
    try:
        scale = float(_child_text(icon_style, "scale").strip() or 1.0)
    except ValueError:
        return 1.0
    return scale if 0 < scale < 100 else 1.0


def _hotspot(icon_style: Element | None) -> tuple[float, float, str, str] | None:
    """The pixel of the image the source anchors it by, in the units it gave.

    Resolved no further here: `x=32 pixels` only means something once the image
    it measures has been read, and reading it is a later act than parsing.
    """
    if icon_style is None:
        return None
    spot = _child(icon_style, "hotSpot")
    if spot is None:
        return None
    try:
        x, y = float(spot.get("x", "")), float(spot.get("y", ""))
    except ValueError:
        return None
    return x, y, spot.get("xunits", "fraction"), spot.get("yunits", "fraction")


def _icon_of(style: dict[str, Any]) -> tuple[str, dict[str, Any]] | None:
    """A style's pictogram, keyed by everything that decides what it looks like.

    The key is the content hash of the description, so two styles that would
    compose to the same pixels are one stored image — which is what keeps a My
    Maps with one style per placemark down to one icon per *look*.
    """
    href = str(style.get("href") or "")
    if not href:
        return None
    descriptor = {
        "href": href,
        "colour": str(style.get("colour") or ""),
        "scale": float(style.get("scale") or 1.0),
        "hotspot": list(style["hotspot"]) if style.get("hotspot") else None,
    }
    return icon_key(descriptor), descriptor


def icon_key(descriptor: dict[str, Any]) -> str:
    """The name a pictogram is stored under: the hash of what decides its pixels."""
    seed = json.dumps(descriptor, sort_keys=True).encode("utf-8")
    return hashlib.sha256(seed).hexdigest()[:ICON_KEY_LENGTH]


def _kml_abgr(value: str) -> str:
    """KML writes `aabbggrr`; CSS wants `#rrggbb`, and the alpha is dropped.

    Opacity is the layer's to set — a source that painted a fill at 40% did so
    against its own basemap, not against whatever imagery this case is on.
    """
    text = str(value or "").strip().lstrip("#")
    if len(text) != 8 or not re.fullmatch(r"[0-9a-fA-F]{8}", text):
        return ""
    return f"#{text[6:8]}{text[4:6]}{text[2:4]}".lower()


def _kml_style(element: Element, styles: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """What this placemark draws: the style it points at, else the one inside it."""
    url = _child_text(element, "styleUrl").strip().lstrip("#")
    if url and url in styles:
        return styles[url]
    inline = _child(element, "Style")
    return _style(inline) if inline is not None else {}


def _kml_geometries(element: Element) -> Iterator[dict[str, Any]]:
    for child in element:
        tag = _tag(child)
        if tag == "Point":
            point = _kml_points(_child_text(child, "coordinates"))
            if point:
                yield {"type": "Point", "coordinates": point[0]}
        elif tag in ("LineString", "LinearRing"):
            points = _kml_points(_child_text(child, "coordinates"))
            if len(points) >= 2:
                yield {"type": "LineString", "coordinates": points}
        elif tag == "Polygon":
            rings = list(_kml_rings(child))
            if rings:
                yield {"type": "Polygon", "coordinates": rings}
        elif tag == "Track":
            # Google Earth's own track: timestamped `<gx:coord>lon lat alt</gx:coord>`
            # rather than a coordinates string. The times are not drawn, so what
            # is left of it is the path.
            track = [
                fix
                for coord in child
                if _tag(coord) == "coord" and (fix := _gx_coord(coord.text)) is not None
            ]
            if len(track) >= 2:
                yield {"type": "LineString", "coordinates": track}
        elif tag == "MultiGeometry":
            yield from _kml_geometries(child)


def _kml_rings(polygon: Element) -> Iterator[list[list[float]]]:
    """Outer boundary first, then the holes — the order GeoJSON reads them in."""
    for name in ("outerBoundaryIs", "innerBoundaryIs"):
        for child in polygon:
            if _tag(child) != name:
                continue
            ring = _child(child, "LinearRing")
            if ring is None:
                continue
            points = _kml_points(_child_text(ring, "coordinates"))
            if len(points) < 4:
                continue
            if points[0] != points[-1]:
                points.append(points[0])
            yield points


def _kml_points(text: str) -> list[list[float]]:
    """`lon,lat[,alt]` tuples, whitespace-separated. Altitude is dropped."""
    points: list[list[float]] = []
    for chunk in str(text or "").split():
        parts = chunk.split(",")
        if len(parts) < 2:
            continue
        try:
            lon, lat = float(parts[0]), float(parts[1])
        except ValueError:
            continue
        if not _on_earth(lon, lat):
            continue
        points.append([lon, lat])
        if len(points) > MAX_GEOMETRY_POINTS:
            raise LayerError(
                f"one shape in this file has more than {MAX_GEOMETRY_POINTS:,} points"
            )
    return points


def _gx_coord(text: str | None) -> list[float] | None:
    parts = str(text or "").split()
    if len(parts) < 2:
        return None
    try:
        lon, lat = float(parts[0]), float(parts[1])
    except ValueError:
        return None
    return [lon, lat] if _on_earth(lon, lat) else None


def _on_earth(lon: float, lat: float) -> bool:
    return -180 <= lon <= 180 and -90 <= lat <= 90


# ---------------------------------------------------------------------------
# GPX
# ---------------------------------------------------------------------------

#: What a GPX states about its own contents, which is the whole of its grouping.
_GPX_CATEGORIES = {"wpt": "Waypoints", "trk": "Tracks", "rte": "Routes"}


def _from_gpx(data: bytes) -> tuple[list[dict[str, Any]], str]:
    root = _xml(data)
    features: list[dict[str, Any]] = []
    title = ""
    metadata = _child(root, "metadata")
    if metadata is not None:
        title = _text(_child_text(metadata, "name"), MAX_NAME)

    for child in root:
        tag = _tag(child)
        category = _GPX_CATEGORIES.get(tag)
        if category is None:
            continue
        name = _text(_child_text(child, "name"), MAX_NAME)
        description = _child_text(child, "desc") or _child_text(child, "cmt")
        if tag == "wpt":
            point = _gpx_point(child)
            if point is None:
                continue
            _bound(features)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": point},
                    "properties": _properties(
                        name=name,
                        description=description,
                        category=category,
                        date=_child_text(child, "time"),
                    ),
                }
            )
            continue
        for points in _gpx_paths(child, tag):
            if len(points) < 2:
                continue
            _bound(features)
            features.append(
                {
                    "type": "Feature",
                    "geometry": {"type": "LineString", "coordinates": points},
                    "properties": _properties(
                        name=name, description=description, category=category
                    ),
                }
            )
    return features, title


def _gpx_paths(element: Element, tag: str) -> Iterator[list[list[float]]]:
    """A track's segments, or a route's single run of points."""
    if tag == "rte":
        yield [
            point for child in element
            if _tag(child) == "rtept" and (point := _gpx_point(child)) is not None
        ]
        return
    for segment in element:
        if _tag(segment) != "trkseg":
            continue
        yield [
            point for child in segment
            if _tag(child) == "trkpt" and (point := _gpx_point(child)) is not None
        ]


def _gpx_point(element: Element) -> list[float] | None:
    try:
        lon, lat = float(element.get("lon", "")), float(element.get("lat", ""))
    except ValueError:
        return None
    return [lon, lat] if _on_earth(lon, lat) else None


# ---------------------------------------------------------------------------
# The source's own pictograms
# ---------------------------------------------------------------------------
#
# Only ever reached through the tick the analyst put on the add dialog, which is
# what makes this defensible at all: a KMZ carries its icons inside itself and
# costs nothing, but a KML — a My Maps above all — points at somebody else's
# server, and following that is a request the app must be *asked* to make.
#
# Nothing a host sent is handed on. Every image is decoded here, tinted, resized
# and re-encoded, so what the browser loads is a PNG this process produced. That
# is one answer to three separate things: an SVG with a script in it, a file
# pretending to be an image, and a thumbnail that unpacks into a gigabyte.
#
# No failure here refuses a layer. An icon that will not load leaves its features
# drawing the app's own shape in the source's colour, which is a map that still
# says what is where.


def icon_images(
    descriptors: dict[str, dict[str, Any]], *, source: bytes = b""
) -> dict[str, bytes]:
    """key → the PNG to store for it, skipping every one that could not be made.

    `source` is the original bytes, which is how a KMZ's own icons are found: its
    hrefs name members of the archive the layer was read from.
    """
    if not descriptors:
        return {}
    archive = _icon_archive(source)
    out: dict[str, bytes] = {}
    total = 0
    fetched = 0
    try:
        for key in list(descriptors)[:MAX_ICONS]:
            descriptor = descriptors[key]
            if _on_the_web(descriptor):
                if fetched >= MAX_FETCHED_ICONS:
                    continue
                fetched += 1
            raw = _icon_bytes(descriptor, archive)
            if not raw:
                continue
            png = _compose_icon(raw, descriptor)
            if png is None:
                continue
            total += len(png)
            if total > MAX_ICONS_BYTES:
                break
            out[key] = png
    finally:
        if archive is not None:
            archive.close()
    return out


def _icon_archive(source: bytes) -> zipfile.ZipFile | None:
    """The KMZ the layer came out of, when it came out of one."""
    if source[:4] != _ZIP_MAGIC:
        return None
    try:
        return zipfile.ZipFile(BytesIO(source))
    except zipfile.BadZipFile:
        return None


def _on_the_web(descriptor: dict[str, Any]) -> bool:
    return str(descriptor.get("href") or "").lower().startswith(("http://", "https://"))


def _icon_bytes(
    descriptor: dict[str, Any], archive: zipfile.ZipFile | None
) -> bytes:
    """The image a descriptor points at: out of the archive, or off the web."""
    href = str(descriptor.get("href") or "")
    if _on_the_web(descriptor):
        return _fetch_icon(href)
    return _zipped_icon(archive, href) if archive is not None else b""


def _zipped_icon(archive: zipfile.ZipFile, href: str) -> bytes:
    """A KMZ member named by a relative href, matched the way a zip stores names.

    Case-insensitively, because a KML written on Windows regularly disagrees with
    its own archive about capitalisation, and the analyst would read that as the
    icons simply not working.
    """
    name = unquote(href.split("?", 1)[0].split("#", 1)[0]).replace("\\", "/")
    name = name.removeprefix("./")
    if not name or _escapes(name):
        return b""
    for entry in archive.infolist():
        if entry.is_dir() or entry.filename.replace("\\", "/").lower() != name.lower():
            continue
        if entry.file_size > MAX_ICON_BYTES:
            return b""
        with archive.open(entry) as handle:
            return handle.read(MAX_ICON_BYTES + 1)
    return b""


def _fetch_icon(href: str) -> bytes:
    """One image off the web, bounded, and never a reason to refuse the layer."""
    try:
        with httpx.stream(
            "GET",
            href,
            timeout=ICON_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        ) as response:
            response.raise_for_status()
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > MAX_ICON_BYTES:
                return b""
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > MAX_ICON_BYTES:
                    return b""
                chunks.append(chunk)
            return b"".join(chunks)
    except (httpx.HTTPError, ValueError):
        return b""


def _compose_icon(raw: bytes, descriptor: dict[str, Any]) -> bytes | None:
    """Somebody else's image → the PNG this app will serve for it.

    The order is the whole of it. The hotspot is read first, against the size the
    source measured it in — `x=32 pixels` means the middle of a 64px icon and
    nothing at all once that icon has been resized. Then tint, because the colour
    is applied at full detail; then resize, so every icon comes out one size; and
    pad last, which is what puts the anchor on the centre.
    """
    try:
        with Image.open(BytesIO(raw)) as opened:
            if opened.width * opened.height > MAX_ICON_AREA:
                return None
            opened.load()
            image = opened.convert("RGBA")
    except (OSError, ValueError, Image.DecompressionBombError):
        return None
    if not image.width or not image.height:
        return None
    anchor = _hotspot_fraction(descriptor.get("hotspot"), image.width, image.height)
    image = _tint(image, str(descriptor.get("colour") or ""))
    image = _resize_icon(image, float(descriptor.get("scale") or 1.0))
    image = _centre_on(image, anchor)
    buffer = BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()


def _tint(image: "Image.Image", colour: str) -> "Image.Image":
    """`<color>` over the image, which in KML means a multiply.

    The step the whole feature turns on. A My Maps' stock pictograms are *white*
    silhouettes — the shape is in the PNG and the colour is in the style — so an
    untinted one is a white blob on white imagery, and honouring the href without
    honouring the colour would look like a bug rather than a map.
    """
    rgb = _rgb(colour)
    if rgb is None:
        return image
    red, green, blue, alpha = image.split()
    bands = [
        band.point([level * value // 255 for level in range(256)])
        for band, value in zip((red, green, blue), rgb)
    ]
    return Image.merge("RGBA", (*bands, alpha))


def _rgb(colour: str) -> tuple[int, int, int] | None:
    text = _hex(colour)
    if not text:
        return None
    return int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16)


def _ink(image: "Image.Image") -> tuple[int, float] | None:
    """The box a pictogram actually paints in, and how much of that box it fills.

    Both read off the opaque core rather than off every pixel the source's own
    antialiasing left a trace in: a soft edge is not part of what the eye
    measures a mark by, and counting it would make a blurry icon read as a
    bigger one.
    """
    solid = image.split()[3].point(lambda level: 255 if level > 128 else 0)
    box = solid.getbbox()
    if box is None:
        return None
    width, height = box[2] - box[0], box[3] - box[1]
    if width <= 0 or height <= 0:
        return None
    painted = solid.crop(box).histogram()[255]
    return max(width, height), max(MIN_ICON_FILL, min(1.0, painted / (width * height)))


def _resize_icon(image: "Image.Image", scale: float) -> "Image.Image":
    """Every icon to one weight, measured on its **ink** rather than its canvas.

    Two separate lies the canvas tells. A My Maps archive holds a 56px square
    painted edge to edge next to a 26px glyph floating in a 56px sheet of
    transparency, so holding the *sheets* to one size draws the second at a
    third of the first. And once the boxes match, a square that fills its box
    still carries nearly twice the ink of the disc beside it. So what is held
    equal is the painted extent, discounted by how densely it is painted, with
    the source's own `<scale>` riding on top.
    """
    ink = _ink(image)
    if ink is None:
        return image
    extent, fill = ink
    side = max(MIN_ICON_SIDE, min(MAX_ICON_SIDE, round(ICON_SIDE * scale)))
    # A glyph lost in a large sheet would scale that whole sheet up with it, so
    # the canvas is held to its own ceiling — the ink then comes out a little
    # under `side`, which is the right way round: too small beats a texture the
    # size of a photograph.
    factor = min(
        side / (extent * fill**ICON_FILL_WEIGHT),
        MAX_ICON_CANVAS / max(image.width, image.height),
    )
    size = (max(1, round(image.width * factor)), max(1, round(image.height * factor)))
    # Lanczos is the right filter for shrinking and the wrong one for growing: it
    # rings, and a ring in the alpha channel of a glyph blown up four times is a
    # visible halo around the mark. Bicubic on the way up has none.
    filter_ = Image.Resampling.LANCZOS if factor < 1 else Image.Resampling.BICUBIC
    return image.resize(size, filter_)


def _centre_on(
    image: "Image.Image", anchor: tuple[float, float] | None
) -> "Image.Image":
    """Pad the image so the pixel the source anchors it by sits at its centre.

    Baked into the pixels rather than carried as a per-feature offset: the map
    then draws every icon the same way — centred, one layout — and a pin whose
    tip is its meaning puts that tip on the ground rather than its own middle.
    The padding is transparent, so it costs almost nothing once compressed.
    """
    if anchor is None:
        return image
    across, down = anchor[0] * image.width, anchor[1] * image.height
    width = max(image.width, round(2 * max(across, image.width - across)))
    height = max(image.height, round(2 * max(down, image.height - down)))
    if (width, height) == (image.width, image.height):
        return image
    padded = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    padded.paste(image, (round(width / 2 - across), round(height / 2 - down)))
    return padded


def _hotspot_fraction(
    hotspot: list[float] | tuple[float, ...] | None, width: int, height: int
) -> tuple[float, float] | None:
    """A KML hotSpot as fractions from the top-left, or None for a centred one.

    Three unit systems and two origins: KML measures `y` up from the bottom,
    except for `insetPixels`, which measures down from the top — and that is the
    one My Maps writes.
    """
    if not hotspot or len(hotspot) != 4 or width <= 0 or height <= 0:
        return None
    x, y, xunits, yunits = hotspot[0], hotspot[1], str(hotspot[2]), str(hotspot[3])
    across = float(x) if xunits == "fraction" else float(x) / width
    if xunits == "insetPixels":
        across = 1.0 - across
    down = float(y) if yunits == "fraction" else float(y) / height
    if yunits != "insetPixels":
        down = 1.0 - down
    across = min(max(across, 0.0), 1.0)
    down = min(max(down, 0.0), 1.0)
    if abs(across - 0.5) < 1e-6 and abs(down - 0.5) < 1e-6:
        return None
    return across, down


# ---------------------------------------------------------------------------
# A layer in a case
# ---------------------------------------------------------------------------
#
# Four files, because the layer does four different things and each has its
# own answer to "does this travel?":
#
#     .layers/<name>.json          the spec — where it came from, how it
#                                  refreshes, which categories are hidden
#     .layers/<name>.src           the bytes as received, plus their sha256
#     .layers/<name>.icons         the source's pictograms, composed here
#     .layers/.cache/<name>.geojson  what the browser draws, derived
#
# The icons travel, unlike the parsed copy, and for the reason that decides all
# of this: they cannot be rebuilt offline. A KMZ's are in the snapshot, but a My
# Maps' came off Google's servers, and a case restored on a machine with no
# network would quietly lose half of what its map looked like. So they are stored
# as a companion the bundle carries, not as a cache.
#
# The snapshot is the original rather than a normalised GeoJSON on purpose: it
# hashes like a media, and "never rewriting evidence already saved from it" is
# then true by construction rather than by care. The parsed form is a cache in
# the strict sense — dropped on delete, never carried in a bundle, and rebuilt
# here the moment something asks for it.
#
# Nothing in this file adopts a feature into the case. A layer is drawn, filtered
# and consulted; the graph knows it as one `map-layer` entity and nothing else.

#: The spec's own version, so a later shape can be told from this one.
SPEC_VERSION = 1

#: Which parser wrote a cached copy.
#:
#: The cache is derived, and *which code derived it* is part of what it is: a
#: layer added from a file is never re-read — nothing about it changes — so
#: without this stamp it would draw the output of whichever parser was current
#: the day it was dropped in, for as long as the case lives. Bumped whenever a
#: change here would give the same bytes a different reading; the next request
#: for that layer reparses the snapshot already on disk.
PARSE_VERSION = 3

#: Where that stamp is written. A GeoJSON object may carry members it does not
#: define, and this one is written first so the check reads the head of the file
#: rather than the twenty megabytes behind it.
PARSE_KEY = "azimut_parse"

#: What the entity type is called wherever the graph names it.
ENTITY_TYPE = "map-layer"

#: How long a fetched snapshot is treated as current. Past it the row says the
#: layer is stale *before* it redraws, which is the whole point of the readout:
#: a layer silently drawing week-old data on a map where decisions get made is
#: this feature's worst failure.
FRESH_FOR_HOURS = 24

#: What a remote source may weigh, checked against the declared length before a
#: byte is read and again as it arrives — a server is free to lie about both.
MAX_FETCH_BYTES = MAX_SOURCE_BYTES

FETCH_TIMEOUT = 30

#: The only feed a Google My Maps has. It is undocumented and Google may change
#: it, so a shape that no longer parses fails with a sentence rather than
#: drawing nothing (SPEC §9 records why this one unofficial endpoint ships).
#:
#: **The KMZ, not the `forcekml=1` conversion beside it.** Both carry the same
#: placemarks, and the difference is everything the map was drawn with: the KMZ
#: bundles the creator's actual icons as archive members, while `forcekml=1`
#: throws the pictograms away and points every style at one of three *blank*
#: Google containers — `503-wht-blank_maps.png`, `961-wht-square-blank.png`,
#: `960-wht-star-blank.png`. A map of forty hand-picked symbols comes back as
#: coloured blanks. The archive is also a quarter of the size on the wire, and
#: its icons need no third-party request at all.
MY_MAPS_FEED = "https://www.google.com/maps/d/kml?mid={mid}"

#: Every form a My Maps share link arrives in — the viewer, the editor, the
#: short `u/0/` variant, and the feed itself pasted back in.
_MY_MAPS = re.compile(
    r"^https?://(?:www\.)?google\.[^/]+/maps/d/(?:u/\d+/)?"
    r"(?:viewer|edit|embed|kml)?\?[^#]*\bmid=([A-Za-z0-9_\-]+)",
    re.IGNORECASE,
)


class LayerFetchError(LayerError):
    """A source that could not be read this time, which is not the same as one
    that will never be readable: the last snapshot stays on the map."""


#: A layer asked of GeoConfirmed by conflict, dates and area rather than by
#: address (`engine/geoconfirmed.py`).
GEOCONFIRMED = "geoconfirmed"

#: The sources a layer follows rather than holds: re-read on Refresh and on case
#: open, and stale when that was too long ago. A file is never either.
FOLLOWED = ("url", GEOCONFIRMED)


def _reading(source: dict[str, Any]) -> Reading | None:
    """The publisher's own reading of this source's bytes, where it has one."""
    if source.get("kind") != GEOCONFIRMED:
        return None
    from . import geoconfirmed  # it imports this module, so not at the top

    return geoconfirmed.reading(source)


def my_maps_mid(url: str) -> str:
    """The map id out of any My Maps link, or "" when it is not one."""
    match = _MY_MAPS.match(str(url or "").strip())
    return match.group(1) if match else ""


def feed_url(url: str) -> str:
    """What is actually fetched for a pasted address.

    A My Maps link is turned into its KML feed — that is the sharing mechanism
    the map's own creator switched on, and there is no other way to read one. Any
    other URL is fetched as given.
    """
    mid = my_maps_mid(url)
    return MY_MAPS_FEED.format(mid=mid) if mid else str(url or "").strip()


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _read_spec(case: "Case", name: str) -> dict[str, Any]:
    path = case.resolve_inside(layout.layer_spec_rel(name))
    try:
        spec = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise LayerError("this layer is not in the case") from exc
    except json.JSONDecodeError as exc:
        raise LayerError("this layer's settings will not parse") from exc
    if not isinstance(spec, dict) or "azimut_layer" not in spec:
        raise LayerError("this file is not a map layer")
    return spec


def _write_spec(case: "Case", name: str, spec: dict[str, Any]) -> None:
    case.subdir(layout.LAYERS_DIR)
    path = case.resolve_inside(layout.layer_spec_rel(name))
    path.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _free_name(case: "Case", title: str) -> str:
    """A stem no other layer holds. Two files called `Roads` are two layers."""
    case.subdir(layout.LAYERS_DIR)
    base = layout.slugify(title, "Layer")
    name, counter = base, 1
    while case.resolve_inside(layout.layer_spec_rel(name)).exists():
        suffix = f"-{counter}"
        name = f"{base[: layout.MAX_SLUG - len(suffix)]}{suffix}"
        counter += 1
    return name


def _store(
    case: "Case", name: str, data: bytes, parsed: dict[str, Any], *, icons: bool
) -> dict[str, Any]:
    """Write the snapshot, its pictograms and its derived cache.

    The one place `icons` decides anything: false and no href is read, off the
    web or out of the archive, and the map draws the app's own shapes. The spec
    is the caller's to write.
    """
    case.subdir(layout.LAYERS_DIR)
    case.resolve_inside(layout.layer_snapshot_rel(name)).write_bytes(data)
    _write_cache(case, name, parsed["geojson"])
    return {
        "sha256": digest(data),
        "bytes": len(data),
        "at": _now(),
        "icons": _write_icons(case, name, parsed["icons"] if icons else {}, source=data),
    }


def _write_icons(
    case: "Case", name: str, descriptors: dict[str, dict[str, Any]], *, source: bytes
) -> int:
    """Compose what a source asked for into one zip, and say how many landed.

    Built whole in memory before anything is written, so a fetch that dies
    halfway leaves the layer with the icons it had rather than half a set. Stored
    rather than deflated: a PNG is already compressed, and a zip of them is a
    directory that happens to be one file.
    """
    path = case.resolve_inside(layout.layer_icons_rel(name))
    images = icon_images(descriptors, source=source)
    if not images:
        path.unlink(missing_ok=True)
        return 0
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for key, png in images.items():
            archive.writestr(f"{key}.png", png)
    path.write_bytes(buffer.getvalue())
    return len(images)


_ICON_KEY = re.compile(r"[0-9a-f]{1,32}")


def icon(case: "Case", name: str, key: str) -> bytes:
    """One stored pictogram, by the key the features that draw it name it with."""
    if not _ICON_KEY.fullmatch(str(key or "")):
        raise LayerError("that is not an icon of this layer")
    path = case.resolve_inside(layout.layer_icons_rel(name))
    try:
        with zipfile.ZipFile(path) as archive:
            return archive.read(f"{key}.png")
    except (OSError, KeyError, zipfile.BadZipFile) as exc:
        raise LayerError("this layer has no such icon") from exc


def _write_cache(case: "Case", name: str, geojson: dict[str, Any]) -> Path:
    path = case.resolve_inside(layout.layer_cache_rel(name))
    path.parent.mkdir(parents=True, exist_ok=True)
    stamped = {PARSE_KEY: PARSE_VERSION, **geojson}
    path.write_text(json.dumps(stamped, ensure_ascii=False), encoding="utf-8")
    return path


def _cache_is_current(path: Path) -> bool:
    """Whether this cached copy came from the parser running now.

    Read from the head of the file: these run to tens of megabytes, and the
    question is answered by the first line of one.
    """
    try:
        with path.open("rb") as handle:
            head = handle.read(64).decode("utf-8", "replace")
    except OSError:
        return False
    return f'"{PARSE_KEY}": {PARSE_VERSION}' in head


def drawing(case: "Case", name: str) -> Path:
    """The parsed GeoJSON to serve, rebuilt from the snapshot when it is gone.

    Which is the normal case after a restore from the Trash or an import: the
    cache is the one of the three files that never travels, so every caller has
    to be able to live without it. Rebuilding is one parse of bytes already on
    disk — and the same parse is what an older stamp asks for, so a layer added
    from a file is read by the parser running now rather than by the one that was
    current the day it was added.
    """
    spec = _read_spec(case, name)
    path = case.resolve_inside(layout.layer_cache_rel(name))
    if path.is_file() and _cache_is_current(path):
        return path
    snapshot = case.resolve_inside(layout.layer_snapshot_rel(name))
    try:
        data = snapshot.read_bytes()
    except OSError as exc:
        raise LayerError("this layer's saved copy is missing") from exc
    parsed = parse(
        data,
        filename=_source_name(spec),
        title=spec.get("title", ""),
        reading=_reading(spec.get("source") or {}),
    )
    return _write_cache(case, name, parsed["geojson"])


def _source_name(spec: dict[str, Any]) -> str:
    source = spec.get("source") or {}
    return str(source.get("name") or source.get("url") or "")


def add_file(
    case: "Case",
    data: bytes,
    *,
    filename: str,
    title: str | None = None,
    icons: bool = False,
) -> dict[str, Any]:
    """A file the analyst opened, as a layer of this case.

    Reaches no network unless `icons` was ticked *and* the file points its
    pictograms at web addresses — which is why the tick defaults to off here and
    on for a subscription: opening a file off this machine does not inherently
    need the network, and following a link does.
    """
    parsed = parse(data, filename=filename, title=title or "")
    source = {"kind": "file", "name": filename, "format": parsed["summary"]["format"]}
    return add_source(case, data, parsed, source=source, title=title, icons=icons)


def save_detection_snapshot(case: "Case", key: str, title: str,
                            document: dict[str, Any]) -> dict[str, Any]:
    """An explicit Detect export, kept independently of its working runs."""
    data = json.dumps(document, ensure_ascii=False).encode()
    parsed = parse(data, filename="detect.geojson", title=title)
    existing = next((r for r in listing(case) if r["source"].get("detection_key") == key), None)
    if existing is None:
        return add_source(case, data, parsed, title=title, icons=False,
                          source={"kind": "file", "name": "detect.geojson", "format": "geojson", "detection_key": key})
    name = existing["name"]
    spec = _read_spec(case, name)
    spec["snapshot"] = _store(case, name, data, parsed, icons=False)
    spec["summary"] = parsed["summary"]
    spec["updated_at"] = _now()
    live = {row["name"] for row in parsed["summary"]["categories"]}
    spec["hidden"] = [entry for entry in spec.get("hidden", []) if entry in live]
    _write_spec(case, name, spec)
    return row(name, spec)


def subscribe(
    case: "Case",
    url: str,
    *,
    title: str | None = None,
    on_open: bool = True,
    icons: bool = True,
) -> dict[str, Any]:
    """A URL the analyst followed. The one place this feature reaches out."""
    address = str(url or "").strip()
    if not address.lower().startswith(("http://", "https://")):
        raise LayerError("a subscribed layer needs an http or https address")
    data, filename = fetch(address)
    parsed = parse(data, filename=filename, title=title or "")
    source = {
        "kind": "url",
        "url": address,
        "feed": feed_url(address),
        "name": filename,
        "format": parsed["summary"]["format"],
        "my_maps": bool(my_maps_mid(address)),
    }
    return add_source(
        case, data, parsed, source=source, title=title, icons=icons, on_open=on_open
    )


def add_source(
    case: "Case",
    data: bytes,
    parsed: dict[str, Any],
    *,
    source: dict[str, Any],
    title: str | None,
    icons: bool,
    on_open: bool | None = None,
    hidden: tuple[str, ...] = (),
) -> dict[str, Any]:
    """File a parsed source as a layer of this case: its spec, its files, its node.

    `on_open` is for a followed source only, and `hidden` names the groups that
    start switched off — only those the source actually holds.
    """
    summary = parsed["summary"]
    name = _free_name(case, title or summary["title"])
    live = {entry["name"] for entry in summary["categories"]}
    spec: dict[str, Any] = {
        "azimut_layer": SPEC_VERSION,
        "title": summary["title"],
        "source": source,
        "hidden": sorted(set(hidden) & live),
        # What the analyst asked for at import, kept so a refresh composes the
        # same layer again rather than a differently dressed one.
        "source_icons": bool(icons),
        "created_at": _now(),
        "updated_at": _now(),
        "summary": summary,
        "snapshot": _store(case, name, data, parsed, icons=bool(icons)),
    }
    if on_open is not None:
        # Re-read the first time it is switched on in a session, which is what
        # "subscribed" means; off leaves a layer that only moves on Refresh.
        # Named for when it began as "on case open", kept so no case migrates.
        spec["refresh"] = {"on_open": bool(on_open)}
    _write_spec(case, name, spec)
    _file_entity(case, name, spec)
    return row(name, spec)


def refresh(case: "Case", name: str) -> dict[str, Any]:
    """Fetch a subscribed layer again and replace its snapshot if it moved.

    An unchanged feed rewrites nothing: same bytes, same sha256, and the row
    only learns that it was checked. A fetch that fails leaves the last snapshot
    exactly where it was — the layer stays on the map, saying how old it is.

    For GeoConfirmed the bytes are half of it: the factions that name the
    legend are read beside the export, and a faction added since is a reason
    to read the same bytes again.
    """
    spec = _read_spec(case, name)
    before = spec.get("source") or {}
    if before.get("kind") not in FOLLOWED:
        raise LayerError("this layer came from a file, so there is nothing to refresh")

    source = before
    if before.get("kind") == GEOCONFIRMED:
        from . import geoconfirmed

        data, source = geoconfirmed.read_again(before)
        spec["source"] = source
    else:
        data, _ = fetch(str(before.get("url") or ""))
    snapshot = spec.get("snapshot") or {}
    now = _now()
    if digest(data) == snapshot.get("sha256") and source == before:
        spec["snapshot"] = {**snapshot, "checked_at": now}
    else:
        parsed = parse(
            data,
            filename=_source_name(spec),
            title=spec.get("title", ""),
            reading=_reading(source),
        )
        spec["summary"] = parsed["summary"]
        spec["snapshot"] = {
            **_store(case, name, data, parsed, icons=bool(spec.get("source_icons"))),
            "checked_at": now,
        }
        # A category the source has since dropped is no longer a thing to hide.
        live = {entry["name"] for entry in parsed["summary"]["categories"]}
        spec["hidden"] = [name_ for name_ in spec.get("hidden") or [] if name_ in live]
    spec["updated_at"] = now
    _write_spec(case, name, spec)
    return row(name, spec)


def update(
    case: "Case",
    name: str,
    *,
    hidden: list[str] | None = None,
    period: tuple[str, str] | None = None,
    on_open: bool | None = None,
    title: str | None = None,
) -> dict[str, Any]:
    """What the analyst set on the row that outlives the session: the legend,
    the time filter, the refresh policy and the title.

    `period` is a first and a last day, either of them "" for no bound, and both
    "" to clear it. It is kept whatever the layer's own dates: a refresh can move
    those, and the filter is the analyst's question rather than a fact about the
    data.

    Not the switch. Whether a layer is drawn lives in the page and starts off on
    every load, so a layer that crashed the tab is not drawn again by the reload.
    """
    spec = _read_spec(case, name)
    if hidden is not None:
        live = {entry["name"] for entry in (spec.get("summary") or {}).get("categories", [])}
        spec["hidden"] = sorted({str(entry) for entry in hidden} & live)
    if period is not None:
        start, end = iso_day(period[0]), iso_day(period[1])
        if start and end and end < start:
            start, end = end, start
        if start or end:
            spec["period"] = {"start": start, "end": end}
        else:
            spec.pop("period", None)
    if on_open is not None and (spec.get("source") or {}).get("kind") in FOLLOWED:
        spec["refresh"] = {**(spec.get("refresh") or {}), "on_open": bool(on_open)}
    if title:
        spec["title"] = _text(title, MAX_NAME) or spec["title"]
    spec["updated_at"] = _now()
    _write_spec(case, name, spec)
    if title:
        entity = case.find_entity(attr="spec", value=layout.layer_spec_rel(name))
        if entity:
            case.update_entity(entity["id"], {"label": spec["title"]})
    return row(name, spec)


def listing(case: "Case") -> list[dict[str, Any]]:
    """Every layer this case holds, newest first."""
    rows = []
    for path in sorted(case.subdir(layout.LAYERS_DIR).glob("*.json")):
        try:
            rows.append(row(path.stem, _read_spec(case, path.stem)))
        except LayerError:
            continue
    rows.sort(key=lambda entry: entry.get("created_at") or "", reverse=True)
    return rows


def read(case: "Case", name: str) -> dict[str, Any]:
    return row(name, _read_spec(case, name))


def row(name: str, spec: dict[str, Any]) -> dict[str, Any]:
    """One layer as the panel reads it.

    Freshness is computed rather than stored: a snapshot does not become stale by
    being written to, it becomes stale by sitting there.
    """
    snapshot = spec.get("snapshot") or {}
    summary = spec.get("summary") or {}
    source = spec.get("source") or {}
    at = str(snapshot.get("checked_at") or snapshot.get("at") or "")
    return {
        "name": name,
        "title": spec.get("title") or name,
        "source": source,
        "hidden": list(spec.get("hidden") or []),
        # the time filter, `{start, end}`, either bound "" when open
        "period": spec.get("period") or None,
        "refresh": spec.get("refresh") or {},
        "features": int(summary.get("features") or 0),
        "categories": summary.get("categories") or [],
        "bbox": summary.get("bbox"),
        "format": summary.get("format") or source.get("format") or "",
        # How many of the source's own pictograms are stored, which is also what
        # tells the map whether to ask for any: zero and it draws its own shapes.
        "icons": int(snapshot.get("icons") or 0),
        "sha256": snapshot.get("sha256") or "",
        "bytes": int(snapshot.get("bytes") or 0),
        "fetched_at": snapshot.get("at") or "",
        "checked_at": at,
        "stale": source.get("kind") in FOLLOWED and _stale(at),
        "created_at": spec.get("created_at") or "",
        "updated_at": spec.get("updated_at") or "",
        "spec": layout.layer_spec_rel(name),
    }


def _stale(stamp: str) -> bool:
    """Whether a subscribed snapshot is old enough that the row must say so.

    A local file is never stale: it is exactly what the analyst opened, and it
    was never going to change on its own.
    """
    if not stamp:
        return True
    try:
        at = datetime.strptime(stamp, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return datetime.now(timezone.utc) - at > timedelta(hours=FRESH_FOR_HOURS)


def _file_entity(case: "Case", name: str, spec: dict[str, Any]) -> str:
    """The layer in the graph: one node, no edges.

    It is an entity so that the Trash, the bundle and the artifact registry
    answer for it the way they answer for everything else a case holds. It states
    nothing about the case, which is why nothing links to it.
    """
    rel = layout.layer_spec_rel(name)
    existing = case.find_entity(attr="spec", value=rel)
    if existing:
        case.update_entity(existing["id"], {"label": spec["title"]})
        return str(existing["id"])
    source = spec.get("source") or {}
    attrs = {"spec": rel, "format": spec.get("summary", {}).get("format", "")}
    if source.get("kind") in FOLLOWED:
        attrs["source_url"] = source.get("url", "")
    return str(case.add_entity(ENTITY_TYPE, spec["title"], attrs=attrs, by="map-layers")["id"])


# ---------------------------------------------------------------------------
# The one network call
# ---------------------------------------------------------------------------


def fetch(url: str) -> tuple[bytes, str]:
    """Read a remote source, bounded, and say what it was called.

    Nothing here runs on a timer. This is reached from adding a subscription,
    from pressing Refresh, and from switching a layer on for the first time in a
    session when it asked to be re-read then — three acts, all of them the
    analyst's.
    """
    address = feed_url(url)
    if not address.lower().startswith(("http://", "https://")):
        raise LayerFetchError("a subscribed layer needs an http or https address")
    return download(address)


def download(
    address: str,
    *,
    body: dict[str, Any] | None = None,
    limit: int = MAX_FETCH_BYTES,
    user_agent: str = USER_AGENT,
) -> tuple[bytes, str]:
    """One bounded request: a GET, or a POST of `body` as JSON.

    The size is checked against the declared length before a byte is read and
    again as the bytes arrive, since a server is free to lie about either.
    """
    try:
        with httpx.stream(
            "GET" if body is None else "POST",
            address,
            json=body,
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": user_agent},
        ) as response:
            response.raise_for_status()
            declared = response.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > limit:
                raise LayerFetchError(
                    f"that source is {_megabytes(int(declared))} — the limit is "
                    f"{_megabytes(limit)}"
                )
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > limit:
                    raise LayerFetchError(f"that source is over {_megabytes(limit)}")
                chunks.append(chunk)
            name = _filename(response.headers.get("content-disposition"), address)
            return b"".join(chunks), name
    except httpx.HTTPStatusError as exc:
        raise LayerFetchError(_status_reason(exc, address)) from exc
    except httpx.HTTPError as exc:
        raise LayerFetchError(f"could not reach that source: {exc}") from exc


def _status_reason(exc: "httpx.HTTPStatusError", address: str) -> str:
    """Why it failed, in the words the analyst can act on.

    My Maps is the case worth spelling out: a map that is not shared publicly
    answers exactly like a map that does not exist, and "404" would send someone
    looking for a typo instead of at the sharing settings.
    """
    code = exc.response.status_code
    if MY_MAPS_FEED.split("?", 1)[0] in address and code in (401, 403, 404):
        return (
            "Google would not serve that map. It has to be shared publicly — "
            "open it in My Maps, then Share, then anyone with the link."
        )
    return f"that source answered {code}"


def _filename(disposition: str | None, address: str) -> str:
    """What to call what came back, for the format sniff's benefit only."""
    match = re.search(r'filename\*?=(?:UTF-8\'\')?"?([^";]+)', str(disposition or ""))
    if match:
        return match.group(1).strip()
    path = str(address).split("?", 1)[0].rstrip("/")
    return path.rsplit("/", 1)[-1] if "/" in path else ""
