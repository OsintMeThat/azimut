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

from . import notes_tables

ENTITY_REF = re.compile(r"\[\[entity:([A-Za-z0-9_-]+)\|([^\]]+)\]\]")
#: A template's guidance: a line that is only `<!--? … -->`. Shown by the editor
#: as grey text in place and replaced by what the analyst types; never printed,
#: counted, searched or excerpted. Any other renderer reads an HTML comment.
HINT = re.compile(r"^[ \t]*<!--\?(?:(?!-->).)*-->[ \t\r]*$")
#: The same guidance written inside a line, which nothing prints or counts either.
INLINE_HINT = re.compile(r"<!--\?.*?-->")
#: Any HTML comment on a line: hidden by the editor and the PDF, so not read out either.
COMMENT = re.compile(r"<!--.*?-->")
#: A chapter: a line that is only `[[include:<note id>]]`, the note printed in
#: its place (`engine/notes_pdf.py`). `case` names the case notes. Any other
#: renderer shows the line as text.
INCLUDE = re.compile(r"^\[\[include:([A-Za-z0-9_-]+)\]\][ \t\r]*$")
#: A page break: a line that is only `<!-- pagebreak -->`. The PDF starts a new
#: page there; every other renderer reads an HTML comment, which shows nothing.
PAGE_BREAK = re.compile(r"^[ \t]*<!--[ \t]*page[ \t-]?break[ \t]*-->[ \t\r]*$", re.I)
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
    and neither is a template's guidance, the line that includes a chapter nor a
    page break."""
    lines: list[tuple[int, str]] = []
    fenced = False
    for index, line in enumerate((text or "").splitlines()):
        if FENCE.match(line):
            fenced = not fenced
            continue
        if not fenced and not HINT.match(line) and not INCLUDE.match(line) and not PAGE_BREAK.match(line):
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


def _backticks(line: str, at: int) -> int:
    """How many backticks run from ``at``."""
    return len(line) - at - len(line[at:].lstrip("`"))


def _code_end(line: str, at: int) -> int:
    """Where the code span opening at ``at`` (a run of backticks) ends, or -1 when no run
    as long closes it, the backticks then being text."""
    run = _backticks(line, at)
    close = line.find("`" * run, at + run)
    while close >= 0 and line[close + run : close + run + 1] == "`":
        close = line.find("`" * run, close + run + 1)
    return -1 if close < 0 else close + run


def footnote_spans(line: str) -> list[tuple[int, int]]:
    """Each footnote written on a line, `^[` to its closing bracket, as (start, end). Its
    brackets balance, a backslash escapes, code is skipped, and one never closed or holding
    nothing is none: the parser's reading (`notes_markdown._footnote`), and the Notebook's
    (`lib/notes/footnotes.js`)."""
    spans: list[tuple[int, int]] = []
    at, opened, depth = 0, -1, 0
    while True:
        if at >= len(line):
            if opened < 0:
                return spans
            # one never closed is text: read on from just after its `^`
            at, opened = opened + 1, -1
            continue
        char = line[at]
        if char == "\\":
            at += 2
        elif char == "`":
            end = _code_end(line, at)
            at = end if end > 0 else at + _backticks(line, at)
        elif opened < 0 and line.startswith("^[", at):
            opened, depth = at, 1
            at += 2
        elif opened >= 0 and char == "[":
            depth += 1
            at += 1
        elif opened >= 0 and char == "]" and depth == 1:
            if line[opened + 2 : at].strip():
                spans.append((opened, at + 1))
                at, opened = at + 1, -1
            else:
                # `^[]` holds nothing, so it is no footnote
                at, opened = opened + 1, -1
        else:
            depth -= 1 if opened >= 0 and char == "]" else 0
            at += 1


def without_footnotes(line: str, *, said: bool = False) -> str:
    """A line with its footnotes taken out, or with ``said`` their words in brackets where
    their letters stand, as one reading the line aloud would say them."""
    out: list[str] = []
    at = 0
    for start, end in footnote_spans(line):
        out.append(line[at:start])
        if said:
            out.append(f" ({line[start + 2 : end - 1]})")
        at = end
    out.append(line[at:])
    return "".join(out)


def plain_line(line: str, *, footnotes: bool = True) -> str:
    """One Markdown line as a reader would say it: references by name, no marks. Its
    footnotes are said in brackets where they stand, or with ``footnotes`` off left out,
    as a summary leaves them."""
    line = COMMENT.sub("", line)
    if "^[" in line:
        line = without_footnotes(line, said=footnotes)
    line = MEDIA_REF.sub(lambda match: match.group(2), line)
    line = ENTITY_REF.sub(lambda match: match.group(2), line)
    line = IMAGE.sub(lambda match: match.group(1), line)
    line = LINK.sub(lambda match: match.group(1), line)
    if TABLE_RULE.match(line) or ALIGN_FENCE.match(line) or notes_tables.read_line(line) is not None:
        return ""
    line = CALLOUT.sub("", line)
    line = HEADING.sub("", line)
    line = QUOTE.sub("", line)
    line = BULLET.sub("", line)
    line = EMPHASIS.sub("", line)
    line = line.replace("|", " ")
    return " ".join(line.split())


def plain(text: str, *, footnotes: bool = True) -> list[tuple[int, str]]:
    """Every line that says something, as plain text, with its index; its footnotes said in
    brackets, or left out with ``footnotes`` off (`plain_line`)."""
    out: list[tuple[int, str]] = []
    for index, line in _prose_lines(text):
        said = plain_line(line, footnotes=footnotes)
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
    # a footnote is an aside: the card reads the running text without it
    for index, said in plain(text, footnotes=False):
        if HEADING.match(rows[index]) and not said.endswith((".", ":", "?", "!")):
            said = f"{said}."
        lines.append(said)
    if lines and fold(lines[0]).rstrip(".") == fold(title.strip()):
        lines = lines[1:]
    return _cut(" ".join(lines), EXCERPT_CHARS)


def word_count(text: str) -> int:
    """How many words the running text holds, its footnotes left out as a summary leaves them."""
    return sum(len(said.split()) for _, said in plain(text, footnotes=False))


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
