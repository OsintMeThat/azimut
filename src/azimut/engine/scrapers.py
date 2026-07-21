"""Keep yt-dlp and gallery-dl fresh, independently of the Azimut release cycle.

Every other dependency is locked in uv.lock and frozen into the release binary
on purpose: the same tag should produce the same program. These two invert that
rule. They race against sites that change their markup without notice, so a
scraper frozen in March is a scraper broken by June — and the user can't fix it
themselves, because the standalone binary has no pip and its modules live inside
the read-only PyInstaller archive.

So Azimut fetches newer copies into the workspace (config.runtime_dir()) and
prefers them over whatever is bundled:

    ~/Azimut/runtime/
    ├── yt-dlp/                      # one directory per distribution, so an
    │   ├── yt_dlp/                  # update is a whole-directory swap and a
    │   └── yt_dlp-2026.7.4.dist-info/   # half-written one can't shadow anything
    └── gallery-dl/
        ├── gallery_dl/
        └── gallery_dl-1.32.6.dist-info/

Both projects publish a single pure-Python ``py3-none-any`` wheel whose required
dependencies we already ship (yt-dlp's core needs none, gallery-dl needs only
requests). That's what makes this safe: for these two, extracting the wheel *is*
the install — no compiler, no resolver, no pip.

Shadowing goes through a meta-path finder rather than a ``sys.path`` entry
because PyInstaller's own importer answers first for anything it bundled, so a
path entry would simply never be consulted for ``yt_dlp``.
"""

from __future__ import annotations

import hashlib
import importlib.metadata
import os
import shutil
import stat
import sys
import tempfile
import threading
import zipfile
from importlib.abc import MetaPathFinder
from importlib.machinery import PathFinder
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx

from .. import config

# distribution name on PyPI -> module name it imports as
SCRAPERS: dict[str, str] = {"yt-dlp": "yt_dlp", "gallery-dl": "gallery_dl"}

PYPI_JSON = "https://pypi.org/pypi/{dist}/json"
# Generous: a wheel is a few MB and the user pressed a button and is watching.
DOWNLOAD_TIMEOUT = 120
# Refuse anything larger than this as a scraper wheel. Both sit around 3 MB;
# this is a sanity bound on an untrusted content-length, not a real limit.
WHEEL_MAX_BYTES = 64 * 1024 * 1024

_lock = threading.Lock()  # updates mutate a shared directory


# ---- swapping a directory, on all three platforms ---------------------------
#
# Windows is the constraint here. os.replace() onto an *existing* directory
# fails there (MOVEFILE_REPLACE_EXISTING is file-only), and a file that's open
# can't be deleted at all. So the destructive step is always a rename — old copy
# out of the way first, new copy in second, delete the leftovers last. Renames
# are cheap and near-atomic everywhere; deletes are the part allowed to fail,
# and by then they can't cost us the package.


def _force_writable(func, path, _exc):
    """rmtree onexc hook: clear the read-only bit Windows refuses to delete through."""
    try:
        os.chmod(path, stat.S_IWRITE)
        func(path)
    except OSError:
        pass


def _rmtree(path: Path) -> None:
    # onexc replaced onerror in 3.12; we still support 3.11. The hook ignores its
    # third argument, which is the only thing that differs between the two.
    if sys.version_info >= (3, 12):
        shutil.rmtree(path, onexc=_force_writable)
    else:
        shutil.rmtree(path, onerror=_force_writable)


def _retire(target: Path) -> Path | None:
    """Rename `target` out of the way, returning where it went (None if absent)."""
    if not target.exists():
        return None
    retired = target.parent / f".trash-{target.name}-{os.urandom(4).hex()}"
    target.replace(retired)
    return retired


def _swap_in(staging: Path, target: Path) -> None:
    """Replace `target` with `staging`, restoring the old copy if the move fails."""
    retired = _retire(target)
    try:
        staging.replace(target)
    except BaseException:
        if retired is not None:
            retired.replace(target)  # put the working copy back
        raise
    if retired is not None:
        # Best-effort: a locked leftover on Windows is litter, not a failure.
        shutil.rmtree(retired, ignore_errors=True)


def _discard(target: Path) -> None:
    """Remove `target`, making sure it's gone from the import path even if the
    delete can't finish — the rename is what counts."""
    retired = _retire(target)
    if retired is not None:
        shutil.rmtree(retired, ignore_errors=True)


