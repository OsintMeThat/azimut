"""Importing a geolocated post as a proof.

A post states a position and points at the footage it was read from. That is a
proof and its material, written in prose, and this module turns the pair into
the same nodes the composer writes when somebody geolocates a clip by hand:

- the **source media** — what was filmed on the spot. It takes ``located-at``
  when the analyst says the camera was there, because the registry gives that
  verb to material and to nothing else;
- the **panel images** — the pictures the post published. They are files the case
  collected too, and they are what the proof composes. A post publishing a set —
  the overhead, the ground shot, the match — is one proof of several panels, not
  one picture kept and the rest dropped;
- the **place** — filed exactly as the composer files one, so a point already in
  the case is reused rather than pinned twice;
- the **proof** — a real spec, so it lists, exports, travels in a bundle and
  reopens for editing like every other proof. Nothing here is a second class of
  proof.

**One picture exports itself; a set waits for the composer.** A published panel is
already a rendered proof, so a single-picture import files it as ``proofs/<name>.png``
and is done. Several panels have no render — laying them out is the composer's
canvas, in the browser — and inventing a second renderer here would drift from it
at the first change to a layout. So a set is filed **without an export**, borrowing
the first picture's thumbnail so the proof still draws in the graph, and the first
save in the composer writes the real one. A composition nobody composed is worth
opening anyway.

**Nothing is written until the analyst approves the preview.** Both downloads
land in a staging directory under ``media/.dl/``, which the bundle already
leaves behind and the Doctor already ignores, and a cancelled import deletes it.
That is why the download runs *before* the preview rather than after: once the
bytes are on disk their hash is known, so the preview can say the case already
holds this file instead of promising it will not.

**No format is special.** What the platform hands over — the media, the post
URL, the author, the date, the text — is read for every site the downloaders
support. What the text is asked for is shapes, never lines or keywords: a
position in any notation the app can parse (``geo.scan_coords``) and a URL. A
post that spells none of it out simply prefills nothing, and the form is filled
by hand, which is the same screen.
"""

from __future__ import annotations

import json
import math
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

from PIL import Image

from .. import layout
from ..workspace import Case, CaseError, ensure_dir
from . import enrich as enrich_engine
from . import geo as geo_engine
from . import links as link_engine
from . import media as media_engine
from . import satellite as satellite_engine

#: Held downloads live beside the in-progress ones. `media/.dl` is already the
#: directory that means "this machine's, not the case's": bundles skip it and the
#: Doctor never offers to adopt what is in it.
#:
#: A staging directory is named exactly like a download's scratch one — a token of
#: `layout.DOWNLOAD_ID_LENGTH` hex digits, no prefix — because the Windows path
#: budget is computed from that branch (`tests/test_layout.py`) and it has two
#: characters of room left. What tells the two apart is the manifest inside, which
#: is also what keeps the sweep from deleting a download still writing.
STAGING_PARENT = ".dl"
MANIFEST = "import.json"

#: The two things an import holds. `panel` is the published picture, `source` the
#: material it was read from; either may be filled by a download or by hand.
#:
#: **Both slots hold several files, and for opposite reasons.** A post often publishes a
#: geolocation as a set — the overhead, the ground shot, the match — and taking one and
#: dropping the rest keeps a third of what was published; those become the panels of one
#: composition, which is what a proof already is. The material runs the other way: a
#: thread states one point and hangs the photos and the clips it rests on off several
#: posts, so a slot that held one file filed one file and left the rest of the case's own
#: evidence outside it.
SLOT_PANEL = "panel"
SLOT_SOURCE = "source"
SLOTS = (SLOT_PANEL, SLOT_SOURCE)

#: How many pictures one import composes. A published set is a handful; past this it is an
#: album, and an album is not a proof.
MAX_PANELS = 8

#: How much material one proof may rest on. A thread hangs a handful of photos and clips
#: off its point; past this it is a channel dump, and that is the Media Library's job.
MAX_SOURCES = 8

