"""What a note's Markdown says, read as text rather than drawn.

The Notebook's home lists notes by what they hold, the case search finds words
inside them, Details shows the sentence a note cites something in, and the
sidebar's To-do ticks a task without opening the note. All of that reads the same
Markdown the editor writes, so it lives here, in one place, with no renderer
behind it.

The patterns are the ones the PDF renderer and `lib/markdown.js` read, so a note
cannot say one thing to the page and another to the search.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

ENTITY_REF = re.compile(r"\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]")
#: A template's guidance: a line that is only `<!--? … -->`. Shown by the editor
#: as grey text in place and replaced by what the analyst types; never printed,
#: counted, searched or excerpted. Any other renderer reads an HTML comment.
HINT = re.compile(r"^[ \t]*<!--\?(?:(?!-->).)*-->[ \t\r]*$")
#: The same guidance written inside a line, which nothing prints or counts either.
INLINE_HINT = re.compile(r"<!--\?.*?-->")
#: A chapter: a line that is only `[[include:<note id>]]`, the note printed in
#: its place (`engine/notes_pdf.py`). `case` names the case notes. Any other
#: renderer shows the line as text.
INCLUDE = re.compile(r"^\[\[include:([A-Za-z0-9_-]+)\]\][ \t\r]*$")
MEDIA_REF = re.compile(r"\[\[media:([A-Za-z0-9_-]+)\|([^\]]+)\]\](?:\{([^}\n]+)\})?")

#: A list item that is a task: `- [ ] text`, `* [x] text`, `1. [ ] text`.
TASK = re.compile(r"^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s+)(.*?)\s*$")
FENCE = re.compile(r"^\s*(```|~~~)")
#: `> [!confirmed]`, the callout a quote opens with.
CALLOUT = re.compile(r"^(\s*>\s*)\[!([a-z]+)\]\s*", re.I)

IMAGE = re.compile(r"!\[([^\]]*)\]\([^)]*\)(?:\{[^}\n]*\})?")
LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
HEADING = re.compile(r"^\s{0,3}#{1,6}\s+")
QUOTE = re.compile(r"^\s*(?:>\s*)+")
BULLET = re.compile(r"^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?")
TABLE_RULE = re.compile(r"^\s*\|?\s*:?-{3,}")
ALIGN_FENCE = re.compile(r"^:::")
EMPHASIS = re.compile(r"(\*\*|__|~~|\*|`)")

#: What one excerpt, snippet or cited sentence may run to before it is cut.
EXCERPT_CHARS = 180
SNIPPET_CHARS = 160
CITATION_CHARS = 240


@dataclass(frozen=True)
class Task:
    line: int
    done: bool
    text: str


def fold(value: str) -> str:
    """Lower case without accents, so `Hodeïda` is found by `hodeida`."""
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def mentioned_ids(text: str) -> list[str]:
    """The records a note points at with `[[entity:…]]`, in order, once each."""
    return list(dict.fromkeys(match.group(1) for match in ENTITY_REF.finditer(text or "")))


def _prose_lines(text: str) -> list[tuple[int, str]]:
    """Each line outside a fenced block, with its index. A diagram is not prose,
    and neither is a template's guidance nor the line that includes a chapter."""
    lines: list[tuple[int, str]] = []
    fenced = False
    for index, line in enumerate((text or "").splitlines()):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if not fenced and not HINT.match(line) and not INCLUDE.match(line):
            lines.append((index, line))
    return lines


def included_ids(text: str) -> list[str]:
    """The notes a note prints as chapters, in order, each line counted.

    Outside fences only: an include written inside a code block is an example of
    the syntax, not a chapter.
    """
    found: list[str] = []
    fenced = False
    for line in (text or "").splitlines():
        if FENCE.match(line):
            fenced = not fenced
            continue
        match = None if fenced else INCLUDE.match(line)
        if match:
            found.append(match.group(1))
    return found


def without_hints(text: str) -> str:
    """The note with each guidance line emptied, outside fences, lines kept in place.

    Emptied rather than removed, so a line number read from what is left is still
    a line number in the note.
    """
    rows = (text or "").split("\n")
    fenced = False
    for index, line in enumerate(rows):
        if FENCE.match(line):
            fenced = not fenced
        elif not fenced and HINT.match(line):
            rows[index] = ""
    return "\n".join(rows)


