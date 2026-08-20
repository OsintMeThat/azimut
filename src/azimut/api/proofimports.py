"""REST API for importing a geolocated post as a proof.

The engine owns the staging directory, the scan and the preview; this owns the
order the pieces are written in, because that order is the whole guarantee:

1. ``POST /proof-imports`` mints a token and a directory to hold files in;
2. ``fetch`` downloads — the post's picture into one slot, the footage the post
   points at into the other. Both land in the staging directory, and both go
   through the same yt-dlp/gallery-dl path the Media Library uses, so a login
   wall and a post with several attachments behave exactly as they do there;
3. ``attach`` fills a slot by hand, which is the answer to a download that
   failed and the whole of the paste-an-image route;
4. ``preview`` says what would be created, reading the held bytes;
5. ``commit`` writes it, and only then does anything enter the case.

``DELETE`` at any point leaves no trace. So does walking away: the next import
sweeps what was abandoned.

Step 5 is also a function, :func:`write_import`, because a sheet's geolocation
index builds a hundred of these in a job (`api/sheetproofs.py`) and the order
above is exactly the guarantee it needs too.
"""

from __future__ import annotations

import base64
import shutil
from typing import Any

from fastapi import APIRouter, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field, HttpUrl

from .. import config, jobs, layout
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import proofimport as import_engine
from ..workspace import Case, CaseError, ensure_dir
from . import proofs
from .cases import get_case
from .limits import MAX_IMAGE_BYTES
from .media import stated_source

router = APIRouter(prefix="/api", tags=["proof-imports"])


class FetchIn(BaseModel):
    url: HttpUrl
    #: Which half of the import this download is for.
    slot: str = Field(default=import_engine.SLOT_PANEL)
    #: 1-based pick when the post carries several attachments, as in Media.
    index: int | None = None
    #: Several picks: a post publishing a geolocation as a set publishes one proof and the
    #: set becomes its panels, and a post carrying two photos of the scene is two pieces
    #: of material, not one. In the order they were ticked.
    indexes: list[int] = Field(default_factory=list, max_length=import_engine.MAX_PANELS)
    use_cookies: bool = False


class FormIn(BaseModel):
    """What the analyst filled in. Coordinates and a source are required, and
    the preview is where that is said rather than at the end of a save.

    ``source_urls`` is a list because a thread states one point and hangs the photos and
    the clips it rests on off several posts. Each address holds its own files, is
    retried on its own and is dropped on its own.
    """

    title: str = Field(default="", max_length=layout.MAX_SLUG)
    coords: str = Field(default="", max_length=200)
    source_urls: list[str] = Field(
        default_factory=list, max_length=import_engine.MAX_SOURCES
    )
    note: str = Field(default="", max_length=500)
    pov: bool = False


def _slot(value: str) -> str:
    if value not in import_engine.SLOTS:
        raise HTTPException(status_code=422, detail=f"unknown slot '{value}'")
    return value


def _open_draft(case: Case, token: str) -> dict[str, Any]:
    try:
        return import_engine.read_draft(case, token)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cases/{case_id}/proof-imports")
def start_import(case_id: str) -> dict[str, str]:
    return {"token": import_engine.open_import(get_case(case_id))}


@router.delete("/cases/{case_id}/proof-imports/{token}")
def cancel_import(case_id: str, token: str) -> dict[str, bool]:
    case = get_case(case_id)
    try:
        import_engine.discard(case, token)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"discarded": True}


