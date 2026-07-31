"""`layout.py` is the only module that knows the shape of a case folder.

The layout is about to move (the case tree gains a wrapper, several directories
become hidden), and that change is only cheap while every path has one origin.
The guard below is what keeps it that way: a module that joins a layout name
onto a path by hand fails this test, so the knowledge cannot leak back out one
drive-by at a time.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from azimut import layout
from azimut.api.naming import slugify
from azimut.engine.media import safe_filename
from azimut.engine.thumbnails import THUMB_GEN
from azimut.layout import CASE_SUBDIRS, TRASH_DIR
from azimut.workspace import Case, CaseError, _slugify

SOURCE = Path(__file__).resolve().parents[1] / "src" / "azimut"

#: Names that address something inside a case. Joining one of these onto a path
#: outside `layout.py` is what the guard refuses.
LAYOUT_NAMES = ("case.json", "case.db", "notes.md", TRASH_DIR, *CASE_SUBDIRS)

#: Matches path construction only — `staging / "case.db"`. An archive member or
#: a dict key spelled the same way is not a path and is left alone.
JOINS_LAYOUT_NAME = re.compile(
    r"/\s*[\"'](?:" + "|".join(re.escape(name) for name in LAYOUT_NAMES) + r")[\"']"
)


def test_no_module_builds_a_case_path_by_hand() -> None:
    offenders = []
    for path in sorted(SOURCE.rglob("*.py")):
        if path.name == "layout.py":
            continue
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if JOINS_LAYOUT_NAME.search(line):
                offenders.append(f"{path.relative_to(SOURCE)}:{number}: {line.strip()}")
    assert not offenders, (
        "these build a case path by hand instead of asking `layout`:\n  " + "\n  ".join(offenders)
    )


#: The longest path each family of artifact can produce, as a function of the
#: caps. Every level of directory the case tree gains has to appear here, or the
#: budget stops describing reality.
#:
#: Fixed lengths, from the code that writes them: a thumbnail is
#: `<sha256[:24]>-g<gen>.jpg` (`thumbnails.py`), a pasted proof asset is 16 hex
#: plus its extension (`api/proofs.py` ASSET_NAME), a trash group id is
#: `_new_id("t")`.
THUMB_NAME = 24 + len(f"-g{THUMB_GEN}") + len(".jpg")
ASSET_NAME = 16 + len(".webp")
TRASH_GROUP_ID = len("t_0123456789")
TRASH_SLOT = 3  # "999" worth of artifacts in one delete


def _branches() -> dict[str, int]:
    """Length of the deepest path in each family, from the case root down.

    Includes the `azimut/` wrapper: every level the tree gains is spent out of
    the same budget, which is the point of recomputing it here rather than
    trusting a number written down once.
    """
    slug, media = layout.MAX_SLUG, layout.MAX_MEDIA_NAME
    wrapper = len(layout.TOOL_DIR) + 1
    return {name: wrapper + length for name, length in _tool_relative(slug, media).items()}


def _tool_relative(slug: int, media: int) -> dict[str, int]:
    """Each branch spelled from the builders in `layout.py`, not from memory.

    A worst-case name is fed through the real function, so a directory that gets
    renamed or hidden moves this table by itself.
    """
    longest_media = "m" * media
    longest_name = "n" * slug
    longest_folder = "f" * layout.MAX_FOLDER_PATH
    return {
        "media file": len(f"media/{longest_media}"),
        "sidecar": len(layout.sidecar_rel(f"media/{longest_media}")),
        "download scratch": len("media/.dl/") + layout.DOWNLOAD_ID_LENGTH + 1 + media,
        "thumbnail": len("media/.thumbs/") + THUMB_NAME,
        "note": len(layout.note_rel(longest_folder, longest_name)),
        "proof asset": len(layout.proof_assets_rel(longest_name)) + 1 + ASSET_NAME,
        "proof spec": len(layout.proof_spec_rel(longest_name)),
        "proof export": len(layout.proof_export_rel(longest_name)),
        "draft": len(layout.draft_rel(longest_name)),
        "session": len(layout.session_rel(longest_name)),
        "grid": len(layout.grid_rel(longest_name)),
        "trash slot": len(f"{layout.TRASH_DIR}/") + TRASH_GROUP_ID + 1 + TRASH_SLOT,
    }


def in_case_budget() -> int:
    """The longest path a case can hold, from its parent directory down."""
    return layout.MAX_CASE_SLUG + 1 + max(_branches().values())


def in_scratch_budget() -> int:
    """The longest generated scratch path, from the workspace root down."""
    scratch_id = len("scratch_") + 10
    return len(".azimut/scratch/") + scratch_id + 1 + max(_branches().values())


def test_the_shipped_budget_matches_the_tree_it_describes() -> None:
    """`layout.IN_CASE_BUDGET` is what Settings refuses a too-long root with, so
    a number that has drifted from the actual tree is worse than no number: it
    would approve a root that breaks cases on Windows.

    This is the only place the two can be compared, because the constant has to
    be available without walking a case.
    """
    assert layout.IN_CASE_BUDGET == in_case_budget(), (
        f"layout.IN_CASE_BUDGET says {layout.IN_CASE_BUDGET}, the tree needs "
        f"{in_case_budget()}. Update the constant, or shorten a branch:\n  "
        + "\n  ".join(f"{v:>4}  {k}" for k, v in sorted(_branches().items(), key=lambda kv: -kv[1]))
    )
    assert layout.IN_SCRATCH_BUDGET == in_scratch_budget()


def test_the_path_budget_leaves_room_for_a_real_workspace_root() -> None:
    """The whole Windows story is this subtraction.

    A case's longest path is a constant once every name is capped, so the only
    question left is where the workspace lives. Keep enough room for a genuinely
    deep root — a corporate OneDrive path runs to about 62 characters — and the
    limit stops being something to discover at write time.
    """
    room_for_the_root = layout.room_for_workspace_root()
    assert room_for_the_root >= 70, (
        f"the case tree needs {in_case_budget()} characters, leaving only "
        f"{room_for_the_root} for the workspace root. Lower a cap in layout.py, "
        f"or shorten a branch:\n  "
        + "\n  ".join(f"{v:>4}  {k}" for k, v in sorted(_branches().items(), key=lambda kv: -kv[1]))
    )


def test_the_root_that_fits_is_the_one_whose_deepest_case_path_fits() -> None:
    """The separator between the root and the case folder is counted once, in
    `room_for_workspace_root()`. Off by one here is a case that writes fine
    everywhere except the machine the budget exists for."""
    exactly = "r" * layout.room_for_workspace_root()
    assert layout.root_overflow(exactly) == 0
    assert len(f"{exactly}/") + in_case_budget() <= layout.WINDOWS_MAX_PATH
    assert layout.root_overflow(exactly + "r") == 1


def test_the_trash_is_no_longer_the_longest_branch() -> None:
    """It was, before it stopped mirroring the case tree, and by enough to break
    Windows on its own. A change that puts it back on top is a regression."""
    branches = _branches()
    worst = max(branches, key=lambda name: branches[name])
    assert worst != "trash slot"
    assert branches["trash slot"] < branches["note"]


def test_every_capped_name_is_actually_capped() -> None:
    """The caps are only real if the functions that build names apply them."""
    assert len(_slugify("x" * 300)) <= layout.MAX_CASE_SLUG
    assert len(slugify("x" * 300, "fallback")) <= layout.MAX_SLUG
    assert len(safe_filename("x" * 300 + ".mp4")) <= layout.MAX_MEDIA_NAME


def test_a_folder_deeper_or_longer_than_the_budget_is_refused(tmp_workspace: str) -> None:
    case = Case.create("Folder bounds")
    case.add_folder("a/b/c/d")  # at the depth limit, accepted
    with pytest.raises(CaseError):
        case.add_folder("a/b/c/d/e")
    with pytest.raises(CaseError):
        case.add_folder("x" * (layout.MAX_FOLDER_PATH + 1))


def test_layout_answers_are_all_under_the_root(tmp_path: Path) -> None:
    root = tmp_path / "a-case"
    answers = [
        layout.manifest(root),
        layout.database(root),
        layout.notes_file(root),
        layout.media(root),
        layout.notes(root),
        layout.trash(root),
        *layout.content_dirs(root),
    ]
    for answer in answers:
        assert answer.is_relative_to(root)


def test_content_dirs_covers_every_subdir_and_the_meta_pair(tmp_path: Path) -> None:
    root = tmp_path / "a-case"
    born = layout.content_dirs(root)
    assert [d.name for d in born[: len(CASE_SUBDIRS)]] == list(CASE_SUBDIRS)
    # the `.meta/` directories are born too, so an emptied case matches a new one
    assert set(born[len(CASE_SUBDIRS) :]) == {
        layout.media(root) / layout.META_DIR,
        layout.subdir(root, "proofs") / layout.META_DIR,
    }
    assert layout.trash(root).name not in CASE_SUBDIRS


def test_subdir_refuses_a_name_outside_the_layout(tmp_path: Path) -> None:
    with pytest.raises(layout.LayoutError):
        layout.subdir(tmp_path, "elsewhere")


def test_case_subdir_still_refuses_the_same_name(tmp_workspace: str) -> None:
    """`Case.subdir` speaks `CaseError` to its callers, whatever `layout` raises."""
    case = Case.create("Layout")
    with pytest.raises(CaseError):
        case.subdir("elsewhere")


def test_layout_does_not_touch_the_filesystem(tmp_path: Path) -> None:
    """Answers are addresses, not creations — `Case` owns making directories."""
    root = tmp_path / "never-created"
    layout.media(root)
    layout.manifest(root)
    layout.content_dirs(root)
    assert not root.exists()


def test_a_case_is_found_by_its_manifest(tmp_workspace: str) -> None:
    case = Case.create("Found by manifest")
    assert layout.is_case(case.path)

    renamed = case.path.with_name("renamed-from-outside")
    case.path.rename(renamed)
    assert layout.is_case(renamed)

    layout.manifest(renamed).unlink()
    assert not layout.is_case(renamed)
