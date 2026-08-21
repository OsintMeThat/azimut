"""Where things live inside a case folder.

One module owns the on-disk shape. Before this, fourteen modules each knew a
piece of it — `workspace.py` built `case.json` and `case.db` by hand, the sqlite
backend guessed the media folder from the database's parent, and the bundle
importer rebuilt the whole tree from string literals. Moving a directory meant
finding all of them.

Everything here takes a case root and returns a path under it. Nothing touches
the filesystem: these are answers to "where would it be", not "is it there".
Creation and traversal guards stay in `Case`, which is the only thing that owns
a real case on disk.

The bundle importer is the reason these take a root rather than a `Case`: it
builds a case shell in a staging directory that is not a case yet.

**The case root belongs to the analyst; `azimut/` belongs to the tool.** A case
folder holds one directory Azimut writes into, and whatever else its owner wants
to keep beside it. Before the wrapper, every directory in a case was ours, so a
folder someone created for their own material either had nowhere to go or
collided with a tool directory — a user-made `notes/` merging into the app's.
One boundary removes the whole class.

Paths inside a case stay relative to the *tool* root: a media is `media/x.png`
in the graph, in a sidecar and in a bundle, whatever the tree above it looks
like. That is what let the wrapper land without rewriting a single stored path,
and what keeps a bundle portable between versions.
"""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path, PurePosixPath, PureWindowsPath

#: What the tool owns inside a case folder. Everything beside it is the
#: analyst's, and Azimut neither reads nor writes there.
TOOL_DIR = "azimut"

# -- what is visible, and what is not ----------------------------------------
#
# Visible means openable and useful in another program: the media themselves,
# the note bodies, a rendered proof, the manifest that says what this folder is.
# Hidden means only Azimut can read it — session specs, post drafts, saved grid
# state, the sidecars, the database.
#
# `media/` used to interleave as many `.azimut.json` sidecars as real files, and
# `exports/` held post drafts rather than exports, so its name lied. Both are
# fixed here.

#: Post drafts. Named for what they are; `exports/` is now free to mean exports.
DRAFTS_DIR = ".drafts"
#: Saved Inspect session specs.
INSPECT_DIR = ".inspect"
#: Saved Grid Search state.
SEARCH_DIR = ".search"
#: Machinery that belongs to a visible sibling: `media/.meta/` holds sidecars,
#: `proofs/.meta/` holds the editable specs and pasted assets.
META_DIR = ".meta"
#: The case database. Hidden because it is the one file whose loss costs
#: everything, and the one someone deletes to reclaim space.
DATA_DIR = ".data"
#: Presentation photos imported directly into an entity. They are deliberately
#: outside ``media/``: adding a portrait or logo must not create evidence in the
#: Media Library. The database records their paths and the entity owns them.
ENTITY_IMAGES_DIR = "entity-images"

#: Content directories, in birth order. The trash is deliberately not one of
#: them — see `TRASH_DIR`.
CASE_SUBDIRS = (
    "media",
    "notes",
    "sheets",
    "proofs",
    "exports",
    DRAFTS_DIR,
    INSPECT_DIR,
    SEARCH_DIR,
)

#: Deleted artifacts wait here, hidden at the case root. Outside `CASE_SUBDIRS`
#: on purpose: it is not case content, and the bundle leaves it behind.
TRASH_DIR = ".trash"


# -- how long a path may get -------------------------------------------------
#
# Windows refuses a path over 260 characters, and a case is written by a Python
# process *and* read by a bundled ffmpeg subprocess, so relying on the opt-in
# long-path support is relying on someone else's manifest. The app stays inside
# the limit instead.
#
# The budget is one subtraction. Every name below is capped, so the longest path
# a case can ever produce is a constant, and the only variable left is where the
# workspace lives:
#
#     len(workspace root) + IN_CASE_BUDGET <= WINDOWS_MAX_PATH
#
# `tests/test_layout.py` recomputes IN_CASE_BUDGET from these caps and fails if
# a new directory level or a raised cap breaks the sum. Raising one means
# lowering another.

