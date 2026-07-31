"""Choosing where the workspace lives, and moving it there.

Two rules run through every test here. A folder the analyst configured is never
recreated or deleted behind their back, and at no point in a move is there less
than one complete workspace on disk.

The tests drive the pointer rather than ``AZIMUT_HOME`` because that is what a
move actually switches; the env var deliberately overrides it and would hide
the very thing under test.
"""

from __future__ import annotations

import shutil
import time
from pathlib import Path

import pytest

from azimut import config
from azimut.engine import workspacemove
from azimut.engine.workspacemove import MoveError
from azimut.workspace import Case


@pytest.fixture(autouse=True)
def forget_the_last_move():
    """One process holds one move. Nothing may inherit the previous one's
    leftovers — `discard_old` acts on that memory, and stale memory would name
    a folder from another run."""
    workspacemove._move = None
    yield
    workspacemove._move = None


@pytest.fixture()
def workspace(monkeypatch, tmp_path):
    """A workspace Azimut found through its pointer, as it does in the field."""
    monkeypatch.delenv("AZIMUT_HOME", raising=False)
    root = tmp_path / "home" / "Azimut"
    root.mkdir(parents=True)
    config.write_pointer(root)
    config.ensure_workspace()
    return root


def _finish(timeout: float = 20.0) -> dict:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        move = workspacemove.status()["move"]
        if move and move["done"]:
            return move
        time.sleep(0.01)
    raise AssertionError("the move never finished")


# -- reading a candidate folder ------------------------------------------------


def test_a_blank_path_is_refused(workspace):
    assert workspacemove.inspect_target("   ")["problems"] == ["name a folder"]


def test_a_file_is_not_a_folder(workspace, tmp_path):
    target = tmp_path / "notes.txt"
    target.write_text("", encoding="utf-8")

    assert workspacemove.inspect_target(str(target))["problems"] == [
        "that path is a file, not a folder"
    ]


def test_a_folder_inside_the_workspace_is_refused(workspace):
    verdict = workspacemove.inspect_target(str(workspace / "inside"))

    assert verdict["problems"] == ["that folder is inside the current workspace"]


def test_a_folder_containing_the_workspace_is_refused(workspace):
    """Copying a tree into one of its own ancestors is how a move eats itself.
    Reachable when the ancestor reads as a workspace, so nesting leaves it alone."""
    (workspace.parent / ".azimut").mkdir()

    verdict = workspacemove.inspect_target(str(workspace.parent))

    assert verdict["problems"] == ["that folder contains the current workspace"]


def test_naming_the_folder_above_the_workspace_points_back_at_it(workspace):
    """Typing `~` when the workspace is `~/Azimut` is not an error to explain at
    length: the subfolder rule lands on the workspace itself, and saying so is
    the shortest true answer."""
    verdict = workspacemove.inspect_target(str(workspace.parent))

    assert verdict["problems"] == ["that is already the workspace"]


def test_the_current_workspace_is_refused(workspace):
    assert workspacemove.inspect_target(str(workspace))["problems"] == [
        "that is already the workspace"
    ]


def test_a_destination_holding_other_files_gets_its_own_subfolder(workspace, tmp_path):
    """Settling among someone's documents would make the workspace impossible to
    tell apart from them."""
    target = tmp_path / "OSINT"
    target.mkdir()
    (target / "case-notes.docx").write_text("", encoding="utf-8")

    verdict = workspacemove.inspect_target(str(target))

    assert verdict["ok"]
    assert verdict["nested"]
    assert Path(verdict["root"]) == target / "Azimut"


def test_an_empty_destination_is_used_as_it_is(workspace, tmp_path):
    target = tmp_path / "empty"
    target.mkdir()

    verdict = workspacemove.inspect_target(str(target))

    assert verdict["ok"] and not verdict["nested"]
    assert verdict["state"] == "empty"


def test_a_destination_that_does_not_exist_yet_is_offered(workspace, tmp_path):
    verdict = workspacemove.inspect_target(str(tmp_path / "new" / "Azimut"))

    assert verdict["ok"]
    assert verdict["state"] == "missing"


def test_a_path_whose_parents_are_all_missing_is_refused(workspace, tmp_path):
    missing_root = "Z:\\gone\\Azimut" if Path("Z:/").drive else "/nonexistent-root/x/Azimut"

    verdict = workspacemove.inspect_target(missing_root)

    assert not verdict["ok"]


