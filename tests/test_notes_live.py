"""A map in a web folder, live online (`engine/notes_web.py`, `notes_html_assets/reader.live.js`).

A web folder whose page holds a map carries MapLibre GL JS as files, copied from the build
the frontend leaves in `static/vendor/maplibre/`, and its licence; its page names them for
the reader, and its policy alone lets the page reach OpenFreeMap's one host. Nothing of it
when the folder's maps are kept offline, when the page holds no map, or when this copy of
Azimut was built without MapLibre, which the check then says once. The single HTML file and
an offline folder stay as they were (`test_notes_live_golden.py`).
"""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import pytest

from azimut.engine import notes_html, notes_web
from azimut.engine import notes_markdown as md
from azimut.workspace import Case

from test_notes_maps import _case, _ground, _markers, _tags, _tracked_line
from test_notes_maps import tiles_here  # noqa: F401  (the fixture: every tile from nowhere)
from test_notes_pdf import exports_of

pytestmark = pytest.mark.usefixtures("tiles_here")

#: MapLibre's build as the frontend leaves it, made small.
VENDOR = {
    "maplibre-gl.js": b'import{a}from"./maplibre-gl-shared.js";export const Map=1;\n',
    "maplibre-gl-shared.js": b"export const a=1;\n",
    "maplibre-gl-worker.js": b'import{a}from"./maplibre-gl-shared.js";\n',
    "maplibre-gl.css": b".maplibregl-map{position:relative}\n",
    "LICENSE.txt": b"Copyright (c) 2023, MapLibre contributors\n",
    "VERSION": b"6.8.0\n",
}
LIVE_POLICY = ("default-src 'none'; img-src 'self' https://tiles.openfreemap.org; media-src 'self'; font-src 'self'; "
               "style-src 'self' 'unsafe-inline'; script-src 'self'; base-uri 'none'; form-action 'none'; "
               "connect-src 'self' https://tiles.openfreemap.org")


@pytest.fixture()
def vendor(tmp_path, monkeypatch):
    """MapLibre's build where the frontend leaves it."""
    folder = tmp_path / "vendor" / "maplibre"
    folder.mkdir(parents=True)
    for name, data in VENDOR.items():
        (folder / name).write_bytes(data)
    monkeypatch.setattr(notes_web, "LIVE_VENDOR", folder)
    return folder


@pytest.fixture()
def unbuilt(tmp_path, monkeypatch):
    """A tree whose frontend was never built."""
    monkeypatch.setattr(notes_web, "LIVE_VENDOR", tmp_path / "never-built")


def _map_note(client, title="Front", *, maps=1) -> tuple[str, Case, str]:
    cid, case = _case(client, title)
    line = _tracked_line(case)
    vehicles = _markers(client, cid)
    ground = _ground(client, cid)
    block = f"::: map\ntitle: The line\nlayer: {line}\nlayer: {vehicles}\nground: {ground}\n:::\n"
    text = "# Front\n\nThe line moved.\n\n" + "\n".join([block] * maps)
    note = case.create_note(title, "", content=text)["id"]
    return cid, case, note


def _policy(page: bytes) -> str:
    return next(attrs["content"] for tag, attrs in _tags(page) if tag == "meta" and attrs.get("http-equiv") == "Content-Security-Policy")


def _said(page: bytes) -> dict:
    found = re.search(rb'<script type="application/json" id="az-gl">(.*?)</script>', page)
    assert found, "the page names no live map"
    return json.loads(found.group(1))


# -- the folder ------------------------------------------------------------------------------------