#: What each slot may hold at once.
SLOT_CAPS = {SLOT_PANEL: MAX_PANELS, SLOT_SOURCE: MAX_SOURCES}

#: A staging directory the analyst walked away from. Swept when the next import
#: opens, so an abandoned tab costs one directory until then and nothing after.
MAX_STAGED_AGE = 24 * 60 * 60

#: How far a file's own recorded position may sit from the one the analyst typed
#: before the preview says so. Below this the two are the same spot written to a
#: different precision; above it, one of them is about somewhere else.
GPS_CONFLICT_METRES = 150

#: Scheme-less links are accepted only with a path, so ordinary prose ("i.e.",
#: a decimal ending a sentence) is not read as an address.
_URL = re.compile(
    r"\bhttps?://[^\s<>\"'\]]+"
    r"|\b(?:[\w-]+\.)+[a-zA-Z]{2,24}/[^\s<>\"'\]]*",
)
#: Trailing punctuation a sentence leaves stuck to a link, and the ellipsis a
#: timeline truncates one with.
_URL_TRIM = ".,;:!?)]}…"

MAX_SCANNED_URLS = 10

#: How much of a post's text is scanned. A caption is a paragraph; what arrives
#: past this is a transcript or a wall of tags, and both are attacker-controlled
#: input running through patterns that backtrack. Bounded at the door, once, so
#: neither scan has to defend itself.
MAX_POST_TEXT = 4000


def _now() -> float:
    return time.time()


# -- the staging directory -------------------------------------------------------


def _parent(case: Case) -> Path:
    return case.subdir("media") / STAGING_PARENT


def staging_dir(case: Case, token: str) -> Path:
    """Where one import holds its files. Refuses a token it did not mint, so a
    request cannot name a directory of its own."""
    if not re.fullmatch(r"[0-9a-f]{%d}" % layout.DOWNLOAD_ID_LENGTH, token):
        raise CaseError("unknown import")
    return _parent(case) / token


def sweep(case: Case) -> int:
    """Drop staging directories nothing came back for. Answers how many went."""
    parent = _parent(case)
    if not parent.is_dir():
        return 0
    dropped = 0
    cutoff = _now() - MAX_STAGED_AGE
    for path in parent.iterdir():
        # The manifest is what makes a directory here an import rather than a
        # download in flight, and deleting one of those would break it.
        if not path.is_dir() or not (path / MANIFEST).is_file():
            continue
        try:
            if path.stat().st_mtime >= cutoff:
                continue
        except OSError:
            continue
        shutil.rmtree(path, ignore_errors=True)
        dropped += 1
    return dropped


def open_import(case: Case) -> str:
    """Mint a token and its directory. Sweeps first: an import that is starting
    is the moment an abandoned one costs nothing to notice."""
    sweep(case)
    token = uuid.uuid4().hex[: layout.DOWNLOAD_ID_LENGTH]
    directory = staging_dir(case, token)
    ensure_dir(directory)
    _write_draft(case, token, {"token": token, "opened_at": _now(), "slots": {}, "post": {}})
    return token


def _draft_path(case: Case, token: str) -> Path:
    return staging_dir(case, token) / MANIFEST


def read_draft(case: Case, token: str) -> dict[str, Any]:
    path = _draft_path(case, token)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseError("this import is no longer open") from exc
    if not isinstance(data, dict):
        raise CaseError("this import is no longer open")
    return data


def _write_draft(case: Case, token: str, draft: dict[str, Any]) -> None:
    media_engine.write_json_atomic(_draft_path(case, token), draft)


def discard(case: Case, token: str) -> None:
    """Cancel: the held files go, and the case is exactly as it was.

    Only a directory carrying the manifest, so a token naming a download still
    writing into its own scratch directory cannot delete it.
    """
    directory = staging_dir(case, token)
    if (directory / MANIFEST).is_file():
        shutil.rmtree(directory, ignore_errors=True)