@router.post("/cases/{case_id}/proof-imports/{token}/fetch")
def fetch(case_id: str, token: str, body: FetchIn) -> dict[str, str]:
    """Download into a slot, without filing anything.

    The picture slot also reads the post: its text is scanned for positions and
    addresses, and both ride back with the job so the form can be prefilled from
    one round trip.
    """
    case = get_case(case_id)
    slot = _slot(body.slot)
    _open_draft(case, token)
    stage = import_engine.staging_dir(case, token)
    ensure_dir(stage)
    url = str(body.url)
    cookies = (
        media_engine.cookies_from_preference(config.load_settings().get("download_cookies"))
        if body.use_cookies
        else None
    )

    #: What to download, in order. `None` is "whatever the post holds", which is the
    #: answer before anybody has seen a picker.
    picks: list[int | None] = [n for n in body.indexes if n > 0] or [body.index]

    def work(set_progress):
        def hook(d):
            if d.get("status") == "downloading":
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                done = d.get("downloaded_bytes") or 0
                set_progress(
                    {
                        "percent": round(done * 100 / total, 1) if total else None,
                        "speed": d.get("_speed_str", "").strip() or None,
                    }
                )
            elif d.get("status") == "finished":
                set_progress({"percent": 100, "stage": "processing"})

        held: list[dict[str, Any]] = []
        for at, pick in enumerate(picks):
            set_progress({"percent": None, "of": len(picks), "done": at})
            result = media_engine.fetch_url(
                case, url, progress_hook=hook, index=pick, cookies=cookies, stage=stage,
                # The panel is a picture by definition, and yt-dlp reads a post for its
                # video: a post publishing a geolocation beside a quoted clip would hand
                # back the clip and the picture would be unreachable from here.
                wants="image" if slot == import_engine.SLOT_PANEL else "",
            )
            staged = result.get("staged")
            if not staged:
                return result  # a picker, a login wall, a Telegram-only post
            held.append(staged)
        # Keyed by the address it came from: a second source address holds its own files
        # beside the first one's, and retrying one that failed replaces only its own.
        import_engine.fill_files(case, token, slot, held, for_url=url)
        answer: dict[str, Any] = {"slot": slot, "staged": held[0], "held": held}
        if slot == import_engine.SLOT_PANEL:
            post = import_engine.read_post(held[0].get("source") or {}, url)
            import_engine.record_post(case, token, post)
            answer["post"] = post
        return answer

    return {"job_id": jobs.start("proof-import", work)}


@router.post("/cases/{case_id}/proof-imports/{token}/attach")
async def attach(
    case_id: str,
    token: str,
    file: UploadFile,
    slot: str = Form(default=import_engine.SLOT_PANEL),
    source_url: str = Form(default="", max_length=4000),
) -> dict[str, Any]:
    """Fill a slot from the computer or the clipboard.

    The one route behind both "paste an image instead" and "the download failed,
    here is the file". ``source_url`` is what the analyst says the bytes came
    from, which a hand-attached file is the only chance to state.

    Read through `stated_source`, like the upload and the later correction in Details:
    an origin is a link, refused when it is not one. This is the surface where the
    address is typed by hand, so it is the one that most needed the reading.
    """
    case = get_case(case_id)
    slot = _slot(slot)
    # Before the bytes are streamed: a refused origin should not leave a staged file.
    stated = stated_source(source_url)
    _open_draft(case, token)
    stage = import_engine.staging_dir(case, token)
    ensure_dir(stage)
    name = media_engine.safe_filename(file.filename or "attachment")
    path = media_engine.unique_path(stage, name)
    # Streamed rather than read into memory: the source slot takes whatever the
    # footage weighs, and a video the downloader could not reach is exactly the
    # file somebody attaches here. Only the picture is bounded, by the same clamp
    # every other image entering the app answers to.
    with path.open("wb") as out:
        shutil.copyfileobj(file.file, out)
    if slot == import_engine.SLOT_PANEL:
        # A proof is composed of pictures: the composer lays panels out on a canvas and
        # a clip has nothing to lay out. Said at the door the file comes through rather
        # than at the preview, which is two screens and one staged file later.
        if media_engine.media_kind(name) != "image":
            path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=422,
                detail="a proof is composed of pictures, and this file is not one",
            )
        if path.stat().st_size > MAX_IMAGE_BYTES:
            path.unlink(missing_ok=True)
            raise HTTPException(status_code=413, detail="that picture is too large")
    source: dict[str, Any] = {"type": "manual", "original_name": file.filename or name}
    if stated:
        source["url"] = stated
    staged = media_engine.stage_descriptor(path, source)
    # For the material, the stated origin is also the row this file answers for, so it
    # replaces what that one address holds and leaves the other addresses alone.
    # Attaching a picture still replaces the whole set: "here is my picture instead" is
    # what that route means, and a set built from a post is not something it adds to.
    import_engine.fill_files(
        case, token, slot, [staged],
        for_url=stated if slot == import_engine.SLOT_SOURCE else "",
    )
    return {"slot": slot, "staged": staged}