def test_a_folder_with_a_map_carries_maplibre_its_licence_and_the_readers_live_part(client, vendor):
    _, case, note = _map_note(client)
    built = notes_web.build(case, note)
    files = built.files
    assert built.maps == 1 and built.live
    for name in ("maplibre-gl.js", "maplibre-gl-shared.js", "maplibre-gl-worker.js", "maplibre-gl.css"):
        # under their own names, which they call one another by, beside one another
        assert files[f"assets/maplibre-6.8.0/{name}"] == VENDOR[name]
    assert files[notes_web.LIVE_LICENSE] == VENDOR["LICENSE.txt"]
    said = _said(files["index.html"])
    assert said["maplibre"] == "assets/maplibre-6.8.0/maplibre-gl.js" and said["css"] == "assets/maplibre-6.8.0/maplibre-gl.css"
    assert said["style"] == "https://tiles.openfreemap.org/styles/liberty"
    # the reader's live part is the asset as written, a file of the folder named by its content
    assert re.fullmatch(r"assets/[0-9a-f]{8}-reader-live\.js", said["module"])
    assert files[said["module"]] == (notes_html.ASSETS / "reader.live.js").read_bytes()
    sheet = next(data for path, data in files.items() if path.endswith("-reader.css")).decode("utf-8")
    assert ".az-gl {" in sheet and ".az-gl-base" in sheet
    # every file the page and its config name is in the folder
    assert {said["module"], said["maplibre"], said["css"]} <= set(files)
    # its weight counts what it carries
    assert built.weight >= sum(len(data) for name, data in VENDOR.items() if name not in ("LICENSE.txt", "VERSION"))
    assert not built.warnings or notes_web.LIVE_MISSING not in built.warnings


def test_only_a_page_with_a_live_map_widens_its_policy_and_only_to_openfreemap(client, vendor):
    _, case, note = _map_note(client)
    live = notes_web.build(case, note).files["index.html"]
    assert _policy(live) == LIVE_POLICY
    assert _policy(live) == notes_web.folder_csp(notes_web.LIVE_SOURCES)
    hosts = set(re.findall(r"https://[\w.-]+", _policy(live)))
    assert hosts == {notes_web.LIVE_HOST}
    # no worker or child source: its worker is a file of the folder, which `script-src 'self'` lets in
    assert "worker-src" not in _policy(live) and "child-src" not in _policy(live) and "blob:" not in _policy(live)
    plain = case.create_note("No map", "", content="# No map\n\nJust words.\n")["id"]
    built = notes_web.build(case, plain)
    assert _policy(built.files["index.html"]) == notes_web.folder_csp()
    assert not built.live and not any("maplibre" in path for path in built.files)
    assert notes_web.LIVE_LICENSE not in built.files and b'id="az-gl"' not in built.files["index.html"]


def test_maps_kept_offline_are_the_html_reports_and_reach_nothing(client, vendor):
    _, case, note = _map_note(client)
    built = notes_web.build(case, note, live=False)
    page = built.files["index.html"]
    assert built.maps == 1 and not built.live
    assert _policy(page) == notes_web.folder_csp()
    assert b"openfreemap" not in page and b'id="az-gl"' not in page
    assert not any("maplibre" in path or "reader-live" in path for path in built.files)
    assert notes_web.LIVE_LICENSE not in built.files
    sheet = next(data for path, data in built.files.items() if path.endswith("-reader.css"))
    assert b".az-gl {" not in sheet
    assert notes_web.LIVE_MISSING not in built.warnings


def test_a_copy_built_without_maplibre_keeps_its_maps_offline_and_says_so_once(client, unbuilt):
    _, case, note = _map_note(client, maps=2)
    assert notes_web.live_maps() is None
    built = notes_web.build(case, note)
    assert built.maps == 2 and not built.live
    assert built.warnings.count(notes_web.LIVE_MISSING) == 1
    assert _policy(built.files["index.html"]) == notes_web.folder_csp()
    assert not any("maplibre" in path for path in built.files)


def test_a_vendor_folder_not_whole_is_no_vendor_folder(vendor):
    assert notes_web.live_maps() is not None
    (vendor / "VERSION").write_text("6.8.0/../../x\n", encoding="utf-8")
    assert notes_web.live_maps() is None
    (vendor / "VERSION").write_text("6.8.0\n", encoding="utf-8")
    (vendor / "maplibre-gl-worker.js").unlink()
    assert notes_web.live_maps() is None