def _held(draft: dict[str, Any], slot: str) -> list[dict[str, Any]]:
    """What a slot holds, always as a list.

    The source holds one file and the panel holds a set, and reading them through one
    shape is what keeps every caller from having to know which of the two it is asking.
    """
    found = (draft.get("slots") or {}).get(slot)
    if isinstance(found, list):
        return [entry for entry in found if isinstance(entry, dict) and entry.get("filename")]
    return [found] if isinstance(found, dict) and found.get("filename") else []


def held_files(case: Case, token: str, slot: str) -> list[dict[str, Any]]:
    """Everything this slot holds, in the order it was held."""
    if slot not in SLOTS:
        raise CaseError(f"unknown slot '{slot}'")
    return _held(read_draft(case, token), slot)


def _at(case: Case, token: str, staged: dict[str, Any]) -> Path | None:
    path = staging_dir(case, token) / str(Path(str(staged.get("filename") or "")).name)
    return path if path.is_file() else None


def staged_path(case: Case, token: str, slot: str) -> Path | None:
    """The first file held in a slot, or None when the slot is empty."""
    held = held_files(case, token, slot)
    return _at(case, token, held[0]) if held else None


def staged_pairs(case: Case, token: str, slot: str) -> list[tuple[Path, dict[str, Any]]]:
    """Every file held in a slot with the entry describing it, the missing ones left out.

    Paired here rather than by the caller, and that is the whole reason it exists: the paths
    that survive and the entries that describe them were two lists zipped by position, so
    one file gone from the staging directory shifted every picture after it onto its
    neighbour's provenance — the post it came from, its title, the footage it derives from.
    A wrong origin on a proof is worse than none.
    """
    found = ((_at(case, token, staged), staged) for staged in held_files(case, token, slot))
    return [(path, staged) for path, staged in found if path is not None]


def fill_slot(case: Case, token: str, slot: str, staged: dict[str, Any]) -> dict[str, Any]:
    """Record what a download or a hand-attached file put in a slot, alone.

    Filling replaces: retrying a failed source download does not leave the abandoned
    attempt on disk, and re-picking a picture drops the one that was there.
    """
    return fill_files(case, token, slot, [staged])


def fill_files(
    case: Case, token: str, slot: str, staged: list[dict[str, Any]], *, for_url: str = ""
) -> dict[str, Any]:
    """Hold this set in a slot, dropping whatever it held that is not in it.

    ``for_url`` narrows the replacement to one address: what came from *that* post goes,
    what came from the others stays. Without it a second source address would have taken
    the first one's files with it, and retrying one failed address would have taken the
    lot. The address is written onto each entry rather than read back off the
    downloader's metadata, because a hand-attached file has no metadata to read.
    """
    if slot not in SLOTS:
        raise CaseError(f"unknown slot '{slot}'")
    draft = read_draft(case, token)
    if for_url:
        staged = [{**entry, "for_url": for_url} for entry in staged]
        kept = [one for one in _held(draft, slot) if one.get("for_url") != for_url]
    else:
        kept = []
    if len(kept) + len(staged) > SLOT_CAPS[slot]:
        raise CaseError(
            f"a proof composes at most {MAX_PANELS} pictures"
            if slot == SLOT_PANEL
            else f"a proof rests on at most {MAX_SOURCES} files"
        )
    holding = kept + staged
    keeping = {str(entry.get("filename") or "") for entry in holding}
    for previous in _held(draft, slot):
        name = str(previous.get("filename") or "")
        if name and name not in keeping:
            (staging_dir(case, token) / str(Path(name).name)).unlink(missing_ok=True)
    draft.setdefault("slots", {})[slot] = holding
    _write_draft(case, token, draft)
    return draft


def drop_for_url(case: Case, token: str, slot: str, url: str) -> dict[str, Any]:
    """Let go of what one address put in a slot, files and all."""
    return fill_files(case, token, slot, [], for_url=url)


def record_post(case: Case, token: str, post: dict[str, Any]) -> dict[str, Any]:
    """Keep what the platform said about the post, and what its text states."""
    draft = read_draft(case, token)
    draft["post"] = post
    _write_draft(case, token, draft)
    return draft


