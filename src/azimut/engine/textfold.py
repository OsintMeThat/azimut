"""How a search compares text: without case, and without the marks a reader skips.

``fold_text`` is applied to the stored search index and to every term typed against
it, so a search for ``Kyiv`` in Cyrillic, ``Cafe`` or ``محمد`` finds the label written
with its accents, its stress marks or its vowels. The browser holds the same fold
(``frontend/src/lib/textFold.js``) for a case small enough to search in memory, and
``tests/fixtures/fold_cases.json`` holds both to one list.

Marks go only where a reader would skip them: on a Latin, Greek or Cyrillic letter,
Arabic harakat and the tatweel, Hebrew points. Everywhere else a combining mark is
part of the letter: a Devanagari sign changes the syllable and a dakuten changes the
sound, so they stay. Punctuation is never touched, because an address, an email or a
handle is looked for by it. ``identity_key`` does not fold: that is identity, and this
is recall.

``lower`` rather than ``casefold``, with the two differences that matter spelled out,
because ``casefold`` has no counterpart in JavaScript and the two sides must agree.
"""

from __future__ import annotations

import unicodedata

#: Case differences ``lower`` leaves that a reader does not see.
_SAME_LETTER = str.maketrans({"ß": "ss", "ς": "σ"})


def _skipped_on(base: int) -> bool:
    """Whether a mark on this letter is one a reader of its script skips."""
    return base <= 0x052F or 0x1E00 <= base <= 0x1FFF


def _skipped(mark: int) -> bool:
    """Arabic harakat and superscript alef, then the Hebrew points."""
    return 0x064B <= mark <= 0x065F or mark == 0x0670 or 0x0591 <= mark <= 0x05C7


def fold_text(text: str) -> str:
    """``text`` as a search compares it."""
    out: list[str] = []
    base = 0
    for char in unicodedata.normalize("NFD", text.lower().translate(_SAME_LETTER)):
        code = ord(char)
        if unicodedata.category(char) == "Mn":
            if not (_skipped_on(base) or _skipped(code)):
                out.append(char)
            continue
        if code == 0x0640:  # the tatweel, which only stretches a word
            continue
        base = code
        out.append(char)
    return unicodedata.normalize("NFC", "".join(out))


def search_rank(label: str, query: str) -> int:
    """Rank exact labels, phrase prefixes, word prefixes, then other matches."""
    text = fold_text(label)
    phrase = " ".join(fold_text(query).split())
    if text == phrase:
        return 0
    if text.startswith(phrase):
        return 1
    words = text.split()
    if all(any(word.startswith(term) for word in words) for term in phrase.split()):
        return 2
    return 3
