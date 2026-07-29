"""Import enrichment: what a local image or video file says about itself.

Everything here is pixels and bytes on disk. The no-network assertion is not
decoration — enrichment runs on every import, and reaching out on any of them
would break the local-first rule the whole app is built on.
"""

from __future__ import annotations

import socket
from fractions import Fraction
from pathlib import Path
from types import SimpleNamespace

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


def test_exif_metadata_keeps_camera_and_nested_gps_tags_for_details(tmp_path):
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E", "2023:06:11 14:22:31")
    exif[271] = "Camera maker"
    exif[272] = "Camera model"
    exif[65000] = "A future tag"

    rows = enrich.exif_metadata(_image(tmp_path, exif=exif))

    assert rows["Make"] == "Camera maker"
    assert rows["Model"] == "Camera model"
    assert rows["DateTimeOriginal"] == "2023:06:11 14:22:31"
    assert rows["GPSLatitudeRef"] == "N"
    assert "48.0" in rows["GPSLatitude"]
    assert rows["65000"] == "A future tag"


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
    assert item["enrich_version"] == enrich.ENRICH_VERSION
    assert item["exif"]["DateTimeOriginal"] == "2023:06:11 14:22:31"


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


def test_video_facts_keep_unknown_tags_and_parse_location(tmp_path, monkeypatch):
    from azimut.engine import ffmpeg as ffmpeg_engine

    payload = b"""{
      "format": {
        "format_name": "mov,mp4",
        "duration": "4.25",
        "tags": {
          "creation_time": "2024-02-03T10:11:12Z",
          "com.apple.quicktime.location.ISO6709": "+48.858300+002.294500+035.0/",
          "future_camera_field": "kept"
        }
      },
      "streams": [{"index": 0, "codec_type": "video", "codec_name": "hevc"}]
    }"""
    seen = []
    monkeypatch.setattr(ffmpeg_engine, "ffprobe_path", lambda: "/local/ffprobe")

    def fake_run(argv, **kwargs):
        seen.append((argv, kwargs))
        return SimpleNamespace(returncode=0, stdout=payload)

    monkeypatch.setattr(enrich.subprocess, "run", fake_run)

    facts = enrich.video_facts(tmp_path / "clip.mov")

    assert seen[0][0][-1] == str(tmp_path / "clip.mov")
    assert seen[0][1] == {"capture_output": True, "timeout": 30}
    assert facts["gps"] == pytest.approx({"lat": 48.8583, "lon": 2.2945})
    assert facts["taken_at"] == "2024-02-03T10:11:12Z"
    assert facts["video_metadata"]["format · tags · future camera field"] == "kept"
    assert facts["video_metadata"]["streams 0 · codec name"] == "hevc"


def test_a_video_import_queues_enrichment_and_lands_probe_metadata(
    tmp_workspace, monkeypatch
):
    import io

    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    monkeypatch.setattr(
        enrich,
        "video_facts",
        lambda path: {
            "video_metadata": {"format · format name": "mov,mp4"},
            "gps": {"lat": 48.8583, "lon": 2.2945},
            "taken_at": "2024-02-03T10:11:12Z",
        },
    )
    case = Case.create("Enrich")
    rel = media_engine.import_stream(
        case, "clip.mp4", io.BytesIO(b"not really a video")
    )["item"]["path"]

    assert case.list_jobs(kind=enrich.ENRICH_KIND, state="queued")
    workqueue.drain(case)
    item = media_engine.read_item(case, rel)
    assert item["enrich_version"] == enrich.ENRICH_VERSION
    assert item["video_metadata"]["format · format name"] == "mov,mp4"
    assert item["gps"] == pytest.approx({"lat": 48.8583, "lon": 2.2945})
    media = case.find_entity(attr="path", value=rel)
    links = [link for link in case.links_of(media["id"]) if link["type"] == enrich.LOCATED_AT]
    assert len(links) == 1
    place = case.get_entity(links[0]["to"])
    assert place["type"] == "place"
    assert place["provenance"]["status"] == "suggested"


def _import_image(case, name, tmp_path, exif=None):
    from azimut.engine import media as media_engine

    src = _image(tmp_path, name, exif=exif) if exif is not None else _image(tmp_path, name)
    with src.open("rb") as fh:
        return media_engine.import_stream(case, name, fh)["item"]["path"]