#: Usable length of a Windows path (260 counts the null terminator).
WINDOWS_MAX_PATH = 259

#: The case folder's own name. Uncapped until the budget was computed, which
#: made a long case name enough to break a case on Windows all by itself.
MAX_CASE_SLUG = 48

#: A media filename, extension included. The visible title is its stem, so both
#: are shortened together rather than allowed to drift.
MAX_MEDIA_NAME = 90

#: The stem of anything the analyst saves under a name — notes, proofs, inspect
#: sessions, post drafts. Mirrored in `frontend/src/lib/naming.js`.
MAX_SLUG = 68

#: A note's filing folder: total path length, and how deep it may nest.
MAX_FOLDER_PATH = 40
MAX_FOLDER_DEPTH = 4

#: The scratch directory one download works in. A full uuid4 hex bought nothing
#: but 20 characters of the budget.
DOWNLOAD_ID_LENGTH = 12

#: The deepest path a permanent case can hold, counted from the directory that
#: holds the case folder. A constant, because every name inside it is capped.
#:
#: It lives here rather than only in the test that proves it because choosing a
#: workspace root has to enforce it: a folder the analyst picks is the last
#: variable left in the subtraction, and refusing it at that moment is the only
#: place the limit can be explained. `tests/test_layout.py` rebuilds both numbers
#: from the caps and the real directory names, so a new directory level or a
#: raised cap fails there rather than at write time on someone's machine.
IN_CASE_BUDGET = 174

#: The same for a scratch case, which pays for the `.azimut/scratch/` prefix but
#: spends less on its own name: a short generated id rather than a case slug.
IN_SCRATCH_BUDGET = 160


def room_for_workspace_root() -> int:
    """How long a workspace root may be before a case inside it can break.

    The separator between the root and the case folder is counted here, so a
    caller compares this against `len(str(root))` and nothing else.
    """
    return WINDOWS_MAX_PATH - 1 - max(IN_CASE_BUDGET, IN_SCRATCH_BUDGET)


def root_overflow(root: Path | str) -> int:
    """Characters by which *root* is too long to hold cases, 0 when it fits."""
    return max(0, len(str(root)) - room_for_workspace_root())


# -- the note left at the case root ------------------------------------------
#
# The boundary above only works if the person opening the folder knows it is
# there. Hidden directories and a wrapper make damage unlikely; a sentence
# saying which half is theirs is what makes it unnecessary. It is also the
# cheapest part of the whole design.

README_NAME = "README.txt"

#: Built from the constants above so a renamed directory cannot leave the note
#: describing a tree that no longer exists.
README_TEXT = f"""This folder is an Azimut case.

  {TOOL_DIR}/     Azimut's files.
  everything else here is yours.

Azimut does not read your folders, index them or clean them up. They travel
with the case when you export it.

Three things worth knowing:

  Do not move or rename anything inside {TOOL_DIR}/ while Azimut is running.
  Do not name a folder "{TOOL_DIR}" here. Windows would merge it with ours.
  Keep folder names short. A full path over 260 characters breaks on Windows.

To move this case, move the whole folder. To send it somewhere, export it
from Azimut instead of zipping this one: the export is checksummed, and it
can carry a password.
"""


def readme(root: Path) -> Path:
    return root / README_NAME


def is_tool_dir(name: str) -> bool:
    """Whether a case-root entry name is the tool's own, or collides with it.

    Case-folded because Windows and macOS are case-insensitive: an `Azimut/`
    the analyst creates sits beside ours on Linux and merges into it there. The
    bundle refuses to carry one, and the doctor reports one it finds.
    """
    return name.casefold() == TOOL_DIR


_INVALID_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')
_WINDOWS_RESERVED = frozenset(
    ["con", "prn", "aux", "nul"]
    + [f"com{number}" for number in range(1, 10)]
    + [f"lpt{number}" for number in range(1, 10)]
)


