"""What a note fills in when it prints: its placeholders, its own first page, and
the three pictures every note can show without a file of the case.

**Placeholders.** `{title}` (the note's title), `{date}` (the cover's day if the
look sets one, else the day the PDF is made, in words), and `{name}`, `{role}` and
`{organisation}` (who signs, from Settings › Publishing) are filled each time a
note prints, wherever they stand outside code. The note keeps them as written, so
the same template signs for whoever prints it, on the day they do. An empty one
goes with the punctuation that joined it to its neighbour (no role reads
*Organisation* alone, not *, Organisation*), and a line it leaves with no word
on it goes too, so a report never shows a raw `{name}` or a stray comma.

**The own cover.** With the look's cover set to the note's own page, the lines
above the first `<!-- cover -->` print alone as page 1 (`split_cover`).

**Three pictures.** `azimut:logo` is the app's mark and name, shipped with it;
`azimut:my-logo` is the analyst's logo (Settings › Publishing, the one proofs
and map plates sign with); `azimut:my-signature` a picture of their handwritten
signature. Each is a local file, nothing is fetched, and none is a source: they
say who made the document, not where its facts come from. One that is not set
prints nothing, and the check before export says so.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import date
from pathlib import Path
from typing import TYPE_CHECKING, Callable, Mapping
from urllib.parse import urlsplit

from .. import __version__, config
from .notes_style import long_date
from .notetext import FENCE, INCLUDE

if TYPE_CHECKING:
    from ..workspace import Case
    from .notelook import NoteLook

PLACEHOLDER = re.compile(r"\{(title|date|name|role|organisation)\}")
#: The line a note's own first page ends at: an HTML comment, so it never prints.
#: The Notebook draws it as a rule (`lib/notes`), reading the same pattern.
COVER_LINE = re.compile(r"^[ \t]*<!--[ \t]*cover[ \t]*-->[ \t]*$", re.I)
#: Who signs, as Settings keeps it: one line each, at most this long.
IDENTITY_KEYS = ("report_name", "report_role", "report_organisation")
MAX_IDENTITY = 80

#: The three pictures, by the name written after `azimut:`.
LOGO = "logo"
MY_LOGO = "my-logo"
MY_SIGNATURE = "my-signature"
PICTURES = (LOGO, MY_LOGO, MY_SIGNATURE)
#: The Azimut lockup inked for a white page, and its size as the Notebook draws it.
AZIMUT_LOGO = Path(__file__).resolve().parent.parent / "assets" / "brand" / "azimut.svg"
AZIMUT_LOGO_SIZE = (614, 127)
#: What the check before export says about a picture the note shows and nobody set.
NOT_SET = {
    MY_LOGO: "No logo set in Settings › Publishing.",
    MY_SIGNATURE: "No signature set in Settings › Publishing.",
}
NO_NAME = "No name set in Settings › Publishing for the signature."
EMPTY_COVER = "Your own cover page is empty: write it above a line <!-- cover -->."

#: An inline code span, which keeps its braces as typed.
CODE_SPAN = re.compile(r"(`+)(.+?)(?<!`)\1(?!`)")
#: What a placeholder's value has escaped, so a title with a star or a bracket in
#: it prints as itself rather than as emphasis or a link.
MARKUP = re.compile(r"([\\`*_\[\]<>~])")
#: Stands for an empty placeholder until the punctuation around it is settled.
EMPTY = "\x00"
#: What joins a placeholder to its neighbour on a line: `{role}, {organisation}`.
#: Not `|`, which is a table's.
JOIN = r"[ \t]*[,;:·/–—-]+[ \t]*"
JOIN_AFTER = re.compile(re.escape(EMPTY) + JOIN)
JOIN_BEFORE = re.compile(JOIN + re.escape(EMPTY))
SPACES = re.compile(r"(?<=\S)[ \t]{2,}(?=\S)")
WORD = re.compile(r"\w")
#: A line that opens a block of its own, which a paragraph ends before (as does a
#: chapter line, whose number names where the chapter prints).
BLOCK_START = re.compile(r"^(?:#{1,6}(?:[ \t]|$)|:::)")
COMMENTS = re.compile(r"<!--.*?-->", re.S)
ALIGN_LINE = re.compile(r"^[ \t]*:::")


def _one_line(value: object) -> str:
    return " ".join(value.split())[:MAX_IDENTITY] if isinstance(value, str) else ""


#: Where a document's credit sends its reader, and what it says: the app and its version.
AZIMUT_SITE = "https://github.com/OsintMeThat/azimut"
MADE_WITH = f"Made with Azimut {__version__}"
#: An X account as Settings › Publishing keeps it (`@name`, the @ optional): what a handle must
#: be for its words to link to the account. Another platform's handle (a Bluesky domain) shows
#: unlinked.
X_HANDLE = re.compile(r"@?([A-Za-z0-9_]{1,15})")


def site_of(value: object) -> str:
    """A site's address as Settings keeps it, checked as a web folder's address is; "" for none."""
    from .notes_web import NotesWebError, address

    try:
        return address(value if isinstance(value, str) else "")
    except NotesWebError:
        return ""


@dataclass(frozen=True)
class Identity:
    """Who signs a report, and where their pictures are on this machine."""

    name: str = ""
    role: str = ""
    organisation: str = ""
    logo: Path | None = None
    signature: Path | None = None
    #: The analyst's own site, as Settings › Publishing › Website keeps it, which their name and
    #: logo link to wherever a document shows them; "" while none is set, both then unlinked.
    site: str = ""
    #: The account handle Settings › Publishing stamps on proofs (`@name`), which a map page's
    #: header shows beside the name; "" while none is set.
    handle: str = ""
    #: Whether a document ends on `MADE_WITH`, linked to `AZIMUT_SITE` (Settings › Publishing).
    credit: bool = False
    #: Whether it is someone else who signs (`written_by`): no logo of the analyst's stands by their name.
    guest: bool = False

    @classmethod
    def from_settings(cls) -> "Identity":
        settings = config.load_settings()
        name, role, organisation = (_one_line(settings.get(key)) for key in IDENTITY_KEYS)
        logo, signature = config.signature_path(), config.report_signature_path()
        return cls(
            name, role, organisation,
            logo=logo if logo.is_file() else None,
            signature=signature if signature.is_file() else None,
            site=site_of(settings.get("report_site")),
            handle=_one_line(settings.get("signature_handle")),
            credit=settings.get("report_credit_azimut") is True,
        )

    def written_by(self, author: str) -> "Identity":
        """Who signs a note someone else wrote (`NoteLook.author`): their name alone. The analyst's
        role, organisation, logo, handwritten signature, site and handle are the analyst's and stay
        off it, so their logo never stands by another's name; the credit stays. Itself while
        ``author`` is ""."""
        if not author:
            return self
        return replace(self, name=author, role="", organisation="", logo=None, signature=None, site="", handle="",
                       guest=True)

    def values(self, day: date) -> dict[str, str]:
        """Every placeholder but `{title}`, which is each note's own."""
        return {"date": long_date(day), "name": self.name, "role": self.role, "organisation": self.organisation}

    def byline(self) -> str:
        """`By Name, Role · Organisation`, or "" with no name to sign with."""
        if not self.name:
            return ""
        said = f"By {self.name}"
        if self.role:
            said += f", {self.role}"
        return f"{said} · {self.organisation}" if self.organisation else said

    def credentials(self) -> str:
        """The line under a signature: `Role · Organisation`, either alone, or ""."""
        return " · ".join(part for part in (self.role, self.organisation) if part)

    def handle_url(self) -> str:
        """The X account the handle names, or "" when it is not an X handle."""
        found = X_HANDLE.fullmatch(self.handle)
        return f"https://x.com/{found.group(1)}" if found else ""

    def picture(self, name: str) -> Path | None:
        """The file one of the three pictures is, or None while it is not set."""
        if name == LOGO:
            return AZIMUT_LOGO
        return self.logo if name == MY_LOGO else self.signature if name == MY_SIGNATURE else None