# -- reading the post ------------------------------------------------------------


def scan_urls(text: str, *, exclude: str = "") -> list[str]:
    """Every address a text points at, in order, minus the post's own.

    Candidates, not an answer: which one is the source is the analyst's call,
    and a post that names three is not being ambiguous by mistake.
    """
    found: list[str] = []
    excluded = exclude.rstrip("/").casefold()
    for match in _URL.finditer(text or ""):
        url = match.group(0).rstrip(_URL_TRIM)
        if not url or url.rstrip("/").casefold() == excluded:
            continue
        if url not in found:
            found.append(url)
        if len(found) == MAX_SCANNED_URLS:
            break
    return found


def read_post(source: dict[str, Any], post_url: str) -> dict[str, Any]:
    """What the downloaders reported about a post, plus what its text states.

    The first half is universal — every extractor answers with a title, a body,
    an author and a date, or leaves them out. The second half is the scan, and
    it prefills; it never decides.

    **The addresses it points at come from two places.** A platform that records them
    beside the words is believed first: an AT Protocol post prints a link truncated to
    an ellipsis and keeps the whole of it in a facet, so scanning the words there gives
    half an address and nothing to say it is half. The scan follows, for everything that
    writes its links out in full.
    """
    text = " \n".join(
        part for part in (source.get("title"), source.get("description")) if isinstance(part, str)
    ).strip()[:MAX_POST_TEXT]
    recorded = [one for one in (source.get("links") or []) if isinstance(one, str) and one]
    excluded = post_url.rstrip("/").casefold()
    urls = [one for one in recorded if one.rstrip("/").casefold() != excluded]
    for one in scan_urls(text, exclude=post_url):
        if one not in urls:
            urls.append(one)
    return {
        "url": post_url,
        "title": source.get("title") or "",
        "text": text,
        "uploader": source.get("uploader") or "",
        "upload_date": source.get("upload_date") or "",
        "coords": geo_engine.scan_coords(text),
        "urls": urls[:MAX_SCANNED_URLS],
    }


# -- what the import would create ------------------------------------------------


