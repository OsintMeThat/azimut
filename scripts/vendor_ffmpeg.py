"""Download the exact ffmpeg build used by standalone release binaries.

Release artifacts are pinned here rather than resolved through moving URLs in
the workflow. Each archive is size-bounded, SHA-256 verified, and read through
an exact member allowlist before ffmpeg and ffprobe enter the PyInstaller build.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import stat
import tempfile
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from typing import NamedTuple


MAX_ARCHIVE_BYTES = 192 * 1024 * 1024
MAX_TOOL_BYTES = 160 * 1024 * 1024
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
TOOL_NAMES = {"ffmpeg", "ffprobe", "ffmpeg.exe", "ffprobe.exe"}


class Archive(NamedTuple):
    source: str
    version: str
    url: str
    sha256: str
    members: tuple[tuple[str, str], ...]


ARTIFACTS: dict[str, tuple[Archive, ...]] = {
    "windows-x86_64": (
        Archive(
            source="BtbN FFmpeg Builds",
            version="autobuild-2026-06-30-13-34 / N-125365-g9a01c1cb6a",
            url=(
                "https://github.com/BtbN/FFmpeg-Builds/releases/download/"
                "autobuild-2026-06-30-13-34/"
                "ffmpeg-N-125365-g9a01c1cb6a-win64-gpl.zip"
            ),
            sha256="52c0383c460f0ec1039088f1591921fb82e3b870b32aab8faf2ff1e5ae14bf9d",
            members=(
                (
                    "ffmpeg-N-125365-g9a01c1cb6a-win64-gpl/bin/ffmpeg.exe",
                    "ffmpeg.exe",
                ),
                (
                    "ffmpeg-N-125365-g9a01c1cb6a-win64-gpl/bin/ffprobe.exe",
                    "ffprobe.exe",
                ),
            ),
        ),
    ),
    "linux-x86_64": (
        Archive(
            source="FFmpeg Build Server",
            version="8.1.2 / 1783011670",
            url=(
                "https://ffmpeg.martin-riedl.de/download/"
                "linux/amd64/1783011670_8.1.2/ffmpeg.zip"
            ),
            sha256="56452c0bfc4ee0325cd615d62f46ba8264f62eed34f727c2224c6c84fa7b8719",
            members=(("ffmpeg", "ffmpeg"),),
        ),
        Archive(
            source="FFmpeg Build Server",
            version="8.1.2 / 1783011670",
            url=(
                "https://ffmpeg.martin-riedl.de/download/"
                "linux/amd64/1783011670_8.1.2/ffprobe.zip"
            ),
            sha256="c6f2d36e98f9a4445fad0b0be539f4c4faf13fd502116bf131becd53f56cd390",
            members=(("ffprobe", "ffprobe"),),
        ),
    ),
    "macos-arm64": (
        Archive(
            source="FFmpeg Build Server",
            version="8.1.2 / 1783011502",
            url=(
                "https://ffmpeg.martin-riedl.de/download/"
                "macos/arm64/1783011502_8.1.2/ffmpeg.zip"
            ),
            sha256="ef1aa60006c7b77ce170c1608c08d8e4ba1c30c5746f2ac986ded932d0ac2c3c",
            members=(("ffmpeg", "ffmpeg"),),
        ),
        Archive(
            source="FFmpeg Build Server",
            version="8.1.2 / 1783011502",
            url=(
                "https://ffmpeg.martin-riedl.de/download/"
                "macos/arm64/1783011502_8.1.2/ffprobe.zip"
            ),
            sha256="c39787f4af7a3932502d2d48db6f6feaaa836b48a73ef78c32cc3285df61dfaf",
            members=(("ffprobe", "ffprobe"),),
        ),
    ),
}


def _download(archive: Archive, destination: Path) -> None:
    request = urllib.request.Request(
        archive.url,
        headers={"User-Agent": "Azimut-release-vendoring"},
    )
    digest = hashlib.sha256()
    total = 0

    with urllib.request.urlopen(request, timeout=60) as response:
        declared = response.headers.get("Content-Length")
        if declared is not None and int(declared) > MAX_ARCHIVE_BYTES:
            raise RuntimeError(f"archive is too large: {archive.url}")

        with destination.open("xb") as output:
            while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                total += len(chunk)
                if total > MAX_ARCHIVE_BYTES:
                    raise RuntimeError(f"archive exceeded the size limit: {archive.url}")
                digest.update(chunk)
                output.write(chunk)

    actual = digest.hexdigest()
    if actual != archive.sha256:
        destination.unlink(missing_ok=True)
        raise RuntimeError(
            f"SHA-256 mismatch for {archive.url}: expected {archive.sha256}, got {actual}"
        )


def _validate_member_names(names: list[str], archive: Archive) -> None:
    expected = {member for member, _destination in archive.members}
    tool_basenames = {PurePosixPath(member).name for member in expected}
    candidates = {
        name
        for name in names
        if PurePosixPath(name).name in tool_basenames and not name.endswith("/")
    }
    if candidates != expected:
        raise RuntimeError(
            f"archive member mismatch for {archive.url}: "
            f"expected {sorted(expected)}, found {sorted(candidates)}"
        )


def _copy_member(source, destination: Path, size: int, archive: Archive) -> None:
    if size > MAX_TOOL_BYTES:
        raise RuntimeError(f"archive member is too large: {archive.url}")
    with destination.open("xb") as output:
        shutil.copyfileobj(source, output, length=DOWNLOAD_CHUNK_BYTES)


def _extract(path: Path, archive: Archive, output_dir: Path) -> None:
    with zipfile.ZipFile(path) as bundle:
        _validate_member_names(bundle.namelist(), archive)
        for member_name, destination_name in archive.members:
            info = bundle.getinfo(member_name)
            if info.is_dir():
                raise RuntimeError(f"expected a file in {archive.url}: {member_name}")
            with bundle.open(info) as source:
                _copy_member(source, output_dir / destination_name, info.file_size, archive)


def vendor(target: str, output_dir: Path) -> dict[str, object]:
    archives = ARTIFACTS[target]
    expected_files = {
        destination
        for archive in archives
        for _member, destination in archive.members
    }
    if {PurePosixPath(name).name for name in expected_files} - TOOL_NAMES:
        raise RuntimeError(f"invalid destination allowlist for {target}")

    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=".azimut-ffmpeg-",
        dir=output_dir.parent,
    ) as temporary:
        staging = Path(temporary)
        extracted = staging / "tools"
        extracted.mkdir()

        for index, archive in enumerate(archives):
            download = staging / f"archive-{index}"
            _download(archive, download)
            _extract(download, archive, extracted)

        installed = {path.name for path in extracted.iterdir() if path.is_file()}
        if installed != expected_files:
            raise RuntimeError(
                f"vendored file mismatch for {target}: "
                f"expected {sorted(expected_files)}, found {sorted(installed)}"
            )

        output_dir.mkdir(parents=True, exist_ok=True)
        for name in TOOL_NAMES:
            stale = output_dir / name
            if stale.is_file() or stale.is_symlink():
                stale.unlink()
        for name in sorted(expected_files):
            source = extracted / name
            if not name.endswith(".exe"):
                source.chmod(source.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
            os.replace(source, output_dir / name)

    provenance: dict[str, object] = {
        "schema": 1,
        "target": target,
        "files": sorted(expected_files),
        "archives": [
            {
                "source": archive.source,
                "version": archive.version,
                "url": archive.url,
                "sha256": archive.sha256,
            }
            for archive in archives
        ],
    }
    provenance_path = output_dir / "ffmpeg-provenance.json"
    temporary_path = output_dir / ".ffmpeg-provenance.json.tmp"
    temporary_path.write_text(
        json.dumps(provenance, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary_path, provenance_path)
    return provenance


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=sorted(ARTIFACTS))
    parser.add_argument("--output", type=Path, default=Path("packaging/vendor"))
    args = parser.parse_args()

    provenance = vendor(args.target, args.output)
    print(json.dumps(provenance, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
