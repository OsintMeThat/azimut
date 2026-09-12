#!/usr/bin/env python3
"""Sign the capture extension with Mozilla, and write the manifest Firefox polls.

Firefox Release and Beta refuse an unsigned extension, with no preference to
turn that off, so the permanent install Chrome gets from "Load unpacked" has
exactly one equivalent here: an XPI signed by Mozilla. Signing is decoupled from
distribution — ``--channel unlisted`` puts no listing on addons.mozilla.org, runs
automated validation only, and hands the signed file back — so the release keeps
shipping from GitHub.

A signed XPI is sealed, so the app's own update button cannot rewrite it. What
replaces it is ``packaging/updates.json``: the manifest named by
``browser_specific_settings.gecko.update_url``, which Firefox re-reads about once
a day and compares against the version it runs. That file is tracked, and cutting
a release is what moves it (see the release checklist).

Usage, from the repo root, after the release carrying this version exists::

    export AMO_JWT_ISSUER=user:12345:67
    export AMO_JWT_SECRET=<secret from the AMO developer hub>
    python3 scripts/sign_extension.py

The tag defaults to ``v{extension version}``, because the extension carries the
version of the release that last changed it — the same number the update button
and the version gate already answer to. ``--from-xpi`` rebuilds the update
manifest from a file already signed, without asking AMO for a second copy.

What gets signed is ``extinstall.shipped_files()``, not the ``extension/``
directory: the XPI, the .zip and the folder the app owns must be the same bytes,
and the directory also holds a dev harness no browser should load.

One entry is kept in the update manifest. Firefox picks the highest version whose
``strict_min_version`` its build satisfies, so a single newest entry updates
everyone who can run it and leaves everyone who cannot on what they have, which
is the honest outcome. Keeping older entries would only matter to offer a
different version per Firefox range.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

REPO = Path(__file__).resolve().parent.parent
EXT = REPO / "extension"
UPDATE_MANIFEST = REPO / "packaging" / "updates.json"

#: Where a release's signed XPI lands. Built from the tag rather than looked up,
#: so the update manifest can be written before the asset is uploaded.
ASSET_BASE = "https://github.com/OsintMeThat/azimut/releases/download"

#: The asset name. Carries its version: release assets from different tags sit in
#: different directories, but a downloaded file lands in one.
ASSET_NAME = "azimut-capture-{version}.xpi"

sys.path.insert(0, str(REPO / "src"))
from azimut.engine import extinstall  # noqa: E402


# ---- reading what the extension declares about itself -----------------------


def gecko_facts() -> dict[str, str]:
    """``id``, ``version`` and ``strict_min_version`` from the extension's own
    manifest. One definition: the update manifest is generated from it rather
    than kept in step by hand."""
    manifest = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    gecko = manifest.get("browser_specific_settings", {}).get("gecko", {})
    missing = [key for key in ("id", "strict_min_version") if not gecko.get(key)]
    if missing or not manifest.get("version"):
        raise SystemExit(
            f"extension/manifest.json is missing {missing or ['version']} — an unlisted "
            "add-on needs an explicit id, and Firefox needs a version to compare"
        )
    return {
        "id": gecko["id"],
        "version": str(manifest["version"]),
        "strict_min_version": gecko["strict_min_version"],
    }


def published_version() -> str | None:
    """The version ``packaging/updates.json`` currently offers, or None."""
    try:
        entries = json.loads(UPDATE_MANIFEST.read_text(encoding="utf-8"))["addons"]
    except (OSError, KeyError, json.JSONDecodeError):
        return None
    for addon in entries.values():
        for update in addon.get("updates", []):
            if update.get("version"):
                return str(update["version"])
    return None


# ---- the update manifest ----------------------------------------------------


def build_update_manifest(
    addon_id: str, version: str, link: str, sha256: str, strict_min_version: str
) -> dict[str, Any]:
    """The JSON shape Firefox expects at ``update_url``.

    ``update_hash`` is redundant over HTTPS and carried anyway: it is what proves
    the bytes GitHub serves are the bytes Mozilla signed, and it costs one line.
    """
    return {
        "addons": {
            addon_id: {
                "updates": [
                    {
                        "version": version,
                        "update_link": link,
                        "update_hash": f"sha256:{sha256}",
                        "applications": {
                            "gecko": {"strict_min_version": strict_min_version}
                        },
                    }
                ]
            }
        }
    }


def asset_url(tag: str, version: str) -> str:
    return f"{ASSET_BASE}/{tag}/{ASSET_NAME.format(version=version)}"


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ---- signing ----------------------------------------------------------------


def stage_payload(destination: Path) -> None:
    """Copy exactly what the extension ships into ``destination``."""
    source = extinstall.source_dir()
    if source is None:
        raise SystemExit("no extension found to sign")
    for name, path in extinstall.shipped_files(source):
        target = destination / PurePosixPath(name)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)


def sign(staging: Path, artifacts: Path) -> Path:
    """Ask AMO for a signed copy, and return it. Raises if it comes back empty.

    AMO refuses a version it has already signed, which is the failure to expect
    when the extension did not change: its version deliberately stays put across
    releases that leave it alone.
    """
    issuer = os.environ.get("AMO_JWT_ISSUER")
    secret = os.environ.get("AMO_JWT_SECRET")
    if not issuer or not secret:
        raise SystemExit("set AMO_JWT_ISSUER and AMO_JWT_SECRET (AMO developer hub)")
    subprocess.run(
        [
            "npx",
            "--yes",
            "web-ext@8",
            "sign",
            "--source-dir",
            str(staging),
            "--artifacts-dir",
            str(artifacts),
            "--channel",
            "unlisted",
            "--api-key",
            issuer,
            "--api-secret",
            secret,
        ],
        check=True,
    )
    signed = sorted(artifacts.glob("*.xpi"))
    if not signed:
        raise SystemExit("web-ext reported success but produced no .xpi")
    return signed[-1]


# ---- the command ------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    facts = gecko_facts()
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--tag",
        default=f"v{facts['version']}",
        help="release tag carrying the signed XPI (default: v<extension version>)",
    )
    parser.add_argument(
        "--from-xpi",
        type=Path,
        help="rebuild the update manifest from an already-signed file, without signing",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO / "dist-xpi",
        help="where the signed XPI is written (default: dist-xpi/)",
    )
    options = parser.parse_args(argv)

    version = facts["version"]
    if options.from_xpi is None and published_version() == version:
        raise SystemExit(
            f"packaging/updates.json already offers {version}. AMO refuses a version it "
            "has already signed — bump extension/manifest.json, or pass --from-xpi to "
            "rewrite the manifest from the file it signed."
        )

    if options.from_xpi is not None:
        signed = options.from_xpi
        if not signed.is_file():
            raise SystemExit(f"no such file: {signed}")
    else:
        options.output.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="azimut-xpi-") as scratch:
            staging = Path(scratch) / "payload"
            stage_payload(staging)
            produced = sign(staging, options.output)
        signed = options.output / ASSET_NAME.format(version=version)
        if produced != signed:
            produced.replace(signed)

    manifest = build_update_manifest(
        facts["id"],
        version,
        asset_url(options.tag, version),
        sha256_of(signed),
        facts["strict_min_version"],
    )
    UPDATE_MANIFEST.write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"signed: {signed}")
    print(f"update manifest: {UPDATE_MANIFEST} -> {version} at {options.tag}")
    print("Upload the XPI to that release, then commit packaging/updates.json.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
