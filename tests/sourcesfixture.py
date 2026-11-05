"""A case holding one item from each producer that records where its pictures come
from, filed the way that producer files it, for the notes' sources tests.

Pictures go through `media.import_image` / `import_rendered_bytes`, which write the
sidecar, the index row and the `derived-from` edges as the tools do. The video is
registered by hand so no worker runs ffmpeg over bytes that are not a video.
"""

from __future__ import annotations

import hashlib
import io
from typing import Any

from PIL import Image

from azimut.engine import links as link_engine
from azimut.engine import media as media_engine

POST_URL = "https://x.com/portwatch/status/1899200000000000001"
PHOTO_URL = "https://t.me/portnews/512"
MAPS_URL = "https://www.google.com/maps/@14.7980,42.9540,800m/data=!3m1!1e3"
NOTICE_URL = ("https://port-authority.example.org/notices/2026/03/13/"
              "temporary-closure-of-berths-10-to-14-after-the-strike-on-the-oil-terminal")
ARCHIVE_URL = f"https://web.archive.org/web/20260313091500/{NOTICE_URL}"
ACCOUNT_URL = "https://x.com/portwatch"
#: What Horizon writes under `attribution`: the terrain's, the imagery's and the peaks' credits.
HORIZON_CREDITS = "Copernicus DEM GLO-30 © DLR · © OpenStreetMap contributors · 30 m relief"


def _picture(colour: tuple[int, int, int], size: tuple[int, int] = (640, 360)) -> Image.Image:
    return Image.new("RGB", size, colour)


def _png(colour: tuple[int, int, int]) -> bytes:
    buffer = io.BytesIO()
    _picture(colour).save(buffer, "PNG")
    return buffer.getvalue()


def _image(case: Any, title: str, source: dict[str, Any], colour: tuple[int, int, int], **options: Any) -> dict[str, Any]:
    filed = media_engine.import_image(case, _picture(colour), f"{title}.png", source, title=title,
                                      dedupe=False, **options)
    return {"id": filed["entity"]["id"], "path": filed["item"]["path"]}


def _rendered(case: Any, title: str, source: dict[str, Any], by: str) -> dict[str, Any]:
    filed = media_engine.import_rendered_bytes(case, _png((70, 90, 110)), title, ".png", source, by=by)
    return {"id": filed["entity"]["id"], "path": filed["item"]["path"]}


def _video(case: Any) -> dict[str, Any]:
    """A downloaded video, as its sidecar and index row say, with no file worth decoding."""
    path = "media/Strike on the port.mp4"
    data = b"not a real video, only its record"
    case.resolve_inside(path).parent.mkdir(parents=True, exist_ok=True)
    case.resolve_inside(path).write_bytes(data)
    sha = hashlib.sha256(data).hexdigest()
    source = {"type": "download", "url": POST_URL, "webpage_url": POST_URL, "downloader": "yt-dlp",
              "uploader": "Port Watch", "upload_date": "20260312"}
    entity = case.add_entity("media", "Strike on the port",
                             attrs={"path": path, "sha256": sha, "kind": "video", "source_url": POST_URL},
                             by="download", source=POST_URL)
    case.upsert_media_item({"path": path, "filename": "Strike on the port.mp4", "title": "Strike on the port",
                            "kind": "video", "sha256": sha, "size": len(data),
                            "added_at": "2026-03-13T08:00:00Z", "source": source}, entity_id=entity["id"])
    return {"id": entity["id"], "path": path, "sha256": sha}


