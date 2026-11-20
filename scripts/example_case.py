"""Build the example case the app opens in one press: `uv run python scripts/example_case.py`.

An invented island, Saltmere, an invented storm on the night of 14 to 15 March 2026, and
invented accounts making claims about it, told through real photographs of other storms
and places. Every photograph is a work of the United States government in the public
domain, taken from Wikimedia Commons and credited in `CREDITS.md` beside the bundle and on
its media in the case (its Commons page as its source, its author and licence in its
notes). Nothing in the case puts an invented event on a real place without saying so where
the picture shows: each note opens on a callout saying the story is invented, and every
photograph standing in it as evidence says what it really is in its own caption, its
proof's band or its credit line (*Illustration: FEMA photo, Pensacola Beach, Florida,
16 July 2005*). No landmark is shown, and names and numbers on hulls are blurred.

The case is filled through the routes the app serves, as `tests/fullcase.py` fills its
own, in a throwaway workspace, then written as a case bundle into
`src/azimut/assets/example/`, which `engine/examplecase.py` imports on the press. The
notes are `scripts/example_notes/*.md`, made from the showcase templates of
`frontend/src/lib/notes/ready.js`; `{{name}}` in them is the id of what the case filed
under that name.

The photographs are fetched from Commons only here, while the bundle is built, at the
sizes Commons serves its thumbnails in, into a cache folder (`--photos`, a temporary one
by default). Opening the case fetches nothing.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
NOTES = Path(__file__).resolve().parent / "example_notes"
OUT = ROOT / "src" / "azimut" / "assets" / "example"
FONTS = ROOT / "src" / "azimut" / "assets" / "fonts"

# -- where the island is ---------------------------------------------------------------------

#: The middle of the map's ground: open ocean in the South Atlantic, far from any land, so no
#: real place sits under the invented one.
LAT0, LON0 = -41.2, -22.6
#: The ground's tile zoom, its size, and so the metres each of its pixels covers.
GROUND_ZOOM = 17
ZONE = "UTC"


def _mercator(lat: float, lon: float, zoom: float) -> tuple[float, float]:
    world = 256 * 2 ** zoom
    x = (lon + 180) / 360 * world
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * world
    return x, y


def _unmercator(x: float, y: float, zoom: float) -> tuple[float, float]:
    world = 256 * 2 ** zoom
    lon = x / world * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * y / world))))
    return lat, lon


def ground_point(px: float, py: float, size: tuple[int, int]) -> tuple[float, float]:
    """The latitude and longitude of a pixel of the ground, which is laid north up round the middle."""
    cx, cy = _mercator(LAT0, LON0, GROUND_ZOOM)
    return _unmercator(cx + px - size[0] / 2, cy + py - size[1] / 2, GROUND_ZOOM)


def offset(east_m: float, north_m: float) -> tuple[float, float]:
    """A point so many metres east and north of the ground's middle."""
    lat = LAT0 + north_m / 111_320
    return lat, LON0 + east_m / (111_320 * math.cos(math.radians(LAT0)))


def coords(point: tuple[float, float]) -> str:
    return f"{point[0]:.6f}, {point[1]:.6f}"


# -- the photographs -------------------------------------------------------------------------


@dataclass(frozen=True)
class Photo:
    """A photograph on Commons: its file, who made it, what it truly shows, and the origin
    a caption names when it stands in the story as an illustration."""

    title: str
    author: str
    shows: str
    taken: str
    wide: bool = True
    #: Agency, place and day, as a caption or a proof's band says them: "FEMA photo, Pensacola Beach, Florida, 16 July 2005".
    origin: str = ""

    @property
    def page(self) -> str:
        return "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(self.title.replace(" ", "_"))


