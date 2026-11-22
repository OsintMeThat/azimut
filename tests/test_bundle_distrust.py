"""A bundle from someone else, read with distrust (`engine/bundles.py`, `engine/filescreen.py`).

Its database may hold nothing Azimut's schema does not, or it is refused; what could run when
opened, and a file whose name claims a picture, a video or a sound its first bytes are not, are
named before the import and left out of it unless the analyst keeps them.
"""

from __future__ import annotations

import os
import sqlite3
import zipfile
from contextlib import closing
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import bundles, filescreen, workqueue
from azimut.workspace import Case

import schema_rewind

PE = b"MZ\x90\x00\x03\x00\x00\x00\x04\x00\x00\x00\xff\xff" + bytes(48)
ELF = b"\x7fELF\x02\x01\x01" + bytes(57)
HTML = b"<!doctype html><html><script>alert(1)</script></html>"
PLAYLIST = b"#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0\nconcat:file:///etc/passwd\n"


def _jpeg() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), (200, 40, 40)).save(buffer, "JPEG")
    return buffer.getvalue()


def _png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (8, 8), (40, 40, 200)).save(buffer, "PNG")
    return buffer.getvalue()


@pytest.fixture()
def source(tmp_workspace, monkeypatch) -> Case:
    """A case holding what an analyst's case ordinarily does: a note, a picture, a document."""
    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Guest case")
    case.create_note("Witness", "", content="# Witness\n")
    (case.path / "files").mkdir()
    (case.path / "files" / "report.pdf").write_bytes(b"%PDF-1.7\n" + bytes(80))
    (case.path / "files" / "notes.txt").write_text("plain words\n", encoding="utf-8")
    (case.path / "files" / "harbour.jpg").write_bytes(_jpeg())
    # a PNG saved as .jpg, as downloads often are: a picture all the same
    (case.path / "files" / "saved-as.jpg").write_bytes(_png())
    (case.path / "files" / "empty.mp4").write_bytes(b"")
    return case


def _plant(case: Case, files: dict[str, bytes]) -> None:
    for rel, data in files.items():
        target = case.path / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)


def _import(exported: Path, **options) -> tuple[Case, dict]:
    destination = Case.create(bundles.imported_name("guest"))
    answer = bundles.import_into(destination, exported, **options)
    return Case.open(answer["case_id"]), answer


# -- what the screen reads -----------------------------------------------------------------------------------


@pytest.mark.parametrize(("name", "head", "said"), [
    ("files/setup.exe", PE, filescreen.WINDOWS_PROGRAM),
    ("files/invoice.pdf", PE, filescreen.WINDOWS_PROGRAM),
    ("files/tool", ELF, filescreen.LINUX_PROGRAM),
    ("files/tool.bin", b"\xcf\xfa\xed\xfe" + bytes(60), filescreen.MAC_PROGRAM),
    ("files/fat", b"\xca\xfe\xba\xbe\x00\x00\x00\x02" + bytes(56), filescreen.MAC_PROGRAM),
    ("files/Main.class", b"\xca\xfe\xba\xbe\x00\x00\x00\x34" + bytes(56), filescreen.JAVA_PROGRAM),
    ("files/readme.txt", b"#!/bin/sh\nrm -rf ~\n", filescreen.SCRIPT),
    ("files/run.BAT", b"@echo off\n", filescreen.SCRIPT),
    ("files/map.js", b"var a = 1;\n", filescreen.SCRIPT),
    ("files/setup.msi", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + bytes(56), filescreen.INSTALLER),
    ("files/photo.lnk", b"anything", filescreen.SHORTCUT),
    ("files/photo", b"\x4c\x00\x00\x00\x01\x14\x02\x00\x00\x00\x00\x00\xc0\x00\x00\x00\x00\x00\x00\x46", filescreen.SHORTCUT),
    ("files/budget.xlsm", b"PK\x03\x04", filescreen.MACROS),
    ("files/Tool.app/Contents/Info.plist", b"<?xml", filescreen.MAC_APP),
    ("files/holiday.jpg", HTML, "named .jpg but not a picture"),
    ("files/clip.mp4", PLAYLIST, "named .mp4 but not a video"),
    ("files/voice.mp3", PE, filescreen.WINDOWS_PROGRAM),
    ("files/voice.ogg", b"plain text", "named .ogg but not a sound"),
    # a program is one in the case's web folders too, and a script anywhere else
    ("azimut/exports/web/x/reader.js", PE, filescreen.WINDOWS_PROGRAM),
    ("azimut/exports/web/x/run.sh", b"echo", filescreen.SCRIPT),
    ("azimut/media/reader.js", b"(function(){})();", filescreen.SCRIPT),
    ("reader.js", b"(function(){})();", filescreen.SCRIPT),
    ("exports/web/x/reader.js", b"(function(){})();", filescreen.SCRIPT),
])
def test_what_runs_and_what_lies_about_itself_is_named(name, head, said):
    assert filescreen.reason(name, head) == said