def test_the_single_html_file_never_goes_live(client, vendor):
    _, case, note = _map_note(client)
    found = md.read_note(case, note)
    assert found is not None
    single = notes_html.render(case, title=found[0], text=found[1], public=True).html
    assert _policy(single) == notes_html.CSP
    assert b"openfreemap" not in single and b'id="az-gl"' not in single and b"maplibre-gl" not in single


# -- the routes ------------------------------------------------------------------------------------


def test_the_check_says_whether_the_folders_maps_go_live(client, vendor):
    cid, case, note = _map_note(client)
    route = f"/api/cases/{cid}/notes/pdf/check"
    web = client.post(route, json={"notes": [note], "format": "web"}).json()["notes"][0]
    assert web["live"] is True
    plain = case.create_note("No map", "", content="# No map\n\nJust words.\n")["id"]
    assert client.post(route, json={"notes": [plain], "format": "web"}).json()["notes"][0]["live"] is False
    # an HTML file is one offline file whatever it holds
    assert client.post(route, json={"notes": [note], "format": "html"}).json()["notes"][0]["live"] is False


def test_the_check_says_nothing_goes_live_in_a_copy_built_without_maplibre(client, unbuilt):
    cid, _, note = _map_note(client)
    said = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note], "format": "web"}).json()["notes"][0]
    assert said["live"] is False
    assert {"text": notes_web.LIVE_MISSING, "line": None, "kind": "other"} in said["warnings"]


def test_the_export_keeps_the_maps_offline_when_asked(client, vendor):
    cid, _, note = _map_note(client)
    route = f"/api/cases/{cid}/notes/web"
    live = client.post(route, json={"notes": [note]})
    assert live.status_code == 200, live.text
    folder = exports_of(cid) / "web" / live.json()["written"][0]["file"]
    assert (folder / notes_web.LIVE_LICENSE).is_file() and (folder / "assets" / "maplibre-6.8.0" / "maplibre-gl-worker.js").is_file()
    assert "openfreemap" in _policy((folder / "index.html").read_bytes())
    offline = client.post(route, json={"notes": [note], "offline_maps": True})
    assert offline.status_code == 200, offline.text
    assert not (folder / notes_web.LIVE_LICENSE).exists() and not (folder / "assets" / "maplibre-6.8.0").exists()
    assert _policy((folder / "index.html").read_bytes()) == notes_web.folder_csp()
    assert client.post(route, json={"notes": [note], "offline_maps": "maybe"}).status_code == 422


def test_the_wheel_check_names_the_live_maps_assets():
    """The release's wheel check fails a wheel without the reader's live part."""
    workflow = (Path(__file__).resolve().parents[1] / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    for name in ("reader.live.js", "reader.live.css"):
        assert f"azimut/engine/notes_html_assets/{name}" in workflow
    for name in notes_web.LIVE_FILES:
        assert f"azimut/static/vendor/maplibre/{name}" in workflow


# -- what the browser tests read -------------------------------------------------------------------

#: What a page with a live map is read under, as the browser test serves it
#: (`frontend/e2e/notebook-web-live.spec.js`); written again with `UPDATE_LIVE_FIXTURE=1`.
FIXTURE = Path(__file__).resolve().parents[1] / "frontend/src/lib/notes/liveFolder.fixture.json"


def test_the_live_folder_fixture_is_what_the_engine_writes():
    said = {"csp": notes_web.folder_csp(notes_web.LIVE_SOURCES), "style": notes_web.LIVE_STYLE, "host": notes_web.LIVE_HOST}
    written = json.dumps(said, indent=2) + "\n"
    if os.environ.get("UPDATE_LIVE_FIXTURE"):
        FIXTURE.write_text(written, encoding="utf-8")
    assert FIXTURE.read_text(encoding="utf-8") == written
