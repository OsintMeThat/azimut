"""A figure: one place, one day, several renderings, laid out for publication.

The figure an analyst actually publishes is rarely one picture. It is the same
ground four times — true colour for what a reader recognises, a short-wave
composite for the heat, a single band for the same thing without the colour, an
index for the measurement — each captioned, with one line underneath saying
where and when. Building that by hand means four captures, four files, four
drags onto a canvas and a footer typed from memory.

So it is one press. Each panel is a real capture, filed with its own provenance
(the ``/satellite/figure`` route), and the layout is a Geo Proof spec: the composer already
lays panels out in a grid, captions them, draws the footer and takes
annotations, so a figure opens as an ordinary composition the analyst can put
arrows on rather than as a picture they can only accept or redo.

Nothing here reaches the network or the disk — it is the arithmetic of the
layout and the wording of the footer, which is why it can be read on its own.
"""

from __future__ import annotations

import uuid
from typing import Any

#: Panels per row, and the ceiling. Two across is what the figures this was
#: built for use, and a figure nobody can read the captions of is not a figure:
#: past eight panels it is a contact sheet.
#:
#: "Per row" rather than "columns" because a body field named `columns` is a
#: table the browser assembled, which the hardening gate holds to a size limit
#: (`tests/test_hardening.py`). This is a count from one to four.
#:
#: "Figure" rather than "plate" on purpose: a plate is already the SVG a Graph
#: or a Timeline is written out as (``api/plates.py``), and the canvas a Geo
#: Proof composes on (``lib/composer.js``). A third meaning would cost more
#: than the word is worth.
DEFAULT_PER_ROW = 2
MAX_PANELS = 8
MAX_PER_ROW = 4

#: What every panel is drawn from, said once under the figure.
CREDIT = "Copernicus Sentinel-2 L2A"
RADAR_CREDIT = "Copernicus Sentinel-1 GRD"


def caption_for(label: str, at: int, total: int, numbered: bool = True) -> str:
    """A panel's caption. Numbered, because a figure's text refers to panel 2."""
    text = " ".join(str(label or "").split())
    if not numbered or total < 2:
        return text
    return f"{at + 1}. {text}" if text else f"{at + 1}."


def footer_line(day: str, coords: str, credit: str = CREDIT) -> str:
    """The one line under the figure: when, where, and from what.

    Each part only when it is known. An undated figure says nothing about a date
    rather than printing an empty field — the same rule the date pill follows.
    """
    parts = []
    if day:
        parts.append(f"Date: {day}")
    if coords:
        parts.append(f"Coordinates: {coords}")
    if credit:
        parts.append(f"Source: {credit}")
    return "  ·  ".join(parts)


def spec(
    panels: list[dict[str, Any]],
    *,
    per_row: int = DEFAULT_PER_ROW,
    footer: str = "",
    numbered: bool = True,
) -> dict[str, Any]:
    """The Geo Proof a figure is saved as.

    ``panels`` is one entry per rendering, in the order they were asked for:
    ``{"src", "label", "natural", "lat", "lon"}``. Everything the composer can
    decide for itself is left out, so a figure opens as a plain composition
    rather than one frozen into whatever this module thought a figure should
    look like — the one exception being the footer, which states the figure's
    own provenance and is the reason it is worth pressing one button for.
    """
    across = max(1, min(int(per_row), MAX_PER_ROW))
    total = len(panels)
    return {
        "azimut_proof": 1,
        "panels": [
            {
                "id": f"p{uuid.uuid4().hex[:8]}",
                "src": entry["src"],
                "caption": caption_for(entry.get("label", ""), at, total, numbered),
                "row": at // across,
                "scale": 1,
                "natural": [int(entry["natural"][0]), int(entry["natural"][1])],
                # The composer reads the point off a panel for the coordinates
                # it offers; `aimed` says an analyst put the crosshair there,
                # which a figure's centre is.
                "meta": {"lat": entry["lat"], "lon": entry["lon"], "aimed": True},
            }
            for at, entry in enumerate(panels)
        ],
        "pastes": [],
        "shapes": [],
        "notes": {},
        "legendOrder": [],
        "material": [],
        "sources": [],
        # Said once, in the credit line. The composer's own coordinate footer
        # stays off so the figure does not print the point twice.
        "footer": footer,
    }
