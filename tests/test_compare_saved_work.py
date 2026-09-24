"""A saved comparison is saved work: it stands on the map and keeps its images."""

import json

import pytest

from azimut import workspace
from azimut.engine import comparisons, media
from azimut.workspace import Case
from test_compare_api import _case, _png, _preview, _save, _spec


def _row(client, cid, title):
    rows = client.get(f"/api/cases/{cid}/satellite/index").json()
    return next(row for row in rows if row["title"] == title)


def _keep(client, cid, name, spec=None, fmt="png", **extra):
    files = {"image_a": ("a.png", _png((200, 40, 40)), "image/png")}
    if fmt != "png":
        files["image_b"] = ("b.png", _png((40, 40, 200)), "image/png")
    return client.post(
        f"/api/cases/{cid}/compare/sessions/{name}/images",
        files=files,
        data={"format": fmt, "filename": extra.pop("filename", f"{name} 2024-05-03_2026-09-02"),
              "spec": json.dumps(spec or _spec()), **extra},
    )


# -- where it stands --------------------------------------------------------------


def test_a_frame_is_placed_on_its_centre_and_drawn_as_its_ground():
    # drawn upright, the ring is the box between the two corners
    (lon, lat), ring = comparisons.frame_ring({"points": [[2.0, 48.0], [2.1, 47.9]], "angle": 0})
    assert lon == pytest.approx(2.05)
    assert 47.9 < lat < 48.0
    assert ring[0] == ring[-1] and len(ring) == 5
    assert {round(p[0], 5) for p in ring} == {2.0, 2.1}
    # drawn on a turned camera, its sides run along the turned screen
    _, turned = comparisons.frame_ring({"points": [[2.0, 48.0], [2.1, 47.9]], "angle": 45})
    assert {round(p[0], 5) for p in turned} != {2.0, 2.1}


def test_a_saved_comparison_is_listed_with_the_captures_at_its_view(client):
    cid = _case(client, "Saved comparison")
    assert _save(client, cid, "Harbour reading").status_code == 200
    _preview(client, cid, "Harbour reading", imagery_a="2024-05-03", imagery_a_exact="false",
             imagery_b="2026-09-02")

    row = _row(client, cid, "Harbour reading")
    assert row["kind"] == "comparison"
    assert (row["lat"], row["lon"]) == (48.8584, 2.2945)
    assert row["session"] == "Harbour reading"
    assert (row["imagery_a"], row["imagery_b"]) == ("2024-05-03~", "2026-09-02")
    assert row["path"] == "media/Harbour reading.png" and row["thumbnail"]
    assert row["footprint"] is None and row["kept"] == []
    # its country is asked on save, and offline it waits for the Locate pass
    session = Case.open(cid).find_entity(attr="spec", value=".compare/Harbour reading.json")
    assert session["attrs"]["geo"]["state"] == "failed"


def test_a_framed_comparison_stands_on_its_frame(client):
    cid = _case(client, "Framed comparison")
    spec = _spec()
    spec["frame"] = {"points": [[2.2945, 48.8584], [2.2961, 48.8572]], "angle": 0}
    _save(client, cid, "Framed reading", spec)
    row = _row(client, cid, "Framed reading")
    assert row["lon"] == pytest.approx((2.2945 + 2.2961) / 2)
    assert row["footprint"]["type"] == "Polygon"
    # taking the frame off takes it off the map
    _save(client, cid, "Framed reading", _spec(), overwrite=True)
    assert _row(client, cid, "Framed reading")["footprint"] is None


# -- keeping an export ------------------------------------------------------------


def test_a_kept_image_carries_the_reading_it_shows_and_is_never_replaced(client):
    cid = _case(client, "Kept images")
    _save(client, cid, "Harbour reading")
    moved = _spec()
    moved["camera"] = {**moved["camera"], "lat": 48.86, "lon": 2.30}

    first = _keep(client, cid, "Harbour reading", moved, imagery_b="2026-09-02T05:42:10Z")
    second = _keep(client, cid, "Harbour reading", moved, fmt="slide")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json()["path"] == "media/Harbour reading 2024-05-03_2026-09-02.png"
    assert second.json()["path"].endswith(".gif")

    source = media.read_item(Case.open(cid), first.json()["path"])["source"]
    assert source["kept"] is True and source["session"] == ".compare/Harbour reading.json"
    # the reading on screen when it was kept, not the session's saved one
    assert (source["lat"], source["lon"]) == (48.86, 2.30)
    assert source["imagery_b"] == "2026-09-02T05:42:10Z"

    again = _keep(client, cid, "Harbour reading", moved)
    assert again.json()["path"] != first.json()["path"]
    kept = _row(client, cid, "Harbour reading")["kept"]
    assert {image["path"] for image in kept} == {
        first.json()["path"], second.json()["path"], again.json()["path"]}


