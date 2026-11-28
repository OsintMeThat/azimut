"""Write the site whose home What's new pictures: `uv run python scripts/whats_new_site.py OUT`.

`npm run guide:news` (`frontend/guide/news.mjs`) calls it, then photographs the home it
leaves in OUT. The site is invented: five articles of a harbour-watching site, each with
a photograph of the guide's demo case as its list picture (`frontend/guide/photos`, all
public domain) and a place on the home's map. The home is written by the code that
writes an analyst's own home on GitHub Pages (`engine/sitehome.py`), so the picture is
the home as Azimut makes it, its tabs, its map of places and its cards.
"""

from __future__ import annotations

import shutil
import sys
from pathlib import Path
from typing import Any

from azimut.engine import site, siteatlas, sitehome
from azimut.engine.notelook import NotePlace
from azimut.engine.site import Card, Site

ROOT = Path(__file__).resolve().parents[1]
PHOTOS = ROOT / "frontend" / "guide" / "photos"

HOME = Site(title="Harbour Watch", address="https://your-name.github.io/",
            tagline="Open-source looks at ports and shipping", author="your-name")

#: Each article: its folder, title, summary, day, category, list picture and place.
ARTICLES: tuple[tuple[str, str, str, str, str, str, tuple[float, float, str]], ...] = (
    ("ym-success", "A photo of the YM Success, placed on the west bank of the Main Channel",
     "One photo posted with no caption, placed from the bridge and the cranes behind it.",
     "2026-11-27", "Ports", "bridge_channel.jpg", (33.7417, -118.2795, "Los Angeles")),
    ("bridge-from-both-banks", "The bridge from both banks",
     "Two clips of one departure, each placed, then dated by the shadows on the bridge.",
     "2026-11-24", "Ports", "channel_departure.jpg", (33.7497, -118.2716, "San Pedro")),
    ("a-container-yard-grows", "A container yard grows",
     "Six Sentinel-2 passes read side by side: the yard gained at least 14 hectares in a year.",
     "2026-11-18", "Shipping", "container_yard.jpg", (32.9, -79.95, "Charleston")),
    ("miami-from-above", "Miami from above, before the season",
     "An aerial picture matched to the terminal, and what it can and cannot date.",
     "2026-11-09", "Shipping", "miami_port_aerial.jpg", (25.7781, -80.1706, "Miami")),
    ("wando-terminal", "Wando Welch Terminal ruled out",
     "Why the green bridge in the post cannot be Charleston's.",
     "2026-11-02", "Ports", "wando_terminal.jpg", (32.835, -79.896, "Wando")),
)


def write(out: Path) -> None:
    """The home, its kit and each article's list picture, under `out` as the site's root."""
    lines: list[dict[str, Any]] = []
    for folder, title, summary, day, category, photo, (lat, lon, name) in ARTICLES:
        (out / folder).mkdir(parents=True, exist_ok=True)
        shutil.copy(PHOTOS / photo, out / folder / "card.jpg")
        card = Card(title=title, summary=summary, date=day, category=category, author=HOME.author,
                    image="card.jpg", place=NotePlace(lat=lat, lon=lon, name=name))
        lines.append(site.line_of(card, folder))
    listed, maps, pages = site.listing(lines), site.map_view(lines), site.pages_of(lines)
    home = site.fill(sitehome.home(HOME, listed, maps, pages), listed, maps, HOME.title, HOME.prefix)
    (out / site.HOME).write_text(home, encoding="utf-8")
    for path, data in sitehome.kit(HOME, atlas=bool(siteatlas.placed(listed))).items():
        target = out / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


if __name__ == "__main__":
    write(Path(sys.argv[1]))
