"""What leans on a file: the Media Library's Unused filter and every delete's preview.

The two are one rule read from two ends (`engine/uses.py`). The gate at the bottom
holds them together over a case filled through every tool: a file the filter calls
unused is exactly one whose delete would warn about nothing.
"""

from __future__ import annotations

import base64
import io
import json

from PIL import Image

from azimut import layout
from azimut.engine import links as link_engine
from azimut.engine import sheets as sheet_engine
from azimut.engine import uses as uses_engine
from azimut.workspace import Case

import fullcase


def _png(color=(200, 30, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), color).save(buf, "PNG")
    return buf.getvalue()


def _case(client, name="Uses") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, cid, name, color=(200, 30, 30)) -> str:
    res = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(_png(color)), "image/png")},
    )
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _entity_id(client, cid, path) -> str:
    return client.get(
        f"/api/cases/{cid}/entities/lookup", params={"attr": "path", "value": path}
    ).json()["entity"]["id"]


def _unused(client, cid, **params) -> list[str]:
    page = client.get(
        f"/api/cases/{cid}/media/page", params={"unused": "true", **params}
    ).json()
    return sorted(item["path"] for item in page["items"])


def _facets(client, cid, **params) -> dict:
    return client.get(f"/api/cases/{cid}/media/page", params=params).json()["facets"]


def _impact(client, cid, **body) -> dict:
    res = client.post(f"/api/cases/{cid}/delete-impact", json=body)
    assert res.status_code == 200, res.text
    return res.json()


def _touched(impact) -> dict[str, list[str]]:
    return {row["label"]: row["how"] for row in impact["touched"]}


def _plate(client, cid, title, src, kind="image"):
    element = {"id": "pic", "kind": kind, "box": [10, 10, 80, 60], "src": src}
    if kind == "video":
        element["step"] = "s1"
    res = client.post(
        f"/api/cases/{cid}/map-plates",
        json={"title": title, "spec": {"elements": [element]}},
    )
    assert res.status_code == 200, res.text
    return res.json()


# -- the filter --------------------------------------------------------------------


def test_a_fresh_file_is_unused_and_counted(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    assert _unused(client, cid) == [a]
    assert _facets(client, cid)["unused_count"] == 1


def test_a_plate_showing_a_file_uses_it_and_says_so(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    b = _upload(client, cid, "b.png", (10, 200, 10))
    _plate(client, cid, "Situation", a)

    assert _unused(client, cid) == [b]
    assert _touched(_impact(client, cid, paths=[a])) == {"Situation": ["shows it"]}
    assert _impact(client, cid, paths=[b])["counts"]["touched"] == 0


def test_the_files_inspect_filed_stay_unused(client):
    """Inspect work names the frames it filed. Those are its output, not its use."""
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    frame = _upload(client, cid, "frame.png", (20, 20, 220))
    res = client.put(
        f"/api/cases/{cid}/inspect/work",
        json={"path": a, "spec": {"frames": [{
            "id": "fr_1", "path": a, "time": None, "filed": {"path": frame, "signature": "x"},
        }]}},
    )
    assert res.status_code == 200, res.text

    assert _unused(client, cid) == [frame]
    # the subject's work goes with it, and the dialog says so
    impact = _impact(client, cid, paths=[a])
    assert impact["counts"]["cascade"] == 1
    assert _impact(client, cid, named=[{"tool": "inspect", "name": a}])["counts"] == {
        "blocking": 0, "cascade": 0, "tombstone": 0, "touched": 0,
    }


def test_a_collage_uses_its_pieces_not_its_export():
    data = {
        "nodes": [{"save": {"path": "media/piece.png"}}, {"save": {"path": "media/other.png"}}],
        "exported": {"path": "media/collage.png", "signature": "s"},
    }
    assert [lean.target for lean in uses_engine._collage(data)] == [
        "media/piece.png", "media/other.png",
    ]


def test_a_relation_uses_both_ends_and_names_its_verb(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.85, "lon": 2.29, "zoom": 17, "title": "Tower"},
    ).json()
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": _entity_id(client, cid, a), "to_id": place["id"], "type": "located-at"},
    )
    assert res.status_code == 200, res.text

    assert _unused(client, cid) == []
    assert _touched(_impact(client, cid, paths=[a])) == {"Tower": ["was recorded here"]}
    assert _touched(_impact(client, cid, ids=[place["id"]])) == {"a": ["was recorded at"]}


