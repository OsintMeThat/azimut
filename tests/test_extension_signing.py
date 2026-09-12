"""The signed-XPI road: what the extension declares, and what Firefox polls.

Firefox Release refuses an unsigned extension with no preference to turn that
off, so Firefox installs the extension from an AMO-signed XPI and updates itself
from ``packaging/updates.json``. Nothing in the app reads that file — Firefox
does, once a day — which is exactly why it needs a gate: a drift between the id
the extension is signed under and the id the manifest is keyed by produces no
error anywhere, it just silently never updates.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from azimut.engine import extinstall, updates

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import sign_extension  # noqa: E402

UPDATE_MANIFEST = REPO / "packaging" / "updates.json"

#: The tracked manifest, served raw from the default branch. The extension is
#: signed with this address inside it, so moving the file means signing a new
#: version — which is why the address is asserted rather than left to habit.
UPDATE_URL = (
    "https://raw.githubusercontent.com/OsintMeThat/azimut/main/packaging/updates.json"
)


@pytest.fixture(scope="module")
def gecko():
    manifest = json.loads((REPO / "extension" / "manifest.json").read_text(encoding="utf-8"))
    return manifest["browser_specific_settings"]["gecko"]


@pytest.fixture(scope="module")
def published():
    return json.loads(UPDATE_MANIFEST.read_text(encoding="utf-8"))


# -- what the extension declares -------------------------------------------


def test_the_extension_carries_an_id_that_can_be_signed(gecko):
    """AMO reserves the id at the first signature and it is permanent afterwards:
    changing it later is a different add-on, so every install loses its pairing.
    A placeholder id is therefore a one-way mistake, not a detail."""
    assert gecko["id"]
    assert not gecko["id"].endswith(".invalid"), (
        "a placeholder id becomes permanent the moment AMO signs it"
    )


def test_firefox_is_told_where_to_look_for_updates(gecko):
    """Self-distributed means self-hosted updates: AMO signs the file but serves
    nothing, so without this key a signed install never hears about a new one."""
    assert gecko["update_url"] == UPDATE_URL
    assert gecko["update_url"].startswith("https://")  # Firefox refuses plain HTTP


def test_the_update_manifest_is_not_part_of_the_payload():
    """It lives under ``packaging/`` on purpose. Shipped, it would land in every
    browser folder and move the payload digest on every release, which the update
    button reads as "a new version is ready" for bytes nobody changed."""
    source = extinstall.source_dir()
    assert source is not None
    names = [name for name, _ in extinstall.shipped_files(source)]
    assert not any(name.endswith("updates.json") for name in names)


# -- the manifest Firefox polls ---------------------------------------------


def test_the_update_manifest_is_keyed_by_the_extension_id(published, gecko):
    """The one drift that fails silently: Firefox looks itself up by id, finds
    nothing, and reports no error to anyone."""
    assert list(published["addons"]) == [gecko["id"]]


def test_every_offered_version_is_one_that_exists(published, gecko):
    """Each entry points at a release asset, carries the hash of the bytes Mozilla
    signed, and never offers a version ahead of the one this build ships — the
    update manifest is written at release cut, so a version leading the code means
    it was written for a release that never happened."""
    bundled = extinstall.bundled_version()
    for addon in published["addons"].values():
        for entry in addon["updates"]:
            version = entry["version"]
            assert entry["update_link"].startswith("https://")
            assert entry["update_link"].endswith(f"azimut-capture-{version}.xpi")
            assert entry["update_hash"].startswith("sha256:")
            assert len(entry["update_hash"].split(":", 1)[1]) == 64
            gecko_range = entry["applications"]["gecko"]
            assert gecko_range["strict_min_version"] == gecko["strict_min_version"]
            assert not updates.is_newer(version, bundled)


# -- the generator ----------------------------------------------------------


def test_the_generator_reads_the_extension_rather_than_a_copy(gecko):
    facts = sign_extension.gecko_facts()
    assert facts["id"] == gecko["id"]
    assert facts["version"] == extinstall.bundled_version()
    assert facts["strict_min_version"] == gecko["strict_min_version"]


def test_the_asset_url_names_the_release_that_carries_it():
    assert sign_extension.asset_url("v0.3.0", "0.3.0") == (
        "https://github.com/OsintMeThat/azimut/releases/download/v0.3.0/"
        "azimut-capture-0.3.0.xpi"
    )


def test_a_generated_manifest_passes_the_gates_above(tmp_path, gecko):
    """The generator's output and the checked-in file answer to one shape."""
    built = sign_extension.build_update_manifest(
        gecko["id"], "0.3.0", sign_extension.asset_url("v0.3.0", "0.3.0"), "a" * 64, "115.0"
    )
    entry = built["addons"][gecko["id"]]["updates"][0]
    assert entry["version"] == "0.3.0"
    assert entry["update_hash"] == "sha256:" + "a" * 64
    assert entry["applications"]["gecko"]["strict_min_version"] == "115.0"

    written = tmp_path / "updates.json"
    written.write_text(json.dumps(built), encoding="utf-8")
    assert json.loads(written.read_text(encoding="utf-8")) == built


def test_a_version_already_offered_is_refused(monkeypatch, tmp_path):
    """AMO refuses a version it has already signed, and the extension's version
    deliberately stays put across releases that do not touch it. Caught here with
    its reason rather than as a failed upload halfway through a release."""
    manifest = tmp_path / "updates.json"
    version = extinstall.bundled_version()
    manifest.write_text(
        json.dumps(
            sign_extension.build_update_manifest(
                "x@y", version, "https://example.invalid/azimut-capture-%s.xpi" % version,
                "b" * 64, "115.0",
            )
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(sign_extension, "UPDATE_MANIFEST", manifest)
    assert sign_extension.published_version() == version
    with pytest.raises(SystemExit, match="already offers"):
        sign_extension.main([])


def test_no_published_version_before_the_first_signature(monkeypatch, tmp_path):
    """The checked-in manifest starts with an empty ``updates`` list, which is
    what "nothing signed yet" looks like. It must not read as a version."""
    manifest = tmp_path / "updates.json"
    manifest.write_text(json.dumps({"addons": {"x@y": {"updates": []}}}), encoding="utf-8")
    monkeypatch.setattr(sign_extension, "UPDATE_MANIFEST", manifest)
    assert sign_extension.published_version() is None
