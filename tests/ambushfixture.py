"""A case built like a real investigation, for the HTML report's tests and its sample.

An ambush on a desert road, told as an open-source register of armoured vehicles: the
post that showed it, a clip cut from it, a frame, a capture of the junction, a
comparison kept with its two sides, a proof with a point of view, a phone photo whose
EXIF still says where it was taken, a page and its archived copy, three dated plate
pictures for a stepper and two wide pictures for a story. Every picture is drawn here
with Pillow; nothing is anyone's real case. The clip is a real MP4 when ffmpeg is on
the machine, made with metadata the report must not carry.
"""

from __future__ import annotations

import io
import json
import random
import shutil
import subprocess
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter
from PIL.PngImagePlugin import PngInfo

from azimut import layout
from azimut.engine import links as link_engine
from azimut.engine import media as media_engine
from azimut.engine import thumbnails

POST_URL = "https://x.com/sahm_watch/status/1981234567890123456"
PHOTO_URL = "https://t.me/sahm_local/2207"
ARTICLE_URL = "https://news.example.org/2025/10/25/column-hit-near-wadi-sahm-junction"
ARCHIVE_URL = f"https://web.archive.org/web/20251025120000/{ARTICLE_URL}"
STREET_URL = ("https://www.google.com/maps/@15.4129,44.2377,3a,75y,90h,90t/data=!3m6!1e1!3m4"
              "!1sAF1QipExample!2e0!7i13312!8i6656")
ACCOUNT_URL = "https://x.com/sahm_watch"
JUNCTION = (15.412700, 44.238100)
FILMER = (15.413060, 44.236870)
#: What the clip's container says about itself, which the report must leave behind.
CLIP_SECRET = "Filmed at 15.41306,44.23687 by Sahm Watch"
#: What the phone photo's EXIF says, and the PNG frame's text chunk.
GPS_SECRET = (15.0, 24.0, 47.0)
PNG_SECRET = "/home/analyst/cases/ambush/notes.txt"

WIDE = (1280, 720)


# -- pictures, drawn ------------------------------------------------------------------


