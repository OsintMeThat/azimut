"""The Case workspace as a 0.3.1 analyst left it, and how that case reads.

`fullcase.py` plants one artifact per tool so the Trash and bundle gates see
everything a case can own. This builds on it for the other question a rework of
the Board, Graph and Timeline has to answer: does a case made before the rework
still read the same after it? So it adds what those three surfaces keep — saved
readings of every surface, Live and Snapshot, in both Timeline modes, with tracks
that hide, pin and add Media; dated, undated and unplaced Claims; a kept Detect
pin and a proof date, which are Claims of their own; Notebook mentions, a promoted
Sheet row and entity galleries.

`read_workspace` answers what those surfaces show, with ids replaced by
`type:label` and the moment of the build scrubbed, so the reading of one build can
be compared with the recorded one (`fixtures/case-workspace-0.3.1.json`).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fullcase import FullCase, build_full_case

GOLDEN = Path(__file__).parent / "fixtures" / "case-workspace-0.3.1.json"

#: The window every saved reading looks at, around the dates planted below.
WINDOW = {"from": "2026-07-01", "to": "2026-09-01"}


@dataclass
class WorkspaceCase:
    full: FullCase
    claims: dict[str, str] = field(default_factory=dict)  # statement -> id
    temporal: dict[str, str] = field(default_factory=dict)  # statement -> temporal row id
    views: dict[str, str] = field(default_factory=dict)  # name -> id
    detect_claim: str = ""
    dated_proof: str = ""
    promoted: str = ""


def _ok(response, what: str) -> dict[str, Any]:
    assert response.status_code == 200, f"{what}: {response.text}"
    return response.json()


def build_workspace_case(client) -> WorkspaceCase:
    from azimut.engine import workqueue

    # This fixture represents 0.3.1, before retyping and merge journals existed.
    full = build_full_case(client, name="Case workspace", subject_changes=False)
    ws = WorkspaceCase(full=full)
    case_id = full.case_id
    base = f"/api/cases/{case_id}"
    photo = _ok(
        client.get(f"{base}/entities/lookup", params={"attr": "path", "value": full.photo}),
        "photo",
    )["entity"]["id"]

    # -- a photograph that says when its camera took it -----------------------
    # A file date, on the Media track: the one a rework must stop confusing with
    # the analyst's. EXIF keeps the camera's clock without an offset, so it is a
    # reading the UTC axis cannot place.
    import io

    from PIL import Image

    shot = Image.new("RGB", (64, 48), (90, 110, 130))
    exif = Image.Exif()
    exif.get_ifd(0x8769)[36867] = "2026:08:01 13:58:00"
    buf = io.BytesIO()
    shot.save(buf, "JPEG", exif=exif)
    _ok(client.post(f"{base}/media/upload",
                    files={"file": ("harbour.jpg", io.BytesIO(buf.getvalue()), "image/jpeg")}),
        "dated photo")

    # -- Claims through the Timeline's own endpoint, one per date shape -------
    def claim(statement: str, **body: Any) -> str:
        saved = _ok(client.post(f"{base}/timeline/claims", json={"statement": statement, **body}),
                    statement)
        ws.claims[statement] = saved["entity"]["id"]
        ws.temporal[statement] = saved["temporal"]["id"]
        return saved["entity"]["id"]

    claim("Convoy crossed the east bridge", when="2026-08-01T14:05:00Z",
          time_role="occurred", confidence="certain",
          about=[full.vessel_id], at=[full.place_id], cites=[photo])
    claim("Quay 4 warehouse burned", when="2026-07-30/2026-08-02",
          time_role="occurred", confidence="probable",
          about=[full.structure_id], at=[full.place_id], cites=[full.bookmark_id])
    claim("Recruitment announced", when="2026-07", confidence="possible",
          about=[full.account_id], cites=[full.bookmark_id])
    claim("Vessel seen leaving around the first", when="2026-08-01~",
          time_role="observed", about=[full.vessel_id], at=[full.place_id])
    claim("Night strike on the quay", when="2026-08-03T22:10:00+03:00",
          confidence="refuted", about=[full.structure_id], at=[full.place_id])
    claim("Crew list circulated", when="2026-08-05",
          about=[full.person_id], cites=[full.note_id])
    # Undated: it is waiting for a date, which is the Overview's "No date yet".
    claim("Owner changed the flag", about=[full.vessel_id, full.org_id])
    # Unplaced: a local wall-clock time is a date the axis cannot place in UTC.
    claim("Harbour master called in", when="2026-08-02T08:30:00",
          about=[full.person_id])
    # A suggestion, filed the way an importer files one.
    suggested = _ok(client.post(f"{base}/entities", json={
        "type": "claim", "label": "Second convoy suggested", "status": "suggested",
        "attrs": {"when": "2026-08-06", "confidence": "possible"},
    }), "suggested claim")["id"]
    ws.claims["Second convoy suggested"] = suggested

    # -- a proof that states when its material was taken ----------------------
    import base64
    from fullcase import _png

    dated = _ok(client.post(f"{base}/proofs", json={
        "title": "Bridge proof",
        "png_base64": base64.b64encode(_png(size=(200, 120), color=(30, 90, 60))).decode(),
        "spec": {
            "panels": [{"id": "p0", "src": full.piece, "natural": [60, 60]}],
            "shapes": [], "pastes": [],
            "when": "2026-07-31T16:20:00Z",
        },
    }), "dated proof")
    ws.dated_proof = dated["name"]

    # -- a kept Detect pin, which dates itself on a Claim at the pin ----------
    run_id = Path(full.analyzer_run).stem.split("-", 1)[1]
    run = _ok(client.get(f"{base}/analysis/runs/{run_id}"), "run")
    assert run["results"], "the full case's run found a candidate to keep"
    kept = _ok(client.post(
        f"{base}/analysis/runs/{run_id}/results/{run['results'][0]['id']}/promote",
        json={"title": "Levelled yard"},
    ), "kept pin")
    ws.detect_claim = (kept["claim"] or {}).get("id", "")
    assert ws.detect_claim, "keeping a dated candidate states when on a Claim"

    # -- a Sheet row promoted into the case ----------------------------------
    units = _ok(client.post(f"{base}/sheets", json={"title": "Units"}), "units sheet")
    promoted = _ok(client.post(f"{base}/sheets/{units['id']}/promote", json={
        "columns": ["id", "Unit", "Notes"],
        "rows": [["r1", "3rd Harbour Brigade", "seen at the quay"]],
        "meta": {},
        "keys": ["r1"],
        "subject": {"column": "Unit", "type": "organization", "fields": {}, "attach": {},
                    "skip": [], "group": False, "group_label": None},
        "point": "",
        "addresses": "",
    }), "promote")
    ws.promoted = promoted["meta"]["links"]["r1"]["Unit"]

    # -- Notebook mentions: the running notes and a filed note ----------------
    _ok(client.put(f"{base}/notes", json={"text": (
        "# Case workspace\n\n"
        f"Owner is [[entity:{full.org_id}|Northwind Shipping]], "
        f"crew named by [[entity:{full.person_id}|A. Nadeau]].\n\n"
        f"[[media:{full.photo}]]\n"
    )}), "notes")
    _ok(client.put(f"{base}/notes/{full.note_id}", json={
        "text": f"# Witness\n\nSaw [[entity:{full.vessel_id}|MV Aurora]] leave.\n",
    }), "filed note")

    # -- saved readings: every surface, Live and Snapshot, both Timeline modes --
    def view(name: str, surface: str, mode: str, spec: dict[str, Any]) -> None:
        saved = _ok(client.post(f"{base}/analysis-views", json={
            "name": name, "surface": surface, "mode": mode, "spec": spec,
        }), name)
        ws.views[name] = saved["id"]

    ws.views["People in review"] = full.analysis_view_id
    ws.views["Chronology in review"] = full.timeline_view_id
    actors = {
        "query": {
            "filter": {"families": ["actor"]},
            "terms": {"type": "person,organization"},
            "label": "People and organizations",
        },
        "board": {"order": "label", "sortKey": "label", "sortDesc": False},
    }
    view("Actors frozen", "board", "snapshot", actors)
    view("Fleet graph", "graph", "live", {
        "query": {"filter": {"families": ["asset", "actor"]},
                  "terms": {"type": "vessel,organization,structure"}},
        "graph": {"lens": "all", "hops": 2, "kept": [full.vessel_id],
                  "arrangement": [{"id": full.vessel_id, "x": 40, "y": -12}],
                  "camera": {"x": 10, "y": 20, "zoom": 1.25}},
    })
    view("Fleet graph frozen", "graph", "snapshot", {
        "query": {"filter": {"families": ["asset"]}, "terms": {"type": "vessel,structure"}},
        "graph": {"lens": "all", "hops": 1},
    })
    media_tracks = [
        {"id": "events", "label": "Events", "categories": ["statement"],
         "pinned": [ws.temporal["Recruitment announced"]],
         "hidden": [ws.temporal["Crew list circulated"]]},
        {"id": "media", "label": "Media", "categories": ["media"], "color": "blue"},
        {"id": "preset-vessel", "label": "Vessel", "categories": ["statement"],
         "query": {"relation": "about", "terms": {"type": "vessel"},
                   "filter": {"types": ["vessel"]}}},
        {"id": "preset-activity", "label": "Case activity", "categories": ["case_activity"],
         "collapsed": True},
    ]
    view("Chronology with media", "timeline", "live", {"timeline": {
        **WINDOW, "view_mode": "plot", "zone_choice": "zone:Europe/Kyiv",
        "timezone": "Europe/Kyiv", "tracks": media_tracks,
    }})
    view("Chronology as list", "timeline", "live", {"timeline": {
        **WINDOW, "view_mode": "list", "group_by": "subject", "tracks": media_tracks[:2],
    }})
    view("Chronology frozen", "timeline", "snapshot", {"timeline": {
        **WINDOW, "view_mode": "plot", "tracks": media_tracks[:3],
    }})
    view("Chronology list frozen", "timeline", "snapshot", {"timeline": {
        **WINDOW, "view_mode": "list", "tracks": media_tracks[:1],
    }})
    # A Timeline view saved without tracks: the server gave it its default ones.
    view("Chronology defaults", "timeline", "live", {"timeline": dict(WINDOW)})

    workqueue.wait_until_idle(timeout=20)
    return ws


# -- reading ----------------------------------------------------------------------

#: Written by the build itself, so different on every run and on nobody's screen as
#: a fact about the case.
_VOLATILE_KEYS = {
    "created_at", "updated_at", "captured_at", "reviewed_at", "mtime", "revision",
    "stamp", "modified", "size", "bytes", "etag", "fetched", "engine_version",
}
_ISO = re.compile(
    r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?"
)
_COMPACT = re.compile(r"(?<!\d)(\d{8})[-_T]?(\d{6})(?!\d)")


def _recent(match: str, now: datetime) -> bool:
    text = match.replace(" ", "T")
    try:
        value = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return False
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return abs(now - value) < timedelta(days=2)


def _scrub(text: str, names: dict[str, str], now: datetime | None = None) -> str:
    now = now or datetime.now(timezone.utc)
    for ident in sorted(names, key=len, reverse=True):
        if ident in text:
            text = text.replace(ident, names[ident])
    text = _ISO.sub(lambda m: "<now>" if _recent(m.group(0), now) else m.group(0), text)

    def compact(m: re.Match[str]) -> str:
        day, clock = m.group(1), m.group(2)
        stamp = f"{day[:4]}-{day[4:6]}-{day[6:]}T{clock[:2]}:{clock[2:4]}:{clock[4:]}"
        return "<now>" if _recent(stamp, now) else m.group(0)

    return _COMPACT.sub(compact, text)


def _normal(value: Any, names: dict[str, str], now: datetime) -> Any:
    if isinstance(value, dict):
        return {
            _scrub(str(key), names, now): _normal(item, names, now)
            for key, item in sorted(value.items())
            if key not in _VOLATILE_KEYS
        }
    if isinstance(value, list):
        return [_normal(item, names, now) for item in value]
    if isinstance(value, str):
        return _scrub(value, names, now)
    return value


def _row(item: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    """One timeline row as the axis and the list read it, ids named so that rows and
    their connectors sort the same way on every build."""
    def named(key: str) -> list[str]:
        return sorted(_scrub(e.get("id", ""), names) for e in item.get(key) or [])

    return {
        key: _scrub(item[key], names) if isinstance(item.get(key), str) else item.get(key)
        for key in (
            "id", "owner_id", "category", "kind", "label", "raw", "earliest", "latest",
            "precision", "time_role", "status", "confidence", "parse_error",
        )
        if key in item
    } | {
        "subjects": named("subject_entities"),
        "places": named("place_entities"),
        "sources": named("source_entities"),
    }


def _written_now(row: dict[str, Any]) -> bool:
    """Rows dated by the build itself: when a file or an entity was filed."""
    return row.get("kind") in {"added", "filed"}


def _timeline_rows(client, base: str, names: dict[str, str], **params: Any) -> dict[str, Any]:
    rows: list[dict[str, Any]] = []
    cursor = None
    while True:
        page = _ok(client.get(f"{base}/timeline", params={
            **params, "limit": 200, **({"cursor": cursor} if cursor else {}),
        }), "timeline")
        rows.extend(_row(item, names) for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    return {
        "rows": sorted((r for r in rows if not _written_now(r)), key=lambda r: r["id"]),
        "undated": page["undated"],
        "unplaced": page["unplaced"],
    }


def _labels(client, base: str, terms: dict[str, Any]) -> list[str]:
    page = _ok(client.get(f"{base}/catalog/entities", params={**terms, "limit": 500}), "catalog")
    return sorted(f"{e['type']}:{e['label']}" for e in page["items"])


def _snapshot(snapshot: dict[str, Any], names: dict[str, str]) -> dict[str, Any]:
    return {
        "entities": sorted(_scrub(e["id"], names) for e in snapshot.get("entities") or []),
        "links": sorted(
            _scrub(f"{link['from']} {link['type']} {link['to']}", names)
            for link in snapshot.get("links") or []
        ),
        "timeline_items": sorted(
            (_row(item, names) for item in snapshot.get("timeline_items") or []
             if not _written_now(item)),
            key=lambda r: r["id"],
        ),
        "timeline_tracks": {
            track: sorted(_scrub(one, names) for one in ids)
            for track, ids in (snapshot.get("timeline_tracks") or {}).items()
        },
    }


def read_workspace(client, ws: WorkspaceCase) -> dict[str, Any]:
    """What the Board, Graph and Timeline show of this case, id-free."""
    from azimut.workspace import Case

    case_id = ws.full.case_id
    base = f"/api/cases/{case_id}"
    case = Case.open(case_id)
    names = {e["id"]: f"{e['type']}:{e['label']}" for e in case.list_entities()}
    names.update({ident: f"view:{name}" for name, ident in ws.views.items()})
    names[case_id] = "case"
    names[Path(ws.full.analyzer_run).stem.split("-", 1)[1]] = "run"
    names[ws.full.entity_photo_id] = "image:direct"
    now = datetime.now(timezone.utc)

    views: dict[str, Any] = {}
    readings: dict[str, Any] = {}
    for summary in _ok(client.get(f"{base}/analysis-views"), "views")["views"]:
        stored = _ok(client.get(f"{base}/analysis-views/{summary['id']}"), summary["name"])
        spec = dict(stored["spec"])
        if "snapshot" in spec:
            spec["snapshot"] = _snapshot(spec["snapshot"], names)
        views[stored["name"]] = {
            "surface": stored["surface"], "mode": stored["mode"], "spec": spec,
        }
        if stored["mode"] != "live":
            continue
        if stored["surface"] == "timeline":
            timeline = spec["timeline"]
            readings[stored["name"]] = {
                track["id"]: _timeline_rows(
                    client, base, names,
                    **{"from": timeline["from"], "to": timeline["to"]},
                    category=track["categories"],
                    track=json.dumps({**track["query"], "hidden": track["hidden"]}),
                )
                for track in timeline["tracks"]
            }
        else:
            readings[stored["name"]] = _labels(client, base, spec["query"]["terms"])

    claims = {}
    for entity in case.list_entities():
        if entity["type"] != "claim":
            continue
        connectors: dict[str, list[str]] = {}
        for link in case.links_of(entity["id"]):
            if link["from"] == entity["id"]:
                connectors.setdefault(link["type"], []).append(link["to"])
        claims[entity["label"]] = {
            "status": entity.get("status"),
            "attrs": entity.get("attrs") or {},
            "connectors": {
                verb: sorted(names.get(one, one) for one in ids) for verb, ids in connectors.items()
            },
        }

    galleries = {
        names[entity_id]: [
            {"primary": image.get("primary"), "media": image.get("media_id") or image.get("path")}
            for image in _ok(client.get(f"{base}/entities/{entity_id}/images"), "images")["images"]
        ]
        for entity_id in (ws.full.person_id, ws.full.org_id)
    }

    reading = {
        "views": views,
        "live": readings,
        "events": _timeline_rows(client, base, names, category=["statement"]),
        "media": _timeline_rows(client, base, names, category=["media"]),
        "summary": _ok(client.get(f"{base}/catalog/summary"), "summary"),
        "search": {
            q: _labels(client, base, {"q": q})
            for q in ("Nadeau", "aurora", "handy bulker", "Quay 4", "brigade", "@harbourwatch")
        },
        "claims": claims,
        "galleries": galleries,
        "notes": _ok(client.get(f"{base}/notes"), "notes").get("text"),
        "filed_note": _ok(client.get(f"{base}/notes/{ws.full.note_id}"), "note").get("text"),
        "promoted": names.get(ws.promoted),
        "detect_claim": names.get(ws.detect_claim),
    }
    return _normal(reading, names, now)
