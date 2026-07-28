"""Import enrichment: what a local image file says about itself.

Everything here is pixels and bytes on disk. The no-network assertion is not
decoration — enrichment runs on every import, and reaching out on any of them
would break the local-first rule the whole app is built on.
"""

from __future__ import annotations

import socket
from fractions import Fraction
from pathlib import Path

import pytest
from PIL import Image

from azimut.engine import enrich


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    """Any socket created inside this module is a bug."""

    def explode(*args, **kwargs):
        raise AssertionError("enrichment must not touch the network")

    monkeypatch.setattr(socket, "socket", explode)
    monkeypatch.setattr(socket, "create_connection", explode)


def _image(tmp_path: Path, name="shot.jpg", size=(64, 48), exif: Image.Exif | None = None) -> Path:
    path = tmp_path / name
    img = Image.new("RGB", size)
    for x in range(size[0]):  # a horizontal ramp, so the hash is not all zeros
        for y in range(size[1]):
            img.putpixel((x, y), (x * 4 % 256, y * 4 % 256, 40))
    img.save(path, "JPEG", exif=exif if exif is not None else Image.Exif())
    return path


def _exif_with_gps(lat_dms, lat_ref, lon_dms, lon_ref, taken=None) -> Image.Exif:
    exif = Image.Exif()
    gps = {
        1: lat_ref,
        2: tuple(Fraction(v).limit_denominator() for v in lat_dms),
        3: lon_ref,
        4: tuple(Fraction(v).limit_denominator() for v in lon_dms),
    }
    exif.get_ifd(0x8825).update(gps)
    if taken:
        exif.get_ifd(0x8769)[36867] = taken
    return exif


def test_exif_facts_converts_dms_to_signed_decimal(tmp_path):
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E", "2023:06:11 14:22:31")
    facts = enrich.exif_facts(_image(tmp_path, exif=exif))

    assert facts["gps"]["lat"] == pytest.approx(48.858333, abs=1e-5)
    assert facts["gps"]["lon"] == pytest.approx(2.350833, abs=1e-5)
    assert facts["taken_at"] == "2023-06-11T14:22:31"


def test_exif_facts_applies_the_southern_and_western_hemisphere_refs(tmp_path):
    exif = _exif_with_gps((33, 51, 54.0), "S", (151, 12, 36.0), "W")
    facts = enrich.exif_facts(_image(tmp_path, exif=exif))

    assert facts["gps"]["lat"] < 0
    assert facts["gps"]["lon"] < 0


def test_exif_facts_returns_nothing_for_an_image_without_exif(tmp_path):
    assert enrich.exif_facts(_image(tmp_path)) == {}


def test_exif_facts_drops_out_of_range_and_null_island_coordinates(tmp_path):
    out_of_range = _exif_with_gps((99, 0, 0.0), "N", (0, 0, 0.0), "E")
    assert "gps" not in enrich.exif_facts(_image(tmp_path, "a.jpg", exif=out_of_range))

    null_island = _exif_with_gps((0, 0, 0.0), "N", (0, 0, 0.0), "E")
    assert "gps" not in enrich.exif_facts(_image(tmp_path, "b.jpg", exif=null_island))


def test_exif_facts_survives_a_malformed_date(tmp_path):
    exif = _exif_with_gps((1, 0, 0.0), "N", (1, 0, 0.0), "E", "not a date")
    facts = enrich.exif_facts(_image(tmp_path, exif=exif))
    assert "taken_at" not in facts
    assert facts["gps"]["lat"] == pytest.approx(1.0)


def test_dhash_is_16_hex_chars_and_stable(tmp_path):
    path = _image(tmp_path)
    digest = enrich.dhash(path)
    assert len(digest) == 16
    assert int(digest, 16) >= 0
    assert enrich.dhash(path) == digest


def test_dhash_matches_the_same_picture_at_a_different_size(tmp_path):
    original = _image(tmp_path, "big.jpg", size=(400, 300))
    with Image.open(original) as img:
        img.resize((120, 90)).save(tmp_path / "small.jpg", "JPEG")

    assert enrich.hamming(enrich.dhash(original), enrich.dhash(tmp_path / "small.jpg")) <= enrich.DHASH_MATCH


def test_dhash_separates_two_different_pictures(tmp_path):
    ramp = _image(tmp_path, "ramp.jpg")
    flat = tmp_path / "flat.jpg"
    Image.new("RGB", (64, 48), (10, 200, 90)).save(flat, "JPEG")

    assert enrich.hamming(enrich.dhash(ramp), enrich.dhash(flat)) > enrich.DHASH_MATCH


def test_importing_an_image_queues_enrichment_and_lands_the_facts(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E", "2023:06:11 14:22:31")
    source = _image(tmp_path, exif=exif)

    with source.open("rb") as fh:
        result = media_engine.import_stream(case, "shot.jpg", fh)
    rel = result["item"]["path"]

    assert [j["kind"] for j in case.list_jobs(state="queued")].count(enrich.ENRICH_KIND) == 1
    workqueue.drain(case)

    item = media_engine.read_item(case, rel)
    assert item["gps"]["lat"] == pytest.approx(48.858333, abs=1e-5)
    assert item["gps"]["lon"] == pytest.approx(2.350833, abs=1e-5)
    assert item["taken_at"] == "2023-06-11T14:22:31"
    assert len(item["dhash"]) == 16
    assert item["enriched_at"]


def test_enrichment_is_recorded_even_when_the_image_carries_nothing(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    with _image(tmp_path).open("rb") as fh:
        rel = media_engine.import_stream(case, "plain.jpg", fh)["item"]["path"]

    workqueue.drain(case)

    item = media_engine.read_item(case, rel)
    assert item["enriched_at"]  # we looked
    assert "gps" not in item and "taken_at" not in item  # and found nothing
    assert item["dhash"]  # pixels always hash


def test_a_deleted_media_cancels_its_enrich_job(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    with _image(tmp_path).open("rb") as fh:
        rel = media_engine.import_stream(case, "gone.jpg", fh)["item"]["path"]
    media_path = case.resolve_inside(rel)
    media_path.unlink()
    media_path.with_suffix(media_path.suffix + ".json").unlink(missing_ok=True)

    workqueue.drain(case)

    assert case.list_jobs(kind=enrich.ENRICH_KIND)[0]["state"] == "cancelled"


def test_a_video_import_is_not_queued_for_enrichment(tmp_workspace, monkeypatch):
    import io

    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    media_engine.import_stream(case, "clip.mp4", io.BytesIO(b"not really a video"))

    assert case.list_jobs(kind=enrich.ENRICH_KIND) == []