def _terrain(size: tuple[int, int], seed: int, *, scars: int = 0) -> Image.Image:
    """Desert seen from above: sand, a wadi, the road and its junction, a few compounds."""
    rng = random.Random(seed)
    width, height = size
    image = Image.new("RGB", size, (196, 170, 128))
    draw = ImageDraw.Draw(image)
    for _ in range(900):
        x, y = rng.randrange(width), rng.randrange(height)
        shade = rng.randrange(-22, 18)
        draw.ellipse((x, y, x + rng.randrange(8, 40), y + rng.randrange(6, 30)),
                     fill=(196 + shade, 170 + shade, 128 + shade // 2))
    draw.line([(0, height * 0.78), (width * 0.35, height * 0.6), (width * 0.6, height * 0.66), (width, height * 0.42)],
              fill=(150, 140, 112), width=46)
    draw.line([(0, height * 0.55), (width, height * 0.5)], fill=(84, 82, 80), width=18)
    draw.line([(width * 0.52, 0), (width * 0.5, height)], fill=(92, 90, 86), width=14)
    for _ in range(14):
        x, y = rng.randrange(40, width - 120), rng.randrange(30, int(height * 0.4))
        draw.rectangle((x, y, x + rng.randrange(40, 90), y + rng.randrange(30, 70)), fill=(214, 204, 186),
                       outline=(120, 112, 98), width=3)
    for index in range(scars):
        x = width * (0.3 + 0.05 * index)
        y = height * 0.53 - 6 + 4 * (index % 3)
        draw.ellipse((x - 26, y - 22, x + 26, y + 22), fill=(48, 40, 36))
        draw.rectangle((x - 8, y - 5, x + 8, y + 5), fill=(20, 20, 20))
    return image.filter(ImageFilter.GaussianBlur(0.6))


def _ground(seed: int, *, smoke: bool = True, size: tuple[int, int] = WIDE) -> Image.Image:
    """A frame from the road: sky, the horizon, the column and, once hit, smoke."""
    rng = random.Random(seed)
    width, height = size
    image = Image.new("RGB", size)
    draw = ImageDraw.Draw(image)
    for y in range(height):
        if y < height * 0.55:
            tone = int(170 + 60 * y / (height * 0.55))
            draw.line([(0, y), (width, y)], fill=(tone - 40, tone - 10, tone + 20 if tone < 235 else 255))
        else:
            tone = int(178 - 40 * (y - height * 0.55) / (height * 0.45))
            draw.line([(0, y), (width, y)], fill=(tone + 20, tone, tone - 40))
    draw.polygon([(0, height * 0.56), (width * 0.3, height * 0.47), (width * 0.55, height * 0.53),
                  (width, height * 0.45), (width, height * 0.58), (0, height * 0.6)], fill=(150, 128, 98))
    draw.polygon([(width * 0.42, height), (width * 0.5, height * 0.58), (width * 0.53, height * 0.58),
                  (width * 0.75, height)], fill=(88, 86, 82))
    for index in range(6):
        x = width * (0.47 + 0.018 * index)
        y = height * (0.62 + 0.05 * index)
        scale = 1 + index * 0.45
        draw.rectangle((x - 22 * scale, y - 9 * scale, x + 22 * scale, y + 6 * scale), fill=(62, 66, 54))
        draw.rectangle((x - 8 * scale, y - 16 * scale, x + 8 * scale, y - 9 * scale), fill=(58, 62, 50))
    if smoke:
        for _ in range(26):
            x, y = width * 0.5 + rng.randrange(-60, 60), height * 0.5 - rng.randrange(0, 260)
            radius = rng.randrange(24, 70)
            grey = rng.randrange(52, 96)
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(grey, grey, grey))
    return image.filter(ImageFilter.GaussianBlur(1.2))


def _png(image: Image.Image, text: str = "") -> bytes:
    buffer = io.BytesIO()
    info = PngInfo()
    if text:
        info.add_text("Comment", text)
    image.save(buffer, "PNG", pnginfo=info)
    return buffer.getvalue()


def _jpeg_with_gps(image: Image.Image) -> bytes:
    """A phone photo: a JPEG whose EXIF says where and with what it was taken."""
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"
    exif[0x0110] = "Model 7"
    gps = exif.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", GPS_SECRET, "E", (44.0, 14.0, 13.0)
    buffer = io.BytesIO()
    image.save(buffer, "JPEG", quality=88, exif=exif, comment=b"taken by a named person")
    return buffer.getvalue()


def _see_through(size: tuple[int, int] = (640, 360)) -> Image.Image:
    """A marked-up overlay that shows through: kept a PNG in the report."""
    image = Image.new("RGBA", size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 40, size[0] - 40, size[1] - 40), outline=(220, 40, 40, 255), width=8)
    draw.ellipse((size[0] / 2 - 50, size[1] / 2 - 50, size[0] / 2 + 50, size[1] / 2 + 50), fill=(220, 40, 40, 140))
    return image


# -- filing ------------------------------------------------------------------------------


def _rendered(case: Any, title: str, data: bytes, suffix: str, source: dict[str, Any], by: str,
              **attrs: Any) -> dict[str, Any]:
    filed = media_engine.import_rendered_bytes(case, data, title, suffix, source, by=by, extra_attrs=attrs or None)
    return {"id": filed["entity"]["id"], "path": filed["item"]["path"]}


def _image(case: Any, title: str, image: Image.Image, source: dict[str, Any], **options: Any) -> dict[str, Any]:
    filed = media_engine.import_image(case, image, f"{title}.png", source, title=title, dedupe=False, **options)
    return {"id": filed["entity"]["id"], "path": filed["item"]["path"]}