PHOTOS: dict[str, Photo] = {
    "bayland": Photo("File:FEMA - 38737 - Boats moved on shore and damaged by Hurricane Ike.jpg", "Walter Jennings, FEMA",
                     "Boats and their floating docks pushed 200 ft inland at the Bayland Marina near Houston, Texas, by Hurricane Ike's surge",
                     "21 September 2008", origin="FEMA photo, Bayland Marina, Baytown, Texas, 21 September 2008"),
    "pleasure": Photo("File:FEMA - 38748 - Damaged boats in Texas.jpg", "Liz Roll, FEMA",
                      "Damaged boats at the Pleasure Island marina, Port Arthur, Texas, after Hurricane Ike",
                      "20 September 2008", origin="FEMA photo, Pleasure Island marina, Port Arthur, Texas, 20 September 2008"),
    "baytown": Photo("File:FEMA - 39211 - Boat damage in Texas from Hurricane Ike.jpg", "Greg Henshall, FEMA",
                     "Boats pushed out of the water at the Baytown Marina, Texas, by Hurricane Ike's surge",
                     "13 October 2008"),
    "biloxi": Photo("File:FEMA - 16713 - Photograph by Mark Wolfe taken on 09-03-2005 in Mississippi.jpg", "Mark Wolfe, FEMA",
                    "Damaged houses and boats pushed inland in Biloxi, Mississippi, after Hurricane Katrina", "3 September 2005"),
    "keywest": Photo("File:FEMA - 18545 - Photograph by Jocelyn Augustino taken on 11-04-2005 in Florida.jpg", "Jocelyn Augustino, FEMA",
                     "A sailboat partly sunk at Key West, Florida, after Hurricane Wilma", "4 November 2005"),
    "beach": Photo("File:FEMA - 14240 - Photograph by Jocelyn Augustino taken on 07-16-2005 in Florida.jpg", "Jocelyn Augustino, FEMA",
                   "A boat pushed ashore on Pensacola Beach, Florida, by Hurricane Dennis", "16 July 2005",
                   origin="FEMA photo, Pensacola Beach, Florida, 16 July 2005"),
    "empire": Photo("File:FEMA - 17873 - Photograph by Robert Kaufmann taken on 10-26-2005 in Louisiana.jpg", "Robert Kaufmann, FEMA",
                    "A shrimp boat on its side in a few feet of water at Empire, Louisiana, after Hurricane Katrina", "25 October 2005"),
    "marsh": Photo("File:US Coast Guard - 1387546 - 110828-G-OD102-70 Hurricane Irene response.jpg",
                   "Petty Officer 3rd Class Jessica Potter, U.S. Coast Guard",
                   "A sailboat pushed ashore near Atlantic Beach, North Carolina, by Hurricane Irene", "28 August 2011",
                   origin="U.S. Coast Guard photo, near Atlantic Beach, North Carolina, 28 August 2011"),
    "wetland": Photo("File:Beached boat (37140270696).jpg", "Tom MacKenzie, U.S. Fish and Wildlife Service",
                     "A boat beached in the wetlands outside New Orleans East, Louisiana, after Hurricane Katrina", "7 September 2005"),
    "pier": Photo("File:FEMA - 20544 - Photograph by Marvin Nauman taken on 11-01-2005 in Louisiana.jpg", "Marvin Nauman, FEMA",
                  "The pier at Grand Isle East State Park, Louisiana, destroyed by Hurricane Katrina", "1 November 2005",
                  origin="FEMA photo, Grand Isle, Louisiana, 1 November 2005"),
    "houses": Photo("File:FEMA - 11688 - Photograph by Mark Wolfe taken on 10-15-2004 in Florida.jpg", "Mark Wolfe, FEMA",
                    "A house behind the sand Hurricane Ivan left at Pensacola Beach, Florida, its roof under a tarp",
                    "15 October 2004", origin="FEMA photo, Pensacola Beach, Florida, 15 October 2004"),
    "sgi": Photo("File:St George Island before and after Hurricane Michael NOAA.jpg", "NOAA, with the USGS Coastal Change Hazards team",
                 "St. George Island, Florida, from the air in April 2017 and on 13 October 2018, after Hurricane Michael; "
                 "the arrows NOAA drew are painted out", "April 2017 and 13 October 2018"),
}

UA = {"User-Agent": "azimut-example-case/1.0 (building the app's example case; https://github.com/OsintMeThat)"}


def _get(url: str) -> bytes:
    for attempt in range(6):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as answer:
                return answer.read()
        except urllib.error.HTTPError as exc:
            if exc.code != 429:
                raise
            time.sleep(15 * (attempt + 1))
    raise RuntimeError(f"Commons kept refusing {url}")


def fetch(cache: Path, key: str) -> Image.Image:
    """The photograph at the size Commons serves its thumbnails in, fetched once into ``cache``."""
    path = cache / f"{key}.jpg"
    if not path.is_file():
        photo = PHOTOS[key]
        query = {"action": "query", "titles": photo.title, "prop": "imageinfo", "iiprop": "url",
                 "iiurlwidth": "1920" if photo.wide else "1280", "format": "json"}
        answer = json.loads(_get("https://commons.wikimedia.org/w/api.php?" + urllib.parse.urlencode(query)))
        page = next(iter(answer["query"]["pages"].values()))
        path.write_bytes(_get(page["imageinfo"][0]["thumburl"]))
        time.sleep(2)
    if key == "sgi":
        return _without_arrows(path)
    with Image.open(path) as image:
        return image.convert("RGB")


def _without_arrows(path: Path) -> Image.Image:
    """NOAA's picture with the yellow arrows it drew on both panels painted out of the ground."""
    import cv2
    import numpy as np

    picture = cv2.imread(str(path))
    if picture is None:
        raise SystemExit(f"{path} is not a picture")
    blue, green, red = (picture[..., channel].astype(int) for channel in range(3))
    yellow = ((red + green) / 2 - blue > 45) & (red > 110) & (green > 100)
    where = np.zeros_like(yellow)
    where[515:610, 290:1360] = True
    mask = cv2.dilate((yellow & where).astype(np.uint8) * 255, np.ones((9, 9), np.uint8))
    clean = cv2.inpaint(picture, mask, 9, cv2.INPAINT_TELEA)
    return Image.fromarray(cv2.cvtColor(clean, cv2.COLOR_BGR2RGB))


def jpeg(image: Image.Image, quality: int = 80) -> bytes:
    out = io.BytesIO()
    image.save(out, "JPEG", quality=quality, optimize=True, progressive=True)
    return out.getvalue()


def blurred(image: Image.Image, boxes: tuple[tuple[float, float, float, float], ...]) -> Image.Image:
    """``image`` with each box (fractions of it) blurred past reading: a name or a number on a hull."""
    out = image.copy()
    for left, top, right, bottom in boxes:
        box = (round(left * image.width), round(top * image.height), round(right * image.width), round(bottom * image.height))
        out.paste(image.crop(box).filter(ImageFilter.GaussianBlur(5)), box[:2])
    return out


