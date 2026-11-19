"""The vector copy an icon imported as an SVG keeps beside its PNG, cut down to shapes.

The library keeps every icon as a PNG this process made (`iconlibrary`). An icon that
came in as an SVG also keeps this copy, so the pages drawn as SVG (the HTML report, the
web folder, the editor's chart) draw its paths sharp at any size; the PDF and the
pictures keep the PNG. An SVG can carry a script, so the copy is rebuilt from an
allowlist, never passed through:

- **Elements**: ``svg`` (the root only), ``g``, ``path``, ``circle``, ``ellipse``,
  ``rect``, ``line``, ``polyline``, ``polygon``. Any other is dropped with all it holds;
  an ``<a>`` is drawn as a group, its link gone.
- **Attributes**: geometry (``d``, ``points``, ``x``, ``y``, ``cx``, ``cy``, ``r``,
  ``rx``, ``ry``, ``width``, ``height``, ``x1`` to ``y2``, ``transform``) and paint
  (``fill``, ``stroke``, ``stroke-width``, ``fill-rule``, ``opacity`` and the few in
  `PAINT`), each value checked against its own grammar; a ``style`` attribute is read
  for the same properties. Nothing else survives: no event attribute, no ``href``, no id,
  no class, no ``url(…)``, no entity.
- **The parse** is defusedxml's with the DOCTYPE refused, and so every entity, bounded
  in bytes, elements and depth.

A copy is kept only when it draws what the PNG draws (`Vector.whole`): an SVG that
leans on something dropped (a gradient, a ``<use>``, a stylesheet, text, a clip) keeps
its PNG alone, as every icon imported before this did. What is dropped without changing
the drawing (a title, metadata, an editor's own namespace, a script, which an image
never runs anyway) does not cost the copy.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any
from xml.etree.ElementTree import Element

from defusedxml.ElementTree import ParseError, fromstring as parse_xml

#: What an SVG read for its vector may weigh, and the cleaned copy kept.
MAX_SOURCE_BYTES = 256 * 1024
MAX_VECTOR_BYTES = 128 * 1024
#: How many elements, and how deep, a drawing may be.
MAX_ELEMENTS = 2000
MAX_DEPTH = 32

SVG_NS = "http://www.w3.org/2000/svg"
SHAPES = frozenset({"g", "path", "circle", "ellipse", "rect", "line", "polyline", "polygon"})
#: Elements that draw nothing themselves: dropped with what they hold, the drawing unchanged.
#: What they define only shows through a reference (``url(#…)``, ``<use>``), which costs the copy.
QUIET_ELEMENTS = frozenset({"title", "desc", "metadata", "script", "defs", "symbol", "linearGradient",
                            "radialGradient", "pattern", "clipPath", "mask", "filter", "marker"})

_NUMBER = r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?"
#: A length in the drawing's own units: a share (``50%``) would read against a view the copy cuts.
_LENGTH = re.compile(rf"^{_NUMBER}(?:px)?$")
_PLAIN = re.compile(rf"^{_NUMBER}$")
_SHARE = re.compile(rf"^{_NUMBER}%?$")
_PATH = re.compile(r"^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]*$")
_POINTS = re.compile(r"^[0-9eE.,+\-\s]*$")
_TRANSFORM = re.compile(r"^\s*(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[0-9eE.,+\-\s]*\)\s*,?\s*)+$")
_DASHES = re.compile(r"^(?:none|[0-9eE.,+\-\s]+)$")
_COLOUR = re.compile(r"^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|(?:rgba?|hsla?)\([0-9.,%\s/deg+\-]*\)|[a-zA-Z]{3,24})$")
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")
_ENUMS = {
    "fill-rule": ("nonzero", "evenodd"),
    "stroke-linecap": ("butt", "round", "square"),
    "stroke-linejoin": ("miter", "round", "bevel", "arcs", "miter-clip"),
}

#: Geometry, each by the grammar its value must match, and the elements it is read on.
GEOMETRY: dict[str, re.Pattern[str]] = {
    "d": _PATH, "points": _POINTS, "transform": _TRANSFORM,
    **{name: _LENGTH for name in ("x", "y", "cx", "cy", "r", "rx", "ry", "width", "height", "x1", "y1", "x2", "y2")},
}
#: Paint, inherited from a group to what it holds.
PAINT = ("fill", "stroke", "stroke-width", "fill-rule", "opacity", "fill-opacity", "stroke-opacity",
         "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset")
#: Attributes and style properties dropped without changing the drawing.
QUIET = frozenset({"id", "class", "version", "baseProfile", "preserveAspectRatio", "enable-background",
                   "shape-rendering", "text-rendering", "image-rendering", "color-rendering",
                   "color-interpolation", "color-interpolation-filters", "role", "focusable", "tabindex",
                   "overflow", "href", "stop-color", "stop-opacity", "flood-color", "flood-opacity",
                   "lighting-color", "solid-color", "solid-opacity", "isolation", "letter-spacing",
                   "word-spacing", "line-height", "writing-mode", "direction", "dominant-baseline",
                   "baseline-shift", "white-space", "xmlns", "target"})
_QUIET_PREFIXES = ("font", "text-", "data-", "aria-", "-inkscape", "inkscape", "sodipodi", "on")
#: Values of these properties that change nothing, so a file that writes them keeps its copy.
_DEFAULTS = {"display": ("inline", "block", "inherit", ""), "visibility": ("visible", "inherit", ""),
             "paint-order": ("normal", "fill stroke markers", "fill", ""), "mix-blend-mode": ("normal", ""),
             "vector-effect": ("none", "")}
_HIDDEN = {"display": ("none",), "visibility": ("hidden", "collapse")}


@dataclass(frozen=True)
class Vector:
    """A drawing kept: its ``view`` (x, y, width, height) and its ``body``, the shapes as
    this module writes them; ``whole`` when nothing that drew was dropped."""

    view: tuple[float, float, float, float]
    body: str
    whole: bool = True

    def document(self) -> str:
        """The copy as a file of its own, what the library stores."""
        return (f'<svg xmlns="{SVG_NS}" viewBox="{" ".join(_n(value) for value in self.view)}">'
                f"{self.body}</svg>")


class _Lost(Exception):
    """Something that drew was dropped: the copy would not draw what the PNG draws."""


def clean(text: str | bytes) -> Vector | None:
    """An SVG's drawing rebuilt from the allowlist, or None when it cannot be read, is
    past `MAX_SOURCE_BYTES`, has no viewBox, or draws nothing that is kept."""
    raw = text.encode("utf-8") if isinstance(text, str) else bytes(text)
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        return None
    return _clean(raw)


@lru_cache(maxsize=32)
def _clean(raw: bytes) -> Vector | None:
    try:
        root = parse_xml(raw, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except (ParseError, ValueError, SyntaxError):  # defusedxml refuses as ValueError subclasses
        return None
    if _local(root.tag) != "svg" or _namespace(root.tag) not in ("", SVG_NS):
        return None
    view = _view(root.get("viewBox", ""))
    if view is None or not _bounded(root):
        return None
    state = {"lost": False, "shapes": 0}
    paint, colour = _paint(root, state, "#000000")
    if root.get("transform") is not None:
        state["lost"] = True
    children = "".join(_children(root, state, colour, 1))
    if not state["shapes"]:
        return None
    body = f"<g{_attributes(paint)}>{children}</g>" if paint else children
    if len(body.encode("utf-8")) > MAX_VECTOR_BYTES:
        return None
    return Vector(view, body, not state["lost"])


def cropped(vector: Vector, box: tuple[float, float, float, float]) -> Vector:
    """The drawing seen through ``box``, the share of its view (left, top, right, bottom,
    each 0 to 1) a picture of it paints: its view is cut to its ink, as the PNG is."""
    x, y, width, height = vector.view
    left, top, right, bottom = (min(1.0, max(0.0, edge)) for edge in box)
    if right <= left or bottom <= top:
        return vector
    return Vector((x + width * left, y + height * top, width * (right - left), height * (bottom - top)),
                  vector.body, vector.whole)


def tinted(body: str, colour: str) -> str:
    """The drawing in one colour, as a silhouette is: every paint but ``none`` becomes
    ``colour``, and what names no fill takes it too. ``colour`` is a ``#rrggbb``."""
    colour = colour if _HEX.match(colour or "") else "#888888"
    painted = re.sub(r' (fill|stroke)="(?!none"|transparent")[^"]*"', rf' \1="{colour}"', body)
    return f'<g fill="{colour}">{painted}</g>'


