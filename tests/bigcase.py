"""Synthetic large-case generator for storage and migration tests.

The fixture builds a repeatable legacy graph for the one-way SQLite importer.
It writes the import source once so large tests stay fast, then callers open it
through the same migration boundary as the application.

Standard library only, and it lives under ``tests/`` so hatchling never packages
it into the wheel or the frozen binaries (see the doc's packaging constraints).
"""

from __future__ import annotations

import json
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from azimut import config
from azimut.engine.media import THUMB_DIR
from azimut.layout import PRE_HIDDEN_SIDECAR_SUFFIX
from legacy_case import LEGACY_SUBDIRS
from azimut.workspace import Case, _slugify

# Well-known + deliberately unknown types, so the fixture exercises the "unknown
# entity/link types stay valid" rule the ontology promises.
_SEMANTIC_TYPES = (
    "person", "organization", "account", "email", "phone", "domain", "place",
    "ip", "vehicle", "vessel", "aircraft", "structure",
)
_UNKNOWN_TYPES = ("spacecraft", "widget", "signal")
_LINK_TYPES = ("appears-in", "located-at", "owns", "mentions", "posted", "same-as")

_BASE_TIME = datetime(2024, 1, 1, tzinfo=timezone.utc)


@dataclass
class BigCaseSummary:
    """What was planted so storage and release tests can assert against it."""

    case_id: str
    entities: int = 0
    links: int = 0
    media: int = 0
    media_files_missing: int = 0
    notes: int = 0
    artifacts: int = 0
    folders: int = 0
    tombstoned: int = 0
    derived_from_links: int = 0
    depends_on_links: int = 0
    sample_ids: list[str] = field(default_factory=list)


_FOLDER_TREE = (
    "Sources",
    "Sources/Telegram",
    "Sources/X",
    "Sources/Local",
    "People",
    "Places",
    "Work",
    "Work/Drafts",
    "Work/Confirmed",
)


def _stamp(offset: int) -> str:
    return (_BASE_TIME + timedelta(seconds=offset)).strftime("%Y-%m-%dT%H:%M:%SZ")


def _fake_sha(rng: random.Random) -> str:
    return "%064x" % rng.getrandbits(256)