def crop(image: Image.Image, box: tuple[float, ...], width: int, ratio: float | None = None) -> Image.Image:
    """``box`` in fractions of the picture (left, top, right, bottom), or (left, middle, right) at ``ratio``."""
    w, h = image.size
    if ratio is not None:
        left, middle, right = box
        span = (right - left) * w / ratio / h
        top, bottom = middle - span / 2, middle + span / 2
    else:
        left, top, right, bottom = box
    if top < 0:
        bottom, top = bottom - top, 0
    if bottom > 1:
        top, bottom = top - (bottom - 1), 1
    cut = image.crop((round(left * w), round(top * h), round(right * w), round(bottom * h)))
    return cut.resize((width, round(width * cut.height / cut.width)), Image.Resampling.LANCZOS)


# -- the boats of the register ----------------------------------------------------------------


@dataclass(frozen=True)
class Boat:
    """One boat as the register counts it, the frame its wall shows, and where it lies."""

    number: int
    kind: str
    status: str
    grade: str
    seen: str
    first: str
    photo: str
    box: tuple[float, float, float]
    #: Where on the ground it lies, in the ground's pixels.
    at: tuple[float, float]
    #: Parts of the frame blurred: a maker's name or a registration on the hull.
    blur: tuple[tuple[float, float, float, float], ...] = ()


BOATS: tuple[Boat, ...] = (
    Boat(1, "Motor cruiser", "Ashore", "Confirmed", "Marina survey", "15 Mar 2026", "bayland", (0.50, 0.43, 0.86), (190, 420)),
    Boat(2, "Sailing yacht", "Ashore", "Confirmed", "Marina survey", "15 Mar 2026", "pleasure", (0.0, 0.17, 0.30), (250, 392)),
    Boat(3, "Sailing yacht", "Ashore", "Almost sure", "Marina survey", "15 Mar 2026", "bayland", (0.22, 0.46, 0.45), (300, 372)),
    Boat(4, "Sailing yacht", "Damaged", "Confirmed", "Marina survey", "15 Mar 2026", "pleasure", (0.07, 0.42, 0.33), (342, 418)),
    Boat(5, "Motor cruiser", "Ashore", "Almost sure", "Marina survey", "15 Mar 2026", "pleasure", (0.30, 0.21, 0.62), (408, 380)),
    Boat(6, "Motor cruiser", "Ashore", "Confirmed", "Marina survey", "15 Mar 2026", "pleasure", (0.60, 0.21, 0.84), (470, 424),
         ((0.05, 0.33, 0.25, 0.47),)),
    Boat(7, "Sailing yacht", "Damaged", "Confirmed", "Marina survey", "15 Mar 2026", "pleasure", (0.30, 0.73, 0.95), (522, 372)),
    Boat(8, "Sport fisher", "Ashore", "Confirmed", "Harbour walk", "15 Mar 2026", "baytown", (0.72, 0.56, 1.0), (590, 356),
         ((0.35, 0.0, 0.75, 0.3),)),
    Boat(9, "Motor cruiser", "Ashore", "Strong doubt", "Harbour walk", "15 Mar 2026", "baytown", (0.10, 0.40, 0.43), (622, 300)),
    Boat(10, "Runabout", "Ashore", "Confirmed", "Harbour walk", "15 Mar 2026", "biloxi", (0.47, 0.44, 1.0), (688, 330),
         ((0.36, 0.41, 0.54, 0.55),)),
    Boat(11, "Sailing yacht", "Sunk", "Confirmed", "Harbour walk", "16 Mar 2026", "keywest", (0.28, 0.48, 0.98), (130, 430)),
    Boat(12, "Sailing yacht", "Ashore", "Almost sure", "Harbour walk", "16 Mar 2026", "bayland", (0.76, 0.36, 1.0), (262, 562)),
    Boat(13, "Motor cruiser", "Ashore", "Confirmed", "Beach walk", "15 Mar 2026", "beach", (0.36, 0.56, 1.0), (330, 742)),
    Boat(14, "Shrimp boat", "Capsized", "Confirmed", "Drone flight", "16 Mar 2026", "empire", (0.23, 0.48, 1.0), (70, 470),
         ((0.70, 0.48, 0.97, 0.74),)),
    Boat(15, "Sailing yacht", "Ashore", "Almost sure", "Drone flight", "16 Mar 2026", "marsh", (0.27, 0.45, 0.62), (250, 450)),
    Boat(16, "Runabout", "Ashore", "Strong doubt", "Drone flight", "16 Mar 2026", "wetland", (0.33, 0.55, 0.64), (700, 286)),
)


#: The pictures a note holds whole: a photo, the part of it shown, and the width it is filed at.
SCENES: dict[str, tuple[str, tuple[float, float, float, float], int]] = {
    "quay": ("bayland", (0.25, 0.0, 1.0, 0.86), 1600),
    "marina": ("pleasure", (0.0, 0.05, 1.0, 1.0), 1280),
    "launch": ("beach", (0.0, 0.08, 1.0, 1.0), 1280),
    "pier": ("pier", (0.0, 0.0, 1.0, 1.0), 1280),
    "houses": ("houses", (0.0, 0.05, 1.0, 1.0), 1280),
    "salt-marsh": ("marsh", (0.0, 0.0, 1.0, 1.0), 1280),
}

