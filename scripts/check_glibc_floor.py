"""Refuse a Linux release binary that needs a newer glibc than the README promises.

PyInstaller copies the build machine's own `libstdc++.so.6`, `libgcc_s.so.1` and
`libz.so.1` into the single-file binary, which loads them before the system's. The
glibc those were linked against is therefore the oldest one the binary starts on,
and it is set by the runner image, not by anything in this repository. The release
workflow pins that image; this reads every ELF the binary carries and fails the
build when one of them asks for more than `FLOOR`, so the README can never promise
less than the binary needs.
"""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Iterator
from pathlib import Path

#: What README.md states for the Linux binary ("glibc 2.38 or newer").
FLOOR = (2, 38)

_VERSION = re.compile(rb"GLIBC_(\d+)\.(\d+)(?:\.(\d+))?(?![\d.])")


def glibc_versions(data: bytes) -> set[tuple[int, ...]]:
    """Every `GLIBC_x.y[.z]` version an ELF image names."""
    return {
        tuple(int(part) for part in match.groups() if part is not None)
        for match in _VERSION.finditer(data)
    }


def embedded_elves(binary: Path) -> Iterator[tuple[str, bytes]]:
    """The bootloader, then every shared object packed into the binary."""
    from PyInstaller.archive.readers import CArchiveReader

    archive = CArchiveReader(str(binary))
    # Only the bootloader's own bytes: what follows it is compressed and could
    # spell anything.
    start = getattr(archive, "_start_offset", 0) or len(binary.read_bytes())
    yield binary.name, binary.read_bytes()[:start]
    for name, entry in archive.toc.items():
        if entry[-1] != "b":
            continue
        data = archive.extract(name)
        if data.startswith(b"\x7fELF"):
            yield name, data


def over_floor(
    members: Iterator[tuple[str, bytes]], floor: tuple[int, ...] = FLOOR
) -> list[tuple[str, tuple[int, ...]]]:
    """(member, highest version) for each member asking for more than `floor`."""
    out = []
    for name, data in members:
        versions = glibc_versions(data)
        if versions and max(versions) > floor:
            out.append((name, max(versions)))
    return out


def _dotted(version: tuple[int, ...]) -> str:
    return ".".join(str(part) for part in version)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("binary", type=Path)
    args = parser.parse_args(argv)
    members = list(embedded_elves(args.binary))
    highest = max(
        (max(v) for _name, data in members if (v := glibc_versions(data))), default=None
    )
    print(f"{len(members)} ELF images; highest glibc asked for: {_dotted(highest or (0,))}")
    failures = over_floor(iter(members))
    for name, version in failures:
        print(f"{name} needs GLIBC_{_dotted(version)}, above the {_dotted(FLOOR)} floor")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
