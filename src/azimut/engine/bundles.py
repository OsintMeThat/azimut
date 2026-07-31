"""Portable, integrity-checked case bundles.

A plain bundle is a ZIP whose first member is a small compatibility header and
whose last member is the SHA-256 manifest. A sealed bundle encrypts that whole
ZIP as an AES-256-GCM stream, so filenames and sizes are not left in the ZIP
central directory for other programs to read.

**A bundle is the case folder.** Format 2 puts it under one `case/` member
prefix, so unzipping one by hand gives back one directory: `azimut/` holding the
tool's state, and beside it whatever the analyst keeps there. The prefix also
keeps the bundle's own two metadata members outside the case, so files called
`bundle.json` and `bundle-header.json` remain valid analyst files. Format 1
named members relative to the tool root and carried only the tool's half; those
bundles still import, and the folder migration reshapes them on first open.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import struct
import tempfile
import threading
import time
import unicodedata
import uuid
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, Callable, Iterable, Iterator

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .. import __version__, config, layout
from ..sqlite_backend import SQLITE_SCHEMA, SqliteCase
from ..workspace import Case, CaseError, _now, _replace_with_retry, ensure_dir
from . import workqueue

BUNDLE_FORMAT = 2
#: The format from which members are named relative to the case root rather than
#: the tool root, which is what lets a bundle carry the analyst's own folders.
WRAPPED_MEMBERS = 2
BUNDLE_ROOT = "case"
HEADER_NAME = "bundle-header.json"
MANIFEST_NAME = "bundle.json"
MAGIC = b"AZIMUT-BUNDLE\0"
ENVELOPE_VERSION = 1
KDF_SCRYPT = 1
SCRYPT_LOG_N = 15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 64 * 1024 * 1024
CHUNK_SIZE = 1024 * 1024
MAX_MANIFEST_SIZE = 16 * 1024 * 1024
MAX_BUNDLE_MEMBERS = 100_000
MAX_DECLARED_SIZE = (1 << 63) - 1
MAX_CASE_NAME = 120
LARGE_BUNDLE_SIZE = 10 * 1024 * 1024 * 1024
MIN_DISK_RESERVE = 64 * 1024 * 1024
MAX_DISK_RESERVE = 512 * 1024 * 1024
_ENVELOPE = struct.Struct(">14sBBBII16sI4s")
_ZIP_LOCAL = struct.Struct("<4s5H3I2H")
_ZIP_LOCAL_MAGIC = b"PK\x03\x04"
_ZIP_DESCRIPTOR_MAGIC = b"PK\x07\x08"

#: What the *tool root* holds that travels. Anything else there is a cache or
#: the trash, and `classify_case_entry` must have an answer for it.
BUNDLED_ROOTS = frozenset(
    {"case.json", "notes.md", layout.DATA_DIR, *layout.CASE_SUBDIRS}
)

#: What a format-1 *import* accepts on top of that: the names the tool root used
#: before the database and the session directories were hidden. A bundle written
#: by an older Azimut must still land, and the folder migration reshapes it on
#: first open — refusing the member outright would strand every bundle already
#: exported. Format 2 never uses these, so this set dies with format 1.
IMPORTABLE_ROOTS = BUNDLED_ROOTS | {"case.db", "exports", "inspect", "search"}
NOT_BUNDLED = {
    ".trash": "deleted artifacts do not travel",
    "media/.thumbs": "content-addressed thumbnails are rebuilt",
    "media/.dl": "in-progress downloads belong to this machine",
}

#: Extensions whose bytes are already compressed. Deflating them burns CPU on
#: every export and saves nothing, and the free zone is where a case's largest
#: files land.
_PRECOMPRESSED = frozenset(
    {
        ".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".heic",
        ".mp4", ".m4v", ".mov", ".mkv", ".webm", ".avi",
        ".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac",
        ".zip", ".gz", ".bz2", ".xz", ".zst", ".7z", ".rar",
    }
)

EXPORT_JOB = "bundle-export"
IMPORT_JOB = "bundle-import"
_secret_lock = threading.Lock()
_job_secrets: dict[str, str] = {}
_removed_jobs: dict[str, dict[str, Any]] = {}
_MAX_MEMORY_JOBS = 100
UPLOAD_MAX_AGE = 24 * 60 * 60
_WINDOWS_RESERVED = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{index}" for index in range(1, 10)}
    | {f"LPT{index}" for index in range(1, 10)}
)
_WINDOWS_FORBIDDEN = frozenset('<>:"|?*')


class BundleError(CaseError):
    """A bundle is invalid, incompatible, or cannot be opened."""


def _uploads_dir() -> Path:
    return config.bundles_dir() / ".imports"


def _upload_path(upload_id: str) -> Path:
    try:
        normalized = uuid.UUID(upload_id).hex
    except (ValueError, AttributeError) as exc:
        raise BundleError("invalid bundle upload") from exc
    if normalized != upload_id:
        raise BundleError("invalid bundle upload")
    return _uploads_dir() / f"{normalized}.bundle"


def cleanup_uploads(*, now: float | None = None) -> None:
    """Remove abandoned browser uploads after a bounded recovery window."""
    directory = _uploads_dir()
    if not directory.is_dir():
        return
    cutoff = (time.time() if now is None else now) - UPLOAD_MAX_AGE
    for path in directory.glob("*.bundle"):
        try:
            if path.stat().st_mtime < cutoff:
                path.unlink()
        except FileNotFoundError:
            pass


def stage_upload(source: BinaryIO) -> tuple[str, Path]:
    """Copy one browser upload to durable local staging without buffering it."""
    directory = _uploads_dir()
    directory.mkdir(parents=True, exist_ok=True)
    cleanup_uploads()
    usage = shutil.disk_usage(directory)
    reserve = disk_reserve(usage.total)
    budget = max(0, usage.free - reserve)
    upload_id = uuid.uuid4().hex
    destination = _upload_path(upload_id)
    temporary = destination.with_suffix(".tmp")
    written = 0
    try:
        with temporary.open("xb") as target:
            while chunk := source.read(CHUNK_SIZE):
                current_free = shutil.disk_usage(directory).free
                if (
                    written + len(chunk) > budget
                    or current_free - len(chunk) < reserve
                ):
                    raise BundleError(
                        "not enough free space to stage this bundle without filling the disk"
                    )
                target.write(chunk)
                written += len(chunk)
        _replace_with_retry(temporary, destination)
    except BaseException:
        temporary.unlink(missing_ok=True)
        destination.unlink(missing_ok=True)
        raise
    return upload_id, destination


def uploaded_bundle(upload_id: str) -> Path:
    path = _upload_path(upload_id)
    if not path.is_file():
        raise BundleError("bundle upload not found")
    return path


def discard_upload(upload_id: str) -> None:
    _upload_path(upload_id).unlink(missing_ok=True)


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _safe_member(name: str) -> bool:
    path = PurePosixPath(name)
    if (
        not name
        or path.is_absolute()
        or path.as_posix() != name
        or "\\" in name
        or "\0" in name
    ):
        return False
    for part in path.parts:
        if (
            part in {".", ".."}
            or part.endswith((" ", "."))
            or any(ord(char) < 32 or char in _WINDOWS_FORBIDDEN for char in part)
            or part.split(".", 1)[0].upper() in _WINDOWS_RESERVED
        ):
            return False
    return True


def _portable_member_key(name: str) -> str:
    """The name Windows and macOS use for collision checks."""
    return "/".join(
        unicodedata.normalize("NFC", part).casefold()
        for part in PurePosixPath(name).parts
    )


def _validate_member_names(names: list[str]) -> None:
    # Checked on the way out as well as on the way in: an export that produced
    # more members than an import accepts would write a bundle nobody could
    # open, and the free zone is where a case first gets enough files for that
    # to be reachable.
    if len(names) > MAX_BUNDLE_MEMBERS:
        raise BundleError(
            f"a bundle carries at most {MAX_BUNDLE_MEMBERS} files, and this case has {len(names)}"
        )
    if any(not _safe_member(name) for name in names):
        raise BundleError("the bundle contains a path that is not portable")
    portable = [_portable_member_key(name) for name in names]
    if len(portable) != len(set(portable)):
        raise BundleError("the bundle contains paths that collide on another operating system")


def disk_reserve(total: int) -> int:
    """Leave a small recovery margin without imposing a fixed bundle-size cap."""
    return min(MAX_DISK_RESERVE, max(MIN_DISK_RESERVE, total // 100))


def _space_preview(source: Path, header: dict[str, Any]) -> dict[str, Any]:
    """Estimate peak extra space for an import on the workspace filesystem."""
    try:
        usage = shutil.disk_usage(config.workspace_root())
        source_size = source.stat().st_size
    except OSError as exc:
        raise BundleError("could not check free space for this bundle") from exc
    payload = int(header["total_size"])
    # A sealed bundle is decrypted to a temporary ZIP before extraction. A plain
    # ZIP is read in place, so only its extracted payload needs additional space.
    estimated = payload + (source_size if header.get("sealed") else 0)
    reserve = disk_reserve(usage.total)
    return {
        "estimated_import_bytes": estimated,
        "free_space_bytes": usage.free,
        "space_reserve_bytes": reserve,
        "space_ok": estimated + reserve <= usage.free,
        "large_bundle": payload >= LARGE_BUNDLE_SIZE or estimated * 2 >= max(usage.free, 1),
    }


def _require_import_space(source: Path, header: dict[str, Any]) -> None:
    preview = _space_preview(source, header)
    if not preview["space_ok"]:
        raise BundleError(
            "not enough free space to import this bundle while keeping a disk safety reserve"
        )


def _require_extract_space(target: Path, total_size: int) -> None:
    try:
        usage = shutil.disk_usage(target)
    except OSError as exc:
        raise BundleError("could not check free space for bundle extraction") from exc
    if total_size + disk_reserve(usage.total) > usage.free:
        raise BundleError(
            "not enough free space to extract this bundle while keeping a disk safety reserve"
        )


def _require_export_space(target: Path, total_size: int) -> None:
    try:
        usage = shutil.disk_usage(target.parent)
    except OSError as exc:
        raise BundleError("could not check free space for bundle export") from exc
    if total_size + disk_reserve(usage.total) > usage.free:
        raise BundleError(
            "not enough free space to export this case while keeping a disk safety reserve"
        )


def _included(rel: str) -> bool:
    if rel == ".trash" or rel.startswith(".trash/"):
        return False
    if rel in {"media/.thumbs", "media/.dl"}:
        return False
    if rel.startswith("media/.thumbs/") or rel.startswith("media/.dl/"):
        return False
    return PurePosixPath(rel).parts[0] in BUNDLED_ROOTS


def _importable(rel: str, version: int) -> bool:
    """Whether a bundle member may land, at the naming its format declares."""
    if version < WRAPPED_MEMBERS:
        return PurePosixPath(rel).parts[0] in IMPORTABLE_ROOTS
    parts = PurePosixPath(rel).parts
    if len(parts) < 2 or parts[0] != BUNDLE_ROOT:
        return False
    head = parts[1]
    inside = "/".join(parts[2:])
    if head == layout.TOOL_DIR:
        return bool(inside) and _included(inside)
    return not layout.is_tool_dir(head)


def classify_case_entry(rel: str) -> str | None:
    """Return ``bundled``/``not-bundled`` for declared case state."""
    if _included(rel):
        return "bundled"
    if any(rel == path or rel.startswith(path + "/") for path in NOT_BUNDLED):
        return "not-bundled"
    return None


def _walk(
    entries: Iterable[Path], base: Path, keep: Callable[[str], bool]
) -> Iterator[tuple[str, Path]]:
    """(`base`-relative name, path) for every file under `entries` that `keep` keeps.

    A directory `keep` rejects is never descended into, so skipping a cache
    costs nothing.

    Symlinks are refused rather than followed. `rglob` walks into a linked
    directory and `is_file()` follows a linked file, so the previous walk would
    have copied a link's *target* into the bundle under a name saying it was the
    analyst's own file — which turns "the free zone travels" into a way to read
    anything the account can reach. A bundle carries what the folder holds.
    """
    for entry in sorted(entries):
        rel = entry.relative_to(base).as_posix()
        if not keep(rel):
            continue
        if entry.is_symlink():
            raise BundleError(f"'{rel}' is a symbolic link; a bundle carries files, not links")
        if entry.is_dir():
            yield from _walk(entry.iterdir(), base, keep)
        elif entry.is_file():
            yield rel, entry
        else:
            raise BundleError(f"'{rel}' is not a regular file")


def _check_free_name(name: str) -> None:
    """The one name the analyst's half of a case folder cannot use."""
    if layout.is_tool_dir(name):
        raise BundleError(
            f"'{name}' collides with Azimut's own folder on Windows and macOS; "
            "rename it before exporting"
        )