#: What each picture is called in the case, and so in a note's sources.
SCENE_TITLES = {
    "quay": "The marina quay, 15 March", "marina": "The marina canal, 15 March", "launch": "The launch on the beach, 15 March",
    "pier": "The old pier, 15 March", "houses": "A house at the west end, 15 March",
    "salt-marsh": "A yacht in the salt marsh, 16 March",
}

#: What the aerial pictures truly are, said on the map's credit line and the pair's two labels.
AERIAL_AFTER = ("Imagery used as an illustration: NOAA aerial photograph of St. George Island, Florida, 13 October 2018, "
                "public domain; the places and dates of this example are invented")
AERIAL_SIDE = "NOAA aerial, St. George Island, Florida (illustration)"
#: Each side's real day: NOAA dates the first to April 2017 only, so it reads "about".
AERIAL_DAYS = (("2017-04-15", False), ("2018-10-13", True))

#: The case's named colours, so a value reads the same in every chart, table and map.
PALETTE = (
    ("Claim", "#d55e00"), ("Geolocated", "#009e73"), ("Press", "#0072b2"),
    ("False", "#c0392b"), ("Misleading", "#e69f00"),
    ("Destroyed", "#7f1d1d"), ("Severe", "#b8492f"), ("Moderate", "#f0a14a"),
    ("Ashore", "#3a7dbf"), ("Damaged", "#e3b23c"), ("Sunk", "#1b2a49"), ("Capsized", "#cc79a7"),
)

#: The two panels of NOAA's picture, by their pixels at 1920 across: before, then after, with
#: their dates and NOAA's mark left out.
PANELS = ((22, 22, 948, 975), (972, 22, 1898, 975))

# -- what the story holds --------------------------------------------------------------------

#: Who says what about the storm, every account invented, every address on example.org.
ACCOUNTS = {
    "gazette": ("@saltmere_gazette", "The island's weekly paper"),
    "breaking": ("@saltmere_breaking", "An account that reposts whatever is going round"),
    "harbour": ("@saltmere_harbour", "The harbour office"),
}


def post(account: str, number: int) -> str:
    return f"https://example.org/{ACCOUNTS[account][0][1:]}/posts/{number}"


#: The case's dated statements: the claims made, and what the pictures show.
CLAIMS = (
    ("The harbour office closes the marina ahead of the storm", "2026-03-14T12:00", "occurred", "certain", "harbour", 210),
    ("The storm reaches Saltmere", "2026-03-14T22:00", "occurred", "certain", "gazette", 1187),
    ("“Every house at the west end has been flattened”", "2026-03-15T08:30", "occurred", "refuted", "breaking", 915),
    ("“The island launch sank in the harbour”", "2026-03-15T10:05", "occurred", "refuted", "breaking", 917),
    ("“Fifty boats destroyed at Saltmere”", "2026-03-16T08:00", "occurred", "refuted", "breaking", 921),
    ("The marina reopens to the island launch", "2026-03-18T09:00", "occurred", "probable", "harbour", 214),
)


def ground_places(size: tuple[int, int]) -> dict[str, tuple[float, float]]:
    """The story's places, read off the ground where they are."""
    at = {
        "marina": (90, 690), "road": (400, 560), "beach": (450, 690), "pier": (600, 600), "launch": (330, 742),
        "houses": (60, 770), "houses-camera": (200, 820), "pier-camera": (570, 640), "launch-camera": (380, 790),
    }
    return {name: ground_point(x, y, size) for name, (x, y) in at.items()}


# -- filling the case --------------------------------------------------------------------------


def _ok(answer: Any) -> Any:
    if answer.status_code >= 400:
        raise RuntimeError(f"{answer.request.method} {answer.request.url}: {answer.status_code} {answer.text[:400]}")
    return answer.json()