def _distance_metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle metres between two points, on a spherical earth. Precise
    enough for "is this the same spot", which is all it is asked."""
    radius = 6_371_000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * radius * math.asin(min(1.0, math.sqrt(a)))


def _stated_gps(path: Path, kind: str) -> dict[str, float] | None:
    """The position a held file states about itself, read locally.

    The same readers import enrichment uses, called here so a contradiction
    between the file and the typed coordinates surfaces while the analyst can
    still act on it rather than weeks later in the graph.
    """
    try:
        if kind == "image":
            gps = enrich_engine.exif_facts(path).get("gps")
        elif kind == "video":
            gps = (enrich_engine.video_facts(path) or {}).get("gps")
        else:
            return None
    except Exception:
        return None
    return gps if isinstance(gps, dict) and "lat" in gps and "lon" in gps else None


def _numbered(slot: str, count: int) -> list[str]:
    """One name per file a slot holds: `panel`, `panel 2`, `panel 3`.

    The report is a list of *files* and every line of it is about one of them. Calling
    three of them `panel` made the reading ambiguous — "panel derived-from source", three
    times, says nothing about which — and made the screen that renders it keyed on a name
    three rows shared. Numbered from the second, so a slot holding one keeps its name.
    """
    return [slot] + [f"{slot} {at}" for at in range(2, count + 1)]


def stated_sources(
    held: list[dict[str, Any]], urls: list[str]
) -> list[dict[str, Any]]:
    """What a slot holds for the addresses the form states, in the order it states them.

    The staging directory is a cache and the form is the claim, so an address the analyst
    took off the list leaves its download behind rather than filing it — the screen and
    the case cannot drift apart over a row somebody removed. Ordering by the form is also
    what makes `source 2` in the report mean the second box on the screen.

    A file held for no address at all is one somebody attached without saying where it
    came from. It is kept, last: the form cannot disown what it cannot name.
    """
    by_url: dict[str, list[dict[str, Any]]] = {}
    for entry in held:
        by_url.setdefault(str(entry.get("for_url") or ""), []).append(entry)
    return [one for url in urls for one in by_url.get(url, [])] + by_url.get("", [])


def read_source_urls(form: dict[str, Any]) -> list[str]:
    """The addresses the form states, in the order it states them, without repeats."""
    stated = form.get("source_urls")
    if not isinstance(stated, list):
        stated = [stated] if stated else []
    return list(dict.fromkeys(str(one or "").strip() for one in stated if str(one or "").strip()))


def proof_name(title: str) -> str:
    return layout.slugify(title, "Proof")


def preview(case: Case, token: str, form: dict[str, Any]) -> dict[str, Any]:
    """Everything this import would write, before it writes any of it.

    Read-only, and deliberately offline: resolving the country is a Nominatim
    call the creation makes anyway, and a preview is not an action that needs
    the network. A place already in the case shows the country it already has.
    """
    draft = read_draft(case, token)
    panels = _held(draft, SLOT_PANEL)
    #: One name per picture, because the report is a list of *files* and every line of it
    #: is about one of them. Calling three of them `panel` made the reading ambiguous —
    #: "panel derived-from source", three times, says nothing about which — and made the
    #: screen that renders it keyed on a name three rows shared.
    panel_slots = _numbered(SLOT_PANEL, len(panels))
    panel = panels[0] if panels else {}
    source_urls = read_source_urls(form)
    held_source = stated_sources(_held(draft, SLOT_SOURCE), source_urls)
    source_slots = _numbered(SLOT_SOURCE, len(held_source))
    #: Both halves as one list of (name, file), which is the order the report reads in:
    #: the material first, then the pictures composed out of it.
    material = list(zip(source_slots, held_source))
    composed = list(zip(panel_slots, panels))

    title = str(form.get("title") or "").strip()
    coords_text = str(form.get("coords") or "").strip()
    pov = bool(form.get("pov"))

    blocking: list[str] = []
    warnings: list[dict[str, str]] = []
    entities: list[dict[str, Any]] = []
    links: list[dict[str, str]] = []

    if not panels:
        blocking.append("There is no image for the proof yet.")
    elif any(held.get("kind") != "image" for held in panels):
        blocking.append("A proof is composed of pictures, and this file is not one.")
    if not title:
        blocking.append("The proof needs a name.")
    if not source_urls:
        blocking.append("A source is required.")
    elif len(source_urls) > MAX_SOURCES:
        blocking.append(f"A proof rests on at most {MAX_SOURCES} sources.")
    elif any(len(scan_urls(one)) > 1 for one in source_urls):
        # A box is the address its own file is fetched from as well as a line the proof
        # carries, so two of them pasted into one is not extra information: it is an
        # address nothing can be downloaded from. The import used to take it, warn that
        # the source "was not downloaded", and file a proof with no material at all.
        blocking.append("A source is one address, and this is several.")
    elif not all(media_engine.is_address(one) for one in source_urls):
        blocking.append("A source is an address, and this is not one.")

    point = geo_engine.parse_coords(coords_text) if coords_text else None
    if not coords_text:
        blocking.append("Coordinates are required.")
    elif point is None:
        blocking.append(f"'{coords_text}' is not a position Azimut can read.")

    name = proof_name(title) if title else ""
    if name and case.find_entity(attr="spec", value=layout.proof_spec_rel(name)) is not None:
        blocking.append(f"A proof is already called '{name}'.")

    # -- the place
    if point is not None:
        standing = satellite_engine.place_at(case, point[0], point[1], keyed_only=False)
        if standing is None:
            entities.append(
                {
                    "slot": "place",
                    "type": "place",
                    "label": geo_engine.to_dms(point[0], point[1]),
                    "state": "new",
                    "detail": "country resolved after creation",
                }
            )
        else:
            geo_attrs = (standing.get("attrs") or {}).get("geo") or {}
            entities.append(
                {
                    "slot": "place",
                    "type": "place",
                    "label": standing["label"],
                    "state": "existing",
                    "detail": str(geo_attrs.get("country") or "already in the case"),
                }
            )

    # -- the material, then the pictures that compose it
    for slot, staged in material + composed:
        if not staged.get("filename"):
            continue
        held = case.find_entity(attr="sha256", value=staged.get("sha256"))
        entities.append(
            {
                "slot": slot,
                "type": "media",
                "label": str(staged.get("title") or staged.get("filename")),
                "state": "existing" if held else "new",
                "detail": _media_detail(staged, held),
            }
        )

    # Only for an address that has one. With the field still empty the blocking line
    # above already says so, and saying it twice reads as two different problems.
    fetched = {str(one.get("for_url") or "") for one in held_source}
    missing = [one for one in source_urls if one not in fetched]
    if missing:
        warnings.append(
            {
                "code": "no-source-media",
                "text": (
                    "The source was not downloaded, so the proof will carry its address "
                    "and no file."
                    if len(missing) == 1
                    else f"{len(missing)} sources were not downloaded, so the proof will "
                    "carry their addresses and no files."
                ),
            }
        )

    if name:
        entities.append(
            {"slot": "proof", "type": "proof", "label": name, "state": "new", "detail": ""}
        )

    # -- the edges, and every one the save will write
    #
    # The point reaches the whole derivation closure, not just the footage: the
    # picture the proof composes is in that closure too, so it takes the verb as
    # well. Drawing only the footage would make the preview quieter than the
    # graph, which is the one way a preview can be wrong.
    if point is not None and name and panels:
        verb = link_engine.LOCATED_AT if pov else link_engine.DEPICTS
        kinds = ("image", "video", "audio") if pov else ("image", "video")
        for slot, staged in material + composed:
            if staged.get("filename") and str(staged.get("kind") or "") in kinds:
                links.append(_edge(slot, verb, "place"))
        # **The proof rests on the material, and composes the pictures.** Both are its own
        # edges, which is what makes it the node the constellation hangs off — the reading
        # somebody looking at the graph is after, since the proof is the finding and a
        # published picture is one file among the several it was read from. Hanging the
        # material off the *picture* instead made a media node the hub of the geolocation
        # and left the proof a leaf beside it.
        #
        # It is also the shape the composer writes by hand (`spec.material`, ONTOLOGY §3),
        # so a proof re-saved there restates exactly these edges rather than losing them.
        for source_slot, staged in material:
            if staged.get("filename"):
                links.append(_edge("proof", link_engine.DERIVED_FROM, source_slot))
        for slot in panel_slots:
            links.append(_edge("proof", link_engine.DERIVED_FROM, slot))
        links.append(_edge("proof", link_engine.DEPICTS, "place"))

    # -- what the files say about themselves
    if point is not None:
        # The first file held, material before pictures. One reading, because the
        # warning names a position and a distance and two of them read as two points.
        path = staged_path(case, token, SLOT_SOURCE) or staged_path(case, token, SLOT_PANEL)
        staged = held_source[0] if held_source else panel
        if path is not None:
            own = _stated_gps(path, str(staged.get("kind") or ""))
            if own is not None:
                away = _distance_metres(point[0], point[1], own["lat"], own["lon"])
                if away > GPS_CONFLICT_METRES:
                    warnings.append(
                        {
                            "code": "gps-conflict",
                            "text": (
                                f"The file states {own['lat']:.6f}, {own['lon']:.6f} — "
                                f"{round(away):,} m from the coordinates entered."
                            ).replace(",", " "),
                        }
                    )

    # -- has this post already been through here
    already = _already_imported(case, draft, panel)
    if already:
        warnings.append(already)

    return {
        "ready": not blocking,
        "blocking": blocking,
        "entities": entities,
        "links": links,
        "warnings": warnings,
    }


def _media_detail(staged: dict[str, Any], held: dict[str, Any] | None) -> str:
    if held is not None:
        return f"already in the case as '{held['label']}'"
    size = int(staged.get("size") or 0)
    kind = str(staged.get("kind") or "file")
    return f"{kind} · {size / (1024 * 1024):.1f} MB" if size else kind


def _already_imported(
    case: Case, draft: dict[str, Any], panel: dict[str, Any]
) -> dict[str, str] | None:
    """Whether this post's picture is already filed, by its bytes then its URL.

    Two questions, because the same post can arrive twice with a re-encoded
    image, and the same picture can arrive from two posts.
    """
    digest = panel.get("sha256")
    if digest:
        held = case.find_entity(attr="sha256", value=digest)
        if held is not None:
            return {
                "code": "already-imported",
                "text": f"This picture is already in the case as '{held['label']}'.",
            }
    post_url = str((draft.get("post") or {}).get("url") or "")
    if post_url:
        held = case.find_entity(attr="source_url", value=post_url)
        if held is not None:
            return {
                "code": "already-imported",
                "text": f"This post was already imported as '{held['label']}'.",
            }
    return None


#: The derivation chain has no entry in the relation registry — it is not a
#: relation — so the one edge the preview draws from it carries its reading here.
_CHAIN_LABELS = {link_engine.DERIVED_FROM: "derived from"}


def _edge(from_slot: str, type_: str, to_slot: str) -> dict[str, str]:
    relation = link_engine.relation_type(type_)
    return {
        "from": from_slot,
        "to": to_slot,
        "type": type_,
        "label": relation.label if relation else _CHAIN_LABELS.get(type_, type_),
    }


def panel_size(path: Path) -> tuple[int, int]:
    """The picture's own pixel size, which the composer lays a panel out from."""
    with Image.open(path) as img:
        return int(img.width), int(img.height)


