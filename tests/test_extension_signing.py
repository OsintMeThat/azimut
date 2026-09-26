"""The signed-XPI road: what the extension declares, and what Firefox polls.

Firefox Release refuses an unsigned extension with no preference to turn that
off, so Firefox installs the extension from an AMO-signed XPI and updates itself
from ``packaging/updates.json``. Nothing in the app reads that file — Firefox
does, once a day — which is exactly why it needs a gate: a drift between the id
the extension is signed under and the id the manifest is keyed by produces no
error anywhere, it just silently never updates.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
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
    assert facts["update_url"] == gecko["update_url"]


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


def test_signing_credentials_are_passed_in_the_private_environment(monkeypatch, tmp_path):
    captured = {}
    monkeypatch.setenv("AMO_JWT_ISSUER", "synthetic-issuer")
    monkeypatch.setenv("AMO_JWT_SECRET", "synthetic-secret")

    def fake_run(argv, **kwargs):
        captured.update(argv=argv, kwargs=kwargs)
        (tmp_path / "signed.xpi").write_bytes(b"signed")

    monkeypatch.setattr(sign_extension.subprocess, "run", fake_run)
    signed = sign_extension.sign(tmp_path / "payload", tmp_path)

    assert signed.name == "signed.xpi"
    command = " ".join(captured["argv"])
    assert "synthetic-issuer" not in command
    assert "synthetic-secret" not in command
    assert "--api-key" not in captured["argv"]
    assert "--api-secret" not in captured["argv"]
    assert captured["kwargs"]["env"]["WEB_EXT_API_KEY"] == "synthetic-issuer"
    assert captured["kwargs"]["env"]["WEB_EXT_API_SECRET"] == "synthetic-secret"


def test_an_earlier_xpi_in_the_output_is_never_taken_for_the_new_one(monkeypatch, tmp_path):
    """dist-xpi/ outlives a cut. An XPI already sitting there under the asset
    name must be replaced by what AMO returns, and the manifest must hash the new
    bytes, whatever the two files sort as."""
    monkeypatch.setenv("AMO_JWT_ISSUER", "synthetic-issuer")
    monkeypatch.setenv("AMO_JWT_SECRET", "synthetic-secret")
    manifest = tmp_path / "updates.json"
    monkeypatch.setattr(sign_extension, "UPDATE_MANIFEST", manifest)
    output = tmp_path / "dist-xpi"
    output.mkdir()
    version = extinstall.bundled_version()
    stale = output / sign_extension.ASSET_NAME.format(version=version)
    stale.write_bytes(b"an earlier release")

    def fake_run(argv, **kwargs):
        artifacts = Path(argv[argv.index("--artifacts-dir") + 1])
        (artifacts / f"0a1b2c-{version}.xpi").write_bytes(b"freshly signed")

    monkeypatch.setattr(sign_extension.subprocess, "run", fake_run)
    assert sign_extension.main(["--output", str(output)]) == 0

    assert [path.name for path in output.iterdir()] == [stale.name]
    assert stale.read_bytes() == b"freshly signed"
    offered = json.loads(manifest.read_text(encoding="utf-8"))["addons"]
    (entry,) = next(iter(offered.values()))["updates"]
    assert entry["update_hash"] == "sha256:" + hashlib.sha256(b"freshly signed").hexdigest()


def test_the_signer_refuses_to_guess_between_two_xpis(monkeypatch, tmp_path):
    monkeypatch.setenv("AMO_JWT_ISSUER", "synthetic-issuer")
    monkeypatch.setenv("AMO_JWT_SECRET", "synthetic-secret")

    def fake_run(argv, **kwargs):
        (tmp_path / "a.xpi").write_bytes(b"one")
        (tmp_path / "b.xpi").write_bytes(b"two")

    monkeypatch.setattr(sign_extension.subprocess, "run", fake_run)
    with pytest.raises(SystemExit, match="more than one"):
        sign_extension.sign(tmp_path / "payload", tmp_path)


def test_a_signer_failure_cannot_serialize_the_secret(monkeypatch, tmp_path):
    monkeypatch.setenv("AMO_JWT_ISSUER", "synthetic-issuer")
    monkeypatch.setenv("AMO_JWT_SECRET", "synthetic-secret")

    def fail(argv, **kwargs):
        raise subprocess.CalledProcessError(2, argv, stderr="validation failed")

    monkeypatch.setattr(sign_extension.subprocess, "run", fail)
    with pytest.raises(subprocess.CalledProcessError) as error:
        sign_extension.sign(tmp_path / "payload", tmp_path)

    assert "synthetic-issuer" not in str(error.value)
    assert "synthetic-secret" not in str(error.value)


@pytest.mark.parametrize(
    "doc",
    [(REPO / "README.md").read_text(encoding="utf-8"), sign_extension.__doc__ or ""],
    ids=["README", "script docstring"],
)
def test_the_signing_instructions_never_put_the_secret_on_a_command_line(doc):
    # A secret typed at the prompt stays in the shell history, so the documented
    # road reads it from a private file instead.
    assert "export AMO_JWT_SECRET" not in doc
    assert "AMO_JWT_SECRET=" not in doc
    assert "source ~/.config/azimut/amo.env" in doc


def test_completed_delivery_cannot_pass_with_an_empty_update_list(monkeypatch, gecko):
    empty = json.dumps({"addons": {gecko["id"]: {"updates": []}}}).encode()
    monkeypatch.setattr(
        sign_extension,
        "gecko_facts",
        lambda: {
            "id": gecko["id"],
            "version": "0.3.0",
            "strict_min_version": gecko["strict_min_version"],
            "update_url": UPDATE_URL,
        },
    )

    with pytest.raises(SystemExit, match="exactly one version"):
        sign_extension.verify_published_delivery("v0.3.0", lambda _url, _limit: empty)


def test_completed_delivery_verifies_the_public_xpi_hash(monkeypatch, gecko):
    xpi = b"mozilla-signed-xpi"
    link = sign_extension.asset_url("v0.3.0", "0.3.0")
    published = sign_extension.build_update_manifest(
        gecko["id"],
        "0.3.0",
        link,
        hashlib.sha256(xpi).hexdigest(),
        gecko["strict_min_version"],
    )
    monkeypatch.setattr(
        sign_extension,
        "gecko_facts",
        lambda: {
            "id": gecko["id"],
            "version": "0.3.0",
            "strict_min_version": gecko["strict_min_version"],
            "update_url": UPDATE_URL,
        },
    )

    def fetch(url, _limit):
        return json.dumps(published).encode() if url == UPDATE_URL else xpi

    assert sign_extension.verify_published_delivery("v0.3.0", fetch) == link