def build(client: Any, cache: Path) -> str:
    """Fill the example case through the app's routes; returns its id."""
    from azimut.engine import examplecase
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    case_id = _ok(client.post("/api/cases", json={"name": examplecase.NAME}))["id"]
    at = lambda path: f"/api/cases/{case_id}{path}"  # noqa: E731
    ids: dict[str, str] = {}

    def entity(type_: str, label: str, attrs: dict[str, Any] | None = None) -> str:
        return _ok(client.post(at("/entities"), json={"type": type_, "label": label, "attrs": attrs or {}}))["id"]

    def link(source: str, target: str, verb: str) -> None:
        _ok(client.post(at("/links"), json={"from_id": source, "to_id": target, "type": verb}))

    def upload(name: str, data: bytes, photo: Photo, title: str) -> str:
        filed = _ok(client.post(at("/media/upload"), files={"file": (name, data, "image/jpeg")},
                                data={"source_url": photo.page}))
        path = filed["item"]["path"]
        credit = (f"Used as an illustration of an invented story. Photo: {photo.author}, {photo.taken}. Public domain. "
                  f"What it really shows: {photo.shows}.")
        return _ok(client.patch(at("/media"), json={"path": path, "notes": credit, "title": title})).get("path", path)

    def lookup(path: str) -> str:
        return _ok(client.get(at("/entities/lookup"), params={"attr": "path", "value": path}))["entity"]["id"]

    # -- the photographs, as the case's files -------------------------------------------------
    paths: dict[str, str] = {}
    for boat in BOATS:
        frame = blurred(crop(fetch(cache, boat.photo), boat.box, 480, ratio=1.5), boat.blur)
        name = f"boat-{boat.number:02d}.jpg"
        paths[name] = upload(name, jpeg(frame, 78), PHOTOS[boat.photo],
                             f"Boat {boat.number:02d}, {boat.kind.lower()}, {boat.status.lower()}")
        ids[f"boat-{boat.number:02d}"] = lookup(paths[name])
    for scene, (key, box, width) in SCENES.items():
        picture = crop(fetch(cache, key), box, width)
        paths[scene] = upload(f"{scene}.jpg", jpeg(picture, 80), PHOTOS[key], SCENE_TITLES[scene])
        ids[scene] = lookup(paths[scene])

    # -- the ground under the maps, and the beach road before and after ----------------------------
    noaa = fetch(cache, "sgi")
    before, after = (noaa.crop(box) for box in PANELS)
    size = after.size
    places = ground_places(size)
    case = Case.open(case_id)
    media_dir = case.subdir("media")
    noaa_photo = PHOTOS["sgi"]
    lat, lon = ground_point(size[0] / 2, size[1] / 2, size)
    ground_file = media_dir / "Saltmere from the air, 16 March.jpg"
    ground_file.write_bytes(jpeg(after, 82))
    filed = media_engine._register(
        case, ground_file,
        {"type": "satellite", "provider": "example-aerial", "provider_label": "NOAA aerial photograph (illustration)",
         "attribution": AERIAL_AFTER, "method": "example", "lat": lat, "lon": lon,
         "zoom": GROUND_ZOOM, "bearing": 0, "width": size[0], "height": size[1], "url": noaa_photo.page},
        by="satellite", entity_type="capture", title="Saltmere from the air, 16 March",
        extra_attrs={"lat": lat, "lon": lon, "zoom": GROUND_ZOOM, "provider": "example-aerial", "coords": coords((lat, lon))},
        dedupe=False,
    )
    ids["ground"] = filed["entity"]["id"]
    _ok(client.patch(at("/media"), json={"path": filed["item"]["path"], "notes": (
        f"{AERIAL_AFTER}. Photo: {noaa_photo.author}. What it shows: {noaa_photo.shows}; this is its after panel, "
        "laid at an invented place.")}))

    # Kept as Compare keeps a still with its two sides, minus the session: no tile provider
    # stands behind these pictures for Compare to open again.
    sides: dict[str, str] = {}
    # each side labelled with what it truly is and its real day, never a day of the story
    for side, half, (day, exact) in (("a", before, AERIAL_DAYS[0]), ("b", after, AERIAL_DAYS[1])):
        kept = media_engine.import_rendered_bytes(
            case, jpeg(half, 76 if side == "a" else 77), f"Beach Road, before and after the storm - {side.upper()}", ".jpg",
            {"type": "compare", "side": side, "providers": {side: AERIAL_SIDE}, f"imagery_{side}": day,
             **({} if exact else {f"imagery_{side}_exact": False}),
             "lat": lat, "lon": lon, "zoom": GROUND_ZOOM - 1, "attribution_burned": True, "url": noaa_photo.page},
            by="compare",
        )
        sides[side] = kept["item"]["path"]
    pair = Image.new("RGB", (before.width * 2 + 8, before.height), (255, 255, 255))
    pair.paste(before, (0, 0))
    pair.paste(after, (before.width + 8, 0))
    pair.thumbnail((1200, 1200))
    kept = media_engine.import_rendered_bytes(
        case, jpeg(pair, 76), "Beach Road, before and after the storm", ".jpg",
        {"type": "compare", "kept": True, "mode": "swipe", "animation": None,
         "providers": {"a": AERIAL_SIDE, "b": AERIAL_SIDE}, "lat": lat, "lon": lon,
         "zoom": GROUND_ZOOM - 1, "bearing": 0, "sides": sides, "attribution_burned": True, "url": noaa_photo.page,
         "imagery_a": AERIAL_DAYS[0][0], "imagery_a_exact": False, "imagery_b": AERIAL_DAYS[1][0]},
        by="compare", extra_attrs={"lat": lat, "lon": lon},
    )
    from azimut.engine import links as link_engine

    link_engine.link_all(case, kept["entity"]["id"], link_engine.DERIVED_FROM, [sides["a"], sides["b"]], by="compare")
    ids["pair"] = kept["entity"]["id"]
    for path in (kept["item"]["path"], sides["a"], sides["b"]):
        _ok(client.patch(at("/media"), json={"path": path, "notes": (
            f"Used as an illustration. Photo: {noaa_photo.author}, {noaa_photo.taken}. Public domain. What it shows: "
            f"{noaa_photo.shows}; its two panels stand here for Beach Road before and after the invented storm.")}))

    # -- who says what -------------------------------------------------------------------------
    accounts = {key: entity("account", handle, {"url": f"https://example.org/{handle[1:]}", "notes": about})
                for key, (handle, about) in ACCOUNTS.items()}
    ids.update({f"account-{key}": value for key, value in accounts.items()})
    for label, when, role, confidence, who, number in CLAIMS:
        day = f"{int(when[8:10])} Mar"  # every post is of March 2026
        page = entity("bookmark", f"{ACCOUNTS[who][0]}, {day}", {"url": post(who, number)})
        claim = entity("claim", label, {"when": f"{when}:00Z", "when_zone": ZONE, "time_role": role, "confidence": confidence})
        link(accounts[who], page, "posted")
        link(claim, page, "cites")
        ids[f"post-{number}"] = page

    # -- the places, and the proofs that put the pictures there ---------------------------------
    for name, label in (("marina", "Saltmere marina"), ("beach", "Saltmere beach"), ("pier", "The old pier"),
                        ("houses", "The houses at the west end")):
        place = _ok(client.post(at("/satellite/place"), json={"lat": places[name][0], "lon": places[name][1], "zoom": 17,
                                                              "title": label}))
        ids[f"place-{name}"] = place["id"]
    proofs = (
        ("The launch is ashore, not sunk", "launch", "launch-camera", "launch", "2026-03-15T11:20",
         "The island launch lies upright on the beach west of the old pier, above the tide line."),
        ("The old pier lost its end", "pier", "pier-camera", "pier", "2026-03-15T09:00",
         "The old pier's walkway stands; the deck beyond the surf line and the light at its end are gone."),
        ("The houses at the west end stand", "houses", "houses-camera", "houses", "2026-03-15T10:40",
         "The houses at the west end stand behind the sand the sea left, roofs torn and patched, walls whole."),
    )
    for title, scene, camera, place, when, sentence in proofs:
        still = crop(fetch(cache, SCENES[scene][0]), SCENES[scene][1], 860 if PHOTOS[SCENES[scene][0]].wide else 520)
        png = _proof_png(still, title, PHOTOS[SCENES[scene][0]].origin)
        spec = {
            "panels": [{"id": "p0", "src": paths[scene], "natural": list(still.size)}],
            "coordsText": coords(places[place]),
            "points": [{"coords": coords(places[place])}, {"coords": coords(places[camera]), "pov": True}],
            "when": f"{when}:00", "whenZone": ZONE, "description": sentence,
        }
        made = _ok(client.post(at("/proofs"), json={"title": title, "spec": spec,
                                                     "png_base64": base64.b64encode(png).decode()}))
        ids[f"proof-{scene}"] = _ok(client.get(at("/entities/lookup"), params={"attr": "spec", "value": made["spec_path"]}))["entity"]["id"]

    # -- the register, as a sheet of the case, and on a map -------------------------------------
    sheet = _ok(client.post(at("/sheets"), json={"title": "Boat register"}))
    ids["sheet"] = sheet["id"]
    rows = []
    for boat in BOATS:
        point = ground_point(*boat.at, size)
        rows.append([f"r{boat.number}", f"#{boat.number}", boat.kind, boat.status, boat.grade, boat.seen, boat.first,
                     coords(point)])
    _ok(client.put(at(f"/sheets/{sheet['id']}"), json={
        "columns": ["id", "#", "Type", "Status", "Grade", "Seen in", "First seen", "Coordinates"],
        "rows": rows,
        "meta": {"frozen": "#", "widths": {"Type": 140, "Coordinates": 190},
                 "roles": {"Coordinates": {"kind": "latlon"},
                           "Grade": {"kind": "state", "values": ["Confirmed", "Almost sure", "Strong doubt"]}},
                 "description": "Every boat the storm left ashore, sunk or damaged, counted once across the pictures."},
    }))
    boats_layer = _ok(client.post(at(f"/sheets/{sheet['id']}/map"), json={
        "title": "Boats lost", "choice": {"place": "Coordinates", "name": "#", "colour": "Grade", "start": "First seen",
                                          "card": ["Type", "Status", "Grade"]}}))
    ids["layer-boats"] = boats_layer.get("title") or "Boats lost"

    # -- what the storm did, drawn by hand on a layer of its own --------------------------------
    layer = _ok(client.post(at("/map-layers/editable"), json={"title": "Storm damage", "description":
                                                               "What the storm did, drawn day by day."}))
    name = layer["name"]
    _ok(client.patch(at(f"/map-layers/{name}/edit"), json={"track": {"on": True, "precision": "day", "zone": ZONE}}))
    flood = [ground_point(x, y, size) for x, y in ((180, 500), (480, 470), (560, 560), (420, 650), (250, 700), (150, 640))]
    _ok(client.post(at(f"/map-layers/{name}/shapes"), json={
        "geometry": {"type": "Polygon", "coordinates": [[[lo, la] for la, lo in flood + flood[:1]]]},
        "name": "Where the sea crossed the road", "colour": "#0072b2", "at": "2026-03-15",
        "description": "The sea came over the dunes here and left its sand across the road."}))
    surge = [ground_point(x, y, size) for x, y in ((0, 700), (926, 320), (926, 460), (0, 900))]
    _ok(client.post(at(f"/map-layers/{name}/shapes"), json={
        "geometry": {"type": "Polygon", "coordinates": [[[lo, la] for la, lo in surge + surge[:1]]]},
        "name": "Hit by the surge", "colour": "#d55e00", "at": "2026-03-15", "line_dash": "dashed", "fill_opacity": 0.12,
        "description": "The beach and the houses between it and the road, under sand or without a roof."}))
    road = [ground_point(x, y, size) for x, y in ((0, 725), (180, 650), (400, 560), (650, 450), (926, 330))]
    _ok(client.post(at(f"/map-layers/{name}/shapes"), json={
        "geometry": {"type": "LineString", "coordinates": [[lo, la] for la, lo in road]},
        "name": "Beach Road under sand", "colour": "#e69f00", "at": "2026-03-15",
        "description": "The surge left sand across the road its whole length."}))
    for label, place, day, shown, colour, symbol, words in (
        ("The old pier, its end gone", "pier", "2026-03-15", "pier", "#d55e00", "badge-alert",
         "The walkway stands; the deck beyond the surf line is gone."),
        ("The launch, ashore", "launch", "2026-03-15", "launch", "#cc79a7", "badge-ship",
         "Upright on the beach above the tide line."),
        ("The houses at the west end, standing", "houses", "2026-03-15", "houses", "#009e73", "badge-house",
         "Roofs torn and patched, walls whole, behind the sand the sea left."),
    ):
        _ok(client.post(at(f"/map-layers/{name}/markers"), json={
            "lat": places[place][0], "lon": places[place][1], "name": label, "colour": colour, "symbol": symbol,
            "description": words, "at": day, "picture": ids[shown]}))
    ids["layer-damage"] = layer.get("title") or "Storm damage"

    # -- one colour a meaning, in every note: the case's own palette -----------------------------
    _ok(client.put(at("/layer-palette"), json={"colours": [{"name": name, "colour": colour} for name, colour in PALETTE]}))

    # -- the notes ---------------------------------------------------------------------------------
    ids.update({f"at-{key}": coords(value) for key, value in places.items()})
    ids.update(_tables(ids))
    ids["infographic"] = _infographic(client, ids["sheet"], rows)
    for index, path in enumerate(sorted(NOTES.glob("*.md"))):
        title, look, body = _note_source(path)
        body = _fill(body, ids)
        made = _ok(client.post(at("/notes"), json={"title": title, "content": body}))
        _ok(client.put(at(f"/notes/{made['id']}/look"), json=look))
        ids[f"note-{path.stem}"] = made["id"]
    _ok(client.put(at("/notes"), json={"text": _fill((NOTES / "case-notes.txt").read_text(encoding="utf-8"), ids)}))
    return case_id


