"""Shared naming rules: the visible stem every saved item's filename follows.

The frontend mirrors `slugify` in `lib/naming.js` so it can tell before it posts
whether a name is free. These cases are the contract both sides implement.
"""

import json

from azimut.api.naming import MAX_SLUG, read_created_at, slugify


def test_visible_stem_preserves_human_text_and_replaces_forbidden_characters():
    assert slugify("Inspect 1", "session") == "Inspect 1"
    assert slugify("  Rooftop! @ 12:30  ", "proof") == "Rooftop! @ 12_30"
    assert slugify("Café déjà", "proof") == "Café déjà"


def test_slug_falls_back_per_caller_and_is_bounded():
    assert slugify("", "proof") == "proof"
    assert slugify("!!!", "session") == "!!!"
    assert slugify(None, "draft") == "draft"
    assert len(slugify("a" * 200, "proof")) == MAX_SLUG


def test_slug_cannot_reach_outside_its_folder():
    # The canonical stem is the guard on a client-supplied `rename_from`.
    # Separators and parent traversal never reach the filesystem.
    for hostile in ("../../etc/passwd", "..\\..\\windows", "a/b", "."):
        assert "/" not in slugify(hostile, "proof")
        assert "\\" not in slugify(hostile, "proof")
        assert ".." not in slugify(hostile, "proof")


def test_read_created_at_returns_the_stamp_on_disk(tmp_path):
    path = tmp_path / "spec.json"
    path.write_text(json.dumps({"created_at": "2026-07-26T10:00:00Z"}), encoding="utf-8")
    assert read_created_at(path) == "2026-07-26T10:00:00Z"


def test_read_created_at_is_none_when_unreadable(tmp_path):
    assert read_created_at(tmp_path / "missing.json") is None
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    assert read_created_at(bad) is None
    empty = tmp_path / "empty.json"
    empty.write_text("{}", encoding="utf-8")
    assert read_created_at(empty) is None
    wrong = tmp_path / "wrong.json"
    wrong.write_text(json.dumps({"created_at": 17}), encoding="utf-8")
    assert read_created_at(wrong) is None