def test_gps_becomes_a_suggested_place_linked_to_the_photo(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E")
    rel = _import_image(case, "paris.jpg", tmp_path, exif)
    workqueue.drain(case)

    places = [e for e in case.list_entities() if e["type"] == "place"]
    assert len(places) == 1
    place = places[0]
    assert place["provenance"]["status"] == "suggested"
    assert place["provenance"]["by"] == "enrich"
    assert place["attrs"]["lat"] == pytest.approx(48.858333, abs=1e-5)

    media = case.find_entity(attr="path", value=rel)
    links = [ln for ln in case.links_of(media["id"]) if ln["type"] == enrich.LOCATED_AT]
    assert len(links) == 1
    assert links[0]["to"] == place["id"]
    assert links[0]["provenance"]["status"] == "suggested"


def test_two_photos_from_the_same_spot_reuse_one_place(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E")
    _import_image(case, "one.jpg", tmp_path, exif)
    workqueue.drain(case)
    _import_image(case, "two.jpg", tmp_path, exif)
    workqueue.drain(case)

    assert len([e for e in case.list_entities() if e["type"] == "place"]) == 1


def test_draining_twice_does_not_stack_duplicate_suggestions(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E")
    rel = _import_image(case, "again.jpg", tmp_path, exif)
    workqueue.drain(case)
    workqueue.enqueue(case, enrich.ENRICH_KIND, key=rel, payload={"path": rel})
    workqueue.drain(case)

    media = case.find_entity(attr="path", value=rel)
    assert len([ln for ln in case.links_of(media["id"]) if ln["type"] == enrich.LOCATED_AT]) == 1


def test_a_rescaled_copy_is_suggested_as_the_same_image(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    big = _image(tmp_path, "big.jpg", size=(400, 300))
    with Image.open(big) as img:
        img.resize((120, 90)).save(tmp_path / "small.jpg", "JPEG")

    with big.open("rb") as fh:
        first = media_engine.import_stream(case, "big.jpg", fh)["item"]["path"]
    with (tmp_path / "small.jpg").open("rb") as fh:
        second = media_engine.import_stream(case, "small.jpg", fh)["item"]["path"]
    workqueue.drain(case)

    a = case.find_entity(attr="path", value=first)
    b = case.find_entity(attr="path", value=second)
    matches = [ln for ln in case.links_of(b["id"]) if ln["type"] == enrich.SAME_IMAGE_AS]
    assert [ln["to"] for ln in matches] == [a["id"]]
    assert matches[0]["provenance"]["status"] == "suggested"


def test_unrelated_pictures_are_not_linked(tmp_workspace, monkeypatch, tmp_path):
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    _import_image(case, "ramp.jpg", tmp_path)
    flat = tmp_path / "flat.jpg"
    Image.new("RGB", (200, 150), (10, 200, 90)).save(flat, "JPEG")
    with flat.open("rb") as fh:
        rel = media_engine.import_stream(case, "flat.jpg", fh)["item"]["path"]
    workqueue.drain(case)

    entity = case.find_entity(attr="path", value=rel)
    assert [ln for ln in case.links_of(entity["id"]) if ln["type"] == enrich.SAME_IMAGE_AS] == []


def test_a_dismissed_suggestion_does_not_come_back_on_a_re_enrich(tmp_workspace, monkeypatch, tmp_path):
    """Dropping a suggestion is how an analyst says "not that". A re-read refreshes
    the file's facts, but re-proposing what was already settled would make the
    Enrich button undo every triage decision in the case."""
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E")
    rel = _import_image(case, "pin.jpg", tmp_path, exif)
    workqueue.drain(case)

    media = case.find_entity(attr="path", value=rel)
    proposed = [ln for ln in case.links_of(media["id"]) if ln["type"] == enrich.LOCATED_AT]
    assert len(proposed) == 1
    case.remove_link(proposed[0]["id"])

    # the facts are read again — and land again — but the graph is left alone
    media_engine.merge_item(case, rel, {"enriched_at": "", "gps": None})
    enrich.on_register(case, rel, "image", media["id"])
    workqueue.drain(case)

    assert media_engine.read_item(case, rel)["gps"]["lat"] == pytest.approx(48.858333, abs=1e-5)
    assert [ln for ln in case.links_of(media["id"]) if ln["type"] == enrich.LOCATED_AT] == []


def test_media_from_an_older_release_still_gets_its_suggestions(tmp_workspace, monkeypatch, tmp_path):
    """A file enriched before the version stamp existed has never been proposed
    anything, so the first backfill must still speak up."""
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Enrich")
    exif = _exif_with_gps((33, 51, 24.0), "S", (151, 12, 55.0), "E")
    rel = _import_image(case, "old.jpg", tmp_path, exif)
    # rewind to what an older release left behind: facts, no version, no edges
    media = case.find_entity(attr="path", value=rel)
    for link in case.links_of(media["id"]):
        case.remove_link(link["id"])
    sidecar = media_engine.read_item(case, rel)
    sidecar.pop("enrich_version", None)
    media_engine._write_sidecar(case.resolve_inside(rel), sidecar)

    enrich.on_register(case, rel, "image", media["id"])
    workqueue.drain(case)

    assert [ln["type"] for ln in case.links_of(media["id"])] == [enrich.LOCATED_AT]


def test_backfill_keeps_an_imported_confirmed_gps_relation(
    tmp_workspace, monkeypatch, tmp_path
):
    """A bundle may bring old media that needs the current enrichment version
    together with an analyst's confirmed Relate-to choice. The facts may be
    refreshed, but that choice must not come back as another suggestion."""
    from azimut.engine import links as link_engine
    from azimut.engine import media as media_engine
    from azimut.engine import workqueue
    from azimut.workspace import Case

    monkeypatch.setattr(workqueue, "start_workers", False)
    case = Case.create("Imported relation")
    exif = _exif_with_gps((48, 51, 30.0), "N", (2, 21, 3.0), "E")
    rel = _import_image(case, "related.jpg", tmp_path, exif)
    workqueue.drain(case)

    media = case.find_entity(attr="path", value=rel)
    for link in case.links_of(media["id"]):
        case.remove_link(link["id"])
    place = case.add_entity(
        "place",
        "Chosen place",
        {"lat": 48.858333, "lon": 2.350833},
        by="user",
    )
    stated = link_engine.add_relation(
        case,
        media["id"],
        place["id"],
        enrich.LOCATED_AT,
        by="user",
    )

    sidecar = media_engine.read_item(case, rel)
    sidecar.pop("enrich_version", None)
    media_engine._write_sidecar(case.resolve_inside(rel), sidecar)
    enrich.on_register(case, rel, "image", media["id"])
    workqueue.drain(case)

    located = [
        link for link in case.links_of(media["id"]) if link["type"] == enrich.LOCATED_AT
    ]
    assert located == [stated]
    assert located[0]["provenance"]["status"] == "confirmed"


def test_a_probe_that_never_ran_is_left_for_the_backfill_to_retry(tmp_workspace, monkeypatch, tmp_path):
    """A timed-out or crashed ffprobe is not an answer about the file. Stamping the
    enrichment version on it would take it out of the backfill's reach for good."""
    import subprocess

    from azimut.engine import ffmpeg as ffmpeg_engine

    monkeypatch.setattr(ffmpeg_engine, "ffprobe_path", lambda: "/usr/bin/ffprobe")

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="ffprobe", timeout=30)

    monkeypatch.setattr(subprocess, "run", timeout)
    assert enrich.video_facts(tmp_path / "clip.mp4") is None

    # a file ffprobe did read and found nothing in is an answer, and repeating it
    # on every backfill would never produce a different one
    monkeypatch.setattr(
        subprocess, "run", lambda *a, **k: SimpleNamespace(returncode=1, stdout=b"")
    )
    assert enrich.video_facts(tmp_path / "clip.mp4") == {}


def test_one_exif_value_is_bounded_while_it_is_built(tmp_workspace):
    """The cap exists so a maker note or a lens table never reaches a sidecar in
    full. Rendering the whole thing and then slicing would do all the work the cap
    is there to avoid, so the bound is applied as the string is assembled."""
    huge_list = tuple(range(200_000))
    rendered = enrich._display_value(huge_list)
    assert len(rendered) <= enrich.EXIF_VALUE_CAP + 1
    assert rendered.endswith("…")

    printable = enrich._display_value(b"A" * 5000)
    assert len(printable) <= enrich.EXIF_VALUE_CAP + 1
    # a binary blob is reported by size rather than mangled into replacement chars
    assert enrich._display_value(b"\x00\x01\x02" * 400) == f"{1200} bytes"
    # a short value is untouched
    assert enrich._display_value("Canon EOS 5D") == "Canon EOS 5D"