def credits() -> str:
    """The credits file beside the bundle: every photograph, what it truly shows, whose it is."""
    used = sorted({boat.photo for boat in BOATS} | {key for key, _, _ in SCENES.values()} | {"sgi"})
    rows = [f"| {PHOTOS[key].shows} | {PHOTOS[key].taken} | {PHOTOS[key].author} | Public domain | [Commons]({PHOTOS[key].page}) |"
            for key in used]
    return "\n".join([
        "# Credits for the example case's pictures",
        "",
        "The example case (`example-case.azimut.zip`, built by `scripts/example_case.py`) is fictional: the",
        "island of Saltmere, its storm of March 2026 and every account in it are invented. Its pictures are",
        "real photographs of other places and storms, each a work of the United States government in the",
        "public domain, taken from Wikimedia Commons and cut and resized for their place in the case.",
        "",
        "Each one says what it is where it shows, as the illustration it is: a note's caption, a proof's",
        "band, a picture wall's source line, the map ground's credit line and the before and after's two",
        "labels name where and when it was really taken, and say the scene and dates of the example are",
        "invented. Its Details say it again: its Commons page is its source, and its notes say who made it,",
        "when, and what it truly shows. No landmark is shown; a maker's name or a registration on a hull is",
        "blurred, and the arrows NOAA drew on its before and after are painted out.",
        "",
        "| What it shows | Taken | By | Licence | Source |",
        "|---|---|---|---|---|",
        *rows,
        "",
        "A replacement keeps to the same rule: public domain or CC0, no face anyone could recognise, no",
        "name or number that points at a real person, and a line here.",
        "",
    ])


