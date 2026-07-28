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
