"""The work on Horizon's bench, kept in the case so a reload brings it back."""

import copy
import io

from PIL import Image

from azimut import layout
from azimut.workspace import Case


def _case(client, name: str) -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _photo(client, cid: str) -> str:
    out = io.BytesIO()
    Image.new("RGB", (96, 64), (30, 60, 90)).save(out, "PNG")
    answer = client.post(f"/api/cases/{cid}/media/upload", files={"file": ("ridge.png", io.BytesIO(out.getvalue()), "image/png")})
    assert answer.status_code == 200, answer.text
    return answer.json()["item"]["path"]


def _spec() -> dict:
    return {
        "version": 1,
        "eye": {"lat": 46.5586, "lon": 7.8353, "mode": "ground", "height": 1.7},
        "look": {"heading": 95.5, "tilt": 2, "roll": -1.5, "fov": 58, "projection": "camera"},
    }


def _save(client, cid: str, title: str):
    return client.post(f"/api/cases/{cid}/horizon/views", json={"title": title, "spec": _spec()})


def _photo_work(path: str) -> dict:
    return {
        "path": path, "kind": "image", "title": "Ridge at dusk", "mix": 0.7, "bend": 0.0,
        "strokes": [[{"u": 0.1, "v": 0.4}, {"u": 0.5, "v": 0.35}, {"u": 0.9, "v": 0.42}]],
        "hints": {"picture": "photo", "zoom": "normal", "facing": None, "reach": "auto"},
    }


def _find_work() -> dict:
    return {
        "area": [{"lat": 46.5, "lon": 7.8}, {"lat": 46.5, "lon": 7.9}, {"lat": 46.6, "lon": 7.9}],
        "alignments": [{
            "colour": "#ff8a65",
            "photo": {"near": {"u": 0.4, "v": 0.6}, "far": {"u": 0.41, "v": 0.45}},
            "map": {"near": {"lat": 46.55, "lon": 7.85}, "far": {"lat": 46.6, "lon": 7.95}},
            "offset": 0.4, "offset_known": True, "tops": True, "heights": {"near": 12, "far": 0},
        }],
        "who": {"mode": "drone", "low": 10, "high": 120},
        "spacing": 250,
        "tolerance": 2,
        "search": None,
    }


def test_the_bench_comes_back_as_it_was_left(client):
    cid = _case(client, "Bench")
    path = _photo(client, cid)
    spec = _spec()
    work = {"view": None, "spec": spec, "photo": _photo_work(path), "find": _find_work()}

    assert client.put(f"/api/cases/{cid}/horizon/work", json=work).status_code == 200
    back = client.get(f"/api/cases/{cid}/horizon/work").json()

    assert back["photo_here"] is True
    kept = back["work"]
    assert kept["spec"]["eye"] == spec["eye"]
    assert kept["photo"]["strokes"] == work["photo"]["strokes"]
    assert kept["find"]["alignments"][0]["heights"] == {"near": 12, "far": 0}
    assert kept["find"]["who"] == {"mode": "drone", "low": 10, "high": 120}
    assert kept["find"]["spacing"] == 250


def test_an_empty_case_has_no_bench_and_a_cleared_one_is_gone(client):
    cid = _case(client, "Empty bench")
    assert client.get(f"/api/cases/{cid}/horizon/work").json() == {"work": None, "photo_here": None}

    client.put(f"/api/cases/{cid}/horizon/work", json={"find": _find_work()})
    assert client.delete(f"/api/cases/{cid}/horizon/work").json() == {"cleared": True}
    assert client.get(f"/api/cases/{cid}/horizon/work").json()["work"] is None
    assert client.delete(f"/api/cases/{cid}/horizon/work").json() == {"cleared": False}


def test_the_bench_is_never_listed_as_a_view(client):
    cid = _case(client, "Bench and views")
    _save(client, cid, "work")
    client.put(f"/api/cases/{cid}/horizon/work", json={"spec": _spec()})

    case = Case.open(cid)
    assert case.resolve_inside(layout.horizon_work_rel()).is_file()
    # a view titled like the bench file is another file: the bench keeps a name no view can take
    assert [row["name"] for row in client.get(f"/api/cases/{cid}/horizon/views").json()] == ["work"]
    assert client.get(f"/api/cases/{cid}/horizon/work").json()["work"]["spec"]["eye"] == _spec()["eye"]


def test_a_photo_gone_from_the_case_is_said_and_one_outside_it_refused(client):
    cid = _case(client, "Bench photo")
    path = _photo(client, cid)
    client.put(f"/api/cases/{cid}/horizon/work", json={"photo": _photo_work(path)})
    Case.open(cid).resolve_inside(path).unlink()
    assert client.get(f"/api/cases/{cid}/horizon/work").json()["photo_here"] is False

    outside = client.put(f"/api/cases/{cid}/horizon/work", json={"photo": _photo_work("../../secret.png")})
    assert outside.status_code == 400


def test_the_bench_is_checked_at_the_edge(client):
    cid = _case(client, "Bench edges")
    bad_eye = copy.deepcopy(_spec())
    bad_eye["eye"]["lat"] = 120
    assert client.put(f"/api/cases/{cid}/horizon/work", json={"spec": bad_eye}).status_code == 422
    crowded = _find_work()
    crowded["area"] = crowded["area"] * 100
    assert client.put(f"/api/cases/{cid}/horizon/work", json={"find": crowded}).status_code == 422
    wrong_spacing = {**_find_work(), "spacing": 333}
    assert client.put(f"/api/cases/{cid}/horizon/work", json={"find": wrong_spacing}).status_code == 422