def test_an_existing_workspace_is_recognised(workspace, tmp_path, monkeypatch):
    """The hand-moved folder: it already holds cases, and adopting it is the point."""
    Case.create("Harbour survey")
    moved = tmp_path / "moved-by-hand"
    shutil.move(str(workspace), str(moved))
    config.write_pointer(tmp_path / "somewhere-else")
    config.ensure_workspace()

    verdict = workspacemove.inspect_target(str(moved))

    assert verdict["state"] == "workspace"
    assert verdict["cases"] == 1


def test_a_synced_folder_is_flagged_and_still_allowed(workspace, tmp_path):
    target = tmp_path / "OneDrive" / "Azimut"
    target.mkdir(parents=True)

    verdict = workspacemove.inspect_target(str(target))

    assert verdict["ok"]
    assert "synced folder" in verdict["warnings"][0]


def test_a_path_too_long_for_windows_is_refused_there_and_named_elsewhere(
    workspace, tmp_path, monkeypatch
):
    """The budget from `layout` is finally enforced here: this is the last free
    variable in the subtraction that keeps a case openable on Windows."""
    deep = tmp_path / ("d" * 60) / ("e" * 60) / ("f" * 60) / ("g" * 60)

    monkeypatch.setattr("sys.platform", "win32")
    refused = workspacemove.inspect_target(str(deep))
    monkeypatch.setattr("sys.platform", "linux")
    allowed = workspacemove.inspect_target(str(deep))

    assert not refused["ok"]
    assert "too long" in refused["problems"][0]
    assert any("too long" in warning for warning in allowed["warnings"])


def test_a_destination_without_room_is_refused(workspace, tmp_path, monkeypatch):
    target = tmp_path / "tiny"
    target.mkdir()
    monkeypatch.setattr(
        shutil, "disk_usage", lambda _path: shutil._ntuple_diskusage(1_000_000, 999_000, 1_000)
    )

    verdict = workspacemove.inspect_target(str(target))

    assert not verdict["ok"]
    assert "not enough free space" in verdict["problems"][0]


# -- adopting a folder ---------------------------------------------------------


def test_adopting_a_hand_moved_folder_finds_its_cases(workspace, tmp_path):
    Case.create("Harbour survey")
    moved = tmp_path / "OSINT" / "Azimut"
    moved.parent.mkdir()
    shutil.move(str(workspace), str(moved))
    config.write_pointer(tmp_path / "gone")

    workspacemove.adopt(str(moved))

    assert config.workspace_root() == moved
    assert [row["name"] for row in Case.list_all()] == ["Harbour survey"]


def test_adopting_an_empty_folder_leaves_the_old_cases_where_they_are(workspace, tmp_path):
    Case.create("Harbour survey")
    fresh = tmp_path / "fresh"

    workspacemove.adopt(str(fresh))

    assert config.workspace_root() == fresh
    assert Case.list_all() == []
    assert (workspace / "harbour-survey").is_dir()


def test_adopting_creates_the_skeleton_and_keeps_the_workspace_private(workspace, tmp_path):
    workspacemove.adopt(str(tmp_path / "fresh"))

    assert config.settings_path().is_file()
    assert config.scratch_dir().is_dir()
    assert config.bundles_dir().is_dir()


def test_going_back_to_the_default_root_clears_the_pointer(workspace, tmp_path):
    workspacemove.use_default()

    assert config.read_pointer() is None
    assert config.workspace_root() == config.DEFAULT_ROOT.expanduser()


def test_adopting_a_refused_folder_raises(workspace):
    with pytest.raises(MoveError):
        workspacemove.adopt(str(workspace / "inside"))


# -- moving --------------------------------------------------------------------


def test_a_move_copies_verifies_switches_and_keeps_the_old_folder(workspace, tmp_path):
    case = Case.create("Harbour survey")
    (case.path / "analyst-notes.txt").write_text("mine", encoding="utf-8")
    target = tmp_path / "elsewhere" / "Azimut"

    workspacemove.start(str(target))
    move = _finish()

    assert not move["error"]
    assert config.workspace_root() == target
    assert config.read_pointer() == target
    assert [row["name"] for row in Case.list_all()] == ["Harbour survey"]
    assert (target / "harbour-survey" / "analyst-notes.txt").read_text(encoding="utf-8") == "mine"
    assert Path(move["kept_aside"]).is_dir()
    assert not workspace.exists()


