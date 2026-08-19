"""The Windows shards have to add up to the suite.

Windows costs roughly eight times as much per test as Linux does — every test here
builds a case, and a case is a database, folders and files — so it is the one box that
runs the suite in pieces (see the backend matrix in `.github/workflows/ci.yml`).

Pieces are how a file goes missing. A range stopping at ``test_sc*`` beside one starting
at ``test_se*`` runs everything except whatever ``test_sd*`` somebody adds next year, and
nothing anywhere says so: the run is green, the shards are green, and a module is simply
never executed on the platform it was most likely to break on. Green would mean "the
tests we happened to name", which is not what green is for.

So the ranges are read back out of the workflow and checked against the directory. The
workflow is parsed as text rather than as YAML on purpose: this is a gate, PyYAML is not
a declared dependency of this project, and a gate that needs a dependency to run is a
gate that gets skipped.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
TESTS = ROOT / "tests"

#: A matrix entry's `tests:` value. The whole-suite boxes say `tests`; a shard says one
#: or more globs, which is what makes it a shard.
_TESTS_LINE = re.compile(r"^\s*tests:\s*(\S.*?)\s*$", re.MULTILINE)


def _shards() -> list[list[str]]:
    """Every sharded `tests:` value in the workflow, as its list of globs."""
    values = _TESTS_LINE.findall(WORKFLOW.read_text(encoding="utf-8"))
    return [value.split() for value in values if "*" in value]


@pytest.fixture(scope="module")
def shards() -> list[list[str]]:
    if not WORKFLOW.is_file():
        pytest.skip("no workflow to check: not a repository checkout")
    found = _shards()
    assert found, "the backend matrix names no sharded `tests:` value"
    return found


def test_every_test_file_runs_on_windows(shards: list[list[str]]) -> None:
    """No test file falls between two ranges."""
    covered = {path for globs in shards for glob in globs for path in ROOT.glob(glob)}
    missing = sorted(path.name for path in set(TESTS.glob("test_*.py")) - covered)
    assert not missing, (
        "these test files are in no Windows shard, so Windows never runs them: "
        + ", ".join(missing)
    )


def test_no_test_file_runs_twice_on_windows(shards: list[list[str]]) -> None:
    """No test file is claimed by two ranges.

    Not a correctness problem — the same test passing twice is still passing — but it is
    a shard paying for work another one already did, which is the whole thing the split
    exists to avoid.
    """
    seen: dict[str, int] = {}
    for globs in shards:
        for path in {p for glob in globs for p in ROOT.glob(glob)}:
            seen[path.name] = seen.get(path.name, 0) + 1
    twice = sorted(name for name, times in seen.items() if times > 1)
    assert not twice, "these test files are in more than one Windows shard: " + ", ".join(twice)


def test_the_shards_stay_within_reach_of_each_other(shards: list[list[str]]) -> None:
    """No range grows into the one job everything waits for.

    Counted in files rather than in tests, because reading every module to count its
    tests is the collection this gate is deliberately cheaper than. It is a coarse
    measure and the bound is loose to match: it catches a range that has drifted into
    holding half the suite, not a range that is merely the largest.
    """
    sizes = [len({p for glob in globs for p in ROOT.glob(glob)}) for globs in shards]
    assert min(sizes) > 0, "a Windows shard matches no file at all"
    assert max(sizes) <= 3 * (sum(sizes) / len(sizes)), (
        f"one Windows shard holds far more files than the rest: {sizes}"
    )