def _case_files(case: Case) -> Iterator[tuple[str, Path]]:
    """Every file a bundle carries, named the way the bundle names it.

    Members sit under the bundle's `case/` prefix: `case/azimut/media/x.png` for
    the tool's own state, and the analyst's folders under the names they gave
    them. A bundle should carry the whole investigation rather than the half
    Azimut happened to author. The prefix makes an unzipped bundle one folder
    and leaves the bundle's metadata names outside the analyst's free zone.

    The manifest and the database are not in here. The export writes them
    itself, the database after cleaning this machine's state out of it.
    """
    tool = case.tool_root
    written_apart = {
        path.relative_to(tool).as_posix() for path in (case.json_path, case.db_path)
    }
    for rel, path in _walk(tool.iterdir(), tool, _included):
        if rel not in written_apart:
            yield f"{BUNDLE_ROOT}/{layout.TOOL_DIR}/{rel}", path
    free = case.free_entries()
    for entry in free:
        _check_free_name(entry.name)
    for rel, path in _walk(free, case.path, lambda _rel: True):
        yield f"{BUNDLE_ROOT}/{rel}", path


def _clean_database(source: Path, target: Path) -> None:
    """Take a consistent copy, remove local machine state, then compact it."""
    src = sqlite3.connect(source)
    dst = sqlite3.connect(target)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()

    conn = sqlite3.connect(target)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("DELETE FROM trash")
        conn.execute("DELETE FROM jobs WHERE state IN ('queued', 'running')")
        conn.commit()
        conn.execute("VACUUM")
    finally:
        conn.close()