def _mp4(target: Path, seconds: int, *, title: str = "") -> bool:
    """A real H.264 clip with sound and, when asked, a container title, or False with no ffmpeg."""
    if shutil.which("ffmpeg") is None:
        return False
    command = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=s=320x180:r=12:d={seconds}",
               "-f", "lavfi", "-i", f"sine=f=330:d={seconds}", "-c:v", "libx264", "-pix_fmt", "yuv420p",
               "-c:a", "aac", "-shortest"]
    if title:
        command += ["-metadata", f"title={title}", "-metadata", f"location={title}"]
    try:
        subprocess.run([*command, str(target)], check=True, capture_output=True, timeout=60)
    except (OSError, subprocess.SubprocessError):
        return False
    return target.is_file()


def _video(case: Any, title: str, rel: str, source: dict[str, Any], *, seconds: int, secret: str = "",
           by: str = "download", url: str = "") -> dict[str, Any]:
    """A video filed by hand, as the downloader or Inspect files one, with its poster."""
    target = case.resolve_inside(rel)
    target.parent.mkdir(parents=True, exist_ok=True)
    if not _mp4(target, seconds, title=secret):
        target.write_bytes(b"not a real video, only its record")
    data = target.read_bytes()
    import hashlib

    sha = hashlib.sha256(data).hexdigest()
    attrs = {"path": rel, "sha256": sha, "kind": "video", **({"source_url": url} if url else {})}
    entity = case.add_entity("media", title, attrs=attrs, by=by, **({"source": url} if url else {}))
    case.upsert_media_item({"path": rel, "filename": Path(rel).name, "title": title, "kind": "video", "sha256": sha,
                            "size": len(data), "added_at": "2025-10-25T08:00:00Z", "source": source},
                           entity_id=entity["id"])
    poster = thumbnails.thumb_relpath(sha, "video")
    if poster:
        still = case.resolve_inside(poster)
        still.parent.mkdir(parents=True, exist_ok=True)
        _ground(7).resize((640, 360)).save(still, "JPEG", quality=80)
    return {"id": entity["id"], "path": rel, "sha256": sha, "real": data[:4] != b"not "}


