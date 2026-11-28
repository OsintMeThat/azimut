"""The signed manifest the one-click update believes, and the script that signs it.

Every key here is made by the test. The real signing key never comes near the
suite; only its public half sits in ``releasesign.TRUSTED_KEYS``, which the last
gate checks for shape.
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from azimut.engine import releasesign, updates

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "scripts"))

import release_signing  # noqa: E402

PASSPHRASE = "a long enough sentence"


def answers(*replies: str):
    """A getpass stand-in that answers in order."""
    queue = list(replies)
    return lambda _prompt: queue.pop(0)


@pytest.fixture(autouse=True)
def quick_scrypt(monkeypatch):
    """The real cost is half a second and 256 MB per key file; the format is the same."""
    monkeypatch.setattr(release_signing, "SCRYPT_N", 2**14)


@pytest.fixture
def key() -> Ed25519PrivateKey:
    return Ed25519PrivateKey.generate()


@pytest.fixture
def trusted(key) -> tuple[str, ...]:
    return (release_signing.public_line(key),)


@pytest.fixture
def builds(tmp_path) -> dict[str, Path]:
    """One small fake binary per release asset, in CI's one-folder-per-artifact layout."""
    files = {}
    for index, name in enumerate(release_signing.binaries()):
        folder = tmp_path / "artifacts" / name
        folder.mkdir(parents=True)
        (folder / name).write_bytes(b"binary %d " % index * 100)
        files[name] = folder / name
    return files


def signed(key, body: dict | bytes) -> tuple[bytes, bytes]:
    manifest = body if isinstance(body, bytes) else json.dumps(body).encode()
    return manifest, base64.b64encode(key.sign(manifest)) + b"\n"


def body(**changes) -> dict:
    base = {
        "format": 1,
        "project": "azimut",
        "version": "0.3.5",
        "assets": {"azimut-linux-x86_64": {"sha256": "a" * 64, "size": 1234}},
    }
    base.update(changes)
    return base


# -- what the app believes ------------------------------------------------------


def test_a_manifest_the_script_signs_reads_back_in_the_app(key, trusted, builds):
    manifest, signature = release_signing.sign_manifest("v0.3.5", builds, key, trusted)
    found = releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)
    assert found.version == "0.3.5"
    assert set(found.assets) == set(updates.ASSETS.values())
    for name, path in builds.items():
        assert found.assets[name].size == path.stat().st_size
        assert found.assets[name].sha256 == release_signing.sha256_of(path)


def test_one_changed_byte_is_refused(key, trusted):
    manifest, signature = signed(key, body())
    tampered = manifest.replace(b"0.3.5", b"0.3.6")
    with pytest.raises(releasesign.ManifestRefused, match="signature"):
        releasesign.read(tampered, signature, tag="v0.3.6", current="0.3.4", keys=trusted)


def test_another_key_is_refused(trusted):
    manifest, signature = signed(Ed25519PrivateKey.generate(), body())
    with pytest.raises(releasesign.ManifestRefused, match="signature"):
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)


def test_a_copy_that_trusts_no_key_refuses_everything(key):
    manifest, signature = signed(key, body())
    with pytest.raises(releasesign.ManifestRefused, match="trusts no signing key"):
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=())


def test_either_key_works_while_one_replaces_the_other(key):
    old, new = Ed25519PrivateKey.generate(), key
    both = (release_signing.public_line(old), release_signing.public_line(new))
    for signer in (old, new):
        manifest, signature = signed(signer, body())
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=both)


@pytest.mark.parametrize(
    ("tag", "current", "reason"),
    [
        ("v0.3.5", "0.3.5", "not newer"),
        ("v0.3.5", "0.3.6", "not newer"),
        ("v0.3.6", "0.3.4", "another release"),
    ],
)
def test_an_old_or_mismatched_release_is_refused(key, trusted, tag, current, reason):
    manifest, signature = signed(key, body())
    with pytest.raises(releasesign.ManifestRefused, match=reason):
        releasesign.read(manifest, signature, tag=tag, current=current, keys=trusted)