def _zip_info(name: str, *, compressed: bool) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, datetime.now().timetuple()[:6])
    info.compress_type = zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED
    info.external_attr = 0o600 << 16
    return info


def _compress_member(name: str) -> bool:
    if name == HEADER_NAME:
        return False
    if name.startswith(f"{BUNDLE_ROOT}/{layout.TOOL_DIR}/media/"):
        return False
    return PurePosixPath(name).suffix.lower() not in _PRECOMPRESSED


def _write_bytes(
    archive: zipfile.ZipFile,
    name: str,
    data: bytes,
    records: list[dict[str, Any]],
) -> None:
    archive.writestr(_zip_info(name, compressed=_compress_member(name)), data)
    records.append({"path": name, "size": len(data), "sha256": _sha256(data)})


def _write_file(
    archive: zipfile.ZipFile,
    name: str,
    source: Path,
    records: list[dict[str, Any]],
) -> None:
    digest = hashlib.sha256()
    size = 0
    with source.open("rb") as src, archive.open(
        _zip_info(name, compressed=_compress_member(name)), "w"
    ) as dst:
        while chunk := src.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
            dst.write(chunk)
    records.append({"path": name, "size": size, "sha256": digest.hexdigest()})


def _derive_key(password: str, salt: bytes, *, log_n: int, r: int, p: int) -> bytes:
    if not password:
        raise BundleError("password required")
    try:
        return hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=1 << log_n,
            r=r,
            p=p,
            maxmem=SCRYPT_MAXMEM,
            dklen=32,
        )
    except (ValueError, OSError) as exc:
        raise BundleError(f"could not derive the bundle key: {exc}") from exc


