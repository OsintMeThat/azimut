"""A release's signed manifest: what each binary must hash to, and whether to believe it.

The one-click update installs a binary only when its release carries
``azimut-manifest.json`` and ``azimut-manifest.json.sig``, and the signature
verifies against a key this copy of Azimut trusts. The maintainer signs after the
tag, on their own machine (``scripts/release_signing.py``), so write access to the
repository's releases is not enough to push a binary onto every machine.

The manifest is signed rather than each binary, so the version travels with the
hashes: an old signed binary cannot be served again as a newer one.

The format is a contract with copies already installed: an Azimut out in the world
reads the manifests of every later release with the rules it shipped with. A field
may be added, since readers ignore what they don't know. None may be removed,
renamed or change meaning without raising ``FORMAT``, which older readers refuse,
falling back to the manual download.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import json
import re
from dataclasses import dataclass
from typing import Any, Iterable

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from . import updates

MANIFEST_ASSET = "azimut-manifest.json"
SIGNATURE_ASSET = MANIFEST_ASSET + ".sig"
FORMAT = 1
PROJECT = "azimut"

#: The public half of the release signing key: base64 of its 32 raw bytes. With
#: nothing here every manifest is refused, and the pop-up offers the manual
#: download as it always has. Replacing the key takes a release signed with the old
#: one that lists both; the release after it can drop the old one.
TRUSTED_KEYS: tuple[str, ...] = (
    "bt3YHEjghRjw0WBBwheiID8K8Ol2dlRs0khtX9USEFM=",  # id e8249ea9, made 2026-11-28
)

#: A manifest names three binaries; anything near these sizes is not ours.
MANIFEST_LIMIT = 64 * 1024
SIGNATURE_LIMIT = 1024
ASSET_SIZE_LIMIT = 1024**3

_VERSION = re.compile(r"\d+(\.\d+){1,3}")
_ASSET_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
_SHA256 = re.compile(r"[0-9a-f]{64}")


class ManifestRefused(ValueError):
    """The manifest can't be believed, or doesn't describe the release asked for."""


@dataclass(frozen=True)
class Asset:
    sha256: str
    size: int


@dataclass(frozen=True)
class Manifest:
    version: str
    assets: dict[str, Asset]


def public_key(encoded: str) -> Ed25519PublicKey:
    """A key from ``TRUSTED_KEYS``'s spelling. Raises ValueError on anything else."""
    try:
        raw = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"not base64: {encoded!r}") from exc
    if len(raw) != 32:
        raise ValueError(f"an Ed25519 public key is 32 bytes, this one is {len(raw)}")
    return Ed25519PublicKey.from_public_bytes(raw)


def key_id(encoded: str) -> str:
    """Eight hex digits naming a public key, to tell two keys apart at a glance."""
    raw = base64.b64decode(encoded.strip(), validate=True)
    return hashlib.sha256(raw).hexdigest()[:8]


def _signature(text: bytes) -> bytes:
    if len(text) > SIGNATURE_LIMIT:
        raise ManifestRefused("The signature file is too large to be one.")
    try:
        raw = base64.b64decode(text.strip(), validate=True)
    except (binascii.Error, ValueError) as exc:
        raise ManifestRefused("The signature file is not readable.") from exc
    if len(raw) != 64:
        raise ManifestRefused("The signature file is not readable.")
    return raw


def _authenticate(manifest: bytes, signature: bytes, keys: Iterable[str]) -> None:
    trusted = [public_key(key) for key in keys]
    if not trusted:
        raise ManifestRefused("This copy of Azimut trusts no signing key yet.")
    if len(manifest) > MANIFEST_LIMIT:
        raise ManifestRefused("The manifest is too large to be one.")
    raw = _signature(signature)
    for key in trusted:
        try:
            key.verify(raw, manifest)
            return
        except InvalidSignature:
            continue
    raise ManifestRefused("The manifest does not carry the project's signature.")


def _asset(name: object, entry: object) -> tuple[str, Asset]:
    if not isinstance(name, str) or not _ASSET_NAME.fullmatch(name):
        raise ManifestRefused("The manifest names a file Azimut would not download.")
    if not isinstance(entry, dict):
        raise ManifestRefused(f"The manifest's entry for {name} is not readable.")
    sha256, size = entry.get("sha256"), entry.get("size")
    if not isinstance(sha256, str) or not _SHA256.fullmatch(sha256):
        raise ManifestRefused(f"The manifest's hash for {name} is not readable.")
    # bool is an int to Python; a size of True is a bug, not one byte
    if not isinstance(size, int) or isinstance(size, bool) or not 0 < size <= ASSET_SIZE_LIMIT:
        raise ManifestRefused(f"The manifest's size for {name} is not readable.")
    return name, Asset(sha256=sha256, size=size)


def _parse(manifest: bytes) -> Manifest:
    """The manifest's fields, checked one by one. Only ever reads signed bytes."""
    try:
        body: Any = json.loads(manifest.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise ManifestRefused("The manifest is not readable.") from exc
    if not isinstance(body, dict):
        raise ManifestRefused("The manifest is not readable.")
    fmt = body.get("format")
    if not isinstance(fmt, int) or isinstance(fmt, bool):
        raise ManifestRefused("The manifest is not readable.")
    if fmt != FORMAT:
        raise ManifestRefused("This release needs a newer Azimut to install it.")
    if body.get("project") != PROJECT:
        raise ManifestRefused("The manifest is for another project.")
    version = body.get("version")
    if not isinstance(version, str) or not _VERSION.fullmatch(version):
        raise ManifestRefused("The manifest's version is not readable.")
    listed = body.get("assets")
    if not isinstance(listed, dict) or not listed:
        raise ManifestRefused("The manifest lists no binary.")
    return Manifest(version=version, assets=dict(_asset(k, v) for k, v in listed.items()))


def read(
    manifest: bytes,
    signature: bytes,
    *,
    tag: str,
    current: str,
    keys: Iterable[str] | None = None,
) -> Manifest:
    """The manifest of release ``tag``, believed only when signed by a trusted key.

    It must name the release it was fetched from and be newer than ``current``, so a
    signed manifest of an older release can't be served to walk a copy backwards.
    Raises ManifestRefused, whose message can be shown as it is.
    """
    _authenticate(manifest, signature, TRUSTED_KEYS if keys is None else keys)
    found = _parse(manifest)
    if found.version != tag.strip().lstrip("vV"):
        raise ManifestRefused("The manifest is for another release.")
    if not updates.is_newer(found.version, current):
        raise ManifestRefused(f"{found.version} is not newer than {current}.")
    return found