@pytest.mark.parametrize(
    ("changes", "reason"),
    [
        ({"format": 2}, "newer Azimut"),
        ({"format": True}, "not readable"),
        ({"project": "other"}, "another project"),
        ({"version": "0.3.5; rm -rf"}, "version"),
        ({"assets": {}}, "no binary"),
        ({"assets": {"../azimut": {"sha256": "a" * 64, "size": 1}}}, "would not download"),
        ({"assets": {"azimut-linux-x86_64": {"sha256": "A" * 64, "size": 1}}}, "hash"),
        ({"assets": {"azimut-linux-x86_64": {"sha256": "a" * 63, "size": 1}}}, "hash"),
        ({"assets": {"azimut-linux-x86_64": {"sha256": "a" * 64, "size": 0}}}, "size"),
        ({"assets": {"azimut-linux-x86_64": {"sha256": "a" * 64, "size": True}}}, "size"),
        ({"assets": {"azimut-linux-x86_64": {"sha256": "a" * 64, "size": 2**31}}}, "size"),
        ({"assets": {"azimut-linux-x86_64": "a" * 64}}, "not readable"),
    ],
)
def test_a_signed_manifest_with_a_bad_field_is_still_refused(key, trusted, changes, reason):
    manifest, signature = signed(key, body(**changes))
    with pytest.raises(releasesign.ManifestRefused, match=reason):
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)


def test_a_field_a_later_release_adds_is_read_past(key, trusted):
    manifest, signature = signed(key, body(notes="added in a later format-1 release"))
    found = releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)
    assert found.version == "0.3.5"


@pytest.mark.parametrize(
    "signature",
    [b"not base64 at all!", base64.b64encode(b"x" * 63), base64.b64encode(b"x" * 65), b"A" * 2000],
)
def test_an_unreadable_signature_is_refused(key, trusted, signature):
    manifest, _ = signed(key, body())
    with pytest.raises(releasesign.ManifestRefused):
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)


def test_an_oversized_manifest_is_refused_before_it_is_read(key, trusted):
    manifest, signature = signed(key, b" " * (releasesign.MANIFEST_LIMIT + 1))
    with pytest.raises(releasesign.ManifestRefused, match="too large"):
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)


def test_signed_bytes_that_are_not_json_are_refused(key, trusted):
    manifest, signature = signed(key, b"\xff\xfe not json")
    with pytest.raises(releasesign.ManifestRefused, match="not readable"):
        releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4", keys=trusted)


def test_every_trusted_key_is_a_distinct_ed25519_public_key():
    """The gate for the day the real key is pasted in: a typo would refuse every
    release, and nothing else would say why."""
    assert len(set(releasesign.TRUSTED_KEYS)) == len(releasesign.TRUSTED_KEYS)
    for encoded in releasesign.TRUSTED_KEYS:
        releasesign.public_key(encoded)
        assert len(releasesign.key_id(encoded)) == 8


# -- making the key ---------------------------------------------------------------


def test_new_key_writes_a_private_file_and_returns_its_public_line(tmp_path):
    path = tmp_path / "keys" / "signing-key.json"
    line = release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    stored = json.loads(path.read_text(encoding="utf-8"))
    assert stored["kdf"]["name"] == "scrypt" and stored["kdf"]["n"] == 2**14
    assert stored["public"] == line
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600
        assert path.parent.stat().st_mode & 0o777 == 0o700
    reopened = release_signing.load_key(path, answers(PASSPHRASE))
    assert release_signing.public_line(reopened) == line
    releasesign.public_key(line)


def test_a_key_is_never_overwritten(tmp_path):
    path = tmp_path / "signing-key.json"
    path.write_bytes(b"the only copy")
    with pytest.raises(release_signing.SigningError, match="never overwritten"):
        release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    assert path.read_bytes() == b"the only copy"


def test_a_key_is_never_made_inside_the_repository():
    path = REPO / "signing-key.json"
    with pytest.raises(release_signing.SigningError, match="inside the repository"):
        release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    assert not path.exists()