def _proof_png(still: Image.Image, title: str, origin: str) -> bytes:
    """A proof's picture: the frame, then a band with what it shows and where the photograph is really from."""
    band = 64
    sheet = Image.new("RGB", (still.width, still.height + band), (17, 24, 32))
    sheet.paste(still, (0, 0))
    draw = ImageDraw.Draw(sheet)
    bold = ImageFont.truetype(str(FONTS / "IBMPlexSans-Bold.ttf"), 20)
    plain = ImageFont.truetype(str(FONTS / "IBMPlexSans-Regular.ttf"), 15)
    draw.text((16, still.height + 20), title, font=bold, fill=(240, 242, 244), anchor="lm")
    draw.text((16, still.height + 46), f"Illustration: {origin}. Invented scene.", font=plain, fill=(160, 170, 180), anchor="lm")
    out = io.BytesIO()
    sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out, "PNG", optimize=True)
    return out.getvalue()


_HEAD = re.compile(r"\A---\n(.*?)\n---\n", re.S)


def _note_source(path: Path) -> tuple[str, dict[str, Any], str]:
    """A note's source: its title and look in a head of `key: value` lines, then its text."""
    text = path.read_text(encoding="utf-8")
    head = _HEAD.match(text)
    if head is None:
        raise SystemExit(f"{path.name}: no head")
    fields = dict(line.split(": ", 1) for line in head.group(1).splitlines())
    return fields["title"], json.loads(fields["look"]), text[head.end():]


def _fill(text: str, ids: dict[str, str]) -> str:
    def one(match: re.Match[str]) -> str:
        key = match.group(1)
        if key not in ids:
            raise SystemExit(f"no {{{{{key}}}}} in the case")
        return ids[key]

    return re.sub(r"\{\{([a-z0-9:-]+)\}\}", one, text)


