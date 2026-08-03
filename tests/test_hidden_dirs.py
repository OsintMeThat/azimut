"""A leading dot hides a directory on two operating systems out of three.

Windows hides by attribute instead, and an attribute belongs to the directory it
was set on — not to its name. Every way a case tree can be rebuilt (a workspace
copied to another drive, a folder carried between machines, a database the
doctor recreates) therefore drops it, and the case's internals come back into
view. These tests hold the two halves of the answer: the attribute is set
wherever a directory is created, and it is put back wherever a case is opened.

The platform is faked rather than skipped. The behaviour has to be verifiable on
the machine the suite actually runs on, or the one OS it exists for is the one
OS nobody tests it on.
"""

from __future__ import annotations

import ctypes
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from azimut import config, layout
from azimut.api import proofs
from azimut.workspace import Case, ensure_dir

#: What Windows answers for a path it cannot read, and the bits in play. Every
#: real directory reports `DIRECTORY`, which is why the fake below answers with
#: it: an attribute set is never empty, and the code has to add to one.
INVALID = -1
HIDDEN = 0x02
READONLY = 0x01
DIRECTORY = 0x10


class FakeKernel32:
    """The two calls `hide_if_dotted` makes, over an in-memory attribute table."""

    def __init__(self, attributes: dict[str, int] | None = None) -> None:
        self.attributes = attributes or {}
        self.reads: list[str] = []

    def GetFileAttributesW(self, path: str) -> int:  # noqa: N802 - Windows spelling
        self.reads.append(path)
        if path in self.attributes:
            return self.attributes[path]
        return DIRECTORY if Path(path).is_dir() else INVALID

    def SetFileAttributesW(self, path: str, value: int) -> int:  # noqa: N802
        self.attributes[path] = value
        return 1


@pytest.fixture()
def windows(monkeypatch):
    """Run the code under test as if it were on Windows, with a fake kernel32."""
    kernel32 = FakeKernel32()
    monkeypatch.setattr(sys, "platform", "win32")
    monkeypatch.setattr(ctypes, "windll", SimpleNamespace(kernel32=kernel32), raising=False)
    return kernel32


def test_the_hidden_bit_is_added_to_the_attributes_already_there(windows, tmp_path):
    """A directory Windows or the analyst had marked keeps that mark. Writing
    the bit on its own would silently clear everything else."""
    directory = tmp_path / ".data"
    windows.attributes[str(directory)] = READONLY

    config.hide_if_dotted(directory)

    assert windows.attributes[str(directory)] == READONLY | HIDDEN


def test_an_already_hidden_directory_is_not_written_again(windows, tmp_path):
    directory = tmp_path / ".data"
    windows.attributes[str(directory)] = HIDDEN

    config.hide_if_dotted(directory)

    assert windows.attributes[str(directory)] == HIDDEN
    assert windows.reads == [str(directory)]


def test_a_directory_windows_cannot_read_is_left_alone(windows, tmp_path):
    """`GetFileAttributesW` answers -1 for a path that is not there. Treating
    that as an attribute set would write `-1 | HIDDEN` over the directory."""
    missing = tmp_path / ".gone"

    config.hide_if_dotted(missing)

    assert str(missing) not in windows.attributes


def test_a_visible_directory_is_never_hidden(windows, tmp_path):
    config.hide_if_dotted(tmp_path / "media")

    assert windows.attributes == {}


def test_nothing_is_touched_off_windows(monkeypatch, tmp_path):
    """The whole mechanism is one platform's. Elsewhere it must not even look:
    `ctypes.windll` does not exist there."""
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.delattr(ctypes, "windll", raising=False)

    config.hide_if_dotted(tmp_path / ".data")  # no AttributeError


def test_creating_a_directory_hides_the_dotted_parent_it_had_to_make(windows, tmp_path):
    """`proofs/.meta/<name>.assets` is a visible leaf under a hidden parent, and
    `parents=True` creates both. Hiding only the leaf hides nothing."""
    leaf = tmp_path / "proofs" / layout.META_DIR / "harbour.assets"

    ensure_dir(leaf)

    assert windows.attributes == {str(leaf.parent): DIRECTORY | HIDDEN}


def test_the_walk_up_stops_at_the_first_visible_directory(windows, tmp_path):
    """It climbs to fix what `parents=True` just made, not to redecorate the
    machine the workspace happens to sit on."""
    ensure_dir(tmp_path / ".azimut" / "cases" / "harbour" / "azimut" / "media")

    assert windows.attributes == {}


def test_a_case_is_born_with_every_internal_directory_hidden(windows, tmp_workspace):
    case = Case.create("Harbour survey")

    for directory in layout.hidden_dirs(case.path):
        if directory.is_dir():
            assert windows.attributes.get(str(directory)) == DIRECTORY | HIDDEN, directory


def test_opening_a_case_puts_the_attribute_back(tmp_workspace, monkeypatch):
    """The case that arrives from somewhere else: a workspace copied between
    machines carries no attributes at all, and nothing else would ever restore
    them — unlike `.azimut`, which `ensure_workspace` re-hides at every start."""
    case = Case.create("Harbour survey")
    offered: list[Path] = []
    monkeypatch.setattr(config, "hide_if_dotted", offered.append)

    Case.open(case.id)

    assert set(layout.hidden_dirs(case.path)) <= set(offered)


def test_the_hidden_list_holds_every_dot_directory_a_case_is_born_with(tmp_workspace):
    """The sweep is a written-down list, so what it misses stays visible for
    good. This is what fails the day a directory joins the layout."""
    case = Case.create("Harbour survey")
    born = {
        path
        for path in layout.tool_root(case.path).rglob("*")
        if path.is_dir() and path.name.startswith(".")
    }

    assert born <= set(layout.hidden_dirs(case.path))


def test_saving_a_proof_asset_hides_the_folder_it_lands_in(windows, tmp_workspace):
    """The one writer that reaches a hidden directory through a visible child."""
    case = Case.create("Harbour survey")
    folder = case.resolve_inside(layout.proof_assets_rel("harbour"))
    windows.attributes.clear()

    proofs._write_assets(folder, {"a1b2c3d4e5f60718.webp": b"pretend"}, {"a1b2c3d4e5f60718.webp"})

    assert windows.attributes.get(str(folder.parent)) == DIRECTORY | HIDDEN
