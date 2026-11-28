#!/usr/bin/env python3
"""Make the release signing key once, then sign each release's manifest with it.

The one-click update installs a release only when its manifest is signed with the
key the installed Azimut trusts (``engine/releasesign.py``). The private half
never goes near GitHub: it is made and kept on the maintainer's machine, behind a
passphrase, and a release is signed from there after the tag.

Usage, from the repo root::

    uv run python scripts/release_signing.py new-key          # once, ever
    uv run python scripts/release_signing.py public-key       # the line the code trusts
    uv run python scripts/release_signing.py sign v0.3.5      # after each release is published
    uv run python scripts/release_signing.py sign v0.3.5 --from DIR   # binaries on disk, no upload

``sign`` hashes the three binaries the release carries, writes the manifest, signs
it, checks the result with the very rules the app reads it by, and uploads the two
files to the release. With ``--from`` it reads the binaries from a folder (a
branch build's artifacts) and leaves the two files beside them.

Losing the key costs every user one manual download of a release that trusts a new
key, so ``new-key`` never overwrites one and refuses a place inside the repository.
Keep two copies somewhere offline.
"""

from __future__ import annotations

import argparse
import base64
import getpass
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable, Sequence

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.scrypt import Scrypt

REPO = Path(__file__).resolve().parent.parent
GITHUB_REPO = "OsintMeThat/azimut"
DEFAULT_KEY = Path.home() / ".config" / "azimut-release" / "signing-key.json"
KEY_KIND = "azimut-release-signing-key"
PASSPHRASE_MIN = 12
#: scrypt's cost: about 256 MB and half a second per opening, once per release.
SCRYPT_N = 2**18
TAG = re.compile(r"v\d+(\.\d+){1,3}")

sys.path.insert(0, str(REPO / "src"))
from azimut.engine import releasesign, updates  # noqa: E402

Ask = Callable[[str], str]
Run = Callable[[Sequence[str]], subprocess.CompletedProcess[str]]


class SigningError(RuntimeError):
    """Stops the script with a reason and nothing half written."""


def binaries() -> list[str]:
    """The binaries every release carries, as release.yml names them."""
    return sorted(set(updates.ASSETS.values()))


# ---- the key ----------------------------------------------------------------


def public_line(key: Ed25519PrivateKey) -> str:
    """The public key as ``TRUSTED_KEYS`` spells it: base64 of the 32 raw bytes."""
    raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
    return base64.b64encode(raw).decode("ascii")


def _inside_repo(path: Path) -> bool:
    try:
        path.resolve().relative_to(REPO)
    except ValueError:
        return False
    return True


def _new_passphrase(ask: Ask) -> bytes:
    first = ask("Passphrase for the new key: ")
    if len(first) < PASSPHRASE_MIN:
        raise SigningError(
            f"Use at least {PASSPHRASE_MIN} characters; a short sentence is easy to remember."
        )
    if ask("Type it again: ") != first:
        raise SigningError("The two passphrases differ. Nothing was written.")
    return first.encode("utf-8")


def _wrapping_key(passphrase: bytes, salt: bytes, n: int) -> bytes:
    return Scrypt(salt=salt, length=32, n=n, r=8, p=1).derive(passphrase)


def _sealed(key: Ed25519PrivateKey, passphrase: bytes) -> bytes:
    """The key file: the raw private key under AES-GCM, keyed by scrypt from the
    passphrase. A PEM's own encryption is PBKDF2 at 2,048 rounds, which a stolen
    copy would not hold out against for long."""
    raw = key.private_bytes(
        encoding=serialization.Encoding.Raw,
        format=serialization.PrivateFormat.Raw,
        encryption_algorithm=serialization.NoEncryption(),
    )
    salt, nonce = os.urandom(16), os.urandom(12)
    wrapping = _wrapping_key(passphrase, salt, SCRYPT_N)
    sealed = AESGCM(wrapping).encrypt(nonce, raw, KEY_KIND.encode())
    body = {
        "kind": KEY_KIND,
        "public": public_line(key),
        "kdf": {"name": "scrypt", "n": SCRYPT_N, "r": 8, "p": 1, "salt": _b64(salt)},
        "nonce": _b64(nonce),
        "sealed": _b64(sealed),
    }
    return (json.dumps(body, indent=2) + "\n").encode("utf-8")


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def new_key(path: Path, ask: Ask = getpass.getpass) -> str:
    """Make the key at ``path`` (0600, in a 0700 folder) and return its public line."""
    if _inside_repo(path):
        raise SigningError(f"{path} is inside the repository. Keep the key outside it.")
    if path.exists():
        raise SigningError(f"{path} already exists. A signing key is never overwritten.")
    passphrase = _new_passphrase(ask)
    key = Ed25519PrivateKey.generate()
    sealed = _sealed(key, passphrase)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # O_EXCL: a key that appeared since the check above is still never overwritten
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(sealed)
    return public_line(key)


