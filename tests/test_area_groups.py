"""Area groups share case areas and preserve saved sets during migration."""

import pytest

from azimut.api import analyzers as api
from azimut.engine import analyzers
from azimut.engine.analysis_models import AreaGroup
from azimut.workspace import Case


def shape(points):
    return {"type": "Polygon", "coordinates": [points + [points[0]]]}


def test_old_sets_become_ordered_groups_without_losing_shapes(tmp_workspace):
    case = Case.create("Area group test")
    original = [[2.0, 48.0], [2.01, 48.0], [2.01, 48.01], [2.0, 48.01]]
    changed = [[2.0, 48.0], [2.02, 48.0], [2.02, 48.02], [2.0, 48.02]]
    shared = analyzers.save(case, "areas", {"name": "Harbor", "colour": "#38bdf8",
                                           "geometry": shape(changed)}, new_id="111111111111")
    legacy = analyzers.save(case, "zones", {"title": "Ports", "zones": [
        {"id": shared["id"], "name": "Harbor", "kind": "polygon", "points": original},
        {"id": "draft", "name": "River", "kind": "polygon", "points": changed},
    ]}, new_id="aaaaaaaaaaaa")
    second = analyzers.save(case, "zones", {"title": "Priority", "zones": [
        {"id": "draft", "name": "River", "kind": "polygon", "points": changed},
    ]}, new_id="bbbbbbbbbbbb")
    current = analyzers.save(case, "zones", {"title": "Current", "zones": [
        {"id": shared["id"], "name": "Harbor", "kind": "polygon", "points": changed},
    ]}, new_id="cccccccccccc")

    groups = analyzers.listing(case, "zones")
    migrated = analyzers.read(case, "zones", legacy["id"])
    again = analyzers.read(case, "zones", second["id"])
    assert {row["title"] for row in groups} == {"Priority", "Ports", "Current"}
    assert [row["position"] for row in groups] == [0, 1, 2]
    assert "zones" not in migrated
    assert migrated["area_ids"][0] != shared["id"]
    assert migrated["pending_review"] == [{
        "saved_area_id": migrated["area_ids"][0], "current_area_id": shared["id"], "name": "Harbor",
    }]
    assert analyzers.read(case, "areas", migrated["area_ids"][0])["geometry"] == shape(original)
    assert migrated["area_ids"][1] == again["area_ids"][0]
    assert analyzers.read(case, "zones", current["id"])["area_ids"] == [shared["id"]]
    assert len(analyzers.listing(case, "areas")) == 3
    assert analyzers.listing(case, "zones") == groups
    assert len(analyzers.listing(case, "areas")) == 3
    api.update_zones(case.id, legacy["id"], AreaGroup(title="Ports", position=migrated["position"],
                    area_ids=[shared["id"], migrated["area_ids"][1]]))
    assert analyzers.read(case, "zones", legacy["id"])["pending_review"] == []
    assert len(analyzers.listing(case, "areas")) == 3


def test_groups_reference_the_same_area_and_keep_their_own_order(tmp_workspace):
    case = Case.create("Area group test")
    outline = [[2.0, 48.0], [2.01, 48.0], [2.01, 48.01], [2.0, 48.01]]
    first = analyzers.save(case, "areas", {"name": "Harbor", "geometry": shape(outline)})
    other = analyzers.save(case, "areas", {"name": "River", "geometry": shape(outline)})
    ports = api.save_zones(case.id, AreaGroup(title="Ports", area_ids=[first["id"], other["id"]]))
    priority = api.save_zones(case.id, AreaGroup(title="Priority", area_ids=[first["id"]]))
    api.update_zones(case.id, ports["id"], AreaGroup(title="Ports", area_ids=[other["id"], first["id"]]))

    assert analyzers.read(case, "zones", ports["id"])["area_ids"] == [other["id"], first["id"]]
    assert analyzers.read(case, "zones", priority["id"])["area_ids"] == [first["id"]]
    assert len(analyzers.listing(case, "areas")) == 2
    api.delete_item(case.id, "zones", ports["id"])
    later = api.save_zones(case.id, AreaGroup(title="Later", area_ids=[other["id"]]))
    assert [row["title"] for row in analyzers.listing(case, "zones")] == ["Priority", "Later"]
    assert later["position"] == 2
    assert len(analyzers.listing(case, "areas")) == 2
    with pytest.raises(ValueError):
        AreaGroup(title="Duplicate", area_ids=[first["id"], first["id"]])
