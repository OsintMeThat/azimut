"""A geolocation index into proofs: the one road out of a sheet that fetches bytes.

Every other road from a sheet is a reading of what the analyst typed. This one goes and
gets the files two of the columns point at, so it is not a mode of the pass and never
will be: the pass is one transaction because nothing in it touches the network, and a
transaction held open across a hundred downloads would lock the case for minutes.

**What a row states.** Three columns and a note: the footage that was filmed on the spot,
the picture the geolocation was published as, the point, and what to call the result. What
the row becomes depends on how much of that it holds:

===============================  ===============================================
the row holds                    what is written
===============================  ===============================================
coordinates alone                a ``place``
coordinates and a source         the media, posed on that place
coordinates, source and proof    the whole constellation `engine/proofimport` writes
a proof with no source           refused: a geolocation nobody can check
a source or a proof, no point    refused: no geolocation without a point
a proof with no title            refused: a proof without a name is a file without one
===============================  ===============================================

The fourth is stricter than importing one post by hand, which accepts a proof whose
footage would not download and says so in a warning. Deliberate: a binder holds dozens of
those and nobody re-reads them one by one, so a line without the video is a line nobody
will ever verify.

**Planned before it is pressed, and the plan downloads nothing.** Which is what makes it
readable at all: the three refusals are decided from the cells, and the three "already
there" answers are read off the case — a proof by the name it would be saved under, a
media by the page it was downloaded from, a place by its point. So a second press knows
it has nothing to fetch before it fetches anything.

**A hundred rows a press**, against five hundred for the pass, because these are a hundred
downloads. The door says how many are left over so the cap reads as a queue rather than a
breakdown.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from .. import layout
from . import links as link_engine
from . import satellite as satellite_engine
from . import sheetroles
from .sheetpromote import ERROR, JOIN, MAKE, SKIP, UPDATE, counts_of, urls_in
from .proofimport import MAX_SOURCES
from .sheets import SheetError, key_index

if TYPE_CHECKING:
    from ..workspace import Case

#: Provenance on everything this road files, so the graph says which press wrote it.
BY = "sheet-proofs"

#: How many rows one press may take. A fifth of `MAX_PROMOTED`, because each of these
#: is a download rather than a row of arithmetic, and a press an analyst cannot watch to
#: the end is a press they cannot cancel meaningfully either.
MAX_ROWS = 100

#: Which states are left out unless the analyst says otherwise. One word, and the one that
#: means the row was looked at and dropped — a filter that hid anything more would be
#: deciding for them.
SKIPPED_STATES = ("ruled out",)

#: What the media a row downloads means about the point, and it is a choice about the
#: whole press: `located-at` says the camera was there, `depicts` says the frame shows it.
POV_VERB = "located-at"
SHOWS_VERB = "depicts"


@dataclass(frozen=True)
class _Build:
    """A validated declaration: which column holds what, and how the press reads them."""

    columns: list[str]
    rows: list[list[str]]
    keys: list[str]
    key_at: int
    title: str
    source: str
    proof: str
    point: str
    note: str
    status: str
    #: The states left out of this press, folded, empty when nothing is.
    left_out: set[str]
    pov: bool


def read(
    *,
    columns: list[str],
    rows: list[list[str]],
    keys: list[str],
    title: str,
    source: str,
    proof: str,
    point: str,
    note: str = "",
    status: str = "",
    skip_states: list[str] | None = None,
    pov: bool = False,
) -> _Build:
    """Read one declaration, or refuse it at the door with the reason.

    The cap is said here rather than in the press, and it says what is left: a limit that
    only refuses reads as a fault, where the same limit naming the remainder reads as the
    queue it is.
    """
    if len(keys) > MAX_ROWS:
        left = len(keys) - MAX_ROWS
        raise SheetError(
            f"{MAX_ROWS} rows a press, because each one is a download. "
            f"Send these and press again for the other {left}."
        )
    for name in (title, source, proof, point, note, status):
        if name and name not in columns:
            raise SheetError(f"this sheet has no column '{name}'")
    if not point:
        raise SheetError("a build needs the column holding the coordinates")
    if not proof and not source:
        raise SheetError("a build needs the column holding the addresses to fetch")
    named = [name for name in (title, source, proof, point, note, status) if name]
    if len(set(named)) != len(named):
        raise SheetError("each column can only be one thing in a build")
    return _Build(
        columns=columns,
        rows=rows,
        keys=keys,
        key_at=key_index(columns),
        title=title,
        source=source,
        proof=proof,
        point=point,
        note=note,
        status=status,
        # `None` is "the analyst did not say", `[]` is "they said none" — two different
        # answers, and folding them together is what makes a default impossible to undo.
        left_out={
            word.strip().casefold()
            for word in (SKIPPED_STATES if skip_states is None else skip_states)
            if word
        },
        pov=bool(pov),
    )


def proof_verb(pov: bool) -> str:
    """The verb the material takes towards the point. The proof itself always `depicts`:
    it was composed, never recorded anywhere, which is what the registry says too."""
    return POV_VERB if pov else SHOWS_VERB


# -- what one press would do ---------------------------------------------------


def plan(case: "Case", **asked: Any) -> dict[str, Any]:
    """Row by row, what a build would write, with nothing downloaded and nothing written.

    Read by the screen the analyst confirms and by the press itself, so the two cannot
    drift into two readings of the same rows. The same five words every other road in this
    app answers in, which here mean: file it, it is already filed, refresh what it says,
    leave it alone, or this row cannot be read.
    """
    reading = read(**asked)
    wanted = set(reading.keys)
    claimed = _Claimed()
    planned: list[dict[str, Any]] = []
    for row in reading.rows:
        key = _key_of(row, reading.key_at)
        if key not in wanted:
            continue
        planned.append(_decide(case, reading, row, key, claimed))
    return {
        "rows": planned,
        "counts": counts_of(planned),
        "pov": reading.pov,
        "verb": proof_verb(reading.pov),
    }


class _Claimed:
    """What earlier rows of this same press have taken, so the plan sees itself.

    Two rows are two proofs, one proof, or a collision, and which one they are is not
    something either row can answer alone:

    - **the same published address** is one proof seen at two points. The binder's own
      shape: a cross-border strike is two lines because it happened at two places, and
      one picture was published about it. The second row adds its point to the material
      rather than composing the picture a second time under another name.
    - **the same name over two addresses** is a collision. A proof's name is its filename,
      so the second would write over the first — refused, as the single-post import
      refuses a name already taken.
    """

    __slots__ = ("by_url", "by_name")

    def __init__(self) -> None:
        self.by_url: dict[str, str] = {}
        self.by_name: set[str] = set()


def _decide(
    case: "Case", reading: _Build, row: list[str], key: str, claimed: _Claimed
) -> dict[str, Any]:
    title = _cell(row, reading.columns, reading.title).strip()
    coords = _cell(row, reading.columns, reading.point).strip()
    # Every address the cell holds, because a geolocation states one point and rests on
    # whatever was shot at it: the photos, the clip, the second angle. There is no `+` in
    # a spreadsheet, so a cell listing them is how a hundred rows say it. The published
    # picture stays one: a row builds one proof, and two pictures would be two.
    source_urls = urls_in(_cell(row, reading.columns, reading.source))[:MAX_SOURCES]
    source_url = source_urls[0] if source_urls else ""
    proof_url = _first_url(_cell(row, reading.columns, reading.proof))
    state = _cell(row, reading.columns, reading.status).strip().casefold()
    decision: dict[str, Any] = {
        "key": key,
        "action": SKIP,
        "title": title,
        "coords": coords,
        "point": None,
        "source_urls": source_urls,
        #: The first of them, which is what the questions asked of one file ask about:
        #: whether the row has any material at all, and what to name in a refusal.
        "source_url": source_url,
        "proof_url": proof_url,
        "note": _cell(row, reading.columns, reading.note).strip(),
        "writes": "",
        "reason": "",
        "entity": None,
        "entity_label": "",
    }

    if reading.status and state and state in reading.left_out:
        decision["reason"] = f"left out on its status: {state}"
        return decision
    if not coords and not source_url and not proof_url:
        decision["reason"] = "nothing to build from"
        return decision

    point = sheetroles.parse_latlon(coords) if coords else None
    if coords and point is None:
        decision.update(action=ERROR, reason=f"'{coords}' is not a position Azimut can read")
        return decision
    if point is not None and point["out_of_bounds"]:
        decision.update(action=ERROR, reason=f"'{coords}' is not a position on the earth")
        return decision
    if point is None:
        decision.update(action=ERROR, reason="a geolocation needs a point")
        return decision
    decision["point"] = {"lat": point["lat"], "lon": point["lon"]}

    if proof_url and not source_url:
        decision.update(action=ERROR, reason="a proof needs the footage it was read from")
        return decision
    if proof_url and not title:
        decision.update(action=ERROR, reason="a proof needs a name")
        return decision

    if proof_url:
        name = layout.slugify(title, "Proof")
        first = claimed.by_url.get(proof_url)
        if first is not None:
            # One picture, two points: the row above composes it, this one only says the
            # material is seen here too. Filing the proof twice would put two exports of
            # the same image in the case under two names.
            decision.update(
                action=JOIN,
                entity_label=first,
                writes="its point, on the proof the row above builds",
                reason=f"the same published proof as '{first}': only its point is added",
            )
            return decision
        if name in claimed.by_name:
            decision.update(
                action=ERROR, reason=f"another row of this press is already called '{name}'"
            )
            return decision
        claimed.by_url[proof_url] = name
        claimed.by_name.add(name)
        # By where it was published first, by its name second: the address is what a proof
        # *is*, and the name is a cell somebody may have corrected since.
        held = built_proof(case, proof_url) or case.find_entity(
            attr="spec", value=layout.proof_spec_rel(name)
        )
        decision["writes"] = "a proof, its two files and its point"
        if held is not None:
            built_as = str(held.get("label") or name)
            decision.update(
                action=UPDATE,
                entity=held["id"],
                entity_label=built_as,
                reason=(
                    f"already built as '{built_as}': renamed, and its point and note refreshed"
                    if built_as != name
                    else "already built: its point and its note are refreshed"
                ),
            )
        else:
            decision["action"] = MAKE
        return decision

    if source_urls:
        decision["writes"] = (
            "the footage, posed on its point"
            if len(source_urls) == 1
            else f"{len(source_urls)} files, posed on one point"
        )
        # All of them or none: a row half-downloaded is a row to run, and calling it
        # "already there" on the strength of its first address would leave the rest out.
        downloaded = [held_media(case, one) for one in source_urls]
        leading = downloaded[0]
        if leading is not None and all(one is not None for one in downloaded):
            decision.update(
                action=JOIN,
                entity=leading["id"],
                entity_label=str(leading.get("label") or ""),
                reason="already downloaded: only its point is restated",
            )
        else:
            decision["action"] = MAKE
        return decision

    decision["writes"] = "a place"
    standing = satellite_engine.place_at(case, point["lat"], point["lon"], keyed_only=False)
    if standing is not None:
        decision.update(
            action=JOIN,
            entity=standing["id"],
            entity_label=str(standing.get("label") or ""),
            reason="this point is already in the case",
        )
    else:
        decision["action"] = MAKE
    return decision


#: The types that mean "the app already fetched this address". A `bookmark` records a page
#: rather than a file, and a `post` is a different thing to have of it — reading either as
#: the footage would leave the row believing it holds a video it never downloaded.
FETCHED_TYPES = ("media", "capture")


def built_proof(case: "Case", proof_url: str) -> dict[str, Any] | None:
    """The proof already built from this published address, whatever it is called now.

    **A built proof is identified by where it was published, not by its name.** The name
    is a cell an analyst edits, and keying on it makes a corrected title a second proof
    rather than a rename — and, worse, makes two rows publishing *one* picture under two
    titles two separate proofs of the same image.

    Read off the panel: the picture was downloaded from that address and records it
    (`attrs.source_url`), and the proof is what composes it.
    """
    panel = held_media(case, proof_url)
    if panel is None:
        return None
    for link in case.links_of(panel["id"]):
        if link["to"] != panel["id"] or link["type"] != link_engine.DERIVED_FROM:
            continue
        composing = case.get_entity(link["from"])
        if composing is not None and composing.get("type") == "proof":
            return composing
    return None


def held_media(case: "Case", url: str) -> dict[str, Any] | None:
    """The file the case already downloaded from this address, or None.

    What makes a second press cost nothing: the page a download came from is recorded on
    the file (`attrs.source_url`), so the question "do we already have this" is asked of
    the case rather than of the network.
    """
    found = case.find_entity(attr="source_url", value=url)
    return found if found is not None and found.get("type") in FETCHED_TYPES else None


#: The three answers that mean the press has work to do on this row.
DOING = (MAKE, JOIN, UPDATE)


def _key_of(row: list[str], at: int) -> str:
    return row[at] if at < len(row) else ""


def _cell(row: list[str], columns: list[str], name: str) -> str:
    if not name or name not in columns:
        return ""
    at = columns.index(name)
    return str(row[at]) if at < len(row) else ""


def _first_url(text: str) -> str:
    """The first address a cell holds. A cell of a `url` column may hold a sentence around
    it, and which of two addresses is the footage is not a question a hundred rows can be
    asked — so the first one, the way `urls_in` reads a column of sources."""
    found = urls_in(text)
    return found[0] if found else ""
