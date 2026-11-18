"""What the Notebook's block handle writes is read by the engine as it means it.

The handle (`frontend/src/lib/notes/editor/turnInto.js`) marks a block internal, sets
it on a side of the page or in a corner of the cover, and copies a link to a heading.
`turnInto.test.js` checks the module writes what `handle-writes.json` holds; this test
checks the engine reads that the same way: the public edition leaves each internal
passage out whole and nothing else, an aligned block keeps its side or its corner, and
an anchor is the one the HTML page gives the heading.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from azimut.engine import notes_markdown as md
from azimut.engine.notes_html import _slug

FIXTURE = Path(__file__).resolve().parents[1] / "frontend/src/lib/notes/editor/fixtures/handle-writes.json"
WRITES: dict[str, Any] = json.loads(FIXTURE.read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", WRITES["internal"], ids=lambda case: case["kind"])
def test_an_internal_passage_is_left_out_of_the_public_edition_whole(case: dict[str, str]) -> None:
    before, after = "Intro words.", "Closing words."
    note = f"{before}\n\n{case['wrapped']}\n\n{after}"
    public, found = md.strip_internal(note)
    assert found == 1
    lines = public.split("\n")
    passage = case["wrapped"].count("\n") + 1
    # every line of the passage blanked, the lines kept, the words around it untouched
    assert lines[2 : 2 + passage] == [""] * passage
    assert lines[0] == before and lines[-1] == after
    assert len(lines) == note.count("\n") + 1
    # and the block before it was marked holds none
    assert md.internal_passages(f"{before}\n\n{case['text']}\n\n{after}") == 0


@pytest.mark.parametrize("case", WRITES["aligned"], ids=lambda case: case.get("corner") or case["side"])
def test_an_aligned_block_keeps_its_side_or_its_corner(case: dict[str, str]) -> None:
    blocks = [block for block in md.alignment_blocks(f"Intro\n\n{case['written']}\n\nEnd") if block.tokens]
    aligned = [block for block in blocks if block.align != "left" or block.corner]
    assert len(aligned) == 1
    corner = case.get("corner", "")
    assert aligned[0].corner == corner
    assert aligned[0].align == (corner.rsplit("-", 1)[-1] if corner else case["side"])


@pytest.mark.parametrize("words, slug", WRITES["anchors"])
def test_a_heading_link_names_the_anchor_the_html_page_gives(words: str, slug: str) -> None:
    assert _slug(words) == slug