def _key_file(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise SigningError(f"No key at {path}. Pass --key, or make one with new-key.")
    try:
        body = json.loads(path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise SigningError(f"{path} is not a signing key made by this script.") from exc
    if not isinstance(body, dict) or body.get("kind") != KEY_KIND:
        raise SigningError(f"{path} is not a signing key made by this script.")
    return body


def public_of(path: Path) -> str:
    """The public line a key file states, read without its passphrase."""
    return str(_key_file(path)["public"])


def load_key(path: Path, ask: Ask = getpass.getpass) -> Ed25519PrivateKey:
    body = _key_file(path)
    passphrase = ask(f"Passphrase for {path}: ").encode("utf-8")
    try:
        kdf = body["kdf"]
        wrapping = _wrapping_key(passphrase, base64.b64decode(kdf["salt"]), int(kdf["n"]))
        raw = AESGCM(wrapping).decrypt(
            base64.b64decode(body["nonce"]), base64.b64decode(body["sealed"]), KEY_KIND.encode()
        )
    except InvalidTag as exc:
        raise SigningError("That passphrase does not open the key.") from exc
    except (KeyError, TypeError, ValueError) as exc:
        raise SigningError(f"{path} is damaged: {exc}") from exc
    key = Ed25519PrivateKey.from_private_bytes(raw)
    if public_line(key) != body.get("public"):
        raise SigningError(f"{path} is damaged: its private and public halves differ.")
    return key


# ---- the manifest -------------------------------------------------------------


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_manifest(version: str, files: dict[str, Path]) -> bytes:
    """The manifest's bytes, exactly as signed: sorted keys, one trailing newline."""
    body = {
        "format": releasesign.FORMAT,
        "project": releasesign.PROJECT,
        "version": version,
        "assets": {
            name: {"sha256": sha256_of(path), "size": path.stat().st_size}
            for name, path in sorted(files.items())
        },
    }
    return (json.dumps(body, indent=2, sort_keys=True) + "\n").encode("utf-8")


def find_binaries(folder: Path) -> dict[str, Path]:
    """Each binary in ``folder``, flat or one folder per artifact as CI hands them over."""
    found: dict[str, Path] = {}
    for name in binaries():
        for candidate in (folder / name, folder / name / name):
            if candidate.is_file():
                found[name] = candidate
                break
    missing = [name for name in binaries() if name not in found]
    if missing:
        listed = ", ".join(missing)
        raise SigningError(f"Not in {folder}: {listed}. Every binary is signed or none.")
    return found


def require_trusted(public: str, trusted: Sequence[str] | None = None) -> None:
    trusted = releasesign.TRUSTED_KEYS if trusted is None else trusted
    if public not in trusted:
        raise SigningError(
            f"Key {releasesign.key_id(public)} is not one this Azimut trusts "
            "(engine/releasesign.py TRUSTED_KEYS). Every copy would refuse the release."
        )


def sign_manifest(
    tag: str,
    files: dict[str, Path],
    key: Ed25519PrivateKey,
    trusted: Sequence[str] | None = None,
) -> tuple[bytes, bytes]:
    """The manifest and its signature, refused unless the app would accept them."""
    if not TAG.fullmatch(tag):
        raise SigningError(f"{tag} is not a release tag like v0.3.5.")
    trusted = releasesign.TRUSTED_KEYS if trusted is None else trusted
    require_trusted(public_line(key), trusted)
    manifest = build_manifest(tag[1:], files)
    signature = base64.b64encode(key.sign(manifest)) + b"\n"
    # the same reader the app uses, so a manifest it would refuse never leaves here
    try:
        releasesign.read(manifest, signature, tag=tag, current="0", keys=trusted)
    except releasesign.ManifestRefused as exc:
        raise SigningError(f"The app would refuse this manifest: {exc}") from exc
    return manifest, signature


def write_pair(folder: Path, manifest: bytes, signature: bytes) -> list[Path]:
    written = [folder / releasesign.MANIFEST_ASSET, folder / releasesign.SIGNATURE_ASSET]
    written[0].write_bytes(manifest)
    written[1].write_bytes(signature)
    return written


# ---- GitHub -------------------------------------------------------------------


def _gh(run: Run, *args: str) -> str:
    try:
        done = run(["gh", *args])
    except FileNotFoundError as exc:
        raise SigningError("The GitHub CLI (gh) is not installed.") from exc
    if done.returncode != 0:
        raise SigningError(f"gh {args[0]} {args[1]} failed: {done.stderr.strip()}")
    return done.stdout


def _run(cmd: Sequence[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(list(cmd), capture_output=True, text=True, check=False)


def sign_published(
    tag: str,
    key: Ed25519PrivateKey,
    *,
    replace: bool = False,
    run: Run = _run,
    trusted: Sequence[str] | None = None,
) -> str:
    """Sign the binaries the release ``tag`` serves, and attach the manifest to it.

    Signs what users download, not a local build: the bytes are fetched back from
    the release first."""
    listed = json.loads(_gh(run, "release", "view", tag, "--repo", GITHUB_REPO, "--json", "assets"))
    names = {str(asset.get("name")) for asset in listed.get("assets", [])}
    if releasesign.MANIFEST_ASSET in names and not replace:
        raise SigningError(f"{tag} is already signed. Pass --replace to sign it again.")
    with tempfile.TemporaryDirectory(prefix="azimut-sign-") as scratch:
        folder = Path(scratch)
        patterns = [arg for name in binaries() for arg in ("--pattern", name)]
        _gh(run, "release", "download", tag, "--repo", GITHUB_REPO, "--dir", scratch, *patterns)
        manifest, signature = sign_manifest(tag, find_binaries(folder), key, trusted)
        pair = [str(path) for path in write_pair(folder, manifest, signature)]
        clobber = ["--clobber"] if replace else []
        _gh(run, "release", "upload", tag, "--repo", GITHUB_REPO, *pair, *clobber)
    return manifest.decode("utf-8")


# ---- command line ---------------------------------------------------------------


def main(argv: list[str] | None = None, ask: Ask = getpass.getpass, run: Run = _run) -> int:
    parser = argparse.ArgumentParser(description="Make the release signing key, sign releases.")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, text in (("new-key", "make the key, once"), ("public-key", "print its public line")):
        cmd = sub.add_parser(name, help=text)
        cmd.add_argument("--key", type=Path, default=DEFAULT_KEY)
    sign = sub.add_parser("sign", help="sign a release's manifest")
    sign.add_argument("tag")
    sign.add_argument("--key", type=Path, default=DEFAULT_KEY)
    sign.add_argument("--from", dest="source", type=Path, help="binaries on disk; no upload")
    sign.add_argument("--replace", action="store_true", help="sign a signed release again")
    args = parser.parse_args(argv)

    try:
        if args.command == "new-key":
            line = new_key(args.key, ask)
            print(f"Key written to {args.key} (id {releasesign.key_id(line)}).")
            print("Copy that file to two places offline now. Without it, no release can be signed.")
            print("The public line, for engine/releasesign.py TRUSTED_KEYS:")
            print(line)
        elif args.command == "public-key":
            line = public_of(args.key)
            print(f"{line}  (id {releasesign.key_id(line)})")
        else:
            # an untrusted key is turned away before its passphrase is asked for
            require_trusted(public_of(args.key))
            if args.source is not None:
                files = find_binaries(args.source)
                manifest, signature = sign_manifest(args.tag, files, load_key(args.key, ask))
                for path in write_pair(args.source, manifest, signature):
                    print(f"Wrote {path}")
            else:
                key = load_key(args.key, ask)
                print(sign_published(args.tag, key, replace=args.replace), end="")
                print(f"Signed and attached to {args.tag}.")
    except SigningError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