def test_the_old_folder_is_kept_complete_until_the_analyst_drops_it(workspace, tmp_path):
    Case.create("Harbour survey")

    workspacemove.start(str(tmp_path / "elsewhere"))
    move = _finish()

    kept = Path(move["kept_aside"])
    assert (kept / "harbour-survey" / "azimut" / "case.json").is_file()

    removed = workspacemove.discard_old()

    assert removed == str(kept)
    assert not kept.exists()


def test_a_move_does_not_carry_the_tile_cache(workspace, tmp_path):
    """Disposable by contract, and the largest thing nobody would miss."""
    cached = config.tile_cache_dir() / "esri" / "12" / "2048.png"
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(b"tile")
    target = tmp_path / "elsewhere"

    workspacemove.start(str(target))
    _finish()

    assert config.tile_cache_dir().is_dir()
    assert not (target / ".azimut" / "cache" / "tiles" / "esri" / "12" / "2048.png").exists()


def test_a_move_carries_settings_keys_and_presets(workspace, tmp_path):
    config.update_settings(lambda s: s["api_keys"].update({"mapbox": "pk.secret"}))
    config.save_templates({"schema": 1, "proof": [], "post": []})

    workspacemove.start(str(tmp_path / "elsewhere"))
    _finish()

    assert config.load_settings()["api_keys"]["mapbox"] == "pk.secret"
    assert config.templates_path().is_file()


def test_a_move_carries_the_empty_directories_a_case_is_born_with(workspace, tmp_path):
    """`exports/` and the two `.meta/` folders hold nothing until they do.
    Recreating only the parents of files would return a moved case to a shape it
    was never in, and the birth-state gate counts every one of them."""
    from azimut import layout

    case = Case.create("Harbour survey")
    born = sorted(
        directory.relative_to(case.path)
        for directory in layout.content_dirs(case.path)
        if not any(directory.iterdir())
    )
    assert born, "this test needs at least one directory that starts empty"
    target = tmp_path / "elsewhere"

    workspacemove.start(str(target))
    _finish()

    moved = target / "harbour-survey"
    assert sorted(d for d in born if (moved / d).is_dir()) == born
    assert (target / ".azimut" / "bundles").is_dir()


def test_a_move_carries_scratch_cases(workspace, tmp_path):
    Case.create("One shot", scratch=True)

    workspacemove.start(str(tmp_path / "elsewhere"))
    _finish()

    assert len(list(config.scratch_dir().iterdir())) == 1