def test_a_duplicate_or_a_guess_does_not_count(client, tmp_path):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    b = _upload(client, cid, "b.png", (10, 200, 10))
    case = Case.open(cid)
    a_id, b_id = _entity_id(client, cid, a), _entity_id(client, cid, b)
    case.add_link(a_id, b_id, link_engine.SAME_IMAGE_AS, by="enrich")
    place = case.add_entity("place", "Guessed", attrs={"lat": 1.0, "lon": 2.0}, by="enrich")
    case.add_link(a_id, place["id"], link_engine.LOCATED_AT, by="enrich", status="suggested")

    assert _unused(client, cid) == sorted([a, b])
    assert _impact(client, cid, paths=[a])["counts"]["touched"] == 0


def test_a_mention_uses_its_target_but_goes_with_its_note(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    a_id = _entity_id(client, cid, a)
    note = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Witness", "content": f"Seen in [[entity:{a_id}|the photo]].\n"},
    )
    assert note.status_code == 200, note.text

    assert _unused(client, cid) == []
    assert _touched(_impact(client, cid, paths=[a])) == {"Witness": ["mentions"]}
    # the note's own pointer is the note's: deleting it touches nothing else
    assert _impact(client, cid, ids=[note.json()["id"]])["counts"]["touched"] == 0


def test_a_layer_marker_following_an_entity_is_named(client):
    cid = _case(client)
    place = client.post(
        f"/api/cases/{cid}/satellite/place",
        json={"lat": 48.85, "lon": 2.29, "zoom": 17, "title": "Tower"},
    ).json()
    layer = client.post(f"/api/cases/{cid}/map-layers/editable", json={"title": "Front"})
    assert layer.status_code == 200, layer.text
    linked = client.post(
        f"/api/cases/{cid}/map-layers/{layer.json()['name']}/links",
        json={"items": [{"id": place["id"], "lat": 48.85, "lon": 2.29}]},
    )
    assert linked.status_code == 200, linked.text

    assert _touched(_impact(client, cid, ids=[place["id"]])) == {"Front": ["1 marker follows it"]}