# -- reading ---------------------------------------------------------------------------------------


def _local(tag: Any) -> str:
    return str(tag).rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _namespace(tag: Any) -> str:
    return str(tag)[1:].split("}", 1)[0] if isinstance(tag, str) and tag.startswith("{") else ""


def _view(value: str) -> tuple[float, float, float, float] | None:
    parts = [part for part in re.split(r"[\s,]+", value.strip()) if part]
    if len(parts) != 4 or not all(_PLAIN.match(part) for part in parts):
        return None
    x, y, width, height = (float(part) for part in parts)
    if not (width > 0 and height > 0) or not all(abs(value) < 1e7 for value in (x, y, width, height)):
        return None
    return (x, y, width, height)


def _bounded(root: Element) -> bool:
    count = 0
    stack = [(root, 1)]
    while stack:
        element, depth = stack.pop()
        count += 1
        if depth > MAX_DEPTH or count > MAX_ELEMENTS:
            return False
        stack.extend((child, depth + 1) for child in element)
    return True


def _declarations(style: str) -> list[tuple[str, str]]:
    out = []
    for part in style.split(";"):
        name, _, value = part.partition(":")
        name = name.strip()
        if name:
            out.append((name, " ".join(value.split())))
    return out


def _quiet(name: str) -> bool:
    return name in QUIET or name.startswith(_QUIET_PREFIXES)