def signing(look: "NoteLook", identity: Identity | None = None) -> tuple[Identity, "NoteLook"]:
    """Who signs a note wherever it is exported or read (the PDF, the Page preview, an HTML file, a
    web folder, a map page, a WordPress draft, the text its editions compare) and the look it is laid
    out in: ``identity``, else this machine's Settings, but a note someone else wrote
    (`NoteLook.author`) by their name alone (`Identity.written_by`), under its title unless the look
    signs it at the end. The one rule they all share."""
    found = identity if identity is not None else Identity.from_settings()
    if not look.author:
        return found, look
    return found.written_by(look.author), look if look.signed else look.model_copy(update={"signed": "title"})


def case_picture(case: "Case", entity_id: str) -> Path | None:
    """The file of a case picture a look names (for the site's list, beside its author's name), None
    when it is no picture there any more."""
    record = case.get_entity(entity_id)
    attrs = (record or {}).get("attrs") or {}
    if not record or not attrs.get("path") or attrs.get("kind") in ("video", "audio"):
        return None
    try:
        path = case.resolve_inside(str(attrs["path"]))
    except Exception:
        return None
    return path if path.is_file() else None


def picture_name(source: str) -> str | None:
    """`logo` for `azimut:logo`, and so on; None for any other address."""
    parts = urlsplit(source)
    if parts.scheme != "azimut" or parts.netloc or parts.query or parts.fragment:
        return None
    return parts.path if parts.path in PICTURES else None