def test_an_entity_photo_uses_the_file(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    person = client.post(
        f"/api/cases/{cid}/entities", json={"type": "person", "label": "A. Nadeau", "attrs": {}}
    ).json()
    res = client.post(
        f"/api/cases/{cid}/entities/{person['id']}/images",
        json={"media_ids": [_entity_id(client, cid, a)]},
    )
    assert res.status_code == 200, res.text

    assert _unused(client, cid) == []
    assert _touched(_impact(client, cid, paths=[a])) == {"A. Nadeau": ["uses it as a photo"]}


def test_a_selection_does_not_warn_about_itself(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    proof = client.post(
        f"/api/cases/{cid}/proofs",
        json={
            "title": "P",
            "spec": {"panels": [{"id": "p0", "src": a}]},
            "png_base64": base64.b64encode(_png()).decode(),
        },
    ).json()
    alone = _impact(client, cid, paths=[a])
    assert [row["label"] for row in alone["tombstone"]] == ["P"]
    together = _impact(client, cid, paths=[a, proof["spec_path"]])
    assert together["counts"] == {"blocking": 0, "cascade": 0, "tombstone": 0, "touched": 0}


def test_saved_work_is_named_the_way_its_delete_names_it(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    plate = _plate(client, cid, "Situation", a)
    # the plate is the one going, so nothing about it is touched; asked by name it resolves
    by_name = _impact(client, cid, named=[{"tool": "plate", "name": plate["name"]}])
    assert by_name["counts"] == {"blocking": 0, "cascade": 0, "tombstone": 0, "touched": 0}
    with_file = _impact(client, cid, paths=[a], named=[{"tool": "plate", "name": plate["name"]}])
    assert with_file["counts"]["touched"] == 0


def test_the_unused_switch_scopes_the_counts(client):
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    _upload(client, cid, "b.png", (10, 200, 10))
    _plate(client, cid, "Situation", a)
    facets = _facets(client, cid, unused="true")
    assert facets["unused_count"] == 1
    assert facets["category_counts"]["image"] == 1
    assert _facets(client, cid)["category_counts"]["image"] == 2


def test_saved_work_deleted_by_name_really_goes(client):
    """The preview and the delete read one name helper; the delete must still be the route."""
    cid = _case(client)
    a = _upload(client, cid, "a.png")
    plate = _plate(client, cid, "Situation", a)
    collage = client.post(
        f"/api/cases/{cid}/collages",
        json={"title": "Strip", "spec": {"width": 200, "height": 100, "nodes": [
            {"id": "nd_1", "save": {"path": a, "time": None, "ops": []},
             "w": 80, "h": 60, "quad": [[0, 0], [80, 0], [80, 60], [0, 60]]},
        ]}},
    ).json()
    session = client.post(
        f"/api/cases/{cid}/compare/sessions",
        json={"title": "Change", "spec": {
            "version": 2, "camera": {"lat": 48.85, "lon": 2.29, "zoom": 17, "bearing": 0},
            "mode": "swipe", "divider": 50, "opacity": 50,
            "a": {"present": True, "provider": "esri-world-imagery", "overlays": []},
            "b": {"present": True, "provider": "osm", "overlays": []},
        }},
    ).json()
    assert _touched(_impact(client, cid, paths=[a])) == {
        "Situation": ["shows it"], "Strip": ["uses it as a piece"],
    }
    for tool, name, route in (
        ("plate", plate["name"], f"map-plates/{plate['name']}"),
        ("collage", collage["name"], f"collages/{collage['name']}"),
        ("comparison", session["name"], f"compare/sessions/{session['name']}"),
    ):
        assert _impact(client, cid, named=[{"tool": tool, "name": name}])["counts"]["touched"] == 0
        gone = client.delete(f"/api/cases/{cid}/{route}")
        assert gone.status_code == 200, gone.text
        assert gone.json()["deleted"], f"the {tool} route deleted nothing"
    assert _unused(client, cid) == [a]


def test_an_area_a_routine_watches_blocks_its_delete_and_the_preview_says_so(client):
    cid = _case(client)
    case = Case.open(cid)
    area_rel, routine_rel = ".analysis/areas-aaaaaaaaaaaa.json", ".analysis/followups-bbbbbbbbbbbb.json"
    area = case.add_entity("analysis-area", "Harbour", attrs={"spec": area_rel}, by="test")
    routine = case.add_entity("analysis-follow-up", "Weekly", attrs={"spec": routine_rel}, by="test")
    path = case.resolve_inside(routine_rel)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text('{"area_dates": [{"area_id": "aaaaaaaaaaaa"}]}', encoding="utf-8")

    impact = _impact(client, cid, ids=[area["id"]])
    assert [(row["label"], row["how"]) for row in impact["blocking"]] == [("Weekly", ["watches it"])]
    assert impact["counts"]["touched"] == 0
    assert client.delete(f"/api/cases/{cid}/entities/{area['id']}").status_code == 409
    # going together, nothing holds the area back, on either side
    both = _impact(client, cid, ids=[area["id"], routine["id"]])
    assert both["counts"]["blocking"] == 0
    assert client.post(
        f"/api/cases/{cid}/entities/delete", json={"ids": [area["id"], routine["id"]]}
    ).status_code == 200


def test_sheet_pointers_are_what_a_delete_clears():
    meta = {
        "links": {"r1": {"Place": "e_place"}},
        "values": {"Status": {"done": "e_word"}},
        "attachments": {"r1": ["e_file", "e_file"]},
    }
    found = sheet_engine.pointers(meta)
    assert found == {"e_place": 1, "e_word": 1, "e_file": 2}
    assert sheet_engine._without_entities(meta, set(found)) == {
        "links": {}, "values": {}, "attachments": {},
    }


# -- the gate: every record naming a file is read, or says why not ------------------

#: Fields that name a media file without using it: what the tool **made**. Keyed by the
#: record's folder and the field's path, `[]` standing for any position in a list. A
#: field here is never read as a use; one missing from here and from `engine/uses.py`
#: fails the gate below, which is the point.
NOT_A_USE = {
    (".inspect", "frames[].filed.path"): "the frame Inspect filed from its subject",
    (".collages", "exported.path"): "the picture the collage last exported",
}


def _strings(value, key=""):
    if isinstance(value, dict):
        for name, inner in value.items():
            yield from _strings(inner, f"{key}.{name}" if key else name)
    elif isinstance(value, list):
        for inner in value:
            yield from _strings(inner, f"{key}[]")
    elif isinstance(value, str):
        yield key, value


def _holder(case, rel):
    """The entity a record belongs to, the way its own tool files it."""
    if rel.startswith("media/.meta/"):
        return case.find_entity(attr="path", value="media/" + rel.removeprefix("media/.meta/")[:-5])
    for attr in ("spec", "draft", "path"):
        found = case.find_entity(attr=attr, value=rel)
        if found is not None:
            return found
    return None


def test_every_record_naming_a_file_is_read_as_a_use_or_says_why_not(client):
    """A new tool, or a new field in an old one, that names a case file must be read by
    `engine/uses.py`, be one of its holder's own chain edges, or be listed above.
    Otherwise the Unused filter calls the file unused and its delete warns about nothing.
    """
    full = fullcase.build_full_case(client)
    cid = full.case_id
    case = Case.open(cid)
    # The two outputs above, written the way their tools write them, so the list is proved.
    work = client.put(f"/api/cases/{cid}/inspect/work", json={"path": full.photo, "spec": {"frames": [{
        "id": "fr_1", "path": full.photo, "time": None, "filed": {"path": full.collage, "signature": "s"},
    }]}})
    assert work.status_code == 200, work.text
    made = client.post(f"/api/cases/{cid}/collages", json={"title": "Exported", "spec": {
        "width": 100, "height": 60, "nodes": [], "exported": {"path": full.compare_image, "signature": "s"},
    }})
    assert made.status_code == 200, made.text

    page = client.get(f"/api/cases/{cid}/media/page", params={"limit": 500}).json()
    paths = {item["path"] for item in page["items"]}
    ids = {}
    for path in paths:
        entity = case.find_entity(attr="path", value=path)
        if entity is not None:
            ids[entity["id"]] = path

    root = case.tool_root
    read = set()
    for holder, lean in uses_engine._records(case):
        rel = holder.rel
        if holder.entity is not None:
            rel = sheet_engine.sidecar(case, holder.entity).relative_to(root).as_posix()
        read.add((rel, lean.target))

    unexplained, listed = [], set()
    for path in sorted(root.rglob("*.json")):
        rel = path.relative_to(root).as_posix()
        if rel.startswith(f"{layout.TRASH_DIR}/"):
            continue  # what the Trash holds is gone from the case
        data = json.loads(path.read_text(encoding="utf-8"))
        for key, value in _strings(data):
            if value not in paths and value not in ids:
                continue
            folder = rel.rsplit("/", 1)[0]
            if (folder, key) in NOT_A_USE:
                listed.add((folder, key))
                continue
            if (rel, value) in read:
                continue
            holder = _holder(case, rel)
            target = case.find_entity(attr="path", value=ids.get(value, value))
            if holder is not None and target is not None and any(
                link["type"] in link_engine.CHAIN_TYPES
                and link["from"] == holder["id"] and link["to"] == target["id"]
                for link in case.links_of(holder["id"])
            ):
                continue  # the graph answers for it: the holder is made from or works on it
            unexplained.append(f"{rel} · {key} = {ids.get(value, value)}")

    assert not unexplained, (
        "records name case files nothing reads as a use; add a reader to engine/uses.py "
        "or list the field in NOT_A_USE with why:\n  " + "\n  ".join(unexplained)
    )
    assert listed == set(NOT_A_USE), f"listed outputs no record writes any more: {set(NOT_A_USE) - listed}"


# -- the gate: the filter and the dialog are one rule --------------------------------


def test_every_unused_file_is_one_whose_delete_warns_about_nothing(client):
    full = fullcase.build_full_case(client)
    cid = full.case_id
    page = client.get(f"/api/cases/{cid}/media/page", params={"limit": 500}).json()
    paths = sorted(item["path"] for item in page["items"])
    assert paths, "the full case files media"

    unused = set(_unused(client, cid, limit=500))
    silent = set()
    for path in paths:
        impact = _impact(client, cid, paths=[path])
        if not any(impact["counts"].values()):
            silent.add(path)
    assert unused == silent
    # and the case is used enough for the gate to mean something
    assert full.photo not in unused