def _hidden(element: Element) -> bool:
    said = {name: element.get(name, "") for name in _HIDDEN}
    said.update({name: value for name, value in _declarations(element.get("style", "")) if name in _HIDDEN})
    return any(value.strip() in _HIDDEN[name] for name, value in said.items())


def _valid(name: str, value: str, colour: str) -> str | None:
    """A paint or geometry value as it is kept, or None when it does not read."""
    value = " ".join(value.split())
    if name in GEOMETRY:
        return value if GEOMETRY[name].match(value) else None
    if name in ("fill", "stroke"):
        if value == "currentColor":
            return colour
        return value if _COLOUR.match(value) else None
    if name in _ENUMS:
        return value if value in _ENUMS[name] else None
    if name in ("stroke-dasharray",):
        return value if _DASHES.match(value) else None
    if name in ("opacity", "fill-opacity", "stroke-opacity"):
        return value if _SHARE.match(value) else None
    if name in ("stroke-width", "stroke-dashoffset"):
        return value if _LENGTH.match(value) else None
    if name == "stroke-miterlimit":
        return value if _PLAIN.match(value) else None
    return None


def _paint(element: Element, state: dict[str, Any], colour: str) -> tuple[dict[str, str], str]:
    """An element's own paint, kept, and the colour ``currentColor`` names inside it. A
    property its style sets wins over the attribute, as a browser reads them."""
    said: dict[str, str] = {}
    for name, value in element.attrib.items():
        if _namespace(name):
            continue  # another vocabulary's (xlink:href, an editor's own): nothing an image draws
        said[name] = value
    for name, value in _declarations(element.get("style", "")):
        said[name] = value
    said.pop("style", None)
    own_colour = said.pop("color", "")
    if own_colour and own_colour != "currentColor" and _COLOUR.match(own_colour.strip()):
        colour = own_colour.strip()
    kept: dict[str, str] = {}
    shape = _local(element.tag)
    for name, value in said.items():
        if name in PAINT or (name in GEOMETRY and shape != "svg"):
            read = _valid(name, value, colour)
            if read is None:
                state["lost"] = True
            else:
                kept[name] = read
        elif name in GEOMETRY or name == "viewBox":
            continue  # the root's size: its view is what is drawn
        elif name in _DEFAULTS:
            if value.strip() not in _DEFAULTS[name]:
                state["lost"] = True
        elif name in _HIDDEN:
            continue
        elif not _quiet(name):
            state["lost"] = True
    return kept, colour


def _children(element: Element, state: dict[str, Any], colour: str, depth: int) -> list[str]:
    out: list[str] = []
    for child in element:
        if not isinstance(child.tag, str):
            continue  # a comment or a processing instruction
        name, space = _local(child.tag), _namespace(child.tag)
        if space not in ("", SVG_NS):
            continue  # an editor's own element: no browser draws it
        if _hidden(child):
            continue
        if name not in SHAPES and name != "a":
            if name == "style" and not (child.text or "").strip():
                continue
            if name not in QUIET_ELEMENTS:
                state["lost"] = True
            continue
        paint, inner = _paint(child, state, colour)
        if name in ("g", "a"):  # a link is drawn as a group, its address gone
            held = "".join(_children(child, state, inner, depth + 1))
            if held:
                out.append(f"<g{_attributes(paint)}>{held}</g>")
            continue
        if _draws(name, paint):
            state["shapes"] += 1
            out.append(f"<{name}{_attributes(paint)}/>")
    return out


def _draws(name: str, attributes: dict[str, str]) -> bool:
    """Whether a shape has what it is drawn from: a path its ``d``, a circle its radius."""
    needs = {"path": ("d",), "circle": ("r",), "ellipse": ("rx", "ry"), "rect": ("width", "height"),
             "line": (), "polyline": ("points",), "polygon": ("points",)}[name]
    return all(attributes.get(key, "").strip() for key in needs)


def _attributes(attributes: dict[str, str]) -> str:
    return "".join(f' {name}="{html.escape(value, quote=True)}"' for name, value in attributes.items())


def _n(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text