@pytest.mark.parametrize(("name", "head"), [
    ("files/report.pdf", b"%PDF-1.7"),
    ("files/notes.txt", b"plain words"),
    ("files/archive.zip", b"PK\x03\x04"),
    ("azimut/.data/case.db", b"SQLite format 3\x00"),
    ("azimut/case.json", b"{\"name\": \"x\"}"),
    ("files/harbour.jpg", b"\xff\xd8\xff\xe0" + bytes(60)),
    ("files/saved-as.jpg", b"\x89PNG\r\n\x1a\n" + bytes(56)),
    ("files/saved-as.jpg", b"RIFF\x00\x00\x00\x00WEBPVP8 "),
    ("files/iphone.heic", b"\x00\x00\x00\x18ftypheic" + bytes(52)),
    ("files/clip.mov", b"\x00\x00\x00\x14ftypqt  " + bytes(52)),
    ("files/clip.webm", b"\x1a\x45\xdf\xa3" + bytes(60)),
    ("files/voice.amr", b"#!AMR\n" + bytes(58)),
    ("files/voice.mp3", b"ID3\x04" + bytes(60)),
    ("files/drawing.svg", b"\xef\xbb\xbf  <svg xmlns='http://www.w3.org/2000/svg'/>"),
    ("files/empty.mp4", b""),
    ("azimut/exports/web/port-strike/assets/reader.js", b"(function(){'use strict';"),
    ("azimut/exports/web/port-strike/assets/maplibre-gl.mjs", b"/**\n * MapLibre GL JS"),
])
def test_an_ordinary_file_is_left_alone(name, head):
    assert filescreen.reason(name, head) == ""


# -- the inspect names them, before anything is imported ----------------------------------------------------


def test_an_ordinary_case_is_flagged_for_nothing_and_comes_back_whole(source):
    exported = bundles.export_case(source)
    preview = bundles.inspect_bundle(exported)
    assert (preview["flagged"], preview["flagged_count"]) == ([], 0)
    landed, answer = _import(exported)
    assert answer["left_out"] == []
    for name in ("report.pdf", "notes.txt", "harbour.jpg", "saved-as.jpg", "empty.mp4"):
        assert (landed.path / "files" / name).read_bytes() == (source.path / "files" / name).read_bytes()


def test_a_case_with_a_note_exported_as_a_web_folder_comes_back_whole(source):
    web = layout.subdir(source.path, "exports") / "web" / "port-strike"
    _plant(source, {
        str((web / "index.html").relative_to(source.path)): b"<!doctype html><html></html>",
        str((web / "assets" / "reader.js").relative_to(source.path)): b"(function(){'use strict';})();",
        str((web / "assets" / "maplibre-gl.js").relative_to(source.path)): b"/** MapLibre GL JS */",
    })
    exported = bundles.export_case(source)
    assert bundles.inspect_bundle(exported)["flagged_count"] == 0
    landed, answer = _import(exported)
    assert answer["left_out"] == []
    home = layout.subdir(landed.path, "exports") / "web" / "port-strike" / "assets"
    assert (home / "reader.js").is_file() and (home / "maplibre-gl.js").is_file()