def build_big_case(
    *,
    name: str = "Big synthetic case",
    entities: int = 10_000,
    links: int = 20_000,
    media: int = 5_000,
    notes: int = 200,
    artifacts: int = 300,
    seed: int = 1234,
    write_media_files: bool = True,
) -> tuple[Case, BigCaseSummary]:
    """Create a case under the configured workspace and fill it in one write.

    ``entities`` is the **total** entity count; ``media``/``notes``/``artifacts``
    are carved out of it and the rest are plain semantic entities. Everything is
    seeded, so the same arguments always produce byte-identical graph rows.
    """
    rng = random.Random(seed)
    # Build the legacy import source in one write. `Case.create` only makes
    # SQLite cases, so this fixture creates the directory directly and callers
    # open it through the one-way migration path.
    parent = config.cases_dir()
    parent.mkdir(parents=True, exist_ok=True)
    path = parent / _slugify(name)
    path.mkdir()
    # The flat, unwrapped shape on purpose: this is a legacy import source, and
    # opening it is what exercises the wrapper migration.
    for sub in LEGACY_SUBDIRS:
        (path / sub).mkdir()
    (path / "notes.md").write_text(f"# {name}\n\n", encoding="utf-8")
    case = Case(path)

    media = min(media, entities)
    notes = min(notes, entities - media)
    artifacts = min(artifacts, entities - media - notes)
    plain = entities - media - notes - artifacts

    summary = BigCaseSummary(case_id=case.id)
    rows: list[dict] = []
    ids: list[str] = []
    clock = 0

    def add(entity: dict) -> str:
        nonlocal clock
        entity["provenance"] = {
            "by": "tool" if rng.random() < 0.5 else "user",
            "at": _stamp(clock),
            "status": "suggested" if rng.random() < 0.2 else "confirmed",
        }
        clock += 1
        rows.append(entity)
        ids.append(entity["id"])
        return entity["id"]

    def pick_folder() -> str | None:
        # ~30% unfiled, the rest spread across the tree.
        return None if rng.random() < 0.3 else rng.choice(_FOLDER_TREE)

    media_dir = path / "media"  # flat: this fixture predates the wrapper
    thumb_dir = media_dir / THUMB_DIR

    # -- media entities (+ sidecars, placeholder bytes, thumbnail states) -----
    media_ids: list[str] = []
    for i in range(media):
        eid = f"e_media_{i:06d}"
        fname = f"img_{i:06d}.jpg"
        rel = f"media/{fname}"
        sha = _fake_sha(rng)
        attrs = {"path": rel, "sha256": sha, "kind": "image"}
        if rng.random() < 0.4:
            attrs["source_url"] = f"https://example.invalid/{i}"
        folder = pick_folder()
        if folder:
            attrs["folder"] = folder
        add({"id": eid, "type": "capture" if rng.random() < 0.3 else "media",
             "label": fname, "attrs": attrs})
        media_ids.append(eid)

        # ~10% of media reference a file that isn't on disk (missing source).
        if rng.random() < 0.1:
            summary.media_files_missing += 1
            continue
        if write_media_files:
            (media_dir / fname).write_bytes(b"\xff\xd8\xff\xe0synthetic-media")
            sidecar = {
                "filename": fname,
                "kind": "image",
                "sha256": sha,
                "size": 16,
                "added_at": _stamp(clock),
                "source": {"url": attrs.get("source_url")} if "source_url" in attrs else {},
                "thumbnail": f"media/{THUMB_DIR}/{fname}.jpg",
            }
            (media_dir / (fname + PRE_HIDDEN_SIDECAR_SUFFIX)).write_text(  # legacy shape
                json.dumps(sidecar, ensure_ascii=False), encoding="utf-8"
            )
            roll = rng.random()
            if roll < 0.7:  # ready
                thumb_dir.mkdir(parents=True, exist_ok=True)
                (thumb_dir / (fname + ".jpg")).write_bytes(b"\xff\xd8\xff\xe0thumb")
            elif roll < 0.8:  # corrupt: truncated header, decode will fail
                thumb_dir.mkdir(parents=True, exist_ok=True)
                (thumb_dir / (fname + ".jpg")).write_bytes(b"\xff\xd8")
            # else: missing thumbnail — nothing written
    summary.media = media

    # -- file-backed notes ----------------------------------------------------
    note_dir = path / "notes"
    note_dir.mkdir(parents=True, exist_ok=True)
    for i in range(notes):
        eid = f"e_note_{i:06d}"
        rel = f"notes/{eid}.md"
        (path / rel).write_text(f"# Note {i}\n\nSynthetic body {i}.\n", encoding="utf-8")
        attrs = {"folder": pick_folder() or "", "path": rel}
        add({"id": eid, "type": "note", "label": f"Note {i}", "attrs": attrs})
    summary.notes = notes

    # -- plain semantic + unknown-typed entities ------------------------------
    for i in range(plain):
        eid = f"e_ent_{i:06d}"
        etype = (
            rng.choice(_UNKNOWN_TYPES) if rng.random() < 0.05
            else rng.choice(_SEMANTIC_TYPES)
        )
        attrs: dict = {}
        folder = pick_folder()
        if folder:
            attrs["folder"] = folder
        if etype == "place" and rng.random() < 0.5:
            attrs["lat"] = round(rng.uniform(-60, 60), 6)
            attrs["lon"] = round(rng.uniform(-180, 180), 6)
        add({"id": eid, "type": etype, "label": f"{etype.title()} {i}", "attrs": attrs})

    # -- proof / post / inspect artifacts (derivation sources) ----------------
    artifact_ids: list[str] = []
    links_rows: list[dict] = []
    derived = depends = 0
    lclock = 0

    def add_link(src: str, dst: str, ltype: str) -> None:
        nonlocal lclock
        links_rows.append({
            "id": f"l_{lclock:06d}",
            "from": src,
            "to": dst,
            "type": ltype,
            "provenance": {"by": "tool", "at": _stamp(lclock), "status": "confirmed"},
        })
        lclock += 1

    for i in range(artifacts):
        kind = rng.choice(("proof", "post", "inspect-session"))
        eid = f"e_art_{i:06d}"
        if kind == "proof":
            attrs = {"spec": f"proofs/proof_{i:06d}.json"}
        elif kind == "post":
            attrs = {"draft": f".drafts/draft_{i:06d}.json"}
        else:
            attrs = {"spec": f"inspect/session_{i:06d}.json"}
        folder = pick_folder()
        if folder:
            attrs["folder"] = folder
        add({"id": eid, "type": kind, "label": f"{kind} {i}", "attrs": attrs})
        artifact_ids.append(eid)

        # Wire a real derivation so plan_delete / tombstones have structure:
        # inspect-session depends-on its media; proof/post derived-from theirs.
        if media_ids:
            src = rng.choice(media_ids)
            if kind == "inspect-session":
                add_link(eid, src, "depends-on")
                depends += 1
            else:
                add_link(eid, src, "derived-from")
                derived += 1
    summary.artifacts = artifacts

    # -- fill the rest of the links budget with semantic edges ----------------
    while len(links_rows) < links and len(ids) >= 2:
        a, b = rng.sample(ids, 2)
        add_link(a, b, rng.choice(_LINK_TYPES))
    summary.derived_from_links = derived
    summary.depends_on_links = depends

    # -- a handful of tombstones (missing-source scars) on some artifacts -----
    for eid in rng.sample(artifact_ids, min(len(artifact_ids), max(1, artifacts // 20))):
        entity = next(e for e in rows if e["id"] == eid)
        entity["attrs"]["lost_sources"] = [{
            "path": f"media/gone_{rng.randrange(10_000):05d}.jpg",
            "sha256": _fake_sha(rng),
            "at": _stamp(clock),
        }]
        summary.tombstoned += 1

    # -- folders: the tree, plus every folder any entity was filed under ------
    used = {e["attrs"]["folder"] for e in rows if e["attrs"].get("folder")}
    folders: set[str] = set(_FOLDER_TREE)
    for path in used:
        parts = path.split("/")
        for j in range(1, len(parts) + 1):
            folders.add("/".join(parts[:j]))
    folder_list = sorted(folders, key=str.lower)

    data = {
        "azimut": {"schema": 2, "storage": "json"},
        "name": name,
        "created_at": _stamp(0),
        "updated_at": _stamp(clock),
        "folders": folder_list,
        "entities": rows,
        "links": links_rows,
    }
    # `path` is shadowed by the folder loop above; the case root is `case.path`.
    (case.path / "case.json").write_text(  # still the unwrapped location
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    summary.entities = len(rows)
    summary.links = len(links_rows)
    summary.folders = len(folder_list)
    summary.sample_ids = ids[:5]
    return case, summary