def plain_line(line: str) -> str:
    """One Markdown line as a reader would say it: references by name, no marks."""
    line = INLINE_HINT.sub("", line)
    line = MEDIA_REF.sub(lambda match: match.group(2), line)
    line = ENTITY_REF.sub(lambda match: match.group(2), line)
    line = IMAGE.sub(lambda match: match.group(1), line)
    line = LINK.sub(lambda match: match.group(1), line)
    if TABLE_RULE.match(line) or ALIGN_FENCE.match(line):
        return ""
    line = CALLOUT.sub("", line)
    line = HEADING.sub("", line)
    line = QUOTE.sub("", line)
    line = BULLET.sub("", line)
    line = EMPHASIS.sub("", line)
    line = line.replace("|", " ")
    return " ".join(line.split())


def plain(text: str) -> list[tuple[int, str]]:
    """Every line that says something, as plain text, with its index."""
    out: list[tuple[int, str]] = []
    for index, line in _prose_lines(text):
        said = plain_line(line)
        if said:
            out.append((index, said))
    return out


def _cut(value: str, limit: int) -> str:
    if len(value) <= limit:
        return value
    head = value[:limit].rsplit(" ", 1)[0] or value[:limit]
    return f"{head}…"


def excerpt(text: str, title: str = "") -> str:
    """The first words of a note, for its card. A first line repeating the title is skipped,
    and a heading ends with a full stop so it does not run into the sentence after it."""
    rows = (text or "").splitlines()
    lines: list[str] = []
    for index, said in plain(text):
        if HEADING.match(rows[index]) and not said.endswith((".", ":", "?", "!")):
            said = f"{said}."
        lines.append(said)
    if lines and fold(lines[0]).rstrip(".") == fold(title.strip()):
        lines = lines[1:]
    return _cut(" ".join(lines), EXCERPT_CHARS)


def word_count(text: str) -> int:
    return sum(len(said.split()) for _, said in plain(text))


def tasks(text: str) -> list[Task]:
    """Every `- [ ]` and `- [x]` of a note, outside code, in order."""
    found: list[Task] = []
    for index, line in _prose_lines(text):
        match = TASK.match(line)
        if match and match.group(4).strip():
            found.append(Task(index, match.group(2) != " ", plain_line(match.group(4))))
    return found


def set_task(text: str, line: int, done: bool, expect: str) -> str:
    """The note with one task ticked or unticked.

    ``expect`` is the task's text as the caller saw it. A note edited since may
    have moved its lines, and ticking whatever now sits on that line would tick
    the wrong thing, so a line that no longer says it is refused.
    """
    rows = (text or "").splitlines(keepends=True)
    if not 0 <= line < len(rows):
        raise ValueError("that task is not in the note any more")
    body = rows[line].rstrip("\r\n")
    ending = rows[line][len(body):]
    match = TASK.match(body)
    if match is None or plain_line(match.group(4)) != expect:
        raise ValueError("that task has changed since it was read")
    mark = "x" if done else " "
    rows[line] = f"{match.group(1)}{mark}{match.group(3)}{body[match.end(3):]}{ending}"
    return "".join(rows)


def _terms(query: str) -> list[str]:
    return [term for term in fold(query).split() if term]


def find(text: str, query: str) -> tuple[int, str] | None:
    """Where a note holds every word of ``query``: the first line naming one, as a snippet.

    A note matches when all the words are somewhere in it, not necessarily on one
    line, the way the case search reads a label. None when one is missing.
    """
    terms = _terms(query)
    if not terms:
        return None
    lines = plain(text)
    whole = fold(" ".join(said for _, said in lines))
    if not all(term in whole for term in terms):
        return None
    for index, said in lines:
        folded = fold(said)
        at = min((folded.find(term) for term in terms if term in folded), default=-1)
        if at < 0:
            continue
        start = max(0, at - SNIPPET_CHARS // 3)
        if start:
            start = said.find(" ", start) + 1 or start
        snippet = said[start:]
        return index, ("…" if start else "") + _cut(snippet, SNIPPET_CHARS)
    return None


def citations(text: str, entity_id: str) -> list[tuple[int, str]]:
    """Each line of a note that names ``entity_id``, as plain text."""
    needles = (f"[[entity:{entity_id}|", f"[[media:{entity_id}|")
    found: list[tuple[int, str]] = []
    for index, line in _prose_lines(text):
        if any(needle in line for needle in needles):
            said = plain_line(line)
            if said:
                found.append((index, _cut(said, CITATION_CHARS)))
    return found