def slugify(text: str | None, fallback: str, *, limit: int = MAX_SLUG) -> str:
    """A human-readable, cross-platform filename stem.

    The historical function name stays because every save route already shares
    it, but the result is no longer a URL slug. The filesystem stem is the name
    Azimut shows, so case, spaces and Unicode survive. Only characters Windows
    forbids are replaced. The returned value is the canonical visible name.
    """
    value = unicodedata.normalize("NFC", str(text or ""))
    value = re.sub(r"\s+", " ", value).strip()
    value = _INVALID_NAME.sub("_", value).strip(" .")
    while ".." in value:
        value = value.replace("..", "_")
    value = value[:limit].rstrip(" .")
    if not value:
        value = fallback[:limit].rstrip(" .") or "file"
    if value.split(".", 1)[0].casefold() in _WINDOWS_RESERVED:
        value = f"_{value}"[:limit].rstrip(" .")
    return value


def visible_filename(title: str | None, suffix: str, fallback: str = "file") -> str:
    """Canonical visible filename for ``title`` while preserving ``suffix``."""
    clean_suffix = suffix if suffix.startswith(".") else f".{suffix}" if suffix else ""
    stem_limit = max(1, MAX_MEDIA_NAME - len(clean_suffix))
    return f"{slugify(title, fallback, limit=stem_limit)}{clean_suffix}"


#: Characters a case folder's name may not hold, on top of everything `slugify`
#: already replaces: the folder name *is* the case id, and the id travels in a
#: URL path, where `#` cuts the rest off and `%` opens an escape. A generated
#: slug never contains either; a folder the analyst named can.
URL_HOSTILE_CHARS = "#%"

#: The same rule spelled for a person, so the message and the check cannot drift.
UNUSABLE_NAME_CHARS = '\\ / : * ? " < > | # %'


def names_one_child(name: str) -> bool:
    """Whether ``name`` addresses one directory entry and cannot climb out of it.

    Asked of both path flavours rather than the host's, because the two disagree
    about exactly the string an attacker sends: ``..\\case.json`` is a traversal
    on Windows and an ordinary filename on Linux. A guard that only consulted the
    running machine's `pathlib` would make the Windows binary the one place the
    rule does not hold, and the suite — which runs on Linux too — would never see
    it (`tests/test_regressions.py`).
    """
    if not name or name in {".", ".."}:
        return False
    return name == PurePosixPath(name).name == PureWindowsPath(name).name


def usable_case_name(name: str) -> bool:
    """Whether a folder can hold a case under the name it already has.

    A case made in the app is named by `Case.create`, which slugs whatever was
    typed. A folder the analyst made themselves arrives already named, and
    adopting it must not rename it — so the name has to clear on its own the bar
    a slug clears by construction: inside `MAX_CASE_SLUG` (the path budget above
    is computed from it), no character Windows refuses, no reserved device name,
    no leading dot, no trailing dot or space.

    `slugify` encodes every one of those rules, so the question is whether the
    name is already its own slug. Compared against the composed form because
    macOS hands back decomposed names from a directory listing, and "Café" is
    not two different folders.
    """
    if not name or name in {".", ".."}:
        return False
    if set(name) & set(URL_HOSTILE_CHARS):
        return False
    return slugify(name, "", limit=MAX_CASE_SLUG) == unicodedata.normalize("NFC", name)


class LayoutError(ValueError):
    """A name that is not part of the case layout."""


def tool_root(root: Path) -> Path:
    """The directory Azimut owns inside a case folder.

    Every other answer in this module is relative to this one, so the wrapper is
    one join rather than a prefix repeated everywhere.
    """
    return root / TOOL_DIR


def manifest(root: Path) -> Path:
    """The case manifest, and the file that makes a directory a case.

    Stays visible at the tool root while the database goes into `.data/`. It is
    small, readable, and it is what identifies the folder — the doctor finds a
    case renamed from outside by reading it. Hiding it would also mean a second
    migration keyed on the filesystem, since nothing could read the schema that
    says to run it.
    """
    return tool_root(root) / "case.json"


def data_dir(root: Path) -> Path:
    return tool_root(root) / DATA_DIR


def database(root: Path) -> Path:
    """The case database: entities, links, folders, jobs and the trash journal."""
    return data_dir(root) / "case.db"