def test_an_image_is_kept_only_under_a_saved_comparison(client):
    cid = _case(client, "Keep refused")
    assert _keep(client, cid, "Nothing here").status_code == 404
    _save(client, cid, "Harbour reading")
    assert _keep(client, cid, "Harbour reading", fmt="png", spec="{}").status_code == 422
    blink = client.post(
        f"/api/cases/{cid}/compare/sessions/Harbour reading/images",
        files={"image_a": ("a.png", _png((0, 0, 0)), "image/png")},
        data={"format": "blink", "filename": "x", "spec": json.dumps(_spec())},
    )
    assert blink.status_code == 422


def test_kept_images_follow_a_renamed_comparison_and_outlive_a_deleted_one(client):
    cid = _case(client, "Kept follow")
    _save(client, cid, "Harbour reading")
    kept = _keep(client, cid, "Harbour reading").json()
    _save(client, cid, "Harbour at dusk", rename_from="Harbour reading")

    row = _row(client, cid, "Harbour at dusk")
    assert [image["path"] for image in row["kept"]] == [kept["path"]]
    assert row["session"] == "Harbour at dusk"

    assert client.delete(f"/api/cases/{cid}/entities/{row['id']}").status_code == 200
    rows = client.get(f"/api/cases/{cid}/satellite/index").json()
    assert not [r for r in rows if r["kind"] == "comparison"]
    assert Case.open(cid).resolve_inside(kept["path"]).is_file()


# -- comparisons saved before -----------------------------------------------------


def test_opening_a_case_from_an_earlier_build_places_its_comparisons(client):
    cid = _case(client, "Earlier comparisons")
    _save(client, cid, "Harbour reading")
    case = Case.open(cid)
    session = case.find_entity(attr="spec", value=".compare/Harbour reading.json")
    attrs = {k: v for k, v in session["attrs"].items() if k not in {"lat", "lon", "zoom", "bearing",
                                                                        "footprint", "geo"}}
    case.remove_entity(session["id"])
    case.add_entity("compare-session", session["label"], attrs=attrs, by="compare")
    manifest = case.read()
    manifest["azimut"]["schema"] = workspace.WORK_SCHEMA
    case._write_json(manifest)

    opened = Case.open(cid)
    placed = opened.find_entity(attr="spec", value=".compare/Harbour reading.json")
    assert (placed["attrs"]["lat"], placed["attrs"]["lon"]) == (48.8584, 2.2945)
    # left for the Locate pass: a migration never waits on a geocoder
    assert "geo" not in placed["attrs"]


def test_a_deleted_comparisons_kept_images_never_join_a_new_one_of_its_name(client):
    cid = _case(client, "Kept stay put")
    _save(client, cid, "Harbour")
    _keep(client, cid, "Harbour")
    group = client.delete(f"/api/cases/{cid}/compare/sessions/Harbour").json()["trash"]
    elsewhere = _spec()
    elsewhere["camera"] = {**elsewhere["camera"], "lat": -33.86, "lon": 151.2}

    fresh = _save(client, cid, "Harbour", elsewhere)

    assert fresh.status_code == 200, fresh.text
    assert fresh.json()["name"] != "Harbour", "a name in the Trash is not free"
    assert _row(client, cid, fresh.json()["name"])["kept"] == []
    # and the deleted one can still come back, with its image
    assert client.post(f"/api/cases/{cid}/trash/{group}/restore").status_code == 200
    assert len(_row(client, cid, "Harbour")["kept"]) == 1


def test_a_rename_onto_a_name_in_the_trash_is_refused(client):
    cid = _case(client, "Trash names")
    _save(client, cid, "Harbour")
    client.delete(f"/api/cases/{cid}/compare/sessions/Harbour")
    _save(client, cid, "Quay")

    refused = _save(client, cid, "Harbour", rename_from="Quay")

    assert refused.status_code == 409 and "Trash" in refused.json()["detail"]
