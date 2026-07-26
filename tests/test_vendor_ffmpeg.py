"""Tests for integrity-checked ffmpeg release vendoring."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import zipfile
from pathlib import Path

import pytest


SCRIPT = Path(__file__).parents[1] / "scripts" / "vendor_ffmpeg.py"
SPEC = importlib.util.spec_from_file_location("azimut_vendor_ffmpeg", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
vendor_ffmpeg = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(vendor_ffmpeg)


def _zip(path: Path, members: dict[str, bytes]) -> str:
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in members.items():
            archive.writestr(name, payload)
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_vendor_verifies_and_extracts_exact_members(tmp_path, monkeypatch):
    ffmpeg_archive = tmp_path / "ffmpeg.zip"
    ffprobe_archive = tmp_path / "ffprobe.zip"
    ffmpeg_hash = _zip(
        ffmpeg_archive,
        {
            "bundle/bin/ffmpeg": b"ffmpeg",
            "bundle/README.txt": b"ignored",
        },
    )
    ffprobe_hash = _zip(
        ffprobe_archive,
        {
            "bundle/bin/ffprobe": b"ffprobe",
            "bundle/LICENSE.txt": b"ignored",
        },
    )
    monkeypatch.setitem(
        vendor_ffmpeg.ARTIFACTS,
        "test",
        (
            vendor_ffmpeg.Archive(
                "Fixture",
                "1",
                ffmpeg_archive.as_uri(),
                ffmpeg_hash,
                (("bundle/bin/ffmpeg", "ffmpeg"),),
            ),
            vendor_ffmpeg.Archive(
                "Fixture",
                "1",
                ffprobe_archive.as_uri(),
                ffprobe_hash,
                (("bundle/bin/ffprobe", "ffprobe"),),
            ),
        ),
    )

    output = tmp_path / "vendor"
    provenance = vendor_ffmpeg.vendor("test", output)

    assert (output / "ffmpeg").read_bytes() == b"ffmpeg"
    assert (output / "ffprobe").read_bytes() == b"ffprobe"
    assert (output / "ffmpeg").stat().st_mode & 0o111
    assert provenance["target"] == "test"
    assert json.loads((output / "ffmpeg-provenance.json").read_text()) == provenance


def test_vendor_rejects_a_bad_digest_without_installing_tools(tmp_path, monkeypatch):
    archive_path = tmp_path / "ffmpeg.zip"
    _zip(archive_path, {"ffmpeg": b"payload"})
    monkeypatch.setitem(
        vendor_ffmpeg.ARTIFACTS,
        "test",
        (
            vendor_ffmpeg.Archive(
                "Fixture",
                "1",
                archive_path.as_uri(),
                "0" * 64,
                (("ffmpeg", "ffmpeg"),),
            ),
        ),
    )

    output = tmp_path / "vendor"
    with pytest.raises(RuntimeError, match="SHA-256 mismatch"):
        vendor_ffmpeg.vendor("test", output)

    assert not (output / "ffmpeg").exists()


def test_vendor_rejects_duplicate_tool_members_outside_the_allowlist(
    tmp_path,
    monkeypatch,
):
    archive_path = tmp_path / "ffmpeg.zip"
    digest = _zip(
        archive_path,
        {
            "expected/ffmpeg": b"expected",
            "unexpected/ffmpeg": b"unexpected",
        },
    )
    monkeypatch.setitem(
        vendor_ffmpeg.ARTIFACTS,
        "test",
        (
            vendor_ffmpeg.Archive(
                "Fixture",
                "1",
                archive_path.as_uri(),
                digest,
                (("expected/ffmpeg", "ffmpeg"),),
            ),
        ),
    )

    with pytest.raises(RuntimeError, match="archive member mismatch"):
        vendor_ffmpeg.vendor("test", tmp_path / "vendor")


def test_release_artifacts_are_pinned_and_have_sha256_digests():
    assert set(vendor_ffmpeg.ARTIFACTS) == {
        "windows-x86_64",
        "linux-x86_64",
        "macos-arm64",
    }
    for archives in vendor_ffmpeg.ARTIFACTS.values():
        for archive in archives:
            assert "/latest/" not in archive.url
            assert "/redirect/" not in archive.url
            assert len(archive.sha256) == 64
            assert set(archive.sha256) <= set("0123456789abcdef")