# ---- reading what's on disk -------------------------------------------------


def dist_dir(dist: str) -> Path:
    return config.runtime_dir() / dist


def runtime_version(dist: str) -> str | None:
    """Version of the updated copy in the workspace, or None if there isn't one.

    Read off the .dist-info directory name rather than by importing, so the
    status endpoint stays cheap and works before the module is ever loaded.
    """
    module = SCRAPERS[dist]
    try:
        infos = list(dist_dir(dist).glob(f"{module}-*.dist-info"))
    except OSError:
        return None
    if not infos or not (dist_dir(dist) / module).exists():
        return None
    return infos[0].name[len(module) + 1 : -len(".dist-info")]


def bundled_version(dist: str) -> str | None:
    """Version shipped with this build — installed by pip, or frozen into the binary."""
    try:
        return importlib.metadata.version(dist)
    except importlib.metadata.PackageNotFoundError:
        # PyInstaller can bundle the module without its .dist-info metadata.
        try:
            module = __import__(SCRAPERS[dist])
        except Exception:
            return None
        version = getattr(module, "__version__", None)
        return str(version) if version else None


def active_version(dist: str) -> tuple[str | None, str]:
    """The version that import would actually get, and where it comes from."""
    runtime = runtime_version(dist)
    if runtime is not None:
        return runtime, "runtime"
    return bundled_version(dist), "bundled"


# ---- shadowing the bundled copy ---------------------------------------------


class _RuntimeFinder(MetaPathFinder):
    """Resolves the scrapers we have a runtime copy of, and nothing else.

    Sits at the front of sys.meta_path so it answers before PyInstaller's
    frozen importer. Deliberately narrow: any module outside `roots` is passed
    straight through, so this cannot affect the rest of the program.
    """

    def __init__(self, roots: dict[str, Path]) -> None:
        self.roots = {module: str(path) for module, path in roots.items()}

    def find_spec(self, fullname: str, path: Any = None, target: Any = None) -> Any:
        top = fullname.partition(".")[0]
        root = self.roots.get(top)
        if root is None:
            return None
        if "." not in fullname:
            return PathFinder.find_spec(fullname, [root], target)
        # A submodule: only claim it if the top-level package actually came from
        # our tree. Otherwise the parent is the bundled one and its __path__
        # points into the PyInstaller archive, which PathFinder can't read.
        parent = sys.modules.get(top)
        parent_path = getattr(parent, "__path__", None)
        if not parent_path or not str(parent_path[0]).startswith(root):
            return None
        return PathFinder.find_spec(fullname, path, target)


def _remove_finder() -> None:
    for existing in [f for f in sys.meta_path if isinstance(f, _RuntimeFinder)]:
        sys.meta_path.remove(existing)


def activate() -> dict[str, str]:
    """Point imports at any updated scrapers in the workspace. Idempotent.

    Called once at startup, and again after an update so a scraper that hasn't
    been imported yet goes live without a restart. Returns {module: version}
    for what got shadowed.
    """
    roots: dict[str, Path] = {}
    shadowed: dict[str, str] = {}
    for dist, module in SCRAPERS.items():
        version = runtime_version(dist)
        if version is None:
            continue
        roots[module] = dist_dir(dist)
        shadowed[module] = version
    _remove_finder()
    if roots:
        sys.meta_path.insert(0, _RuntimeFinder(roots))
    return shadowed


def needs_restart(dist: str) -> bool:
    """True when an update can't take effect until the process restarts.

    media.py imports the scrapers lazily, inside the download call, so before
    the first download an update goes live immediately. Once the old module
    object is in sys.modules, every later import returns it from cache and only
    a restart clears that.
    """
    return SCRAPERS[dist] in sys.modules


# ---- fetching a newer copy --------------------------------------------------


def _pypi_wheel(dist: str) -> tuple[str, str, str]:
    """(version, url, sha256) of the current pure-Python wheel on PyPI."""
    response = httpx.get(PYPI_JSON.format(dist=dist), timeout=30, follow_redirects=True)
    response.raise_for_status()
    payload = response.json()
    version = payload["info"]["version"]
    for url in payload["urls"]:
        if url["packagetype"] == "bdist_wheel" and url["filename"].endswith("-py3-none-any.whl"):
            return version, url["url"], url["digests"]["sha256"]
    raise RuntimeError(f"{dist} {version} has no pure-Python wheel on PyPI")