def png_bytes(path: Path) -> bytes:
    """The imported picture as the proof's export.

    A published panel is already a rendered proof, so the import files it as one
    rather than re-rendering a composition nobody composed. Re-encoded to PNG
    because that is what `proofs/<name>.png` claims to be, and a JPEG under that
    name is a lie the next reader has to sniff its way out of.
    """
    import io

    with Image.open(path) as img:
        buffer = io.BytesIO()
        (img if img.mode in ("RGB", "RGBA", "L") else img.convert("RGB")).save(buffer, "PNG")
        return buffer.getvalue()


def build_spec(
    panels: list[tuple[str, tuple[int, int]]],
    form: dict[str, Any],
    material: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    """The proof an import writes: the pictures it published, the point, the source.

    Everything else is left out on purpose. A spec omits what it does not state,
    and the composer's `normalizeProofStyle` fills every look from its own
    defaults — so an imported proof opens as a plain composition the analyst can
    annotate, rather than one frozen into whatever this module happened to think a
    proof should look like.

    **A post publishing several pictures is one proof of several panels**, laid in
    one row and in the order they were published. Which is not a new kind of thing:
    a proof is a composition, and the only reason an import used to write exactly
    one panel is that it had exactly one picture. The note lands on the first — it
    is one sentence about the proof, not a caption per picture.
    """
    spec = {
        "azimut_proof": 1,
        "panels": [
            {
                "id": f"p{uuid.uuid4().hex[:8]}",
                "src": rel,
                "caption": str(form.get("note") or "").strip() if at == 0 else "",
                "row": 0,
                "scale": 1,
                "natural": [natural[0], natural[1]],
                "meta": {},
            }
            for at, (rel, natural) in enumerate(panels)
        ],
        "pastes": [],
        "shapes": [],
        "notes": {},
        "legendOrder": [],
        # The files the proof rests on without composing them, each with the address it
        # came from. Written into the spec rather than onto the pictures, so the save
        # states the edges and a re-save in the composer restates them — and so taking a
        # source off the proof there takes its files out of the chain with it. The
        # composer's own Source list writes the same key.
        "material": [dict(one) for one in material or []],
        "sources": read_source_urls(form),
    }
    return satellite_engine.state_points(
        spec, [{"coords": form.get("coords"), "pov": bool(form.get("pov"))}]
    )