def entity_images(root: Path) -> Path:
    """Private presentation photos imported directly into entity details."""
    return data_dir(root) / ENTITY_IMAGES_DIR


def entity_image_thumbs(root: Path) -> Path:
    """Bounded previews for direct entity photos."""
    return entity_images(root) / ".thumbs"


def entity_image_rel(image_id: str) -> str:
    return f"{DATA_DIR}/{ENTITY_IMAGES_DIR}/{image_id}.jpg"


def entity_image_thumb_rel(image_id: str) -> str:
    return f"{DATA_DIR}/{ENTITY_IMAGES_DIR}/.thumbs/{image_id}.jpg"


def notes_file(root: Path) -> Path:
    """The case's free-form scratchpad."""
    return tool_root(root) / "notes.md"


def subdir(root: Path, name: str) -> Path:
    """One content directory, refusing a name that is not part of the layout."""
    if name not in CASE_SUBDIRS:
        raise LayoutError(f"unknown case subdir '{name}'")
    return tool_root(root) / name


def media(root: Path) -> Path:
    """The media directory. Named because several callers need it without
    wanting the string."""
    return subdir(root, "media")


def notes(root: Path) -> Path:
    """The note bodies directory."""
    return subdir(root, "notes")


def trash(root: Path) -> Path:
    return tool_root(root) / TRASH_DIR


# -- case-relative paths -----------------------------------------------------
#
# What the graph stores, what a sidecar records and what a bundle names. They
# are built here so a directory rename is one edit, not thirty.


def sidecar_rel(media_rel: str) -> str:
    """A media's sidecar, out of the way in `media/.meta/`.

    It used to sit beside the file as `<name>.azimut.json`, which put one JSON
    file in the listing for every real one. It still travels with the case, and
    it is still what rebuilds the index when the database is gone.
    """
    return f"media/{META_DIR}/{PurePosixPath(media_rel).name}.json"


def proof_spec_rel(name: str) -> str:
    """The editable spec behind a proof. Internal, unlike the PNG it renders."""
    return f"proofs/{META_DIR}/{name}.json"


def proof_export_rel(name: str) -> str:
    """The rendered proof, which is the whole point of the folder."""
    return f"proofs/{name}.png"


def proof_assets_rel(name: str) -> str:
    """Images pasted into one proof, kept with its spec."""
    return f"proofs/{META_DIR}/{name}.assets"


def note_rel(folder: str, name: str) -> str:
    """A note body, mirroring the notebook's filing tree.

    Notes were named after their entity id — visible in `notes/` and illegible,
    the cost of being in the way without the benefit of being readable. They now
    follow the rule every other document already obeys (`api/naming.py`): the
    name is the filename.

    The folder is mirrored rather than flattened because notes are the only
    document type with a filing tree, and flat storage would make two notes
    called "Summary" in two different folders illegal — which guts the feature
    at the exact moment an analyst's workflow is one folder per video. So
    uniqueness is scoped to the folder, not the case.
    """
    parts = [
        slugify(segment, "folder") for segment in folder.split("/") if segment.strip()
    ]
    return "/".join(["notes", *parts, f"{name}.md"])


def sheet_rel(name: str) -> str:
    """A sheet's table, and deliberately a real CSV in a visible folder.

    The file *is* the sheet: it opens in any spreadsheet, it travels in the bundle
    as itself, and a case that outlives the app keeps a readable table rather than
    rows locked in a database. Flat, like proofs and drafts — sheets have no filing
    tree of their own, so uniqueness is scoped to the case.
    """
    return f"sheets/{name}.csv"


def sheet_meta_rel(name: str) -> str:
    """What the grid remembers about a sheet, beside it and out of the way.

    Column widths, hidden columns, the sort, row colours and the entity each cell
    points at. None of it belongs in the CSV: a width is not a finding, and a
    column of internal ids in a file handed to someone else is noise. What *is* a
    finding — a status, a note, a verdict — is a column of the table itself.
    """
    return f"sheets/{META_DIR}/{name}.json"


def draft_rel(name: str) -> str:
    return f"{DRAFTS_DIR}/{name}.json"