def ambush_case(case: Any) -> dict[str, dict[str, Any]]:
    """File the ambush investigation in ``case``; returns each item by name."""
    made: dict[str, dict[str, Any]] = {}
    made["video"] = _video(case, "Column hit near Wadi Sahm", "media/Column hit near Wadi Sahm.mp4", {
        "type": "download", "url": POST_URL, "webpage_url": POST_URL, "downloader": "yt-dlp",
        "uploader": "Sahm Watch", "upload_date": "20251024", "duration": 14,
    }, seconds=14, url=POST_URL)
    made["clip"] = _video(case, "The strike, 0:03 to 0:13", "media/The strike, 0-03 to 0-13.mp4", {
        "type": "inspect", "op": "clip", "from": made["video"]["path"], "from_sha256": made["video"]["sha256"],
        "start": 3.0, "end": 13.0,
    }, seconds=10, secret=CLIP_SECRET, by="inspect")
    link_engine.link_all(case, made["clip"]["id"], link_engine.DERIVED_FROM, [made["video"]["path"]], by="inspect")
    made["frame"] = _rendered(case, "The lead tank stops", _png(_ground(3), PNG_SECRET), ".png", {
        "type": "inspect", "from": made["video"]["path"], "from_sha256": made["video"]["sha256"],
        "op": "frame", "time": 12.4,
    }, "inspect")
    link_engine.link_all(case, made["frame"]["id"], link_engine.DERIVED_FROM, [made["video"]["path"]], by="inspect")
    made["photo"] = _rendered(case, "Wreck of V12 the next morning", _jpeg_with_gps(_ground(11, smoke=False)), ".jpg", {
        "type": "download", "url": PHOTO_URL, "webpage_url": PHOTO_URL, "uploader": "Sahm Local",
        "upload_date": "20251025",
    }, "download")
    made["capture"] = _image(case, "The junction from above", _terrain(WIDE, 1), {
        "type": "satellite", "provider": "esri-world-imagery", "provider_label": "Esri World Imagery",
        "attribution": "Esri, Maxar", "imagery_date": "2025-06-03", "imagery_exact": False,
        "lat": JUNCTION[0], "lon": JUNCTION[1], "zoom": 18, "fetched_at": "2025-10-26T10:00:00Z",
    }, entity_type="capture")
    made["street"] = _image(case, "Street level at the junction", _ground(19, smoke=False), {
        "type": "screenshot", "method": "screenshot", "source_url": STREET_URL, "site": "google-maps",
        "provider": "google-maps", "provider_label": "Google Maps", "imagery_date": "2024-02-01",
        "attribution": "Street View · ©2024 Google", "fetched_at": "2025-10-26T11:00:00Z",
    }, entity_type="capture", extra_attrs={"source_url": STREET_URL, "site": "google-maps"})
    before = _rendered(case, "Junction, 12 March 2025", _png(_terrain(WIDE, 2)), ".png",
                       {"type": "compare", "side": "a", "providers": {"a": "esri-wayback~31144"},
                        "imagery_a": "2025-03-12"}, "compare")
    after = _rendered(case, "Junction, 26 October 2025", _png(_terrain(WIDE, 2, scars=6)), ".png",
                      {"type": "compare", "side": "b", "providers": {"b": "esri-world-imagery"},
                       "imagery_b": "2025-10-26", "imagery_b_exact": False}, "compare")
    made["pair"] = _rendered(case, "The junction before and after", _png(_terrain(WIDE, 2, scars=3)), ".png", {
        "type": "compare", "session": "compare/.meta/Junction.json", "kept": True, "mode": "swipe",
        "providers": {"a": "esri-wayback~31144", "b": "esri-world-imagery"},
        "imagery_a": "2025-03-12", "imagery_b": "2025-10-26", "imagery_b_exact": False,
        "lat": JUNCTION[0], "lon": JUNCTION[1], "zoom": 17, "rendered_at": "2025-10-27T09:00:00Z",
        "attribution_burned": True, "sides": {"a": before["path"], "b": after["path"]},
    }, "compare")
    made["before"], made["after"] = before, after
    # drawn from its two halves, as Compare files a still kept with its sides
    link_engine.link_all(case, made["pair"]["id"], link_engine.DERIVED_FROM, [before["path"], after["path"]],
                         by="compare")
    made["overlay"] = _rendered(case, "Marked junction overlay", _png(_see_through()), ".png", {"type": "clipboard"},
                                "inspect")
    made["proof"] = _proof(case, made)
    made["steps"] = [
        _image(case, f"Plate, {day}", _terrain((960, 540), 30 + index, scars=index * 3), {
            "type": "map-plate", "plate": "Ambush", "slide": index + 1, "attribution": "Esri, Maxar",
            "rendered_at": "2025-10-28T10:00:00Z"})
        for index, day in enumerate(("23 Oct 2025", "24 Oct 2025", "25 Oct 2025"))
    ]
    made["wide"] = _image(case, "The road from the ridge", _ground(23), {"type": "clipboard"})
    made["wreck"] = _image(case, "The burnt-out column", _ground(29), {"type": "clipboard"})
    made["graphic"] = _image(case, "Crew compartment", _ground(31).filter(ImageFilter.GaussianBlur(3)),
                             {"type": "download", "url": PHOTO_URL, "webpage_url": PHOTO_URL})
    made["article"] = {"id": case.add_entity("bookmark", "Column hit near the junction", attrs={
        "url": ARTICLE_URL, "archive_url": ARCHIVE_URL, "fetched_at": "2025-10-25T12:00:00Z"}, by="extension")["id"]}
    made["account"] = {"id": case.add_entity("account", "@sahm_watch", attrs={
        "url": ACCOUNT_URL, "platform": "X"}, by="user")["id"]}
    return made


