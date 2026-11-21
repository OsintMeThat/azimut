"""Where an article stands on a map of the site: the optional place a note's look keeps, its card and
its line carry, the read shows, and the one point a note offers without ever filling it
(`notelook.NotePlace`, `site.read_place`, `engine/siteplace.py`, `POST /notes/{id}/github`,
`GET /notes/{id}/place`).

GitHub is `tests/githubfake.py`, never the network.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from pydantic import ValidationError

from azimut import layout
from azimut.engine import githubpages, notelook, site, siteplace, sitesync
from azimut.engine import links as link_engine
from azimut.workspace import Case

from githubfake import FakeGitHub
from notecase import make_case, make_note
from test_site_hub import _folder
from test_site_publish import DAY, _card, _connect, _new_note

READ = "/api/publishing/github/site/read"
BAB = {"lat": 12.7250041, "lon": 43.5075, "name": "  Bab al-Mandab,   Yemen "}
#: The place as it is kept: six places, its name on one line.
KEPT = {"lat": 12.725004, "lon": 43.5075, "name": "Bab al-Mandab, Yemen"}


@pytest.fixture()
def fake(monkeypatch):
    stand_in = FakeGitHub()
    real = githubpages.client
    monkeypatch.setattr(githubpages, "client", lambda transport=None: real(stand_in.transport()))
    monkeypatch.setattr(githubpages.time, "sleep", lambda seconds: None)
    monkeypatch.setattr("azimut.api.notes._now", lambda: DAY.astimezone())
    return stand_in


@pytest.fixture(autouse=True)
def an_empty_memory():
    sitesync._kept.clear()
    sitesync._plain.clear()
    sitesync._weight = 0


@pytest.fixture()
def note(client):
    return _new_note(client)


def _look(client, note: dict[str, str]) -> dict[str, Any]:
    return client.get(f"/api/cases/{note['cid']}/notes/{note['note']}/look").json()["look"]


def _lines(fake: FakeGitHub) -> list[dict[str, Any]]:
    return json.loads(fake.files()["articles.json"])["articles"]


# -- through a publish: the card, the list, the read ------------------------------------------------------------


def test_a_place_goes_from_the_dialog_to_the_card_the_list_and_the_read_and_a_republish_keeps_it(client, fake, note):
    fake.make_repo()
    _connect(client)
    answer = client.post(note["url"], json={"short_name": "port-strike", "place": BAB})
    assert answer.status_code == 200, answer.text
    files = fake.files()
    card = _card(files, "port-strike")
    assert card["format"] == "azimut-article/1" and card["place"] == KEPT
    assert list(card)[-1] == "place"
    assert [line["place"] for line in _lines(fake)] == [KEPT]
    # kept in the note's look, so the dialog opens on it and a press that says nothing of it keeps it
    assert _look(client, note)["place"] == KEPT
    again = client.post(note["url"], json={"short_name": "port-strike"})
    assert again.status_code == 200 and again.json()["site"]["written"] == []
    assert _card(fake.files(), "port-strike")["place"] == KEPT
    # the read of the site shows it on the article's row
    read = client.post(READ).json()
    assert [item.get("place") for item in read["items"]] == [KEPT]


def test_a_note_with_no_place_has_no_place_key_anywhere(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike", "place": None})
    files = fake.files()
    assert "place" not in _card(files, "port-strike")
    assert "place" not in files["port-strike/article.json"].decode()
    assert "place" not in files["articles.json"].decode()
    assert "place" not in _look(client, note)
    assert ["place" in item for item in client.post(READ).json()["items"]] == [False]


def test_emptying_the_place_takes_it_off_the_card_the_list_and_the_look(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike", "place": BAB})
    changed = client.post(note["url"], json={"short_name": "port-strike", "place": {"lat": -33.9, "lon": 18.42}})
    assert changed.status_code == 200, changed.text
    assert _card(fake.files(), "port-strike")["place"] == {"lat": -33.9, "lon": 18.42, "name": ""}
    emptied = client.post(note["url"], json={"short_name": "port-strike", "place": None})
    assert emptied.status_code == 200, emptied.text
    assert "place" not in _card(fake.files(), "port-strike")
    assert "place" not in _lines(fake)[0]
    assert "place" not in _look(client, note)


@pytest.mark.parametrize(("place", "said"), [
    ({"lat": 85.000001, "lon": 10}, "the latitude must be between -85 and 85"),
    ({"lat": -90, "lon": 10}, "the latitude must be between -85 and 85"),
    ({"lat": 10, "lon": 180.5}, "the longitude must be between -180 and 180"),
    ({"lat": 10, "lon": -181}, "the longitude must be between -180 and 180"),
    ({"lat": 10, "lon": 10, "name": "x" * 81}, "the name is longer than 80 characters"),
    ({"lat": "12.7", "lon": 43.5}, "Lat must be a number"),
    ({"lat": True, "lon": 43.5}, "Lat must be a number"),
    ({"lat": 12.7}, "Lon is required"),
])
def test_a_place_that_is_no_place_is_refused_in_plain_words_and_nothing_is_kept(client, fake, note, place, said):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike", "place": BAB})
    commits = len(fake.posted("/git/commits"))
    answer = client.post(note["url"], json={"short_name": "port-strike", "place": place})
    assert answer.status_code == 422
    assert isinstance(answer.json()["detail"], str) and said in answer.json()["detail"]
    assert len(fake.posted("/git/commits")) == commits
    assert _look(client, note)["place"] == KEPT


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
def test_coordinates_that_are_not_finite_are_refused(client, fake, note, number):
    fake.make_repo()
    _connect(client)
    raw = f'{{"short_name": "port-strike", "place": {{"lat": {number}, "lon": 43.5}}}}'
    answer = client.post(note["url"], content=raw, headers={"Content-Type": "application/json"})
    assert answer.status_code == 422
    assert "the coordinates must be finite numbers" in answer.json()["detail"]
    assert fake.posted("/git/commits") == [] and "place" not in _look(client, note)


def test_an_unlisted_page_with_a_place_stays_out_of_every_list(client, fake, note):
    fake.make_repo()
    _connect(client)
    client.post(note["url"], json={"short_name": "port-strike"})
    hidden = _new_note(client, title="Draft", text="Not yet.\n")
    answer = client.post(hidden["url"], json={"short_name": "draft", "role": "unlisted", "place": BAB})
    assert answer.status_code == 200, answer.text
    files = fake.files()
    assert _card(files, "draft")["place"] == KEPT
    listed = json.loads(files["articles.json"])
    assert "Draft" not in json.dumps(listed) and "Bab al-Mandab" not in files["articles.json"].decode()
    assert "/draft/" not in files["feed.xml"].decode() and "/draft/" not in files["sitemap.xml"].decode()
    # the read still shows it, place and all, as it shows every card
    items = {item["folder"]: item for item in client.post(READ).json()["items"]}
    assert items["draft"]["place"] == KEPT and "place" not in items["port-strike"]


def test_a_hand_edited_card_with_a_place_that_is_no_place_keeps_its_line(client, fake, note):
    files = {
        **_folder("strait", "The strait", place={"lat": 12.7, "lon": 43.5, "name": "Strait", "zoom": 9}),
        **_folder("north", "Too far north", place={"lat": 88, "lon": 10}),
        **_folder("words", "Words for numbers", place={"lat": "12.7", "lon": "43.5"}),
        **_folder("list", "A list", place=[12.7, 43.5]),
    }
    fake.make_repo(files=files)
    _connect(client)
    answer = client.post(note["url"], json={"short_name": "port-strike"})
    assert answer.status_code == 200, answer.text
    lines = {line["title"]: line for line in _lines(fake)}
    assert set(lines) == {"Port strike", "The strait", "Too far north", "Words for numbers", "A list"}
    assert lines["The strait"]["place"] == {"lat": 12.7, "lon": 43.5, "name": "Strait"}
    assert [title for title, line in lines.items() if "place" in line] == ["The strait"]


def test_the_card_reader_keeps_a_place_that_reads_and_drops_one_that_does_not():
    def line(place: Any) -> dict[str, Any] | None:
        return site.read_card("a", json.dumps({"format": "azimut-article/1", "title": "T", "date": "2026-01-01",
                                               "place": place}).encode())

    assert line({"lat": 12, "lon": -43.50750049})["place"] == {"lat": 12.0, "lon": -43.5075, "name": ""}
    assert line({"lat": 12, "lon": 43, "name": None})["place"]["name"] == ""
    for bad in (None, "12.7, 43.5", {"lat": 12}, {"lat": 12, "lon": 200}, {"lat": False, "lon": 1},
                {"lat": 1, "lon": 1, "name": 7}, {"lat": 1, "lon": 1, "name": "x" * 81}):
        made = line(bad)
        assert made is not None and made["title"] == "T" and "place" not in made, bad
    # a card made by Azimut with no place writes none, so its file is the card it always was
    plain = site.Card(title="T", summary="", date="2026-01-01")
    assert "place" not in json.loads(plain.as_json())
    placed = site.Card(title="T", summary="", date="2026-01-01", place=notelook.NotePlace(**BAB))
    assert json.loads(placed.as_json())["place"] == KEPT and site.line_of(placed, "t")["place"] == KEPT


# -- the look ---------------------------------------------------------------------------------------------------


def test_the_place_is_a_look_key_written_only_once_set_and_never_in_a_template(client):
    assert "place" not in notelook.NoteLook().model_dump(mode="json")
    look = notelook.NoteLook.model_validate({"place": BAB})
    assert look.model_dump(mode="json")["place"] == KEPT and not look.is_default
    # a later look's unreadable place is dropped by an older reader, the rest kept
    read = notelook.parse({"style": "report", "place": {"lat": 99, "lon": 1}})
    assert read is not None and read.style == "report" and read.place is None
    with pytest.raises(ValidationError):
        notelook.TemplateLook.model_validate({"place": BAB})
    # set from the Look like any key, and kept when the Look is saved again with it
    cid = make_case(client, "Look")
    made = make_note(client, cid, title="Placed")
    route = f"/api/cases/{cid}/notes/{made['id']}/look"
    assert client.put(route, json={"style": "article", "place": BAB}).json()["look"]["place"] == KEPT
    assert client.get(route).json()["look"]["place"] == KEPT
    refused = client.put(route, json={"place": {"lat": 1, "lon": 999}})
    assert refused.status_code == 422 and "longitude" in refused.json()["detail"]
    assert client.get(route).json()["look"]["place"] == KEPT


# -- the point a note offers ------------------------------------------------------------------------------------


def _place(case: Case, label: str, lat: float, lon: float) -> str:
    return case.add_entity("place", label, {"lat": lat, "lon": lon}, by="user")["id"]


def _proof(case: Case, title: str, points: list[dict[str, Any]], depicts: str = "") -> str:
    spec = layout.proof_spec_rel(title)
    case.resolve_inside(spec).parent.mkdir(parents=True, exist_ok=True)
    case.resolve_inside(spec).write_text(json.dumps({"coordsText": points[0]["coords"], "points": points}),
                                         encoding="utf-8")
    proof = case.add_entity("proof", title, {"kind": "image", "spec": spec}, by="proof-composer")["id"]
    if depicts:
        case.add_link(proof, depicts, link_engine.DEPICTS, by="proof-composer")
    return proof


def _offered(client, cid: str, text: str) -> dict[str, Any] | None:
    made = make_note(client, cid, title="Offered", content=text)
    answer = client.get(f"/api/cases/{cid}/notes/{made['id']}/place")
    assert answer.status_code == 200, answer.text
    # offering is a read: the look keeps no place until the analyst takes it
    assert "place" not in client.get(f"/api/cases/{cid}/notes/{made['id']}/look").json()["look"]
    return answer.json()["suggested"]


def test_a_note_naming_one_place_offers_it_and_two_offer_nothing(client):
    cid = make_case(client, "Strait")
    case = Case.open(cid)
    strait = _place(case, "Bab al-Mandab", 12.7250041, 43.5075)
    port = _place(case, "Mocha port", 13.32, 43.25)
    assert _offered(client, cid, f"Ships off [[entity:{strait}|the strait]].\n") == {
        "lat": 12.725004, "lon": 43.5075, "name": "Bab al-Mandab", "from": "place", "label": "Bab al-Mandab"}
    # named twice is still one place
    twice = f"[[entity:{strait}|The strait]] and again [[entity:{strait}|it]].\n"
    assert _offered(client, cid, twice)["name"] == "Bab al-Mandab"
    assert _offered(client, cid, f"[[entity:{strait}|A]] and [[entity:{port}|B]].\n") is None
    # nothing is offered by a note naming no place, or naming one only in code or in an internal passage
    assert _offered(client, cid, "A guide to the tool.\n") is None
    assert _offered(client, cid, f"```\n[[entity:{strait}|in code]]\n```\n") is None
    assert _offered(client, cid, f"Words.\n\n> [!internal]\n> [[entity:{strait}|kept back]]\n") is None


def test_a_proof_offers_where_it_concluded_and_counts_as_the_place_it_depicts(client):
    cid = make_case(client, "Proofs")
    case = Case.open(cid)
    strait = _place(case, "Bab al-Mandab", 12.725, 43.5075)
    jetty = _proof(case, "Jetty", [{"coords": "13.31, 43.24", "label": "Mocha jetty"},
                                   {"coords": "13.30, 43.23", "label": "Roof", "pov": True}])
    assert _offered(client, cid, f"[[media:{jetty}|Jetty]]\n") == {
        "lat": 13.31, "lon": 43.24, "name": "Mocha jetty", "from": "proof", "label": "Jetty"}
    # a proof seen only from where it was filmed offers nothing: a public edition may round that point away
    filmed = _proof(case, "Filmed", [{"coords": "13.1, 43.1", "label": "POV", "pov": True}])
    assert _offered(client, cid, f"[[media:{filmed}|Filmed]]\n") is None
    # the proofs of one place and the place itself are one place
    first = _proof(case, "First", [{"coords": "12.72, 43.50", "label": "Wake"}], depicts=strait)
    second = _proof(case, "Second", [{"coords": "12.73, 43.51", "label": "Hull"}], depicts=strait)
    text = f"[[media:{first}|First]]\n\n[[media:{second}|Second]]\n\nAt [[entity:{strait}|the strait]].\n"
    assert _offered(client, cid, text) == {
        "lat": 12.725, "lon": 43.5075, "name": "Bab al-Mandab", "from": "place", "label": "Bab al-Mandab"}
    assert _offered(client, cid, f"[[media:{first}|First]]\n\n[[media:{jetty}|Jetty]]\n") is None


def test_a_note_naming_no_place_offers_where_its_one_map_looks(client):
    cid = make_case(client, "Maps")
    one = "::: map\ntitle: The strait\nlayer: Ships\nview: 12.6, 43.4, 9\n:::\n"
    framed = "::: map\ntitle: Framed\nlayer: Ships\nframe: 43.0, 12.0, 44.0, 13.0\n:::\n"
    assert _offered(client, cid, one) == {"lat": 12.6, "lon": 43.4, "name": "", "from": "map", "label": "The strait"}
    assert _offered(client, cid, framed)["lat"] == 12.5 and _offered(client, cid, framed)["lon"] == 43.5
    assert _offered(client, cid, one + "\n" + framed) is None
    assert _offered(client, cid, "::: map\ntitle: Nowhere\nlayer: Ships\n:::\n") is None
    # a place named wins over the map, and a place named beside two maps is still the one place
    case = Case.open(cid)
    port = _place(case, "Mocha port", 13.32, 43.25)
    assert _offered(client, cid, f"[[entity:{port}|Mocha]]\n\n{one}\n{framed}")["from"] == "place"


def test_the_offer_reads_a_point_web_maps_cannot_draw_as_none(client):
    cid = make_case(client, "Far north")
    case = Case.open(cid)
    pole = _place(case, "Station Nord", 81.6, -16.7)
    far = _place(case, "North Pole", 89.9, 0.0)
    assert _offered(client, cid, f"[[entity:{pole}|Nord]]\n")["lat"] == 81.6
    assert _offered(client, cid, f"[[entity:{far}|Pole]]\n") is None
    # the place web maps cannot draw is still a place named: the other is not the note's one place
    assert _offered(client, cid, f"[[entity:{far}|Pole]] and [[entity:{pole}|Nord]]\n") is None
    assert siteplace.named_ids(f"[a](azimut://entity/{far}) [[entity:{pole}|b]]") == [far, pole]