def _aad(header: bytes, index: int, final: bool) -> bytes:
    return hashlib.sha256(header).digest() + index.to_bytes(8, "big") + bytes([final])


class _EnvelopeWriter:
    """Unseekable ZIP target that encrypts while bytes arrive."""

    def __init__(self, raw: BinaryIO, password: str):
        self.raw = raw
        salt = os.urandom(16)
        self.nonce_prefix = os.urandom(4)
        self.header = _ENVELOPE.pack(
            MAGIC,
            ENVELOPE_VERSION,
            KDF_SCRYPT,
            SCRYPT_LOG_N,
            SCRYPT_R,
            SCRYPT_P,
            salt,
            CHUNK_SIZE,
            self.nonce_prefix,
        )
        self.raw.write(self.header)
        self.cipher = AESGCM(
            _derive_key(
                password,
                salt,
                log_n=SCRYPT_LOG_N,
                r=SCRYPT_R,
                p=SCRYPT_P,
            )
        )
        self.buffer = bytearray()
        self.index = 0
        self.position = 0
        self.finished = False

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def tell(self) -> int:
        return self.position

    def write(self, data: bytes | bytearray) -> int:
        if self.finished:
            raise ValueError("bundle envelope is closed")
        incoming = bytes(data)
        self.buffer.extend(incoming)
        self.position += len(incoming)
        while len(self.buffer) > CHUNK_SIZE:
            chunk = bytes(self.buffer[:CHUNK_SIZE])
            del self.buffer[:CHUNK_SIZE]
            self._seal(chunk, final=False)
        return len(incoming)

    def _seal(self, chunk: bytes, *, final: bool) -> None:
        nonce = self.nonce_prefix + self.index.to_bytes(8, "big")
        self.raw.write(self.cipher.encrypt(nonce, chunk, _aad(self.header, self.index, final)))
        self.index += 1

    def finish(self) -> None:
        if self.finished:
            return
        self._seal(bytes(self.buffer), final=True)
        self.buffer.clear()
        self.raw.flush()
        self.finished = True

    def flush(self) -> None:
        self.raw.flush()


def _bundle_name(case: Case, sealed: bool) -> str:
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    suffix = ".azimut.enc" if sealed else ".azimut.zip"
    return f"{case.id}-{date}{suffix}"


def bundle_path(case: Case, *, sealed: bool) -> Path:
    return config.bundles_dir() / _bundle_name(case, sealed)


def export_case(
    case: Case,
    *,
    password: str | None = None,
    output: Path | None = None,
) -> Path:
    """Write one complete bundle atomically and return its path."""
    config.bundles_dir().mkdir(parents=True, exist_ok=True)
    output = Path(output) if output is not None else bundle_path(case, sealed=bool(password))
    if output.parent.resolve() != config.bundles_dir().resolve():
        raise BundleError("bundle output must stay inside the workspace bundle directory")
    temp_output = output.with_name(f".{output.name}.{uuid.uuid4().hex}.tmp")
    fd, db_name = tempfile.mkstemp(prefix="azimut-bundle-db-", suffix=".db", dir=config.bundles_dir())
    os.close(fd)
    clean_db = Path(db_name)

    try:
        _clean_database(case.db_path, clean_db)
        case_json = case.json_path.read_bytes()
        files = list(_case_files(case))
        # The two members the export writes itself, named the way every other
        # member is: where they sit in the case folder.
        manifest_member = (
            f"{BUNDLE_ROOT}/{case.json_path.relative_to(case.path).as_posix()}"
        )
        db_member = f"{BUNDLE_ROOT}/{case.db_path.relative_to(case.path).as_posix()}"
        _validate_member_names(
            [HEADER_NAME, manifest_member, db_member, *(rel for rel, _ in files), MANIFEST_NAME]
        )
        total_size = len(case_json) + clean_db.stat().st_size
        total_size += sum(path.stat().st_size for _, path in files)
        _require_export_space(temp_output, total_size)
        header = {
            "format_version": BUNDLE_FORMAT,
            "azimut_version": __version__,
            "case_db_schema": SQLITE_SCHEMA,
            "case_name": case.read().get("name", case.id),
            "origin_case_id": case.id,
            "created_at": _now(),
            "total_size": total_size,
        }

        envelope: _EnvelopeWriter | None = None
        with temp_output.open("wb") as raw:
            target: Any = raw
            if password:
                envelope = _EnvelopeWriter(raw, password)
                target = envelope
            records: list[dict[str, Any]] = []
            with zipfile.ZipFile(target, "w", allowZip64=True) as archive:
                _write_bytes(archive, HEADER_NAME, _json_bytes(header), records)
                _write_bytes(archive, manifest_member, case_json, records)
                _write_file(archive, db_member, clean_db, records)
                for rel, path in files:
                    _write_file(archive, rel, path, records)
                archive.writestr(
                    _zip_info(MANIFEST_NAME, compressed=True),
                    _json_bytes({"format_version": BUNDLE_FORMAT, "members": records}),
                )
            if envelope is not None:
                envelope.finish()
        _replace_with_retry(temp_output, output)
        return output
    except BaseException:
        temp_output.unlink(missing_ok=True)
        raise
    finally:
        clean_db.unlink(missing_ok=True)