@pytest.mark.parametrize(
    ("replies", "reason"),
    [(("short", "short"), "at least"), ((PASSPHRASE, PASSPHRASE + "!"), "differ")],
)
def test_a_weak_or_mistyped_passphrase_writes_nothing(tmp_path, replies, reason):
    path = tmp_path / "signing-key.json"
    with pytest.raises(release_signing.SigningError, match=reason):
        release_signing.new_key(path, answers(*replies))
    assert not path.exists()


def test_the_key_file_never_holds_the_private_key_in_clear(tmp_path):
    path = tmp_path / "signing-key.json"
    release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    key = release_signing.load_key(path, answers(PASSPHRASE))
    raw = key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    text = path.read_bytes()
    assert raw not in text and base64.b64encode(raw) not in text and raw.hex().encode() not in text


def test_the_public_line_reads_without_the_passphrase(tmp_path, capsys):
    path = tmp_path / "signing-key.json"
    line = release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    assert release_signing.main(["public-key", "--key", str(path)], ask=answers()) == 0
    assert line in capsys.readouterr().out


@pytest.mark.parametrize(
    ("content", "reason"),
    [
        (b"-----BEGIN PRIVATE KEY-----", "not a signing key made by this script"),
        (b'{"kind": "something else"}', "not a signing key made by this script"),
    ],
)
def test_a_file_that_is_not_our_key_is_named_as_such(tmp_path, content, reason):
    path = tmp_path / "signing-key.json"
    path.write_bytes(content)
    with pytest.raises(release_signing.SigningError, match=reason):
        release_signing.load_key(path, answers(PASSPHRASE))


def test_a_damaged_key_file_says_so(tmp_path):
    path = tmp_path / "signing-key.json"
    release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    stored = json.loads(path.read_text(encoding="utf-8"))
    stored["public"] = release_signing.public_line(Ed25519PrivateKey.generate())
    path.write_text(json.dumps(stored), encoding="utf-8")
    with pytest.raises(release_signing.SigningError, match="halves differ"):
        release_signing.load_key(path, answers(PASSPHRASE))


def test_a_wrong_passphrase_says_so(tmp_path):
    path = tmp_path / "signing-key.json"
    release_signing.new_key(path, answers(PASSPHRASE, PASSPHRASE))
    with pytest.raises(release_signing.SigningError, match="does not open"):
        release_signing.load_key(path, answers("not the passphrase"))


# -- signing ----------------------------------------------------------------------


def test_the_manifest_is_the_same_bytes_every_time(builds):
    first = release_signing.build_manifest("0.3.5", builds)
    assert release_signing.build_manifest("0.3.5", dict(reversed(builds.items()))) == first
    assert first.endswith(b"}\n")


def test_a_key_the_app_does_not_trust_signs_nothing(key, builds):
    other = (release_signing.public_line(Ed25519PrivateKey.generate()),)
    with pytest.raises(release_signing.SigningError, match="not one this Azimut trusts"):
        release_signing.sign_manifest("v0.3.5", builds, key, other)


def test_a_release_missing_a_binary_signs_nothing(tmp_path, builds):
    folder = tmp_path / "artifacts"
    (folder / "azimut-macos-arm64" / "azimut-macos-arm64").unlink()
    with pytest.raises(release_signing.SigningError, match="azimut-macos-arm64"):
        release_signing.find_binaries(folder)


def test_a_tag_that_is_not_a_release_signs_nothing(key, trusted, builds):
    with pytest.raises(release_signing.SigningError, match="not a release tag"):
        release_signing.sign_manifest("main", builds, key, trusted)


def test_sign_from_a_folder_leaves_the_pair_beside_the_binaries(tmp_path, key, builds, monkeypatch):
    key_path = tmp_path / "signing-key.json"
    line = release_signing.new_key(key_path, answers(PASSPHRASE, PASSPHRASE))
    monkeypatch.setattr(releasesign, "TRUSTED_KEYS", (line,))
    folder = tmp_path / "artifacts"
    code = release_signing.main(
        ["sign", "v0.3.5", "--key", str(key_path), "--from", str(folder)], ask=answers(PASSPHRASE)
    )
    assert code == 0
    manifest = (folder / releasesign.MANIFEST_ASSET).read_bytes()
    signature = (folder / releasesign.SIGNATURE_ASSET).read_bytes()
    assert releasesign.read(manifest, signature, tag="v0.3.5", current="0.3.4").version == "0.3.5"