def session_rel(name: str) -> str:
    return f"{INSPECT_DIR}/{name}.json"


def grid_rel(name: str) -> str:
    return f"{SEARCH_DIR}/{name}.json"


def content_dirs(root: Path) -> tuple[Path, ...]:
    """Every directory a case is born with.

    The `.meta/` pair is in here so a case's birth state already has the shape
    its first sidecar or proof spec would create — otherwise emptying a case
    would not return it to the state it was born in, which is a gate the repo
    keeps green (`tests/test_artifacts.py`).
    """
    dirs = [tool_root(root) / name for name in CASE_SUBDIRS]
    dirs += [
        media(root) / META_DIR,
        subdir(root, "proofs") / META_DIR,
        subdir(root, "sheets") / META_DIR,
    ]
    return tuple(dirs)


def hidden_dirs(root: Path) -> tuple[Path, ...]:
    """The directories a leading dot is supposed to keep out of the way.

    Windows hides by attribute rather than by name, and an attribute only
    travels with the directory it was set on: a case that arrives by any route
    other than being born here — a workspace copied to another machine, a folder
    restored from a backup — has these in plain view. Whoever opens a case walks
    this list and puts the attribute back.

    The regenerable caches under `media/` are not in it. They are re-created
    through `ensure_dir` on the next thumbnail or download, which hides them
    again by itself.
    """
    dirs = [path for path in content_dirs(root) if path.name.startswith(".")]
    return (data_dir(root), trash(root), *dirs)


def unwrapped_manifest(root: Path) -> Path:
    """Where the manifest sat before the case gained its `azimut/` wrapper.

    Its presence is the whole signal for the schema-5 migration: a case folder
    with a manifest at its own root has not been wrapped yet.
    """
    return root / "case.json"


#: What an unwrapped case holds at its own root, and therefore all the wrapper
#: migration may move. Anything else there was put by the analyst and stays
#: where they left it — sweeping someone's folder into `azimut/` would be the
#: exact opposite of what the wrapper is for. Names only: this module does not
#: read the filesystem, the caller checks what exists.
#: Spelled out rather than derived from `CASE_SUBDIRS`: this is the shape of a
#: case *before* the wrapper, and it must not follow the current layout as that
#: keeps moving. `inspect/` and `search/` were still visible back then.
UNWRAPPED_ENTRIES = (
    "case.db",
    "notes.md",
    TRASH_DIR,
    "media",
    "notes",
    "proofs",
    "exports",
    "inspect",
    "search",
)

#: Migration backups (`case.pre-migrate-v2.json`), which are ours too.
UNWRAPPED_BACKUP_GLOB = "case.*.json"

#: Where the machinery sat before it was hidden, for the migration that moves
#: it. Old shapes are named here rather than spelled out at the call site, so
#: `tests/test_layout.py`'s guard stays meaningful: nothing else in the app may
#: build these paths.
PRE_HIDDEN_DB = "case.db"
PRE_HIDDEN_SIDECAR_SUFFIX = ".azimut.json"
PRE_HIDDEN_DIRS = {"inspect": INSPECT_DIR, "search": SEARCH_DIR, "exports": DRAFTS_DIR}


def needs_wrapper(root: Path) -> bool:
    """Whether this case folder still holds the tool's files at its own root."""
    return not manifest(root).is_file() and unwrapped_manifest(root).is_file()


def is_case(root: Path) -> bool:
    """Whether this directory holds a case, wrapped or not.

    Cases are found by their manifest, never by folder name, so a case renamed
    from outside is still found. An unwrapped case answers yes as well, or it
    could never be opened to be migrated.
    """
    return manifest(root).is_file() or unwrapped_manifest(root).is_file()


def extracted_database(root: Path) -> Path:
    """The case database in a freshly extracted bundle, whatever its vintage.

    A bundle written before the machinery was hidden carries `case.db` at the
    tool root, and the folder migration moves it into `.data/` the first time
    the case is opened. The import has to read the database *before* that, to
    stamp the destination's name into it, so it needs the old address too.
    """
    current = database(root)
    return current if current.is_file() else tool_root(root) / PRE_HIDDEN_DB