def _read_envelope(source: Path) -> tuple[bytes, dict[str, Any]]:
    with source.open("rb") as stream:
        raw = stream.read(_ENVELOPE.size)
    if len(raw) != _ENVELOPE.size:
        raise BundleError("the encrypted bundle header is incomplete")
    magic, version, kdf, log_n, r, p, salt, chunk_size, nonce_prefix = _ENVELOPE.unpack(raw)
    if magic != MAGIC or version != ENVELOPE_VERSION or kdf != KDF_SCRYPT:
        raise BundleError("unsupported encrypted bundle")
    if (log_n, r, p) != (SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P):
        raise BundleError("unsupported encrypted bundle key parameters")
    if chunk_size != CHUNK_SIZE:
        raise BundleError("unsupported encrypted bundle chunk size")
    return raw, {
        "log_n": log_n,
        "r": r,
        "p": p,
        "salt": salt,
        "chunk_size": chunk_size,
        "nonce_prefix": nonce_prefix,
    }


def _decrypt_chunks(source: Path, password: str) -> Iterator[bytes]:
    header, params = _read_envelope(source)
    remaining = source.stat().st_size - _ENVELOPE.size
    if remaining <= 16:
        raise BundleError("the encrypted bundle is incomplete")
    key = _derive_key(
        password,
        params["salt"],
        log_n=params["log_n"],
        r=params["r"],
        p=params["p"],
    )
    cipher = AESGCM(key)
    full = params["chunk_size"] + 16
    with source.open("rb") as stream:
        stream.seek(_ENVELOPE.size)
        index = 0
        while remaining:
            take = min(full, remaining)
            final = remaining <= full
            sealed = stream.read(take)
            if len(sealed) != take or take <= 16:
                raise BundleError("the encrypted bundle is incomplete")
            nonce = params["nonce_prefix"] + index.to_bytes(8, "big")
            try:
                yield cipher.decrypt(nonce, sealed, _aad(header, index, final))
            except InvalidTag as exc:
                raise BundleError("wrong password or damaged bundle") from exc
            remaining -= take
            index += 1


def _first_zip_member(data: bytes) -> tuple[str, bytes]:
    if len(data) < _ZIP_LOCAL.size:
        raise BundleError("the bundle header is incomplete")
    signature, _, flags, compression, _, _, _, packed, _, name_len, extra_len = _ZIP_LOCAL.unpack(
        data[: _ZIP_LOCAL.size]
    )
    if signature != _ZIP_LOCAL_MAGIC or compression != zipfile.ZIP_STORED:
        raise BundleError("the bundle header is not the first stored ZIP member")
    start = _ZIP_LOCAL.size + name_len + extra_len
    if len(data) < start:
        raise BundleError("the bundle header is incomplete")
    name = data[_ZIP_LOCAL.size : _ZIP_LOCAL.size + name_len].decode("utf-8")
    if flags & 0x08:
        end = data.find(_ZIP_DESCRIPTOR_MAGIC, start)
        if end < 0:
            raise BundleError("the bundle header exceeds the pre-flight window")
    else:
        end = start + packed
    return name, data[start:end]


def _validate_header(header: Any) -> dict[str, Any]:
    if not isinstance(header, dict):
        raise BundleError("invalid bundle header")
    version = header.get("format_version")
    db_schema = header.get("case_db_schema")
    if not isinstance(version, int) or not 1 <= version <= BUNDLE_FORMAT:
        raise BundleError("this bundle needs a newer Azimut bundle format")
    if not isinstance(db_schema, int) or not 1 <= db_schema <= SQLITE_SCHEMA:
        raise BundleError("this bundle needs a newer Azimut case database")
    case_name = header.get("case_name")
    if (
        not isinstance(case_name, str)
        or not case_name.strip()
        or len(case_name) > MAX_CASE_NAME
    ):
        raise BundleError("the bundle has no case name")
    total_size = header.get("total_size")
    if (
        not isinstance(total_size, int)
        or isinstance(total_size, bool)
        or not 0 <= total_size <= MAX_DECLARED_SIZE
    ):
        raise BundleError("the bundle has an invalid total size")
    origin = header.get("origin_case_id")
    if origin is not None and (not isinstance(origin, str) or len(origin) > MAX_CASE_NAME):
        raise BundleError("the bundle has an invalid origin case")
    return {**header, "case_name": case_name.strip()}