class FakeGh:
    """Answers gh as a release with the three binaries and the run that built them,
    and records each call."""

    def __init__(self, builds: dict[str, Path], already_signed: bool = False):
        self.builds = builds
        self.calls: list[list[str]] = []
        names = [*builds, *([releasesign.MANIFEST_ASSET] if already_signed else [])]
        self.view = json.dumps({"assets": [{"name": name} for name in names]})
        self.uploaded: dict[str, bytes] = {}
        self.served = {name: path.read_bytes() for name, path in builds.items()}
        self.digests = {name: release_signing.sha256_of(path) for name, path in builds.items()}
        # what the publish job could print in its own log; never to be believed
        self.publish_log = ""

    def build_log(self, name: str) -> str:
        return (
            "Binary (x)\tRecord the binary's digest\t2026-11-28T00:00:00Z "
            "uv run --no-sync python -c \"print('AZIMUT-SHA256', sys.argv[1], ...)\"\n"
            f"Binary (x)\tRecord the binary's digest\t2026-11-28T00:00:01Z AZIMUT-SHA256 {name} {self.digests[name]}\n"
        )

    def __call__(self, cmd):
        cmd = list(cmd)
        self.calls.append(cmd)
        done = lambda out="": subprocess.CompletedProcess(cmd, 0, out, "")  # noqa: E731
        head = cmd[1:3]
        if head == ["release", "view"]:
            return done(self.view)
        if head == ["release", "download"]:
            folder = Path(cmd[cmd.index("--dir") + 1])
            for name, body in self.served.items():
                (folder / name).write_bytes(body)
            return done()
        if head == ["release", "upload"]:
            for arg in cmd:
                if arg.endswith((releasesign.MANIFEST_ASSET, releasesign.SIGNATURE_ASSET)):
                    self.uploaded[Path(arg).name] = Path(arg).read_bytes()
            return done()
        if cmd[1] == "api" and "/commits/" in cmd[2]:
            return done("abc123\n")
        if head == ["run", "list"]:
            return done(json.dumps([
                {"databaseId": 7, "conclusion": "failure", "headSha": "abc123"},
                {"databaseId": 9, "conclusion": "success", "headSha": "abc123"},
            ]))
        if cmd[1] == "api" and cmd[2].startswith(f"repos/{release_signing.GITHUB_REPO}/actions/runs/9/jobs"):
            jobs = [{"id": 100 + i, "name": f"Binary ({name})", "conclusion": "success"}
                    for i, name in enumerate(self.builds)]
            jobs.append({"id": 900, "name": "GitHub release + PyPI publish", "conclusion": "success"})
            return done(json.dumps({"jobs": jobs}))
        if head == ["run", "view"]:
            job = int(cmd[cmd.index("--job") + 1])
            if job == 900:
                return done(self.publish_log)
            return done(self.build_log(list(self.builds)[job - 100]))
        raise AssertionError(cmd)


def test_sign_a_published_release_signs_what_it_serves_and_attaches_the_pair(key, trusted, builds):
    gh = FakeGh(builds)
    release_signing.sign_published("v0.3.5", key, run=gh, trusted=trusted)
    download = next(call for call in gh.calls if call[2] == "download")
    assert sorted(download[i + 1] for i, a in enumerate(download) if a == "--pattern") == sorted(builds)
    assert "--repo" in download and release_signing.GITHUB_REPO in download
    upload = next(call for call in gh.calls if call[2] == "upload")
    assert "--clobber" not in upload
    found = releasesign.read(
        gh.uploaded[releasesign.MANIFEST_ASSET],
        gh.uploaded[releasesign.SIGNATURE_ASSET],
        tag="v0.3.5",
        current="0.3.4",
        keys=trusted,
    )
    assert found.assets["azimut-linux-x86_64"].sha256 == release_signing.sha256_of(
        builds["azimut-linux-x86_64"]
    )