@pytest.mark.parametrize("password", [None, "secret"])
def test_the_inspect_names_each_program_and_disguised_file_with_its_reason(source, password):
    _plant(source, {"files/setup.exe": PE, "files/holiday.jpg": HTML,
                    "files/Tool.app/Contents/MacOS/Tool": b"\xcf\xfa\xed\xfe" + bytes(60),
                    "files/Tool.app/Contents/Info.plist": b"<?xml version='1.0'?>"})
    exported = bundles.export_case(source, password=password)
    preview = bundles.inspect_bundle(exported, password=password)
    assert sorted((item["name"], item["reason"]) for item in preview["flagged"]) == [
        ("files/Tool.app", filescreen.MAC_APP),
        ("files/holiday.jpg", "named .jpg but not a picture"),
        ("files/setup.exe", filescreen.WINDOWS_PROGRAM),
    ]
    assert preview["flagged_count"] == 3


def test_a_sealed_bundle_is_screened_without_decrypting_all_of_it(source, monkeypatch):
    # bytes that do not deflate, so the bundle is many chunks long
    _plant(source, {"files/setup.exe": PE, **{f"files/big-{index}.bin": os.urandom(3 * 1024 * 1024) for index in range(4)}})
    exported = bundles.export_case(source, password="secret")
    opened: list[int] = []
    real = bundles._SealedReader._chunk

    def counted(self, index):
        opened.append(index)
        return real(self, index)

    monkeypatch.setattr(bundles._SealedReader, "_chunk", counted)
    preview = bundles.inspect_bundle(exported, password="secret")
    assert [item["name"] for item in preview["flagged"]] == ["files/setup.exe"]
    whole = -(-exported.stat().st_size // (bundles.CHUNK_SIZE + 16))
    assert len(set(opened)) < whole


def test_the_list_is_bounded_and_the_count_is_whole(source, monkeypatch):
    monkeypatch.setattr(bundles, "MAX_FLAGGED_LISTED", 2)
    _plant(source, {f"files/run-{index}.bat": b"@echo off\n" for index in range(5)})
    preview = bundles.inspect_bundle(bundles.export_case(source))
    assert len(preview["flagged"]) == 2 and preview["flagged_count"] == 5


# -- the import leaves them out, unless kept ---------------------------------------------------------------


def test_a_program_and_a_disguised_picture_are_left_out_and_said(source):
    _plant(source, {"files/setup.exe": PE, "files/holiday.jpg": HTML, "files/clip.mp4": PLAYLIST})
    landed, answer = _import(bundles.export_case(source))
    assert not (landed.path / "files" / "setup.exe").exists()
    assert not (landed.path / "files" / "holiday.jpg").exists()
    assert not (landed.path / "files" / "clip.mp4").exists()
    assert (landed.path / "files" / "harbour.jpg").is_file() and (landed.path / "files" / "report.pdf").is_file()
    assert sorted(item["name"] for item in answer["left_out"]) == ["files/clip.mp4", "files/holiday.jpg",
                                                                  "files/setup.exe"]


def test_the_analyst_may_keep_them(source):
    _plant(source, {"files/setup.exe": PE, "files/holiday.jpg": HTML})
    landed, answer = _import(bundles.export_case(source), keep=True)
    assert (landed.path / "files" / "setup.exe").read_bytes() == PE
    assert (landed.path / "files" / "holiday.jpg").read_bytes() == HTML
    assert answer["left_out"] == []


def test_a_member_left_out_is_still_read_whole_so_a_bundle_lying_about_it_is_refused(source):
    _plant(source, {"files/holiday.jpg": HTML})
    exported = bundles.export_case(source)
    data = bytearray(exported.read_bytes())
    # a picture is stored as it is, so its bytes are found in the bundle
    at = data.find(HTML)
    assert at > 0
    data[at + 20] ^= 0xFF
    exported.write_bytes(data)
    with pytest.raises((bundles.BundleError, zipfile.BadZipFile)):
        _import(exported)


def test_the_browser_import_keeps_them_only_when_asked_and_its_job_says_what_it_left_out(client, source):
    _plant(source, {"files/setup.exe": PE})
    exported = bundles.export_case(source)
    for keep in (False, True):
        preview = client.post("/api/cases/bundles/inspect",
                              files={"file": ("guest.azimut.zip", exported.read_bytes(), "application/zip")}).json()
        assert preview["flagged"] == [{"name": "files/setup.exe", "reason": filescreen.WINDOWS_PROGRAM}]
        body = {"upload_id": preview["upload_id"], "password": None, **({"keep_flagged": True} if keep else {})}
        started = client.post("/api/cases/bundles/import", json=body).json()
        imported = Case.open(started["case_id"])
        assert workqueue.drain(imported) == 1
        status = client.get(f"/api/cases/{started['case_id']}/bundle/jobs/{started['job_id']}").json()
        assert status["state"] == "ready"
        landed = Case.open(started["case_id"])
        if keep:
            assert (landed.path / "files" / "setup.exe").is_file()
            assert (status["left_out"], status["left_out_count"]) == ([], 0)
        else:
            assert not (landed.path / "files" / "setup.exe").exists()
            assert status["left_out"] == [{"name": "files/setup.exe", "reason": filescreen.WINDOWS_PROGRAM}]
            assert status["left_out_count"] == 1


# -- the database holds nothing Azimut never makes -----------------------------------------------------------


@pytest.mark.parametrize("crafted", [
    "CREATE TRIGGER sneak AFTER INSERT ON entities BEGIN UPDATE entities SET label = 'changed'; END",
    "CREATE VIEW extra AS SELECT id FROM entities",
    "CREATE TABLE extra (id TEXT)",
    "CREATE INDEX idx_extra ON entities(label, type)",
])
def test_a_database_holding_what_azimut_never_makes_is_refused(source, monkeypatch, crafted):
    real = bundles._clean_database

    def crafting(origin, target):
        real(origin, target)
        with closing(sqlite3.connect(target)) as conn:
            conn.execute(crafted)
            conn.commit()

    monkeypatch.setattr(bundles, "_clean_database", crafting)
    exported = bundles.export_case(source)
    monkeypatch.setattr(bundles, "_clean_database", real)
    with pytest.raises(bundles.BundleError, match="holds what Azimut never makes"):
        _import(exported)


def test_sqlites_own_statistics_are_no_reason_to_refuse(source, monkeypatch):
    real = bundles._clean_database

    def analysed(origin, target):
        real(origin, target)
        with closing(sqlite3.connect(target)) as conn:
            conn.execute("ANALYZE")
            conn.commit()
            assert conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'sqlite_stat1'").fetchone()

    monkeypatch.setattr(bundles, "_clean_database", analysed)
    exported = bundles.export_case(source)
    monkeypatch.setattr(bundles, "_clean_database", real)
    landed, _ = _import(exported)
    assert [entity["label"] for entity in landed.list_entities()] == ["Witness"]


def test_the_expected_objects_are_a_fresh_databases_and_none_is_a_trigger_or_a_view():
    expected = bundles.expected_objects()
    assert ("table", "entities") in expected and ("index", "idx_entities_type") in expected
    assert not {kind for kind, _ in expected} - {"table", "index"}


@pytest.mark.parametrize("shipped", [7, 17, 18])
def test_a_case_from_each_release_imports_and_migrates_to_exactly_the_expected_objects(source, monkeypatch, shipped):
    """What makes one expected set right for every release: an older database holds a part of it,
    and its migration adds the rest and nothing else."""
    real = bundles._clean_database

    def older(origin, target):
        real(origin, target)
        schema_rewind.rewind(target, shipped)

    current = bundles.SQLITE_SCHEMA
    monkeypatch.setattr(bundles, "_clean_database", older)
    monkeypatch.setattr(bundles, "SQLITE_SCHEMA", shipped)
    exported = bundles.export_case(source)
    # only these two put back: the workspace this test lives in stays its own
    monkeypatch.setattr(bundles, "_clean_database", real)
    monkeypatch.setattr(bundles, "SQLITE_SCHEMA", current)
    landed, _ = _import(exported)
    with closing(sqlite3.connect(landed.db_path)) as conn:
        found = {(kind, name) for kind, name in conn.execute("SELECT type, name FROM sqlite_master")}
    expected = bundles.expected_objects()
    # the rewind rebuilds the Time projection with `CREATE TABLE … AS`, which drops its key, and so
    # SQLite's own index of it: nothing a release lacked
    assert found <= expected and all(name.startswith("sqlite_autoindex_") for _, name in expected - found)
    assert [entity["label"] for entity in landed.list_entities()] == ["Witness"]
    assert layout.data_dir(landed.path).is_dir()