def _table(head: list[str], rows: list[list[str]]) -> str:
    return "\n".join(["| " + " | ".join(head) + " |", "| " + " | ".join("---" for _ in head) + " |",
                      *("| " + " | ".join(row) + " |" for row in rows)])


def _tables(ids: dict[str, str]) -> dict[str, str]:
    """The tables the notes hold, one row a boat, written from the register."""
    def chip(boat: Boat) -> str:
        return f"[[media:{ids[f'boat-{boat.number:02d}']}|#{boat.number}]]"

    return {
        "table:wall": _table(["Picture", "#", "Status", "Type", "Grade"],
                             [[chip(b), f"#{b.number}", b.status, b.kind, b.grade] for b in BOATS]),
        "table:wall-by-status": _table(["Picture", "#", "Type", "Status", "Grade"],
                                       [[chip(b), f"#{b.number}", b.kind, b.status, b.grade] for b in BOATS]),
        "table:register": _table(["#", "Type", "Status", "Grade", "Seen in", "First seen"],
                                 [[f"#{b.number}", b.kind, b.status, b.grade, b.seen, b.first] for b in BOATS]),
        "table:by-type": _table(["Type", "Grade"], [[b.kind, b.grade] for b in BOATS]),
    }


#: The register's page at a glance, as the showcase template sets it (`ready.js`, *Equipment
#: losses register*), applied to the sheet by the app's own route, as its builder does.
_GLANCE = "\n".join([
    ":::: infographic", "title: Boats lost at Saltmere, at a glance", "look: report", "widths: wide, half, half, wide", "",
    "::: chart", "kind: key figures", "| Figure | What it says |", "| --- | --- |", ":::", "",
    "::: chart", "kind: pictograms", "count: rows", "by: Grade", "order: Confirmed, Almost sure, Strong doubt",
    "| Grade |", "| --- |", ":::", "",
    "::: chart", "kind: donut", "count: rows", "by: Status", "| Status |", "| --- |", ":::", "",
    "::: chart", "kind: bars", "count: rows", "by: Type", "| Type |", "| --- |", ":::",
    "::::",
])
_FIGURES = _table(["Figure", "What it says"], [
    ["at least 16", "boats lost or damaged in the marina and on the beach"],
    ["11", "carried ashore off their moorings"],
    ["at least 2", "sunk where they lay"],
])


def _infographic(client: Any, sheet: str, rows: list[list[str]]) -> str:
    table = _table(["#", "Type", "Status", "Grade", "Seen in", "First seen", "Coordinates"], [row[1:] for row in rows])
    applied = _ok(client.post("/api/templates/figure/apply", json={
        "template": {"figure": "infographic", "text": _GLANCE}, "table": table, "origin": f"sheet:{sheet}", "mapping": {}}))
    text = applied["text"]
    empty = "kind: key figures\nrows: own\n| Figure | What it says |\n| --- | --- |"
    if empty not in text:
        raise SystemExit("the infographic's key figures are not where they were:\n" + text)
    text = text.replace(empty, "kind: key figures\nrows: own\n" + _FIGURES)
    # every panel says where its rows come from
    text = re.sub(r"^(kind: [a-z ]+)$", r"\1\nsource: the boat register, a sheet of this case", text, flags=re.M)
    # the titles the rows propose name no thing ("16 rows"): the analyst's own say what they count
    for proposed, own in (("16 rows, by grade", "At least 16 boats, by how sure the type is"),
                          ("16 rows, by status", "At least 16 boats, by what became of them"),
                          ("16 rows, by type", "At least 16 boats, by type")):
        text = text.replace(f"title: {proposed}", f"title: {own}")
    return text


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--photos", type=Path, help="where to keep the photographs fetched from Commons")
    parser.add_argument("--keep", type=Path, help="also keep the built workspace here, to look at")
    args = parser.parse_args()
    cache = args.photos or Path(tempfile.mkdtemp(prefix="azimut-example-photos-"))
    cache.mkdir(parents=True, exist_ok=True)
    home = Path(tempfile.mkdtemp(prefix="azimut-example-home-"))
    os.environ["AZIMUT_HOME"] = str(home)
    sys.path.insert(0, str(ROOT / "src"))
    from fastapi.testclient import TestClient

    from azimut.engine import bundles, examplecase, geo, workqueue
    from azimut.server import create_app
    from azimut.workspace import Case

    # a place saved asks Nominatim for its country; the island has none, and the build stays offline
    geo.reverse_geocode = lambda lat, lon, timeout=8, language=None: None  # type: ignore[assignment]

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        case_id = build(client, cache)
        workqueue.drain(Case.open(case_id))
        written = bundles.export_case(Case.open(case_id))
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(written, examplecase.BUNDLE)
    (OUT / "CREDITS.md").write_text(credits(), encoding="utf-8")
    print(f"{examplecase.BUNDLE.relative_to(ROOT)}: {examplecase.BUNDLE.stat().st_size / 1e6:.2f} MB")
    if args.keep:
        shutil.copytree(home, args.keep, dirs_exist_ok=True)
        print(f"workspace kept in {args.keep}")
    shutil.rmtree(home, ignore_errors=True)


if __name__ == "__main__":
    main()