def test_a_signed_release_is_signed_again_only_when_asked(key, trusted, builds):
    gh = FakeGh(builds, already_signed=True)
    with pytest.raises(release_signing.SigningError, match="already signed"):
        release_signing.sign_published("v0.3.5", key, run=gh, trusted=trusted)
    assert [call[2] for call in gh.calls] == ["view"]
    release_signing.sign_published("v0.3.5", key, replace=True, run=gh, trusted=trusted)
    assert "--clobber" in next(call for call in gh.calls if call[2] == "upload")


def test_a_failing_gh_stops_with_its_reason(key, trusted):
    def refuse(cmd):
        return subprocess.CompletedProcess(list(cmd), 1, "", "release not found")

    with pytest.raises(release_signing.SigningError, match="release not found"):
        release_signing.sign_published("v9.9.9", key, run=refuse, trusted=trusted)


def test_an_untrusted_key_is_turned_away_before_its_passphrase(tmp_path, capsys):
    key_path = tmp_path / "signing-key.json"
    release_signing.new_key(key_path, answers(PASSPHRASE, PASSPHRASE))
    folder = tmp_path / "bins"
    code = release_signing.main(
        ["sign", "v0.3.5", "--key", str(key_path), "--from", str(folder)], ask=answers()
    )
    assert code == 1
    assert "not one this Azimut trusts" in capsys.readouterr().err


def test_a_release_file_the_build_did_not_make_is_never_signed(key, trusted, builds):
    """The publish job could swap a release file before it is signed: the build
    job's own log, which it cannot rewrite, says what the file should be."""
    gh = FakeGh(builds)
    gh.served["azimut-linux-x86_64"] = b"swapped after the build"
    with pytest.raises(release_signing.SigningError, match="not the file the build made"):
        release_signing.sign_published("v0.3.5", key, run=gh, trusted=trusted)
    assert not any(call[1:3] == ["release", "upload"] for call in gh.calls)


def test_a_digest_printed_by_the_publish_job_is_not_believed(key, trusted, builds):
    gh = FakeGh(builds)
    gh.served["azimut-linux-x86_64"] = b"swapped after the build"
    forged = release_signing.sha256_of(builds["azimut-linux-x86_64"]).replace("a", "b")
    gh.publish_log = f"AZIMUT-SHA256 azimut-linux-x86_64 {forged}\n"
    with pytest.raises(release_signing.SigningError, match="not the file the build made"):
        release_signing.sign_published("v0.3.5", key, run=gh, trusted=trusted)
    read_jobs = [call[call.index("--job") + 1] for call in gh.calls if "--job" in call]
    assert read_jobs and "900" not in read_jobs  # the publish job's log is never read


def test_only_the_successful_build_of_the_tags_own_commit_is_read(key, trusted, builds):
    gh = FakeGh(builds)
    release_signing.sign_published("v0.3.5", key, run=gh, trusted=trusted)
    jobs = next(call for call in gh.calls if call[1] == "api" and "/jobs" in call[2])
    assert "/runs/9/" in jobs[2]


def test_a_build_that_printed_no_digest_signs_nothing(key, trusted, builds):
    gh = FakeGh(builds)
    gh.build_log = lambda name: "no digest here\n"
    with pytest.raises(release_signing.SigningError, match="printed no digest"):
        release_signing.sign_published("v0.3.5", key, run=gh, trusted=trusted)


def test_the_build_workflow_prints_the_digest_the_script_reads():
    workflow = (REPO / ".github" / "workflows" / "release.yml").read_text(encoding="utf-8")
    assert "print('AZIMUT-SHA256', sys.argv[1], hashlib.sha256(" in workflow
    assert workflow.index("Record the binary's digest") < workflow.index("name: ${{ matrix.asset }}")
    assert release_signing.DIGEST_LINE.findall(f"AZIMUT-SHA256 azimut-linux-x86_64 {'0' * 64}") == [
        ("azimut-linux-x86_64", "0" * 64)
    ]
    assert release_signing.BUILD_JOB in "Binary (ubuntu-24.04)"
    assert "name: Binary (${{ matrix.os }})" in workflow