def inspect_bundle(source: Path, *, password: str | None = None) -> dict[str, Any]:
    """Read only enough for the import confirmation."""
    source = Path(source).expanduser()
    if not source.is_file():
        raise BundleError(f"bundle '{source}' not found")
    with source.open("rb") as stream:
        sealed = stream.read(len(MAGIC)) == MAGIC
    if sealed:
        first = next(_decrypt_chunks(source, password or ""))
        name, data = _first_zip_member(first)
        if name != HEADER_NAME:
            raise BundleError("bundle-header.json is not the first member")
        try:
            header = json.loads(data)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BundleError("invalid bundle header") from exc
    else:
        try:
            with zipfile.ZipFile(source) as archive:
                infos = archive.infolist()
                if not infos or infos[0].filename != HEADER_NAME:
                    raise BundleError("bundle-header.json is not the first member")
                with archive.open(infos[0]) as member:
                    data = member.read(CHUNK_SIZE + 1)
                if len(data) > CHUNK_SIZE:
                    raise BundleError("the bundle header is too large")
                header = json.loads(data)
        except (OSError, zipfile.BadZipFile, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BundleError("invalid case bundle") from exc
    preview = {**_validate_header(header), "sealed": sealed, "path": str(source)}
    return {**preview, **_space_preview(source, preview)}


def _decrypt_to(source: Path, target: Path, password: str) -> None:
    with target.open("wb") as stream:
        for chunk in _decrypt_chunks(source, password):
            stream.write(chunk)


def _manifest(
    archive: zipfile.ZipFile, version: int
) -> tuple[list[zipfile.ZipInfo], dict[str, Any]]:
    infos = archive.infolist()
    names = [info.filename for info in infos]
    if len(names) != len(set(names)):
        raise BundleError("the bundle contains duplicate member names")
    if not names or names[0] != HEADER_NAME or names[-1] != MANIFEST_NAME:
        raise BundleError("the bundle header or manifest is out of place")
    _validate_member_names(names)
    for name in names[1:-1]:
        if not _importable(name, version):
            raise BundleError("the bundle contains undeclared case state")
    if any((info.external_attr >> 16) & 0o170000 == 0o120000 for info in infos):
        raise BundleError("the bundle contains a symbolic link")
    if any(info.is_dir() for info in infos):
        raise BundleError("the bundle contains directory members")
    try:
        with archive.open(MANIFEST_NAME) as member:
            raw_manifest = member.read(MAX_MANIFEST_SIZE + 1)
        if len(raw_manifest) > MAX_MANIFEST_SIZE:
            raise BundleError("the bundle manifest is too large")
        manifest = json.loads(raw_manifest)
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BundleError("invalid bundle manifest") from exc
    records = manifest.get("members") if isinstance(manifest, dict) else None
    if not isinstance(records, list):
        raise BundleError("invalid bundle manifest")
    if manifest.get("format_version") != version:
        raise BundleError("unsupported bundle manifest")
    by_name: dict[str, dict[str, Any]] = {}
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get("path"), str):
            raise BundleError("invalid bundle manifest member")
        name = record["path"]
        if name in by_name:
            raise BundleError("the bundle manifest contains duplicate paths")
        by_name[name] = record
    if set(by_name) != set(names[:-1]):
        raise BundleError("the bundle members do not match its manifest")
    return infos[:-1], by_name