@router.post("/cases/{case_id}/proof-imports/{token}/preview")
def preview(case_id: str, token: str, body: FormIn) -> dict[str, Any]:
    case = get_case(case_id)
    try:
        return import_engine.preview(case, token, body.model_dump())
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/cases/{case_id}/proof-imports/{token}/commit")
def commit(case_id: str, token: str, body: FormIn) -> dict[str, Any]:
    return write_import(case_id, token, body.model_dump())


def write_import(
    case_id: str, token: str, form: dict[str, Any], *, by: str = "proof-import"
) -> dict[str, Any]:
    """Write one held import, in the order that keeps the graph readable.

    The footage is filed first so the picture can record that it came out of it;
    the proof is saved through the composer's own route, so the place, the verbs
    and the derivation are the ones a hand-made proof would have written. There
    is no second implementation of any of that here.

    Called by the dialog's own commit and by the sheet road that builds a hundred
    of these in a job (`api/sheetproofs.py`). ``by`` is the only thing that
    differs between them, and it is what lets the graph say which press wrote a
    file. Splitting the two would have been the second implementation.
    """
    case = get_case(case_id)
    _open_draft(case, token)
    report = import_engine.preview(case, token, form)
    if not report["ready"]:
        raise HTTPException(status_code=400, detail=" ".join(report["blocking"]))

    created: dict[str, Any] = {}

    # Paired here for the same reason the pictures are: a file whose bytes have gone
    # must not shift the rest onto their neighbours' provenance.
    source_rels: list[dict[str, str]] = []
    filed_sources: list[dict[str, Any]] = []
    pairs = import_engine.staged_pairs(case, token, import_engine.SLOT_SOURCE)
    by_name = {str(held.get("filename") or ""): path for path, held in pairs}
    # Only what the form still states, and in its order — the same reading the preview
    # ran on, so the commit files exactly what the analyst was shown.
    for held in import_engine.stated_sources(
        [held for _path, held in pairs], import_engine.read_source_urls(form)
    ):
        source_path = by_name[str(held.get("filename") or "")]
        filed = media_engine.import_produced_file(
            case,
            source_path,
            str(held["filename"]),
            dict(held.get("source") or {}),
            by=by,
        )
        # The file and the address it came from: the composer reconciles its Source list
        # against these, so a source taken off the proof takes its files with it.
        source_rels.append(
            {"path": filed["entity"]["attrs"]["path"], "url": str(held.get("for_url") or "")}
        )
        filed_sources.append(_summary(filed))
    if filed_sources:
        created["source"] = filed_sources[0]
        if len(filed_sources) > 1:
            created["sources"] = filed_sources

    # Path and manifest entry together: pairing them by position meant a file whose bytes
    # had gone — quarantined by an antivirus, swept by hand — filed every picture after it
    # under its neighbour's origin.
    held_panels = import_engine.staged_pairs(case, token, import_engine.SLOT_PANEL)
    if not held_panels:
        raise HTTPException(status_code=400, detail="the picture is no longer held")
    panel_paths = [path for path, _ in held_panels]
    name = import_engine.proof_name(form["title"])
    # Both read before a single file moves: filing a produced file *moves* it out of the
    # staging directory, so anything the spec needs from the bytes has to be taken first.
    naturals = [import_engine.panel_size(path) for path in panel_paths]
    # One picture is already a rendered proof, so it is filed as the export. A set has no
    # render — the layout is the composer's canvas, in the browser — and a second renderer
    # here would drift from it at the first change. So the set is saved without one, and
    # the first save in the composer writes the real thing.
    export = (
        base64.b64encode(import_engine.png_bytes(panel_paths[0])).decode("ascii")
        if len(panel_paths) == 1
        else None
    )
    panels: list[tuple[str, tuple[int, int]]] = []
    filed_panels: list[dict[str, Any]] = []
    for at, (panel_path, held) in enumerate(held_panels):
        # The picture states where it came from once, in its provenance: the post that
        # published it. What the geolocation *rests* on is the proof's own claim, filed
        # from the spec below — a published picture is one file among the several the
        # proof was read from, not the thing they all hang off.
        panel_source = dict(held.get("source") or {})  # the post, and nothing else
        # Numbered from the second, so a single-picture import keeps the name it had.
        stem = name if at == 0 else f"{name} {at + 1}"
        filed = media_engine.import_produced_file(
            case,
            panel_path,
            layout.visible_filename(stem, panel_path.suffix),
            panel_source,
            by=by,
        )
        panels.append((filed["entity"]["attrs"]["path"], naturals[at]))
        filed_panels.append(filed)
    created["panel"] = _summary(filed_panels[0])
    if len(filed_panels) > 1:
        created["panels"] = [_summary(one) for one in filed_panels]

    spec = import_engine.build_spec(panels, form, material=source_rels)
    saved = proofs.save_proof(
        case_id,
        proofs.ProofIn(title=form["title"], spec=spec, png_base64=export),
    )
    proof_entity = case.find_entity(attr="spec", value=layout.proof_spec_rel(str(saved["name"])))
    # Without an export there is no thumbnail, and a proof draws in the graph off the one
    # recorded on its own row (`graph._previews`) — so it would be the only blank node of
    # its own constellation. It borrows the first picture's, read off that media's sidecar
    # where the thumbnailer put it. A thumbnail is a preview and never an assertion, which
    # is what makes borrowing honest here where filing one picture as `proofs/<name>.png`
    # would not be.
    borrowed = (filed_panels[0].get("item") or {}).get("thumbnail")
    if export is None and borrowed and proof_entity is not None:
        case.update_entity(proof_entity["id"], {"attrs": {"thumb": borrowed}})
    created["proof"] = {
        "name": saved["name"],
        "png": saved.get("png"),
        "id": (proof_entity or {}).get("id"),
    }

    place = saved.get("place")
    if isinstance(place, dict) and place.get("asking") and proof_entity is not None:
        # `proof_place_auto` is off, so the composer's own save would have asked.
        # The import already asked — that is what the preview was — so the answer
        # is filed here rather than handed back as a second question.
        proofs.file_proof_points(case, proof_entity)
    # Read off the edge rather than off the save's answer: the save reports
    # nothing when the point was already in the case, and "which place did this
    # land on" has to be answerable whether the import pinned it or reused it.
    created["place"] = _concluded_place(case, proof_entity)

    import_engine.discard(case, token)
    return created


def _concluded_place(case: Case, proof: dict[str, Any] | None) -> dict[str, Any] | None:
    """The point the saved proof concludes on, as the graph now holds it."""
    if proof is None:
        return None
    for link in case.links_of(proof["id"]):
        if link["from"] != proof["id"] or link["type"] != link_engine.DEPICTS:
            continue
        target = case.get_entity(link["to"])
        if target is not None and target["type"] == "place":
            return {"id": target["id"], "label": target["label"]}
    return None


def _summary(filed: dict[str, Any]) -> dict[str, Any]:
    entity = filed["entity"]
    return {
        "id": entity["id"],
        "label": entity["label"],
        "path": entity["attrs"]["path"],
        "duplicate": bool(filed.get("duplicate")),
    }