def test_a_move_onto_an_existing_workspace_is_refused(workspace, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    (other / ".azimut").mkdir()

    with pytest.raises(MoveError, match="use it as it is"):
        workspacemove.start(str(other))


def test_a_second_move_is_refused_while_one_runs(workspace, tmp_path, monkeypatch):
    started = {"copying": False}
    real_copy = workspacemove._step_copy

    def slow_copy(move, staging):
        started["copying"] = True
        time.sleep(0.3)
        real_copy(move, staging)

    monkeypatch.setattr(workspacemove, "_step_copy", slow_copy)
    workspacemove.start(str(tmp_path / "first"))
    while not started["copying"]:
        time.sleep(0.01)

    assert workspacemove.in_progress()
    with pytest.raises(MoveError, match="already running"):
        workspacemove.start(str(tmp_path / "second"))

    _finish()


def test_there_is_nothing_to_discard_before_a_move(workspace):
    with pytest.raises(MoveError):
        workspacemove.discard_old()


# -- killed part way through ---------------------------------------------------
#
# The steps are driven by hand here rather than through the worker thread, so a
# "kill" is the real thing: execution stops and nothing unwinds. What is
# asserted after each one is the same sentence in every case — restart Azimut
# and the case is still there, opened from a complete workspace.


def _drive(move, staging, workqueue, upto: int) -> None:
    steps = (
        lambda: workspacemove._step_settle(move, workqueue),
        lambda: workspacemove._step_copy(move, staging),
        lambda: workspacemove._step_verify(move, staging),
        lambda: workspacemove._step_switch(move, staging),
        lambda: workspacemove._step_open(move),
        lambda: workspacemove._step_tidy(move),
    )
    for step in steps[:upto]:
        step()


@pytest.mark.parametrize("killed_after", range(7))
def test_a_kill_at_any_step_leaves_a_complete_workspace(workspace, tmp_path, killed_after):
    from azimut.engine import workqueue

    case = Case.create("Harbour survey")
    (case.path / "analyst-notes.txt").write_text("mine", encoding="utf-8")
    target = tmp_path / "elsewhere" / "Azimut"
    move = workspacemove.Move(source=workspace, root=target)
    staging = target.parent / f"{target.name}{workspacemove.STAGING_SUFFIX}"

    resume = workqueue.start_workers
    try:
        _drive(move, staging, workqueue, killed_after)
    finally:
        workqueue.start_workers = resume

    # Restart: the pointer is the only thing that survives the process.
    config.forget_workspace_root()
    root = config.workspace_root()

    assert root.is_dir(), "startup would have nothing to open"
    assert [row["name"] for row in Case.list_all()] == ["Harbour survey"]
    notes = root / "harbour-survey" / "analyst-notes.txt"
    assert notes.read_text(encoding="utf-8") == "mine"
    assert config.settings_path().is_file()


@pytest.mark.parametrize("killed_after", range(4))
def test_nothing_is_removed_before_the_copy_is_verified(workspace, tmp_path, killed_after):
    """Steps 1 to 3 must leave the source untouched: until verification passes,
    it is still the only complete workspace."""
    from azimut.engine import workqueue

    Case.create("Harbour survey")
    target = tmp_path / "elsewhere" / "Azimut"
    move = workspacemove.Move(source=workspace, root=target)
    staging = target.parent / f"{target.name}{workspacemove.STAGING_SUFFIX}"

    resume = workqueue.start_workers
    try:
        _drive(move, staging, workqueue, killed_after)
    finally:
        workqueue.start_workers = resume

    assert (workspace / "harbour-survey" / "azimut" / "case.json").is_file()
    assert config.read_pointer() == workspace


def test_a_half_copy_left_by_a_kill_is_named_before_the_next_attempt(workspace, tmp_path):
    """Only a killed process can leave one behind; a move that fails clears it.
    So it is reported rather than silently overwritten — otherwise the analyst
    finds a folder beside theirs that nothing accounts for."""
    target = tmp_path / "elsewhere" / "Azimut"
    staging = target.parent / f"{target.name}{workspacemove.STAGING_SUFFIX}"
    staging.mkdir(parents=True)

    verdict = workspacemove.inspect_target(str(target))

    assert verdict["ok"]
    assert any("interrupted move" in warning for warning in verdict["warnings"])


def test_a_half_copy_left_by_a_kill_is_discarded_by_the_next_attempt(workspace, tmp_path):
    """A staging directory is incomplete by definition — the pointer only ever
    names a folder that passed verification — so the next attempt starts clean
    rather than trusting bytes nobody vouched for."""
    Case.create("Harbour survey")
    target = tmp_path / "elsewhere" / "Azimut"
    staging = target.parent / f"{target.name}{workspacemove.STAGING_SUFFIX}"
    staging.mkdir(parents=True)
    (staging / "half-written.bin").write_bytes(b"\0" * 16)

    workspacemove.start(str(target))
    move = _finish()

    assert not move["error"]
    assert not (target / "half-written.bin").exists()
    assert (target / "harbour-survey" / "azimut" / "case.json").is_file()


def test_a_move_interrupted_between_the_rename_and_the_pointer_keeps_both_folders(
    workspace, tmp_path
):
    """The one window where two complete workspaces exist. The old one is still
    authoritative, which is what makes the pointer write the whole switch."""
    from azimut.engine import workqueue

    Case.create("Harbour survey")
    target = tmp_path / "elsewhere" / "Azimut"
    move = workspacemove.Move(source=workspace, root=target)
    staging = target.parent / f"{target.name}{workspacemove.STAGING_SUFFIX}"

    resume = workqueue.start_workers
    try:
        workspacemove._step_settle(move, workqueue)
        workspacemove._step_copy(move, staging)
        workspacemove._step_verify(move, staging)
        staging.rename(target)  # the switch, stopped before the pointer write
    finally:
        workqueue.start_workers = resume

    config.forget_workspace_root()

    assert config.workspace_root() == workspace
    assert (workspace / "harbour-survey" / "azimut" / "case.json").is_file()
    assert (target / "harbour-survey" / "azimut" / "case.json").is_file()
