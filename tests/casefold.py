"""Windows and macOS on a Linux run: two names that differ only by case are one file.

NTFS and APFS (as formatted by default) match names without regard to case, and
Windows' `Path.resolve()` answers with the case already on disk. `fold_names` makes
`Case.resolve_inside` do the same for the folders a test names, so a path that
differs from an existing file only by case resolves to that file, which is what an
unlink or a write through it reaches on those systems.
"""

from __future__ import annotations

from azimut import workspace


def fold_names(monkeypatch, *directories: str) -> None:
    original = workspace.Case.resolve_inside

    def resolve(self, relative: str):
        path = original(self, relative)
        folded = relative.replace("\\", "/")
        if path.exists() or not path.parent.is_dir():
            return path
        if not any(folded.startswith(f"{d}/") for d in directories):
            return path
        for sibling in path.parent.iterdir():
            if sibling.name.casefold() == path.name.casefold():
                return sibling
        return path

    monkeypatch.setattr(workspace.Case, "resolve_inside", resolve)
