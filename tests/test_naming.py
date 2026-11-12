"""Shared naming rules: the visible stem every saved item's filename follows.

The frontend mirrors `slugify` in `lib/naming.js` so it can tell before it posts
whether a name is free. These cases are the contract both sides implement.
"""

import json

import pytest

from azimut.api.naming import MAX_SLUG, existing_stem, read_created_at, slugify
from azimut.layout import case_folder_name, usable_case_name, visible_filename


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


#: What a paste from beside Arabic or Hebrew text brings along, unseen.
INVISIBLE = [
    "\u200e", "\u200f", "\u061c",  # left-to-right, right-to-left and Arabic letter marks
    "\u202a", "\u202b", "\u202c", "\u202d", "\u202e",  # embeddings, overrides and their pop
    "\u2066", "\u2067", "\u2068", "\u2069",  # isolates and their pop
    "\u200b", "\u2060", "\ufeff", "\u00ad",  # zero-width space, word joiner, byte-order mark, soft hyphen
]


def test_a_name_given_drops_the_invisible_characters_a_paste_brings():
    # the name a proof was really saved under, pasted from X beside Arabic text
    assert slugify("7H45MFQC+QR\u2069", "Proof") == "7H45MFQC+QR"
    assert slugify("\u2067\u062c\u0633\u0631\u2069 bridge", "Proof") == "\u062c\u0633\u0631 bridge"
    for char in INVISIBLE:
        assert slugify(f"{char}Har{char}bour{char}", "Proof") == "Harbour", repr(char)
    # nothing left but them: the fallback, as for an empty name
    assert slugify("\u2066\u2069", "Proof") == "Proof"
    # one between two words leaves the space it stood beside
    assert slugify("Port \u2069 east", "Proof") == "Port east"


@pytest.mark.parametrize("joiner", ["\u200d", "\u200c"])
def test_a_joiner_stays_inside_a_word_and_goes_at_its_ends(joiner):
    assert slugify(f"{joiner}Depot{joiner}", "Proof") == "Depot"
    assert slugify(f"North {joiner}depot", "Proof") == "North depot"
    assert slugify(f"North{joiner} depot", "Proof") == "North depot"
    assert slugify(f"mi{joiner}ravam", "Proof") == f"mi{joiner}ravam"


def test_an_emoji_sequence_keeps_its_joiners():
    family = "\U0001F468\u200d\U0001F469\u200d\U0001F467"
    assert slugify(f"Rally {family}", "Proof") == f"Rally {family}"


def test_a_name_already_saved_is_read_as_it_stands():
    # a file saved before names were cleaned is still found by its own name
    assert existing_stem("7H45MFQC+QR\u2069", "proof") == "7H45MFQC+QR\u2069"
    for char in INVISIBLE:
        assert existing_stem(f"Har{char}bour", "proof") == f"Har{char}bour"
    # and it guards the folder as the given name does
    for hostile in ("../../etc/passwd", "..\\..\\windows", "a/b", "."):
        assert "/" not in existing_stem(hostile, "proof")
        assert "\\" not in existing_stem(hostile, "proof")
        assert ".." not in existing_stem(hostile, "proof")


def test_a_file_name_given_is_cleaned_and_one_it_has_is_kept():
    assert visible_filename("IMG\u2069 0042", ".jpg") == "IMG 0042.jpg"
    assert visible_filename("IMG\u2069 0042", ".jpg", existing=True) == "IMG\u2069 0042.jpg"


def test_a_case_folder_with_an_invisible_character_can_still_be_adopted():
    # a new case is named clean, and a folder the analyst made is taken as it is
    assert case_folder_name("Kherson\u2069") == "Kherson"
    assert usable_case_name("Kherson\u2069")


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