def latest_version(dist: str) -> str:
    return _pypi_wheel(dist)[0]


def _safe_members(archive: zipfile.ZipFile) -> list[str]:
    """Wheel entries that are safe to extract, rejecting path traversal.

    PyPI is a trusted-ish source and we've already checked the hash, but this
    unpacks an archive into the user's home directory — cheap to verify, and
    the one place where a hostile wheel would get to write outside the tree.
    """
    names = []
    for name in archive.namelist():
        path = Path(name)
        if path.is_absolute() or ".." in path.parts or name.startswith(("/", "\\")):
            raise RuntimeError(f"refusing wheel with unsafe entry: {name}")
        names.append(name)
    return names


def _download_wheel(url: str, expected_sha256: str) -> bytes:
    with httpx.stream("GET", url, timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as response:
        response.raise_for_status()
        buffer = BytesIO()
        for chunk in response.iter_bytes():
            buffer.write(chunk)
            if buffer.tell() > WHEEL_MAX_BYTES:
                raise RuntimeError("scraper wheel is implausibly large; refusing")
        data = buffer.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    if digest != expected_sha256:
        # PyPI told us what this file should hash to; a mismatch means the bytes
        # we got aren't the release we asked for. Never unpack those.
        raise RuntimeError("downloaded wheel does not match the hash PyPI published")
    return data


def update(dist: str) -> dict[str, Any]:
    """Fetch the latest wheel for one scraper into the workspace.

    Returns the same shape as ``status()`` entries, plus what changed. Extracts
    into a staging directory and swaps it in whole, so an interrupted update
    leaves the previous copy intact rather than a half-written package.
    """
    if dist not in SCRAPERS:
        raise KeyError(dist)
    module = SCRAPERS[dist]
    before, _ = active_version(dist)
    version, url, sha256 = _pypi_wheel(dist)

    with _lock:
        if version == runtime_version(dist):
            return {
                "dist": dist,
                "updated": False,
                "version": version,
                "previous": before,
                "restart_required": False,
                "detail": f"{dist} is already at {version}",
            }

        data = _download_wheel(url, sha256)
        root = config.runtime_dir()
        root.mkdir(parents=True, exist_ok=True)
        staging = Path(tempfile.mkdtemp(dir=root, prefix=f".staging-{dist}-"))
        try:
            with zipfile.ZipFile(BytesIO(data)) as archive:
                archive.extractall(staging, members=_safe_members(archive))
            if not (staging / module).is_dir():
                raise RuntimeError(f"{dist} wheel did not contain a {module}/ package")
            _swap_in(staging, dist_dir(dist))
        except BaseException:
            shutil.rmtree(staging, ignore_errors=True)
            raise

    restart = needs_restart(dist)
    activate()  # live immediately if the old module was never imported
    return {
        "dist": dist,
        "updated": True,
        "version": version,
        "previous": before,
        "restart_required": restart,
        "detail": (
            f"updated to {version}; restart Azimut to use it"
            if restart
            else f"updated to {version}"
        ),
    }


def reset(dist: str) -> dict[str, Any]:
    """Drop the workspace copy and fall back to the bundled scraper.

    The escape hatch for the case this whole module creates: a bad upstream
    release. Without it, a broken update would be unfixable from inside the app.
    """
    if dist not in SCRAPERS:
        raise KeyError(dist)
    had = runtime_version(dist)
    with _lock:
        _discard(dist_dir(dist))
    activate()
    return {
        "dist": dist,
        "removed": had is not None,
        "restart_required": had is not None and needs_restart(dist),
        "version": bundled_version(dist),
    }


def status(check_pypi: bool = False) -> list[dict[str, Any]]:
    """What each scraper is at, where it came from, and optionally what's newer.

    ``check_pypi`` is opt-in because it's the only part that touches the network,
    and Azimut is local-first: opening Settings must not phone out on its own.
    """
    out = []
    for dist in SCRAPERS:
        version, source = active_version(dist)
        entry: dict[str, Any] = {
            "dist": dist,
            "version": version,
            "source": source,
            "bundled_version": bundled_version(dist),
            "restart_required": False,
        }
        if check_pypi:
            try:
                latest = latest_version(dist)
                entry["latest"] = latest
                entry["outdated"] = bool(version and latest != version)
            except Exception as exc:
                # Offline is the normal case for this app, not an error state.
                entry["latest"] = None
                entry["check_error"] = str(exc)
        out.append(entry)
    return out