def picture_file(name: str) -> Path | None:
    """Where one of the three pictures is right now, for the route that shows it."""
    return Identity.from_settings().picture(name) if name in PICTURES else None


# -- placeholders --------------------------------------------------------------


def fill(text: str, values: Mapping[str, str], on_empty: Callable[[str, int], None] | None = None) -> str:
    """``text`` with its placeholders filled, outside fenced and inline code.

    A line an empty placeholder leaves wordless is taken out, and a blank line is
    given back where its paragraph ends, so every line after that paragraph keeps
    its number. A hard break (`\\`) left at the end of the paragraph by a line taken
    out after it goes too, or it would print. ``on_empty`` hears each empty
    placeholder with its line.
    """
    if "{" not in text:
        return text
    out: list[str] = []
    owed = 0
    trailing = False  # the lines taken out since the last kept one closed a paragraph
    fenced = False

    def settle() -> None:
        nonlocal owed, trailing
        if not owed:
            return
        if trailing and out:
            last = out[-1].rstrip(" \t")
            if (len(last) - len(last.rstrip("\\"))) % 2:
                out[-1] = last[:-1].rstrip(" \t")
        out.extend([""] * owed)
        owed, trailing = 0, False

    for number, line in enumerate(text.split("\n")):
        if FENCE.match(line):
            settle()
            fenced = not fenced
            out.append(line)
            continue
        if fenced:
            out.append(line)
            continue
        if not line.strip() or BLOCK_START.match(line) or INCLUDE.match(line):
            settle()
        filled, emptied = _fill_line(line, values, number, on_empty)
        if emptied:
            owed += 1
            trailing = True
            continue
        out.append(filled)
        trailing = False
    settle()
    return "\n".join(out)


def _fill_line(
    line: str, values: Mapping[str, str], number: int, said: Callable[[str, int], None] | None
) -> tuple[str, bool]:
    """One line filled, and whether an empty placeholder left it with no word."""
    if "{" not in line:
        return line, False
    empty = False

    def put(match: re.Match[str]) -> str:
        nonlocal empty
        key = match.group(1)
        value = " ".join(values.get(key, "").split())
        if value:
            return MARKUP.sub(r"\\\1", value)
        empty = True
        if said is not None:
            said(key, number)
        return EMPTY

    parts: list[str] = []
    at = 0
    for span in CODE_SPAN.finditer(line):
        parts.append(PLACEHOLDER.sub(put, line[at:span.start()]))
        parts.append(span.group(0))
        at = span.end()
    parts.append(PLACEHOLDER.sub(put, line[at:]))
    filled = "".join(parts)
    if not empty:
        return filled, False
    filled = JOIN_BEFORE.sub("", JOIN_AFTER.sub("", filled)).replace(EMPTY, "")
    filled = SPACES.sub(" ", filled)
    return filled, WORD.search(filled) is None


# -- the own cover ---------------------------------------------------------------


@dataclass
class Cover:
    """A note cut at its cover line: the lines above it, the note with those and the
    line itself blanked (so a line number read from it still holds), and the line."""

    text: str
    body: str
    line: int


def split_cover(text: str) -> Cover | None:
    """The note cut at its first `<!-- cover -->` outside a fence, or None without one."""
    lines = text.split("\n")
    fenced = False
    for number, line in enumerate(lines):
        if FENCE.match(line):
            fenced = not fenced
        elif not fenced and COVER_LINE.match(line):
            above = lines[:number]
            return Cover("\n".join(above), "\n".join([""] * (number + 1) + lines[number + 1:]), number)
    return None


def cover_text(text: str) -> str:
    """The lines above the cover line as the page prints them: a chapter line has no
    place on a cover, so it is blanked rather than printed as its brackets."""
    lines = text.split("\n")
    fenced = False
    for number, line in enumerate(lines):
        if FENCE.match(line):
            fenced = not fenced
        elif not fenced and INCLUDE.match(line):
            lines[number] = ""
    return "\n".join(lines)


def prints_anything(text: str) -> bool:
    """Whether a cover's lines hold anything to print once comments and the
    alignment lines around them are set aside."""
    return any(line.strip() and not ALIGN_LINE.match(line) for line in COMMENTS.sub("", text).split("\n"))
