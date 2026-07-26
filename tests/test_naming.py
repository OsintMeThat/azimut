"""Shared naming rules: the slug every saved item's filename follows.

The frontend mirrors `slugify` in `lib/naming.js` so it can tell before it posts
whether a name is free. These cases are the contract both sides implement.
"""

import json

from azimut.api.naming import MAX_SLUG, read_created_at, slugify


def test_slug_lowercases_hyphenates_and_trims():
    assert slugify("Inspect 1", "session") == "inspect-1"
    assert slugify("  Rooftop! @ 12:30  ", "proof") == "rooftop-12-30"
    assert slugify("Café déjà", "proof") == "caf-d-j"


def test_slug_falls_back_per_caller_and_is_bounded():
    assert slugify("", "proof") == "proof"
    assert slugify("!!!", "session") == "session"
    assert slugify(None, "draft") == "draft"
    assert len(slugify("a" * 200, "proof")) == MAX_SLUG


def test_slug_cannot_reach_outside_its_folder():
    # The slug is the only guard on a client-supplied `rename_from`: nothing but
    # [a-z0-9-] survives it, so no separator or dot-dot can reach the filesystem.
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
