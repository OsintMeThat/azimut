"""A case the Board, Graph and Timeline kept in 0.3.1 still reads the same.

The rework of those three surfaces changes how they draw and what they open on,
never what a case already holds or what a saved reading answers. This builds the
case such an analyst leaves behind (`caseworkspace.py`), reopens it, and compares
its reading with the one recorded when the rework began.

A change that means to alter a reading records it on purpose:

    AZIMUT_WRITE_GOLDEN=1 uv run pytest tests/test_case_workspace_fixture.py

and the diff of `fixtures/case-workspace-0.3.1.json` is then the change's own
account of what reads differently.
"""

from __future__ import annotations

import json
import os

from azimut.sqlite_backend import SQLITE_SCHEMA
from azimut.workspace import Case
from caseworkspace import GOLDEN, build_workspace_case, read_workspace

#: The storage schema 0.3.1 shipped. A newer one must still open this case.
SHIPPED_SCHEMA = 18


def test_a_case_workspace_from_0_3_1_reads_as_it_did(client):
    ws = build_workspace_case(client)
    case = Case.open(ws.full.case_id)
    assert SQLITE_SCHEMA >= SHIPPED_SCHEMA

    reading = read_workspace(client, ws)
    if os.environ.get("AZIMUT_WRITE_GOLDEN") == "1":
        GOLDEN.write_text(
            json.dumps(reading, indent=1, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    recorded = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert case.list_entities(), "the fixture planted nothing"
    for part in recorded:
        assert reading[part] == recorded[part], f"'{part}' reads differently"
    assert set(reading) == set(recorded)


def test_the_fixture_holds_what_the_rework_has_to_keep(client):
    """Guard the fixture itself: a reading of nothing would match forever."""
    ws = build_workspace_case(client)
    reading = read_workspace(client, ws)
    views = reading["views"]
    assert {(v["surface"], v["mode"]) for v in views.values()} == {
        (surface, mode)
        for surface in ("board", "graph", "timeline")
        for mode in ("live", "snapshot")
    }
    modes = {v["spec"]["timeline"]["view_mode"] for v in views.values() if v["surface"] == "timeline"}
    assert modes == {"plot", "list"}
    tracks = views["Chronology with media"]["spec"]["timeline"]["tracks"]
    assert any("media" in t["categories"] for t in tracks)
    assert any(t["hidden"] for t in tracks) and any(t["pinned"] for t in tracks)

    kinds = {row["kind"] for row in reading["events"]["rows"]}
    assert {"claim", "taken"} <= kinds, "Claims and a proof date are on the Events track"
    assert reading["events"]["undated"] >= 1 and reading["events"]["unplaced"] >= 1
    assert reading["detect_claim"].startswith("claim:")
    assert reading["claims"][reading["detect_claim"].removeprefix("claim:")]["attrs"].get(
        "detection"
    ), "a kept Detect pin is a Claim that says it came from a detection"
    assert reading["promoted"] == "organization:3rd Harbour Brigade"
    assert "[[entity:organization:Northwind Shipping|" in reading["notes"]
    assert any(image["primary"] for image in reading["galleries"]["person:A. Nadeau"])
    for view in views.values():
        if view["mode"] == "snapshot":
            snap = view["spec"]["snapshot"]
            assert snap["entities"] or snap["timeline_items"], "a snapshot froze something"