def _proof(case: Any, made: dict[str, dict[str, Any]]) -> dict[str, Any]:
    name = "Junction geolocated"
    png = layout.proof_export_rel(name)
    spec = layout.proof_spec_rel(name)
    case.resolve_inside(png).parent.mkdir(parents=True, exist_ok=True)
    _terrain(WIDE, 5, scars=2).save(case.resolve_inside(png), "PNG")
    junction = f"{JUNCTION[0]:.6f}, {JUNCTION[1]:.6f}"
    case.resolve_inside(spec).parent.mkdir(parents=True, exist_ok=True)
    case.resolve_inside(spec).write_text(json.dumps({
        "description": "The column was hit where the Sana'a road meets the wadi track, 1.2 km east of the bridge.",
        "coordsText": junction,
        "points": [{"coords": junction, "label": "The junction"},
                   {"coords": f"{FILMER[0]:.6f}, {FILMER[1]:.6f}", "label": "Rooftop", "pov": True}],
    }), encoding="utf-8")
    proof = case.add_entity("proof", name, attrs={"spec": spec, "path": png, "kind": "image",
                                                   "posted_url": "https://x.com/our_desk/status/1982000000000000001"},
                            by="proof-composer")
    link_engine.link_all(case, proof["id"], link_engine.DERIVED_FROM,
                         [made["frame"]["path"], made["capture"]["path"]], by="proof-composer")
    return {"id": proof["id"], "path": png}


#: The Mermaid fence the note holds, and the SVG a browser would post for it.
DIAGRAM = "graph LR\n  A[Post] --> B[Clip]\n  B --> C[Frame]\n  C --> D[Proof]\n"
DIAGRAM_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" id="azimut-mermaid-0" viewBox="0 0 520 60" width="520" height="60">'
    '<style>#azimut-mermaid-0 .node rect{fill:#eef2f6;stroke:#54606f}#azimut-mermaid-0 .label{font:14px sans-serif}'
    "</style><defs><marker id=\"azimut-mermaid-0_arrow\" viewBox=\"0 0 10 10\" refX=\"9\" refY=\"5\" markerWidth=\"6\" "
    'markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z"/></marker></defs>'
    '<g class="node"><rect x="4" y="12" width="96" height="36" rx="4"/><text class="label" x="52" y="35" '
    'text-anchor="middle">Post</text></g>'
    '<g class="node"><rect x="144" y="12" width="96" height="36" rx="4"/><text class="label" x="192" y="35" '
    'text-anchor="middle">Clip</text></g>'
    '<g class="node"><rect x="284" y="12" width="96" height="36" rx="4"/><text class="label" x="332" y="35" '
    'text-anchor="middle">Frame</text></g>'
    '<g class="node"><rect x="424" y="12" width="92" height="36" rx="4"/><text class="label" x="470" y="35" '
    'text-anchor="middle">Proof</text></g>'
    '<path d="M100 30H144M240 30H284M380 30H424" stroke="#54606f" marker-end="url(#azimut-mermaid-0_arrow)"/>'
    '<script>alert(1)</script><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>'
    '<a href="javascript:alert(2)"><text onclick="alert(3)">bad</text></a></svg>'
)