def sourced_case(case: Any) -> dict[str, dict[str, Any]]:
    """File one item of each kind in ``case``; returns them by name, each with its
    entity id and path."""
    made: dict[str, dict[str, Any]] = {}
    made["video"] = _video(case)
    made["frame"] = _image(case, "Strike frame at 1:23", {
        "type": "inspect", "from": made["video"]["path"], "from_sha256": made["video"]["sha256"],
        "op": "frame", "time": 83.5,
    }, (120, 60, 40))
    made["photo"] = _image(case, "Crane on the quay", {
        "type": "download", "url": PHOTO_URL, "webpage_url": PHOTO_URL, "uploader": "Port News",
        "upload_date": "20260310",
    }, (40, 90, 140))
    made["collage"] = _image(case, "Quay collage", {
        "type": "inspect", "from": "", "op": "collage",
        "sources": [made["frame"]["path"], made["photo"]["path"]], "perspective": True,
    }, (90, 90, 90))
    made["paste"] = _image(case, "Pasted screenshot", {"type": "clipboard"}, (200, 200, 200))
    made["capture"] = _image(case, "Port from above", {
        "type": "satellite", "provider": "esri-world-imagery", "provider_label": "Esri World Imagery",
        "attribution": "Esri, Maxar", "imagery_date": "2024-03-02", "imagery_exact": False,
        "fetched_at": "2026-03-14T10:00:00Z",
    }, (60, 110, 60), entity_type="capture")
    made["screenshot"] = _image(case, "Berths on Google Maps", {
        "type": "screenshot", "method": "screenshot", "source_url": MAPS_URL, "site": "google-maps",
        "provider": "google-maps", "provider_label": "Google Maps", "imagery_date": "2025-11-01",
        "attribution": "Imagery ©2025 Airbus", "fetched_at": "2026-03-14T11:00:00Z",
    }, (80, 120, 80), entity_type="capture", extra_attrs={"source_url": MAPS_URL, "site": "google-maps"})
    made["compare"] = _rendered(case, "Port before and after", {
        "type": "compare", "session": "compare/port.json", "mode": "swipe",
        "providers": {"a": "esri-wayback~31144", "b": "esri-world-imagery"},
        "imagery_a": "2023-05-01", "imagery_b": "2025-06-02", "imagery_b_exact": False,
        "rendered_at": "2026-03-15T12:00:00Z", "attribution_burned": True,
    }, "compare")
    made["detect"] = _rendered(case, "Burn scar on the quay", {
        "type": "compare", "analysis_run": "run1", "candidate_id": "c1",
        "input": {"a": {"provider": "sentinel2", "date": "2025-03-02"},
                  "b": {"provider": "sentinel2", "date": "2025-04-11"}},
        "candidate": {}, "imagery_a": "2025-03-02", "imagery_b": "2025-04-11",
    }, "compare")
    made["horizon"] = _rendered(case, "Ridge seen from the quay", {
        "type": "horizon", "kind": "capture", "area": False, "lat": 14.79801, "lon": 42.95402,
        "heading": 245.4, "fov": 60, "rendered_at": "2026-03-16T09:00:00Z", "attribution_burned": True,
        "attribution": HORIZON_CREDITS,
    }, "horizon")
    proof_path = "proofs/Strike geolocated.png"
    case.resolve_inside(proof_path).parent.mkdir(parents=True, exist_ok=True)
    _picture((30, 30, 30)).save(case.resolve_inside(proof_path), "PNG")
    proof = case.add_entity("proof", "Strike geolocated", attrs={"path": proof_path, "kind": "image"}, by="proof-composer")
    link_engine.link_all(case, proof["id"], link_engine.DERIVED_FROM,
                         [made["frame"]["path"], made["capture"]["path"]], by="proof-composer")
    made["proof"] = {"id": proof["id"], "path": proof_path}
    made["notice"] = {"id": case.add_entity("bookmark", "Port authority notice", attrs={
        "url": NOTICE_URL, "archive_url": ARCHIVE_URL, "fetched_at": "2026-03-13T07:00:00Z"}, by="extension")["id"]}
    made["account"] = {"id": case.add_entity("account", "@portwatch", attrs={
        "url": ACCOUNT_URL, "platform": "X"}, by="user")["id"]}
    made["place"] = {"id": case.add_entity("place", "Berth 12", attrs={"lat": 14.798, "lon": 42.954}, by="user")["id"]}
    return made


def sourced_note(made: dict[str, dict[str, Any]], case_id: str) -> str:
    """A report citing every item above, in the ways a note can."""
    from urllib.parse import quote

    m = {name: item["id"] for name, item in made.items()}
    return f"""# Strike on the oil terminal

## Summary

[[entity:{m['account']}|@portwatch]] posted [[entity:{m['video']}|the video]] on 12 March, and
[[entity:{m['notice']}|the port authority]] closed berths 10 to 14 the next day. The strike hit
[[entity:{m['place']}|Berth 12]], at 14.7980, 42.9540.

[[media:{m['frame']}|Frame at 1:23]]{{width=70% align=center}}

## Imagery

[[media:{m['capture']}|Port from above]]{{width=60%}}

[[media:{m['screenshot']}|Berths on Google Maps]]{{width=60%}}

[[media:{m['compare']}|Before and after]]{{width=60% caption="The quay before and after"}}

[[media:{m['detect']}|Burn scar]]{{width=50%}}

[[media:{m['horizon']}|Ridge]]{{width=50%}}

## Made in the case

[[media:{m['collage']}|Collage]]{{width=60%}}

[[media:{m['proof']}|Proof]]{{width=60%}}

![pasted](/files/{quote(case_id)}/{quote(made['paste']['path'])})

## Reading

The notice is at [the port's own page]({NOTICE_URL}), and the photo was posted at {PHOTO_URL}.
Also seen in [the same post]({POST_URL}).

- [ ] Check the date on the notice
- [ ] Ask the port for the berth list
- [x] Geolocate the frame
"""
