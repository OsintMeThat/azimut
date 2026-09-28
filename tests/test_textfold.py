"""Search folds the same text the same way on the server as in the browser."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from azimut.engine.textfold import fold_text

CASES = json.loads(
    (Path(__file__).parent / "fixtures" / "fold_cases.json").read_text(encoding="utf-8")
)["cases"]


@pytest.mark.parametrize(("text", "folded", "why"), CASES, ids=[case[2] for case in CASES])
def test_search_folds_what_a_reader_skips_and_nothing_else(text, folded, why):
    assert fold_text(text) == folded


def test_folding_twice_changes_nothing():
    for text, folded, _ in CASES:
        assert fold_text(folded) == folded