def ambush_note(made: dict[str, dict[str, Any]]) -> str:
    """The register as an analyst writes it, every element the HTML report draws."""
    m = {name: item["id"] for name, item in made.items() if isinstance(item, dict)}
    steps = "\n".join(
        f'[[media:{item["id"]}|Plate {index}]]{{caption="{day}, {words}"}}'
        for index, (item, day, words) in enumerate(zip(
            made["steps"], ("23 Oct 2025", "24 Oct 2025", "25 Oct 2025"),
            ("The column on the road", "The first strike", "The wrecks pushed aside")), 1)
    )
    rows = [
        ("V01", "T-72B3 tank", "Destroyed", "90%", "Turret off, burnt out"),
        ("V02", "T-72B3 tank", "Damaged", "75%", "Tracks lost"),
        ("V03", "BMP-2", "Destroyed", "85%", "Burnt out"),
        ("V04", "BMP-2", "Abandoned", "60%", "Hatches open"),
        ("V05", "MT-LB", "Destroyed", "70%", ""),
        ("V06", "BTR-82A", "Damaged", "55%", "Seen in one frame"),
        ("V07", "Ural-4320 truck", "Destroyed", "65%", "May be V11"),
        ("V08", "Ural-4320 truck", "Intact", "80%", ""),
        ("V09", "KamAZ truck", "Destroyed", "70%", ""),
        ("V10", "BMP-2", "Captured", "50%", "Towed away on 25 Oct"),
        ("V11", "Ural-4320 truck", "Destroyed", "40%", "May be V07"),
        ("V12", "T-72B3 tank", "Destroyed", "95%", "Clearest: frame and phone photo"),
        ("V13", "BTR-82A", "Intact", "70%", ""),
        ("V14", "MT-LB", "Abandoned", "45%", ""),
    ]
    table = "\n".join(f"| {code} | {kind} | {state} | {confidence} | {notes} |"
                      for code, kind, state, confidence, notes in rows)
    return f"""<!--? Write the summary first. -->
## Summary

At least 60 vehicles were in the column when it was hit near the Wadi Sahm junction, at
{JUNCTION[0]:.4f}, {JUNCTION[1]:.4f} (plus code 7HXQ8C2X+3G), on 24 October 2025. We identify
14 of them by type, and at least 9 were destroyed or abandoned. Our confidence in the place
is 90%, in the day 75%. [[entity:{m['account']}|@sahm_watch]] posted [[entity:{m['video']}|the video]]
the same evening; [[entity:{m['article']}|the local news site]] reported it the next day.

> [!limits]
> The count is a minimum: the footage shows the head of the column only. Two trucks (V07 and
> V11) may be one seen twice. Nothing here says who fired.

## The footage

[[media:{m['clip']}|The strike]]{{caption="The column under fire, cut from the original post"}}

The first strike lands at [0:01–0:04], and the lead tank stops at [0:09].

[[media:{m['frame']}|Frame at 0:12]]{{width=70% align=center caption="The lead tank stops"}}

## Where it happened

[[media:{m['proof']}|Proof]]{{caption="The junction, matched on the frame and on imagery"}}

[[media:{m['pair']}|Before and after]]{{caption="The junction before and after the ambush"}}

[[media:{m['capture']}|The junction from above]]{{width=60%}}

[[media:{m['street']}|Street level]]{{width=50%}}

## The register

| Code | Type | State | Confidence | Notes |
|------|------|-------|-----------:|-------|
{table}

[V12](#V12) is the clearest: the frame at [0:09] and [[media:{m['photo']}|a phone photo]] show the same
turret ring. We saw 12 trucks in the second frame.

> [!confirmed] The junction matches the frame: the road bend, the wadi track and the two compounds.

> [!unverified] V07 and V11 may be the same truck seen from two sides.

> [!internal]
> The second source asked not to be named. Keep their handle out of anything public.

### The phone photo

[[media:{m['photo']}|Wreck of V12]]{{width=50% caption="Wreck of V12 the next morning"}}

## How it unfolded

::: steps
{steps}
:::

::: story
Read from the ridge, the ambush took under a minute.

[[media:{m['wide']}|The road from the ridge]]{{zoom=0.30,0.40,0.40,0.40}}
The column comes round the bend in close order, tanks first.

[[media:{m['wreck']}|The burnt-out column]]
By the next morning the wrecks have been pushed off the road.
:::

## Graphic material

[[media:{m['graphic']}|Crew compartment]]{{graphic caption="Inside V03, the morning after"}}

## Method

```mermaid
{DIAGRAM.rstrip()}
```

[[media:{m['overlay']}|Overlay]]{{width=40%}}

- [x] Geolocate the junction
- [ ] Ask the second source for the original file

<!-- a comment the page must not carry -->
<div>Raw HTML shows as text</div>

See also [a page on this machine](http://localhost:8477/api/cases), [a file](file:///home/analyst/x.png)
and [a script](javascript:alert(1)).
"""