def _verify_and_extract(
    archive_path: Path, case_root: Path, *, declared: int
) -> dict[str, Any]:
    """Check every member against the manifest, then write them out.

    `declared` is the format the pre-flight header announced, and it decides
    both which member names are legal and where they land. It is not trusted on
    that word alone: the header is verified against the manifest below, and the
    version it really carries has to be the one the names were checked against.
    """
    with zipfile.ZipFile(archive_path) as archive:
        infos, records = _manifest(archive, declared)
        for info in infos:
            record = records[info.filename]
            expected_size = record.get("size")
            expected_hash = record.get("sha256")
            if (
                not isinstance(expected_size, int)
                or isinstance(expected_size, bool)
                or not 0 <= expected_size <= MAX_DECLARED_SIZE
                or not isinstance(expected_hash, str)
                or len(expected_hash) != 64
                or any(char not in "0123456789abcdef" for char in expected_hash)
                or info.file_size != expected_size
            ):
                raise BundleError("invalid bundle manifest member")

        header_info = infos[0]
        header_record = records[HEADER_NAME]
        with archive.open(header_info) as member:
            data = member.read(CHUNK_SIZE + 1)
        if len(data) > CHUNK_SIZE:
            raise BundleError("the bundle header is too large")
        if (
            len(data) != header_record["size"]
            or hashlib.sha256(data).hexdigest() != header_record["sha256"]
        ):
            raise BundleError("bundle-header.json failed verification")
        try:
            header = _validate_header(json.loads(data))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise BundleError("invalid bundle header") from exc
        if header["format_version"] != declared:
            raise BundleError("the bundle format does not match its verified header")
        # Format 1 named its members relative to the tool root and carried only
        # the tool's half of the case; format 2 names them relative to the case
        # folder and carries all of it.
        target = case_root if declared >= WRAPPED_MEMBERS else layout.tool_root(case_root)

        declared_total = sum(records[info.filename]["size"] for info in infos[1:])
        if declared_total != header["total_size"]:
            raise BundleError("the bundle total size does not match its manifest")
        _require_extract_space(target, declared_total)

        total_written = 0
        for info in infos[1:]:
            record = records[info.filename]
            expected_size = record["size"]
            digest = hashlib.sha256()
            size = 0
            relative = PurePosixPath(info.filename)
            if declared >= WRAPPED_MEMBERS:
                # `_importable` proved the first component is exactly `case`.
                relative = PurePosixPath(*relative.parts[1:])
            destination = target / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as src:
                sink: BinaryIO = destination.open("wb")
                with sink:
                    while chunk := src.read(CHUNK_SIZE):
                        if size + len(chunk) > expected_size:
                            raise BundleError(
                                f"bundle member '{info.filename}' exceeds its declared size"
                            )
                        digest.update(chunk)
                        size += len(chunk)
                        total_written += len(chunk)
                        if total_written > declared_total:
                            raise BundleError("the bundle exceeds its declared total size")
                        sink.write(chunk)
            if size != expected_size or digest.hexdigest() != record["sha256"]:
                raise BundleError(f"bundle member '{info.filename}' failed verification")
        return header


def _prepare_import_database(
    db_path: Path,
    *,
    media_dir: Path,
    declared_schema: int,
    origin_case_id: str,
    name: str,
) -> None:
    with closing(sqlite3.connect(db_path)) as conn:
        row = conn.execute("SELECT value FROM meta WHERE key = 'schema_version'").fetchone()
        if row is None or int(row[0]) != declared_schema:
            raise BundleError("the case database does not match the bundle header")
        if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise BundleError("the case database failed its integrity check")
        if conn.execute("PRAGMA foreign_key_check").fetchone() is not None:
            raise BundleError("the case database has broken references")
    SqliteCase.open(db_path, media_dir=media_dir)
    with closing(sqlite3.connect(db_path)) as conn:
        for key, value in (
            ("name", name),
            ("origin_case_id", origin_case_id),
            ("imported_at", _now()),
        ):
            conn.execute(
                "INSERT INTO meta(key, value) VALUES(?, ?)"
                " ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )
        conn.commit()


def imported_name(name: str) -> str:
    return f"{name} (imported)"


def create_import_case(name: str) -> Case:
    """Create a distinct destination, adding a number only when needed."""
    base = imported_name(name)
    candidate = base
    index = 2
    while True:
        try:
            return Case.create(candidate)
        except CaseError:
            pass
        candidate = f"{base} {index}"
        index += 1


def _install_running_job(db_path: Path, job: dict[str, Any]) -> None:
    """Carry the import job through the final directory swap."""
    with closing(sqlite3.connect(db_path)) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO jobs"
            "(id, kind, job_key, state, attempts, max_attempts, payload_json,"
            " error, created_at, updated_at)"
            " VALUES(?, ?, ?, 'running', ?, ?, ?, NULL, ?, ?)",
            (
                job["id"],
                job["kind"],
                job.get("key"),
                job.get("attempts", 1),
                job.get("max_attempts", 1),
                json.dumps(job.get("payload") or {}, ensure_ascii=False),
                job.get("created_at") or _now(),
                _now(),
            ),
        )
        conn.commit()


