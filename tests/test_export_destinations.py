"""Shared export destinations, folder browsing, and media/proof copies."""

import base64
import io
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from PIL import Image

from azimut import layout
from azimut.engine import exportdir
from azimut.workspace import Case


def _png_bytes() -> bytes:
    data = io.BytesIO()
    Image.new("RGB", (24, 16), (80, 90, 100)).save(data, "PNG")
    return data.getvalue()


def _case(client, name: str = "Exports") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _upload(client, case_id: str, name: str = "frame.png") -> dict:
    response = client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": (name, io.BytesIO(_png_bytes()), "image/png")},
    )
    assert response.status_code == 200
    return response.json()["item"]


def _save_proof(client, case_id: str, title: str = "Rooftop") -> dict:
    return client.post(
        f"/api/cases/{case_id}/proofs",
        json={
            "title": title,
            "spec": {"panels": [], "shapes": []},
            "png_base64": base64.b64encode(_png_bytes()).decode("ascii"),
        },
    ).json()


def test_export_destinations_are_remembered_independently(client, tmp_path):
    notes = tmp_path / "notes"
    media = tmp_path / "media"
    notes.mkdir()
    media.mkdir()

    response = client.put(
        "/api/settings/prefs",
        json={"export_dirs": {"notes": str(notes), "media": str(media)}},
    )

    assert response.status_code == 200
    assert response.json()["export_dirs"] == {
        "notes": str(notes),
        "media": str(media),
        "proofs": "",
        "views": "",
    }
    # Every kind answers, so a new one cannot ship without a folder of its own.
    assert set(response.json()["export_dirs"]) == set(exportdir.KINDS)
    assert client.get("/api/settings").json()["export_dirs"]["notes"] == str(notes)

    reset = client.put("/api/settings/prefs", json={"export_dirs": {"notes": ""}})
    assert reset.json()["export_dirs"]["notes"] == ""
    assert reset.json()["export_dirs"]["media"] == str(media)


def test_an_export_destination_must_be_an_existing_writable_folder(client, tmp_path):
    missing = tmp_path / "missing"
    file_path = tmp_path / "file.txt"
    file_path.write_text("not a folder", encoding="utf-8")

    assert client.put(
        "/api/settings/prefs", json={"export_dirs": {"media": str(missing)}}
    ).status_code == 422
    assert client.put(
        "/api/settings/prefs", json={"export_dirs": {"media": str(file_path)}}
    ).status_code == 422


def test_folder_browser_lists_only_visible_folders_and_can_create_one(client, tmp_path):
    (tmp_path / "Visible").mkdir()
    (tmp_path / ".hidden").mkdir()
    (tmp_path / "file.txt").write_text("private contents", encoding="utf-8")

    listed = client.get("/api/folders", params={"path": str(tmp_path)})

    assert listed.status_code == 200
    assert [entry["name"] for entry in listed.json()["folders"]] == ["Visible"]
    assert "file.txt" not in listed.text
    assert "private contents" not in listed.text

    created = client.post(
        "/api/folders/create", json={"parent": str(tmp_path), "name": "Final report"}
    )
    assert created.status_code == 200
    assert created.json()["name"] == "Final report"
    assert (tmp_path / "Final report").is_dir()


def test_writability_probe_never_touches_a_preexisting_file(client, tmp_path):
    sentinel = tmp_path / ".azimut-write-test"
    sentinel.write_bytes(b"belongs to the analyst")

    listed = client.get("/api/folders", params={"path": str(tmp_path)})
    saved = client.put(
        "/api/settings/prefs", json={"export_dirs": {"notes": str(tmp_path)}}
    )

    assert listed.status_code == saved.status_code == 200
    assert sentinel.read_bytes() == b"belongs to the analyst"
    assert [path for path in tmp_path.glob(".azimut-write-*") if path != sentinel] == []


def test_folder_listing_stops_scanning_a_file_heavy_directory(tmp_path, monkeypatch):
    class Entry:
        def __init__(self, index):
            self.name = f"file-{index}"

        def is_dir(self):
            return False

    class Entries:
        consumed = 0

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            for index in range(exportdir.MAX_SCANNED_ENTRIES + 20):
                self.consumed += 1
                yield Entry(index)

    entries = Entries()
    monkeypatch.setattr(exportdir.os, "scandir", lambda _path: entries)

    listed = exportdir.listing(str(tmp_path))

    assert listed["folders"] == []
    assert listed["truncated"] is True
    assert entries.consumed == exportdir.MAX_SCANNED_ENTRIES + 1


