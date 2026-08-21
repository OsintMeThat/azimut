"""REST API for building proofs out of a geolocation index.

The one road out of a sheet that goes and fetches bytes, and therefore the one that is
not a mode of the pass. Two routes:

- ``POST .../proofs/preview`` reads the plan. Offline: the three refusals come out of the
  cells and the three "already there" answers come out of the case, so an analyst knows
  what a hundred downloads would do before one of them starts.
- ``POST .../proofs`` starts a job and hands back its id. The browser polls
  ``GET /api/jobs/{id}`` for a per-row progress and ``POST /api/jobs/{id}/cancel`` to stop
  it, which is the same pattern a media download already follows.

**Atomic per row, not over the batch** — the opposite of the pass, for the opposite
reason. Failing at row 47 is no reason to hand back the 46 that worked, so each row is its
own unit: the files are fetched into a staging directory first, and nothing enters the
case until both of them are held. A row that cannot be reached writes nothing at all and
is simply taken again at the next press.

**Pressing twice is safe without a memory of the first press.** A proof is found by the
name it would be saved under, a media by the page it was downloaded from, and a place by
its point — three questions the case answers on its own. So a browser that closed halfway
through, or a job that died, costs one press and never a twin.

Nothing is reimplemented here. `proofimports.write_import` writes the constellation, the
composer's own save writes the proof, and `satellite` files the points.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config, jobs, layout
from ..engine import links as link_engine
from ..engine import media as media_engine
from ..engine import proofimport as import_engine
from ..engine import satellite as satellite_engine
from ..engine import sheetpromote as promote_engine
from ..engine import sheetproofs as build_engine
from ..engine import sheets as sheet_engine
from ..workspace import Case, CaseError, ensure_dir
from . import proofimports, proofs
from .cases import get_case
from .satellite import locate_on_save

router = APIRouter(prefix="/api/cases", tags=["sheets"])


class SheetBuildIn(BaseModel):
    """One declaration of which column holds what, and the rows to build from.

    The table travels with the request for the same reason every other road out of a sheet
    takes it: the analyst builds from what is on screen, which may hold edits the autosave
    has not written yet.
    """

    #: The same ceilings every other model carrying a table declares, so the refusal comes
    #: from the shape of the table rather than from whatever the engine reaches first.
    columns: list[str] = Field(default_factory=list, max_length=sheet_engine.MAX_COLUMNS)
    rows: list[list[str]] = Field(default_factory=list, max_length=sheet_engine.MAX_ROWS)
    #: Bounded at the pass's own ceiling rather than at this road's, so the hundred-row cap
    #: is refused by the engine — which says how many are left — instead of by the model,
    #: which can only say the list is too long.
    keys: list[str] = Field(default_factory=list, max_length=promote_engine.MAX_PROMOTED)
    #: The name the proof is saved under, so also its filename.
    title: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    #: The address of what was filmed on the spot.
    source: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    #: The address of the published geolocation picture.
    proof: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    point: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    note: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    status: str = Field(default="", max_length=sheet_engine.MAX_COLUMN_NAME)
    #: Which states are left out. Absent means the default one; an empty list means the
    #: analyst put the ruled-out rows back, which is a different answer and has to survive
    #: as one.
    skip_states: list[str] | None = Field(default=None, max_length=20)
    #: Whether the camera was at the point. One answer for the press: a column of its own
    #: waits for a binder that actually holds one.
    pov: bool = False
    #: Rows the analyst read in the plan and put aside.
    skip: list[str] = Field(default_factory=list, max_length=build_engine.MAX_ROWS)


def _declaration(body: SheetBuildIn) -> dict[str, Any]:
    """The arguments the plan and the press both take, stated once."""
    return {
        "columns": body.columns,
        "rows": body.rows,
        "keys": body.keys,
        "title": body.title,
        "source": body.source,
        "proof": body.proof,
        "point": body.point,
        "note": body.note,
        "status": body.status,
        "skip_states": body.skip_states,
        "pov": body.pov,
    }


def _planned(case: Case, body: SheetBuildIn) -> dict[str, Any]:
    names, table = sheet_engine.normalize(body.columns, body.rows)
    return build_engine.plan(case, **{**_declaration(body), "columns": names, "rows": table})


@router.post("/{case_id}/sheets/{sheet_id}/proofs/preview")
def preview_build(case_id: str, sheet_id: str, body: SheetBuildIn) -> dict[str, Any]:
    """What a build would write, with nothing downloaded and nothing written."""
    case = get_case(case_id)
    try:
        return _planned(case, body)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/{case_id}/sheets/{sheet_id}/proofs")
def build_proofs(case_id: str, sheet_id: str, body: SheetBuildIn) -> dict[str, str]:
    """Start the build, and answer with the job that is doing it.

    The plan is read here rather than in the thread, so a declaration the door refuses
    comes back as a refusal on the press instead of a job that fails a second later.
    """
    case = get_case(case_id)
    try:
        reading = _planned(case, body)
    except CaseError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except sheet_engine.SheetError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    left_out = set(body.skip)
    doing = [
        decision
        for decision in reading["rows"]
        if decision["action"] in build_engine.DOING and decision["key"] not in left_out
    ]
    def work(set_progress: Any, stopping: Any) -> dict[str, Any]:
        done: list[dict[str, Any]] = []
        for at, decision in enumerate(doing):
            if stopping():
                break
            set_progress({
                "done": at,
                "total": len(doing),
                "key": decision["key"],
                "label": decision["title"] or decision["coords"],
            })
            wrote = _build_row(case, case_id, decision, pov=body.pov, stopping=stopping)
            # `None` is the row that was cancelled after its downloads and before its
            # write. It is not a failure and it is not a result — it is a row nobody asked
            # for any more, and the next press takes it exactly as it was.
            if wrote is None:
                break
            done.append(wrote)
        set_progress({"done": len(done), "total": len(doing)})
        return {
            "rows": done,
            "counts": {
                word: sum(1 for row in done if row["outcome"] == word)
                for word in ("built", "restated", "failed")
            },
            "links": _sidecar(body, done),
            "stopped": len(done) < len(doing),
        }

    return {"job_id": jobs.start("sheet-proofs", work, stoppable=True)}


#: Which column a row's cell points at, once the row has produced it. The sidecar keys
#: entities by the column their cell sits in, so a built row gets its own chips: the title
#: points at the proof it named, the two addresses at the files they fetched, and the
#: coordinates at the ground.
_IN_COLUMN = {"proof": "title", "source": "source", "panel": "proof", "place": "point"}


def _sidecar(body: SheetBuildIn, done: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """What the browser writes back into the sheet's sidecar, by row key then column.

    Handed back rather than written here: the sheet's file is the browser's to save, and a
    job holding a stamp for two minutes would fight every autosave in that window. What
    makes a second press safe is the case itself, so a sidecar that never arrives costs
    the chips and never a duplicate.
    """
    named = {slot: getattr(body, field) for slot, field in _IN_COLUMN.items()}
    found: dict[str, dict[str, str]] = {}
    for row in done:
        cells = {
            named[slot]: entity
            for slot, entity in (row.get("made") or {}).items()
            if named.get(slot)
        }
        if cells:
            found[row["key"]] = cells
    return found


# -- one row ------------------------------------------------------------------


def _build_row(
    case: Case,
    case_id: str,
    decision: dict[str, Any],
    *,
    pov: bool,
    stopping: Any,
) -> dict[str, Any] | None:
    """Build one row, and answer with what it wrote or why it could not.

    A row never raises: a dead link on line 12 is a fact about line 12, and taking the job
    down over it would lose the eleven rows above and the eighty-eight below. What it
    answers with is what the grid logs beside the row and what the sidecar records, so the
    next press knows this line is done.

    ``None`` is the one answer that is neither: a cancel that landed while this row was
    downloading. The bytes are dropped with the staging directory and the case never heard
    of the row, which is what makes cancelling safe to press.
    """
    answer: dict[str, Any] = {
        "key": decision["key"],
        "outcome": "failed",
        "reason": "",
        "made": {},
    }
    point = decision["point"] or {}
    try:
        if decision["proof_url"]:
            written = _row_proof(case, case_id, decision, pov=pov, stopping=stopping)
        elif decision["source_url"]:
            written = _row_media(case, decision, pov=pov, stopping=stopping)
        else:
            written = {"place": _place_for(case, point["lat"], point["lon"])}
        answer["made"] = {slot: entity["id"] for slot, entity in written.items() if entity}
        answer["outcome"] = "restated" if decision["action"] != "make" else "built"
    except _Stopped:
        return None
    except _RowFailed as failure:
        answer["reason"] = str(failure)
    except Exception as failure:  # noqa: BLE001 — a row is not allowed to end the press
        # Broad on purpose, and it is the whole promise of this road: whatever a
        # downloader raises about one address — and they raise anything — costs that row
        # and no other. The reason is kept whole so the grid can show what happened rather
        # than "it did not work".
        answer["reason"] = str(getattr(failure, "detail", None) or failure)
    return answer


class _RowFailed(Exception):
    """What stopped one row, in the words the grid shows beside it."""


def _walled(answer: dict[str, Any]) -> str:
    """A login wall, said with the next move rather than with the platform's wording.

    A stored session has already been tried by the time a row comes back walled, so the
    three cases are different instructions and not one sentence: none saved, one saved
    that did not get through, and Windows refusing to hand over a Chromium store at all.
    """
    if answer.get("guidance") == "windows-chromium":
        return "needs a login: Windows locks Chrome's cookies, use a cookies.txt file"
    if answer.get("refused"):
        return "needs a login: the browser in Settings is not signed in to this site"
    session = media_engine.cookies_from_preference(
        config.load_settings().get("download_cookies")
    )
    return (
        "needs a login: the browser in Settings is not signed in to this site"
        if session
        else "needs a login: pick your browser in Settings → Downloads"
    )


class _Stopped(Exception):
    """A cancel that arrived while this row was on the network.

    Raised where the bytes are held and nothing is filed yet, which is the last moment a
    row can be abandoned without leaving anything of itself in the case.
    """


def _place_for(case: Case, lat: float, lon: float) -> dict[str, Any]:
    """The place at this point, reused when one already stands there.

    Filed unnamed, by its coordinates, exactly as the composer files a proof's point: a
    place is the one entity in this app whose identity is a number, and two rows about the
    same spot are one pin. The sheet's own title names the *proof*, not the ground.
    """
    standing = satellite_engine.place_at(case, lat, lon, keyed_only=False)
    if standing is not None:
        return standing
    place = satellite_engine.save_place(
        case,
        lat,
        lon,
        by=build_engine.BY,
        extra_attrs={satellite_engine.COORD_KEY: satellite_engine.coord_key(lat, lon)},
    )
    # Never fatal, by construction: the lookup swallows a Nominatim that did not answer
    # and the Locate pass retries what it left `failed`. A point without a country is
    # still a point, and losing a hundred of them to one timeout would not be.
    locate_on_save(case, place["id"], lat, lon)
    return place


#: What each slot has somewhere to put. The panel is a picture — that is what a proof is
#: composed of — and the source is the footage. Which is also how a post carrying both is
#: told apart without asking: a hundred rows cannot each raise a picker.
_SLOT_WANTS = {import_engine.SLOT_PANEL: "image", import_engine.SLOT_SOURCE: "video"}


def _fetch(case: Case, token: str, slot: str, url: str) -> dict[str, Any]:
    """One download into the staging directory, with its failures named.

    The names matter more than usual here: a hundred rows cannot each raise a dialog, so
    what a row could not do has to be legible in one line of a log.

    **A post with several attachments is answered rather than refused.** That is the
    ordinary shape of the thing this road is for — a published geolocation is a picture,
    and the post carries the footage beside it — so the slot's own kind picks the one it
    has somewhere to put, and only a post holding nothing of that kind is a row to do by
    hand.
    """
    stage = import_engine.staging_dir(case, token)
    ensure_dir(stage)
    wants = _SLOT_WANTS.get(slot, "")
    try:
        result = media_engine.fetch_url(case, url, stage=stage, wants=wants)
    except media_engine.WrongKind as refusal:
        # The post was read and holds nothing this slot has room for. One line, because a
        # hundred rows cannot each raise a dialog and this one is actionable: the row goes
        # to the pile to do by hand.
        raise _RowFailed(str(refusal)) from refusal
    if result.get("multi"):
        return _every_file(case, token, slot, url, result, stage=stage)
    if result.get("needs_auth"):
        raise _RowFailed(_walled(result))
    staged = result.get("staged")
    if not staged:
        raise _RowFailed("nothing at that address could be downloaded")
    # Keyed by its address, so a row listing three of them holds three sets rather than
    # each one wiping the last.
    import_engine.fill_files(case, token, slot, [staged], for_url=url)
    return staged


#: What a slot can use out of a post carrying several attachments. A panel is a picture
#: by definition; material is whatever was recorded on the spot, which is why a still
#: photographed there counts and a PDF hanging off the post does not.
_SLOT_KINDS = {
    import_engine.SLOT_PANEL: ("image",),
    import_engine.SLOT_SOURCE: ("image", "video", "audio"),
}

#: What a row says the post was missing, in the words of what the slot is for.
_SLOT_MISSING = {import_engine.SLOT_PANEL: "image", import_engine.SLOT_SOURCE: "media"}


def _every_file(
    case: Case,
    token: str,
    slot: str,
    url: str,
    offered: dict[str, Any],
    *,
    stage: Any,
) -> dict[str, Any]:
    """Take the whole set a post carries, in the order it published it.

    A post that publishes a geolocation as several pictures — the overhead, the ground
    shot, the match — published *one* proof, and keeping the first of three keeps a third
    of it. They become the panels of one composition, which is what a proof already is.
    The material side answers the same way for the same reason: a post carrying two photos
    of the scene and the clip under them is three things that were shot there, and a
    hundred rows cannot each be asked which one counted.

    A slot takes only what it can use — pictures for the panels, anything recorded for the
    material — and a post holding none of it is a row to do by hand.
    """
    kinds = _SLOT_KINDS.get(slot, ())
    # Vouched for as the post's own, and of a kind this slot can use. A hundred rows
    # cannot each be asked whether the clip a post quotes belongs to the geolocation,
    # and taking it would file somebody else's video on this row's point.
    wanted = [
        item
        for item in offered.get("items") or []
        if item.get("kind") in kinds and item.get("own", True)
    ]
    if not wanted:
        held_count = len(offered.get("items") or [])
        # Named for what the slot was after rather than for the kind it prefers: the
        # material takes a photograph as readily as a clip, so "no video" would be a
        # refusal about the wrong thing.
        raise _RowFailed(
            f"that post holds {held_count} files and no {_SLOT_MISSING[slot]}, "
            "so pick one by hand"
        )
    held: list[dict[str, Any]] = []
    cap = import_engine.SLOT_CAPS[slot]
    for item in wanted[:cap]:
        # Asked for by its own kind: `wants="image"` is what reaches the image extractor
        # for a picture yt-dlp would answer with the clip quoted beside it.
        answer = media_engine.fetch_url(
            case, url, index=int(item["index"]), stage=stage, wants=str(item.get("kind") or "")
        )
        if answer.get("needs_auth"):
            raise _RowFailed(_walled(answer))
        staged = answer.get("staged")
        if staged:
            held.append(staged)
    if not held:
        raise _RowFailed("nothing could be downloaded from that address")
    import_engine.fill_files(case, token, slot, held, for_url=url)
    return held[0]


def _row_media(
    case: Case,
    decision: dict[str, Any],
    *,
    pov: bool,
    stopping: Any,
) -> dict[str, Any]:
    """A row with footage and a point but no published proof: the media, on its ground.

    Downloaded to staging and filed from there rather than straight into the case, so a
    row that stops halfway leaves the case untouched — the same order the proof road
    takes, for the same reason.
    """
    point = decision["point"]
    filed: list[dict[str, Any]] = []
    wanted: list[str] = []
    for url in decision["source_urls"]:
        held = build_engine.held_media(case, url)
        if held is None:
            wanted.append(url)
        else:
            filed.append(held)
    if wanted:
        token = import_engine.open_import(case)
        try:
            for url in wanted:
                _fetch(case, token, import_engine.SLOT_SOURCE, url)
            if stopping():
                raise _Stopped()
            pairs = import_engine.staged_pairs(case, token, import_engine.SLOT_SOURCE)
            if not pairs:
                raise _RowFailed("the download is no longer held")
            for path, staged in pairs:
                produced = media_engine.import_produced_file(
                    case, path, str(staged["filename"]), dict(staged.get("source") or {}),
                    by=build_engine.BY,
                )
                filed.append(produced["entity"])
        finally:
            import_engine.discard(case, token)
    place = _place_for(case, point["lat"], point["lon"])
    verb = build_engine.proof_verb(pov)
    # Each file states the point for itself: they were all recorded there, and an edge
    # standing on only the first would leave the rest off the map.
    for one in filed:
        _state(case, one["id"], place["id"], verb)
    made: dict[str, Any] = {"source": filed[0], "place": place}
    made.update({f"source {at + 2}": one for at, one in enumerate(filed[1:])})
    return made


def _row_proof(
    case: Case,
    case_id: str,
    decision: dict[str, Any],
    *,
    pov: bool,
    stopping: Any,
) -> dict[str, Any]:
    """A row with everything: the footage, the picture, the proof and the point.

    Written by `proofimports.write_import`, so the five edges are the ones a hand-made
    import writes and there is no second reading of them here.
    """
    point = decision["point"]
    if decision["action"] == "join":
        return _added_point(case, decision, pov=pov)
    form = {
        "title": decision["title"],
        # The canonical spelling of the point this row was planned on, rather than the
        # cell: the import reads coordinates with its own parser, and handing it the two
        # numbers is what keeps the plan and the press about the same spot.
        "coords": f"{point['lat']}, {point['lon']}",
        "source_urls": decision["source_urls"],
        "note": decision["note"],
        "pov": pov,
    }
    if decision["action"] == "update":
        return _restate_proof(case, case_id, decision, form, pov=pov)

    token = import_engine.open_import(case)
    try:
        for url in decision["source_urls"]:
            _fetch(case, token, import_engine.SLOT_SOURCE, url)
        _fetch(case, token, import_engine.SLOT_PANEL, decision["proof_url"])
        # The last moment this row is only bytes. Past it the media are filed and a cancel
        # can no longer mean "as if it never ran".
        if stopping():
            raise _Stopped()
        written = proofimports.write_import(case_id, token, form, by=build_engine.BY)
    finally:
        # A no-op once the import committed, since it discards its own directory; the
        # point of it is the row that stopped between the two downloads.
        import_engine.discard(case, token)
    made: dict[str, Any] = {}
    for slot in ("source", "panel"):
        entry = written.get(slot)
        if entry:
            made[slot] = {"id": entry["id"], "label": entry.get("label") or ""}
    proof = written.get("proof") or {}
    if proof.get("id"):
        made["proof"] = {"id": proof["id"], "label": proof.get("name") or ""}
    place = written.get("place")
    if place:
        made["place"] = place
    return made


def _added_point(case: Case, decision: dict[str, Any], *, pov: bool) -> dict[str, Any]:
    """A second row about a proof this press already built: its other point.

    The binder's cross-border shape — one video, one published picture, two places, so two
    lines. Composing the picture again under the second row's name would put two exports of
    one image in the case, and **a proof concludes on one point** by design: reopening it
    with different coordinates withdraws the first, or the case reads as two geolocations
    (ONTOLOGY §"Where a geolocation becomes a point").

    So the composition is not written twice — but the point still belongs to it. The
    published proof is what establishes both positions, and that is what the analyst is
    saying by writing two lines about one picture, so **the proof reaches this place too**.
    Written under this road's own provenance, so the graph says which press wrote it, and
    the composer **opens on it** rather than beside it (``satellite.open_spec``): the proof
    reads the same in the tool that made it as it does on the map. Which also means the
    composer can take it back — a row it shows is a row it owns
    (``satellite.restate_proof_point``), and a point nothing can delete is worse than one
    that was never offered.

    `depicts` and never `located-at`, whatever POV says: a proof was composed and recorded
    nowhere. POV picks the verb for the material, and only there.

    **Nothing to join is this row's own failure.** When the row above did not build — a dead
    link, a login wall, an extractor that said nothing — there is no proof and no material
    here, and writing a place while reporting the row as restated marked it done in the
    grid's log with its point resting on nothing. The next press would not take it again.
    """
    panel = build_engine.held_media(case, decision["proof_url"])
    sources = [
        one
        for one in (build_engine.held_media(case, url) for url in decision["source_urls"])
        if one is not None
    ]
    proof = build_engine.built_proof(case, decision["proof_url"])
    if proof is None and panel is None and not sources:
        raise _RowFailed("the row this one joins did not build")
    # Read before the place is filed, so a row with nothing to join leaves no bare pin
    # behind either.
    point = decision["point"]
    place = _place_for(case, point["lat"], point["lon"])
    verb = build_engine.proof_verb(pov)
    made: dict[str, Any] = {"place": place}
    named = [("panel", panel)] + [
        (f"source {at + 2}" if at else "source", one) for at, one in enumerate(sources)
    ]
    for slot, held in named:
        if held is None:
            continue
        _state(case, held["id"], place["id"], verb)
        made[slot] = held
    if proof is not None:
        _state(case, proof["id"], place["id"], link_engine.DEPICTS)
        made["proof"] = proof
    return made


def _restate_proof(
    case: Case, case_id: str, decision: dict[str, Any], form: dict[str, Any], *, pov: bool
) -> dict[str, Any]:
    """A second press over a proof this sheet already built: its point and its note.

    Nothing is fetched — the files are already in the case, and re-downloading them to
    learn what the case already knows is what the plan exists to avoid. The proof is saved
    through the composer's own route, so a corrected point moves its edges instead of
    stating a second geolocation.

    A blank note leaves the caption alone. The column says what the worklist knows about
    the row; an empty cell is nothing said, not an instruction to erase what somebody
    wrote in the composer.
    """
    proof = case.get_entity(str(decision["entity"] or ""))
    if proof is None:
        raise _RowFailed("that proof is no longer in the case")
    spec = dict(proofs.read_spec(case, proof))
    if not spec:
        raise _RowFailed("that proof's composition could not be read")
    # Through the engine rather than by hand: a proof composed with several points
    # holds a list, and setting the old field beside it would be read as nothing
    # said. A sheet row states one point, and this is how it says so.
    satellite_engine.state_points(spec, [{"coords": form["coords"], "pov": form["pov"]}])
    if form["note"]:
        panels = [dict(panel) for panel in spec.get("panels") or []]
        if panels:
            panels[0]["caption"] = form["note"]
            spec["panels"] = panels
    # The name follows the cell, which is what makes the Title column the proof's name
    # rather than a label it was given once. A rename moves the spec and the export; a name
    # another proof already holds is refused, and that refusal is this row's alone.
    standing = str(proof["label"])
    wanted = decision["title"] or standing
    saved = proofs.save_proof(
        case_id,
        proofs.ProofIn(
            title=wanted,
            spec=spec,
            rename_from=standing if layout.slugify(wanted, "Proof") != standing else None,
        ),
    )
    # The save already settled the point — it restates what a proof says on every save —
    # so the place is read off its answer rather than filed a second time. `None` there
    # means the case already held that point, which is the quiet common case.
    lat, lon = decision["point"]["lat"], decision["point"]["lon"]
    reported = saved.get("place") or {}
    filed = reported.get("filed") or []
    if filed:
        place = case.get_entity(str(filed[0]["id"]))
    elif reported.get("asking"):
        # `proof_place_auto` is off, so the composer's own save would have asked. The
        # analyst answered when they read the plan.
        filed = proofs.file_proof_points(case, proof)
        place = case.get_entity(str(filed[0]["id"])) if filed else None
    else:
        place = satellite_engine.place_at(case, lat, lon, keyed_only=False)
    return {
        "proof": {"id": proof["id"], "label": str(saved["name"])},
        "place": place,
    }


def _state(case: Case, subject: str, place: str, verb: str) -> None:
    """Put a file on its ground, skipping an edge the vocabulary refuses.

    A PDF cannot be `located-at` anywhere, and no reading of the two types alone rules it
    out — so the refusal is a fact about that row rather than a reason to lose the media
    it had just filed.
    """
    try:
        link_engine.add_relation(case, subject, place, verb, by=build_engine.BY)
    except CaseError:
        return
