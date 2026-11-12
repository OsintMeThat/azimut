"""Names cleaned of the invisible characters a paste brings along, and the names
already saved with one still found.

A proof was saved as ``7H45MFQC+QR`` followed by a U+2069, pasted from X beside
Arabic text: a name that reads like another and is not. Every name given is cleaned
(`layout.slugify`); every name read back to find what is already saved is read as it
stands (`layout.existing_stem`), so a record saved before the cleaning moves to its
clean name on its next save rather than leaving a copy of itself behind.
"""

from __future__ import annotations

import base64
import io
from urllib.parse import quote

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import renames as rename_engine
from azimut.workspace import Case

PDI = "⁩"  # POP DIRECTIONAL ISOLATE, the character the real proof ended with


def _png(color=(40, 40, 60), size=(80, 50)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _case(client) -> str:
    return client.post("/api/cases", json={"name": "Clean names"}).json()["id"]


def _upload(client, cid, name="photo.png") -> str:
    res = client.post(f"/api/cases/{cid}/media/upload", files={"file": (name, io.BytesIO(_png()), "image/png")})
    assert res.status_code == 200, res.text
    return res.json()["item"]["path"]


def _proof(client, cid, title, **extra) -> dict:
    res = client.post(f"/api/cases/{cid}/proofs", json={
        "title": title, "spec": {"panels": []}, "png_base64": base64.b64encode(_png()).decode(), **extra,
    })
    assert res.status_code == 200, res.text
    return res.json()


def _draft(client, cid, title, state, **extra) -> dict:
    res = client.post(f"/api/cases/{cid}/drafts", json={"title": title, "state": state, **extra})
    assert res.status_code == 200, res.text
    return res.json()


def _state(client, cid, name) -> dict:
    return client.get(f"/api/cases/{cid}/drafts/{quote(name, safe='')}").json()["state"]


def _stems(cid, folder: str) -> list[str]:
    case = Case.open(cid)
    root = case.tool_root / folder
    return sorted(path.stem for path in root.glob("*.json"))


def _labels(cid, type_: str) -> list[str]:
    return sorted(e["label"] for e in Case.open(cid).list_entities() if e["type"] == type_)


def _plant(cid, type_: str, rel, name: str) -> None:
    """A record saved before names were cleaned: moved, with everything naming it, to a
    stem ending in U+2069, as the save used to file it."""
    case = Case.open(cid)
    rename_engine.rename_record(case, type_, rel(name), rel(f"{name}{PDI}"))


# -- a name given ---------------------------------------------------------------------


def test_a_proof_named_with_an_invisible_character_saves_under_the_clean_name(client):
    cid = _case(client)
    saved = _proof(client, cid, f"7H45MFQC+QR{PDI}")
    assert saved["name"] == "7H45MFQC+QR"
    assert saved["png"] == "proofs/7H45MFQC+QR.png"
    assert _labels(cid, "proof") == ["7H45MFQC+QR"]


def test_a_post_named_with_an_invisible_character_saves_under_the_clean_name(client):
    cid = _case(client)
    assert _draft(client, cid, f"Strike{PDI}", {"description": "Smoke"})["name"] == "Strike"
    assert _stems(cid, layout.DRAFTS_DIR) == ["Strike"]


def test_every_named_file_is_cleaned_where_it_is_born(client):
    cid = _case(client)
    photo = _upload(client, cid, f"IMG{PDI} 0042.png")
    assert photo == "media/IMG 0042.png"
    renamed = client.patch(f"/api/cases/{cid}/media", json={"path": photo, "title": f"⁧North roof{PDI}"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["path"] == "media/North roof.png"

    note = client.post(f"/api/cases/{cid}/notes", json={"title": f"Findings{PDI}", "content": "Depot burnt."})
    assert note.status_code == 200, note.text
    held = Case.open(cid).get_entity(note.json()["id"])
    assert (held["label"], held["attrs"]["path"]) == ("Findings", "notes/Findings.md")

    sheet = client.post(f"/api/cases/{cid}/sheets", json={"title": f"Candidates{PDI}"})
    assert sheet.status_code == 200, sheet.text
    assert _labels(cid, "sheet") == ["Candidates"]


def test_a_rename_from_details_cleans_the_new_name_and_a_name_restated_moves_nothing(client):
    cid = _case(client)
    _proof(client, cid, "Depot")
    _proof(client, cid, "Yard")
    _plant(cid, "proof", layout.proof_spec_rel, "Yard")
    proof = Case.open(cid).find_entity(attr="spec", value=layout.proof_spec_rel("Depot"))

    res = client.patch(f"/api/cases/{cid}/entities/{proof['id']}", json={"label": f"Fuel depot{PDI}"})
    assert res.status_code == 200, res.text
    assert _labels(cid, "proof") == ["Fuel depot", f"Yard{PDI}"]

    # the label it already has, sent again with an edit, is no rename
    held = Case.open(cid).find_entity(attr="spec", value=layout.proof_spec_rel(f"Yard{PDI}"))
    res = client.patch(f"/api/cases/{cid}/entities/{held['id']}", json={"label": f"Yard{PDI}", "attrs": {"notes": "x"}})
    assert res.status_code == 200, res.text
    assert _labels(cid, "proof") == ["Fuel depot", f"Yard{PDI}"]


# -- a name already saved -------------------------------------------------------------


def test_a_proof_saved_under_an_invisible_character_moves_to_the_clean_name_with_its_posts(client):
    cid = _case(client)
    saved = _proof(client, cid, "7H45MFQC+QR")
    post = _draft(client, cid, "Strike", {"proofPng": saved["png"]})
    thread = _draft(client, cid, "Strike thread", {
        "kind": "video", "first": "place:7H45MFQC+QR",
        "extraTweets": [{"text": "Mine", "mediaPaths": [saved["png"]], "mediaType": "images",
                         "key": "place:7H45MFQC+QR", "edited": True}],
    })
    _plant(cid, "proof", layout.proof_spec_rel, "7H45MFQC+QR")
    old_png = f"proofs/7H45MFQC+QR{PDI}.png"
    assert _state(client, cid, post["name"])["proofPng"] == old_png

    # the composer saves it as it stands: bound to the name it has, the title its field shows
    raw = f"7H45MFQC+QR{PDI}"
    spec = client.get(f"/api/cases/{cid}/proofs/{quote(raw, safe='')}").json()
    res = client.post(f"/api/cases/{cid}/proofs", json={"rename_from": raw, "title": raw, "spec": spec})
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "7H45MFQC+QR"

    case = Case.open(cid)
    assert _stems(cid, f"proofs/{layout.META_DIR}") == ["7H45MFQC+QR"]
    assert sorted(p.name for p in (case.tool_root / "proofs").glob("*.png")) == ["7H45MFQC+QR.png"]
    assert _labels(cid, "proof") == ["7H45MFQC+QR"]
    assert _state(client, cid, post["name"])["proofPng"] == "proofs/7H45MFQC+QR.png"
    threaded = _state(client, cid, thread["name"])
    assert threaded["first"] == "place:7H45MFQC+QR"
    assert [(one["key"], one["mediaPaths"]) for one in threaded["extraTweets"]] == [
        ("place:7H45MFQC+QR", ["proofs/7H45MFQC+QR.png"]),
    ]


def test_a_post_saved_under_an_invisible_character_moves_to_the_clean_name(client):
    cid = _case(client)
    _draft(client, cid, "Strike", {"description": "Smoke"})
    _plant(cid, "post", layout.draft_rel, "Strike")
    raw = f"Strike{PDI}"
    assert _stems(cid, layout.DRAFTS_DIR) == [raw]
    # found by its own name
    assert _state(client, cid, raw)["description"] == "Smoke"

    saved = _draft(client, cid, raw, {"description": "Smoke, east side"}, rename_from=raw)
    assert saved["name"] == "Strike"
    assert _stems(cid, layout.DRAFTS_DIR) == ["Strike"]
    assert _labels(cid, "post") == ["Strike"]
    assert _state(client, cid, "Strike")["description"] == "Smoke, east side"


def test_a_post_saved_under_an_invisible_character_is_deleted_by_its_own_name(client):
    cid = _case(client)
    _draft(client, cid, "Strike", {"description": "Smoke"})
    _draft(client, cid, "Other", {"description": "Fire"})
    _plant(cid, "post", layout.draft_rel, "Strike")
    res = client.delete(f"/api/cases/{cid}/drafts/{quote(f'Strike{PDI}', safe='')}")
    assert res.status_code == 200, res.text
    assert _stems(cid, layout.DRAFTS_DIR) == ["Other"]


def _collage(client, cid, photo, **body):
    return client.post(f"/api/cases/{cid}/collages", json={
        "spec": {"width": 200, "height": 100, "nodes": [
            {"id": "nd_1", "save": {"path": photo, "time": None, "ops": []},
             "w": 80, "h": 60, "quad": [[0, 0], [80, 0], [80, 60], [0, 60]]},
        ]},
        **body,
    })


def _comparison(client, cid, **body):
    return client.post(f"/api/cases/{cid}/compare/sessions", json={"spec": {
        "version": 2, "camera": {"lat": 48.8584, "lon": 2.2945, "zoom": 17, "bearing": 0},
        "mode": "swipe", "divider": 50, "opacity": 50,
        "a": {"present": True, "provider": "esri-world-imagery", "overlays": []},
        "b": {"present": True, "provider": "osm", "overlays": []},
    }, **body})


def _view(client, cid, **body):
    return client.post(f"/api/cases/{cid}/horizon/views", json={"spec": {
        "eye": {"lat": 46.5586, "lon": 7.8353, "mode": "ground", "height": 1.7},
        "look": {"heading": 95, "tilt": 2, "fov": 60},
        "picture": {"ground": "imagery", "imagery": "esri-world-imagery"},
    }, **body})


def _plate(client, cid, **body):
    return client.post(f"/api/cases/{cid}/map-plates", json={"spec": {"elements": [
        {"id": "title", "kind": "text", "box": [10, 6, 200, 12], "text": "Situation", "size": 18, "weight": 700},
    ]}, **body})


#: Each tool that saves a named record: how it is saved first, how the tool saves it
#: again bound to the name it has, where its records are, and its entity's type.
TOOLS = {
    "collage": (
        lambda client, cid, photo: _collage(client, cid, photo, title="Harbour"),
        lambda client, cid, photo, raw: _collage(client, cid, photo, name=raw, title=raw),
        layout.COLLAGE_DIR, layout.collage_rel, "collage",
    ),
    "comparison": (
        lambda client, cid, photo: _comparison(client, cid, title="Harbour"),
        lambda client, cid, photo, raw: _comparison(client, cid, title=raw, rename_from=raw),
        layout.COMPARE_DIR, layout.compare_session_rel, "compare-session",
    ),
    "horizon view": (
        lambda client, cid, photo: _view(client, cid, title="Harbour"),
        # saved again under the title it shows, as the view open is
        lambda client, cid, photo, raw: _view(client, cid, title=raw, overwrite=True),
        layout.HORIZON_DIR, layout.horizon_view_rel, "horizon-view",
    ),
    "map plate": (
        lambda client, cid, photo: _plate(client, cid, title="Harbour"),
        lambda client, cid, photo, raw: _plate(client, cid, title=raw, rename_from=raw),
        layout.MAPPLATE_DIR, layout.map_plate_rel, "map-plate",
    ),
}


@pytest.mark.parametrize("tool", list(TOOLS))
def test_a_record_saved_under_an_invisible_character_moves_to_the_clean_name(client, tool):
    create, save_again, folder, rel, type_ = TOOLS[tool]
    cid = _case(client)
    photo = _upload(client, cid)
    first = create(client, cid, photo)
    assert first.status_code == 200, first.text
    _plant(cid, type_, rel, "Harbour")
    raw = f"Harbour{PDI}"
    assert _stems(cid, folder) == [raw]

    again = save_again(client, cid, photo, raw)
    assert again.status_code == 200, again.text
    assert again.json()["name"] == "Harbour"
    assert _stems(cid, folder) == ["Harbour"]
    assert _labels(cid, type_) == ["Harbour"]