def test_media_export_defaults_to_the_case_then_uses_the_saved_folder(client, tmp_path):
    case_id = _case(client, "Media export")
    item = _upload(client, case_id)

    first = client.post(f"/api/cases/{case_id}/media/export", json={"path": item["path"]})
    default = layout.subdir(Case.open(case_id).path, "exports")
    assert first.status_code == 200
    assert first.json()["folder"] == str(default)
    assert (default / "frame.png").read_bytes() == _png_bytes()

    chosen = tmp_path / "evidence"
    chosen.mkdir()
    client.put("/api/settings/prefs", json={"export_dirs": {"media": str(chosen)}})
    client.post(f"/api/cases/{case_id}/media/export", json={"path": item["path"]})
    again = client.post(f"/api/cases/{case_id}/media/export", json={"path": item["path"]})

    assert (chosen / "frame.png").is_file()
    assert again.json()["file"] == "frame (2).png"
    assert (chosen / "frame (2).png").is_file()


def test_concurrent_exports_reserve_distinct_names(tmp_path):
    destination = tmp_path / "exports"
    destination.mkdir()
    sources = []
    for index in range(8):
        source = tmp_path / f"source-{index}.txt"
        source.write_text(f"content {index}", encoding="utf-8")
        sources.append(source)
    barrier = Barrier(len(sources))

    def copy(index):
        barrier.wait()
        return exportdir.copy_out(sources[index], destination, "report.txt")

    with ThreadPoolExecutor(max_workers=len(sources)) as pool:
        written = list(pool.map(copy, range(len(sources))))

    assert len({path.name for path in written}) == len(sources)
    assert {path.read_text(encoding="utf-8") for path in written} == {
        f"content {index}" for index in range(len(sources))
    }


def test_a_failed_external_copy_removes_its_reserved_file(tmp_path, monkeypatch):
    source = tmp_path / "source.txt"
    source.write_text("content", encoding="utf-8")
    destination = tmp_path / "exports"
    destination.mkdir()

    def fail(_source, target):
        target.write(b"partial")
        raise OSError("disk full")

    monkeypatch.setattr(exportdir.shutil, "copyfileobj", fail)

    with pytest.raises(exportdir.ExportDirError, match="disk full"):
        exportdir.copy_out(source, destination, "report.txt")
    assert list(destination.iterdir()) == []


def test_media_export_refuses_a_case_file_that_is_not_registered_media(client):
    case_id = _case(client, "Media boundary")
    case = Case.open(case_id)
    case.write_notes("not media")

    response = client.post(
        f"/api/cases/{case_id}/media/export", json={"path": "notes.md"}
    )

    assert response.status_code == 404
    assert list(layout.subdir(case.path, "exports").iterdir()) == []


def test_proof_export_uses_its_own_saved_folder_and_never_overwrites(client, tmp_path):
    case_id = _case(client, "Proof export")
    saved = _save_proof(client, case_id)
    chosen = tmp_path / "proofs"
    chosen.mkdir()
    client.put("/api/settings/prefs", json={"export_dirs": {"proofs": str(chosen)}})

    first = client.post(f"/api/cases/{case_id}/proofs/{saved['name']}/export")
    second = client.post(f"/api/cases/{case_id}/proofs/{saved['name']}/export")

    assert first.status_code == 200
    assert first.json()["file"] == "Rooftop.png"
    assert second.json()["file"] == "Rooftop (2).png"
    assert (chosen / "Rooftop.png").read_bytes() == _png_bytes()


def test_reveal_routes_resolve_saved_folders_without_accepting_a_path(client, tmp_path, monkeypatch):
    case_id = _case(client, "Reveal exports")
    chosen = tmp_path / "chosen"
    chosen.mkdir()
    client.put(
        "/api/settings/prefs",
        json={"export_dirs": {"media": str(chosen), "proofs": str(chosen)}},
    )
    opened = []

    from azimut.engine import reveal

    monkeypatch.setattr(reveal, "reveal", lambda path, **_: opened.append(path))

    assert client.post(f"/api/cases/{case_id}/media/export/reveal").status_code == 200
    assert client.post(f"/api/cases/{case_id}/proofs/export/reveal").status_code == 200
    assert opened == [chosen.resolve(), chosen.resolve()]