def import_into(
    case: Case,
    source: Path,
    *,
    password: str | None = None,
    job: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Verify a bundle in staging, then swap it over a fresh destination shell."""
    source = Path(source).expanduser()
    header = inspect_bundle(source, password=password)
    _require_import_space(source, header)
    staging = case.path.with_name(f"{case.id}.incoming")
    old = case.path.with_name(f"{case.id}.import-shell-{uuid.uuid4().hex}")
    if staging.exists():
        raise BundleError(f"import staging path '{staging.name}' already exists")
    staging.mkdir()
    # A format-1 bundle names its members relative to the tool root, so the
    # directory they extract into has to exist first. A format-2 bundle carries
    # `azimut/` itself and this is a no-op it does not mind.
    layout.tool_root(staging).mkdir()
    archive_path = source
    decrypted = staging / ".bundle.zip"
    try:
        if header["sealed"]:
            _decrypt_to(source, decrypted, password or "")
            archive_path = decrypted
        verified = _verify_and_extract(
            archive_path, staging, declared=int(header["format_version"])
        )
        decrypted.unlink(missing_ok=True)
        # The staging directory is a case shell, not a case yet, so it is
        # addressed through `layout` against its own root rather than through a
        # `Case`.
        staged_manifest = layout.manifest(staging)
        staged_db = layout.extracted_database(staging)
        if not staged_manifest.is_file() or not staged_db.is_file():
            raise BundleError("the bundle does not contain a complete case")
        name = case.read().get("name", imported_name(verified["case_name"]))
        manifest = json.loads(staged_manifest.read_text(encoding="utf-8"))
        manifest["name"] = name
        manifest["updated_at"] = _now()
        staged_manifest.write_bytes(_json_bytes(manifest))
        _prepare_import_database(
            staged_db,
            media_dir=layout.media(staging),
            declared_schema=verified["case_db_schema"],
            origin_case_id=str(verified.get("origin_case_id") or ""),
            name=name,
        )
        if job is not None:
            _install_running_job(staged_db, job)
        case.path.rename(old)
        staging.rename(case.path)
        imported = Case.open(case.id)
        # After the open, because opening is what migrates a case from an older
        # release: a `.inspect/` created here first would sit in the way of the
        # `inspect/` that step still has to rename. A ZIP carries no empty
        # directories, so this is also what gives the case the ones it is born
        # with — through `ensure_dir`, so the dot-directories are hidden.
        ensure_dir(layout.data_dir(imported.path))
        for directory in layout.content_dirs(imported.path):
            ensure_dir(directory)
        from . import thumbnails

        for item in imported.list_media_items():
            if item.get("kind") in thumbnails.THUMBNAILED_KINDS:
                if job is None:
                    thumbnails.enqueue(imported, item["path"])
                else:
                    imported.enqueue_job(
                        thumbnails.THUMB_KIND,
                        key=item["path"],
                        payload={"path": item["path"]},
                    )
        shutil.rmtree(old)
        return {"case_id": imported.id, "name": name, "origin_case_id": verified["origin_case_id"]}
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        if old.exists() and not case.path.exists():
            old.rename(case.path)
        raise


def _remember_secret(job_id: str, password: str | None) -> None:
    if not password:
        return
    with _secret_lock:
        _job_secrets[job_id] = password
        while len(_job_secrets) > _MAX_MEMORY_JOBS:
            _job_secrets.pop(next(iter(_job_secrets)))


def _take_secret(job_id: str) -> str | None:
    with _secret_lock:
        return _job_secrets.pop(job_id, None)


def queue_export(case: Case, *, password: str | None = None) -> dict[str, Any]:
    """Queue an export without ever persisting its password."""
    sealed = bool(password)
    job = case.enqueue_job(
        EXPORT_JOB,
        payload={"sealed": sealed, "output": str(bundle_path(case, sealed=sealed))},
        max_attempts=1 if sealed else 3,
    )
    _remember_secret(job["id"], password)
    workqueue.wake(case)
    return job


def queue_import(
    source: Path,
    *,
    password: str | None = None,
    cleanup_source: bool = False,
) -> tuple[Case, dict[str, Any]]:
    """Pre-flight, create the new case shell, then queue its import."""
    header = inspect_bundle(source, password=password)
    _require_import_space(Path(source), header)
    case = create_import_case(header["case_name"])
    job = case.enqueue_job(
        IMPORT_JOB,
        payload={
            "source": str(Path(source).expanduser()),
            "sealed": header["sealed"],
            "cleanup_source": cleanup_source,
        },
        max_attempts=1,
    )
    _remember_secret(job["id"], password)
    workqueue.wake(case)
    return case, job


def job_status(case_id: str, job_id: str) -> dict[str, Any] | None:
    """Read a live durable job, or the terminal error of a removed import shell."""
    with _secret_lock:
        removed = _removed_jobs.get(job_id)
    if removed is not None and removed.get("case_id") == case_id:
        return dict(removed)
    try:
        case = Case.open(case_id)
    except CaseError:
        return None
    return case.get_job(job_id)


def _handle_export(case: Case, job: dict[str, Any]) -> None:
    sealed = bool(job["payload"].get("sealed"))
    password = _take_secret(job["id"])
    if sealed and not password:
        raise workqueue.JobFailed("Password expired; restart the export")
    export_case(case, password=password, output=Path(job["payload"]["output"]))


def _handle_import(case: Case, job: dict[str, Any]) -> None:
    sealed = bool(job["payload"].get("sealed"))
    source = Path(job["payload"]["source"])
    password = _take_secret(job["id"])
    try:
        if sealed and not password:
            error = "Password expired; restart the import"
        else:
            import_into(
                case,
                source,
                password=password,
                job=job,
            )
            return
    except Exception as exc:
        error = str(exc)
    finally:
        if job["payload"].get("cleanup_source"):
            source.unlink(missing_ok=True)
    with _secret_lock:
        _removed_jobs[job["id"]] = {
            **job,
            "case_id": case.id,
            "state": "failed",
            "error": error,
        }
        while len(_removed_jobs) > _MAX_MEMORY_JOBS:
            _removed_jobs.pop(next(iter(_removed_jobs)))
    case.delete()
    raise workqueue.JobRemoved(error)


workqueue.register(EXPORT_JOB, _handle_export)
workqueue.register(IMPORT_JOB, _handle_import)
