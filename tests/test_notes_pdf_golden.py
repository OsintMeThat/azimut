"""A note without a look prints exactly as it did before looks existed.

The Report Builder gave notes a look (a style, a cover, a table of contents),
and the promise that came with it is that a note nobody touched keeps the
document it always had. This is the net under that promise: a handful of old
notes covering every block the renderer draws, rendered with no look, compared
against a fingerprint taken from the engine *before* looks were added.

**Why a digest of the page drawing and not the PDF bytes.** The bytes hold
zlib-compressed streams, and zlib is free to compress the same input
differently from one build to another (CI runs three OSes and two Pythons). The
fingerprint is instead each page's content stream, decompressed: every glyph,
position, line, fill and picture placement the page draws, in order, and
nothing a compressor or a clock chose. One SHA-256 per note keeps the fixture a
few lines long instead of a folder of PDFs.

**When it fails.** Either the change touched the plain document (then it is a
regression, and the red line says fix it), or a pinned dependency that lays
text out (fpdf2, uharfbuzz, fonttools) moved. The failing PDFs are written to
the test's temporary folder, named in the message, so they can be opened side
by side with ones rendered from the previous commit. Only in the second case
are the digests regenerated, by running this module's ``_digests`` from the
previous commit and the new one and checking they differ for that reason only.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

from PIL import Image
from pypdf import PdfReader

import pytest

from azimut.engine import notes_pdf
from azimut.engine.notelook import NoteLook

from test_notes_pdf import FakeCase, pdf_text, png

# -- the notes -----------------------------------------------------------------

EVERYTHING = """# Everything

Setext heading
==============

A paragraph with **bold**, *italic*, ***both***, `inline code`, ~~struck~~, a
[link](https://example.org) and a hard break
right here. It cites [[entity:live|The roof]] and [[entity:gone|A deleted one]].

Second level, setext
--------------------

::: center
A centred line, **bold inside** that gives up its styling.
:::

::: right
Right aligned.
:::

> [!confirmed] The mast matches the one in frame 12.
> Second line of the callout.

> [!unverified]
> Seen in one source only.

> [!lead] Ask the port authority.

> [!note] Background only.

> [!warning] Do not publish the face.

> A plain quote, with a [[entity:live|reference]].
>
> > And a nested one.

> [!unknown] An unknown kind keeps its marker.

| Site | Distance | Remark |
|---|---:|:---:|
| Roof | 120 m | seen from the **north** |
| Mast | 1.4 km | |
| Quay | 3 km | a much longer remark that has to wrap inside its own column |

- [x] Matched the skyline
- [ ] Check the date
  - nested bullet
    - deeper still
  - back one level
- plain item

1. first
2. second
   1. nested ordered
3. third

```python
def bearing(a, b):
    return (b - a) % 360  # indentation is the meaning
```

    indented code block

<div class="aside">Raw HTML, shown as text.</div>

<!-- an HTML comment the preview hides -->

Inline <b>html</b> in a sentence.

***

### Heading three
#### Heading four
##### Heading five
###### Heading six

Last line.
"""

PICTURES = """# Pictures

![roof](/files/demo/media/roof.png)

![half](/files/demo/media/roof.png){width=50% align=center}

![fixed](/files/demo/media/wide.png "A captioned picture"){width=300px align=right}

[[media:m1|Frame 12]]{width=70% align=center}

[[media:m1|Frame 12 again]]

[[media:v1|Clip]]

[[media:gone|Lost]]

![far](https://example.org/x.png)

An inline ![roof](/files/demo/media/roof.png) picture inside text.

## Heading kept with its picture

![tall](/files/demo/media/tall.png)

Closing paragraph.
"""

DIAGRAM = """# Diagram

Before the diagram.

```mermaid
flowchart LR
  A[Tip] --> B[Check]
  B --> C[Confirmed]
```

After it.
"""

SCRIPTS = """# Scripts

The sign reads مرحبا بالعالم on the left wall, then continues in English.

ကျွန်ုပ်တို့သည် ရန်ကုန်မြို့တွင် ရှိသည်။ A Burmese line, then Latin.

Русский текст, Ελληνικά, 中文, 한국어 → ✓
"""

LONG = "# Long\n\n" + "\n\n".join(
    [
        f"## Section {n}\n\n" + ("A sentence that fills the page with words. " * 18)
        + f"\n\n> [!lead] Lead {n} runs on.\n> " + ("More text in the callout. " * 6)
        + "\n\n```\n" + "\n".join(f"line {n}.{k} = {k * k}" for k in range(14)) + "\n```"
        for n in range(1, 7)
    ]
)

NOTES: dict[str, tuple[str, str]] = {
    "everything": ("Everything", EVERYTHING),
    "pictures": ("Pictures", PICTURES),
    "diagram": ("Diagram", DIAGRAM),
    "scripts": ("Scripts", SCRIPTS),
    "long": ("Long", LONG),
    "empty": ("Empty", "   \n"),
}

#: The fingerprint of each note above, taken from the engine before looks existed
#: (the PDFs were also byte-identical then, with the creation date pinned).
#: One deliberate change since: "everything" no longer prints its HTML comment,
#: which every other Markdown reader hides and which could carry a private
#: remark into a shared PDF. Nothing else on its pages moved.
#:
#: The sources pass (`engine/notesources.py`, the list of sources being off for
#: plain) left these digests as they were, text and links alike when checked
#: against the engine before it. Its deliberate change to plain documents is
#: elsewhere, in credits the case could always have given and never printed: a
#: picture made in the case (an Inspect frame, a collage, a proof, a video made
#: from another) now credits what it was made from (`Source: x.com`, `+1` for
#: more), Compare and Detect pictures say both imagery days, a Horizon picture
#: credits its terrain, and an extension capture names its imagery and day where
#: it said only the page's host. A link to an anchor in the note, which made the
#: whole PDF fail, now prints as its words.
#:
#: One more, asked by the owner: a picture with no width written stays within half
#: the page down (`notes_pdf.UNSIZED_SHARE`), so "pictures"' tall unsized picture is
#: half a page rather than a whole one, and its closing paragraph comes up onto the
#: same page (four pages became three). Nothing else on its pages moved, checked by
#: drawing both engines' pages side by side.
#:
#: One more, with the report signature and the own cover page, which set their lines
#: in `::: right` and `::: center` blocks: a paragraph in an aligned block keeps its
#: styling, links, chips and `[n]` (`_aligned_runs`), where it used to print as one
#: plain string. In "everything" the centred line's **bold inside** is now bold, at
#: the same place; "Right aligned." and every other line, and every other note, are
#: unchanged, checked against the previous engine's pages drawn at 60 and 150 dpi.
GOLDEN: dict[str, str] = {
    "everything": "ec8b993d2bf254585eca3e608da045aaf1e2cd9d050b8644057ac1bace6386a2",
    "pictures": "38cc6b1916f4fb155126d93764d9db3b4f355213945bb5c298555889fee08f33",
    "diagram": "a9d3c0d75d5b35847ba113821079551d98758666f65bcd877962a249bb0fc307",
    "scripts": "90b7ddb4b5b86c93dd54fba2e2e84698e24e6f7534d3da3d86980b0698cdf1b0",
    "long": "b660d41e2adab570958604feea044f53f455f319f8366895ab2e10cf185da194",
    "empty": "fcdcaddb3e3f3857aa7e80589bcac884f203fe7851b7603467860a76aaee19d6",
}

#: Any fixed instant: the date is the one thing in the file a clock chooses.
CREATED = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)

# -- the case they live in -------------------------------------------------------


def golden_case(tmp_path: Path) -> FakeCase:
    """The pictures the notes point at, drawn rather than shipped."""
    png(tmp_path, "media/roof.png", size=(400, 300), color="#4a5a6a")
    png(tmp_path, "media/wide.png", size=(1200, 300), color="#7a5a3a")
    png(tmp_path, "media/tall.png", size=(400, 2400), color="#2a6a4a")
    png(tmp_path, "media/frame.png", size=(640, 360), color="#6a2a4a")
    return FakeCase(
        tmp_path,
        {
            "live": {"id": "live", "label": "The roof", "type": "place", "attrs": {}},
            "m1": {
                "id": "m1",
                "label": "Frame",
                "type": "capture",
                "attrs": {"path": "media/frame.png", "kind": "image"},
            },
            "v1": {
                "id": "v1",
                "label": "Clip",
                "type": "media",
                "attrs": {"path": "media/clip.mp4", "kind": "video"},
            },
            "gone": {"id": "gone", "label": "Lost", "type": "media", "attrs": {}},
        },
    )


def _diagram_png() -> bytes:
    buffer = BytesIO()
    Image.new("RGB", (600, 200), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def drawing(pdf: bytes) -> bytes:
    """Every page's content stream, decompressed, in page order."""
    reader = PdfReader(BytesIO(pdf))
    parts = [f"pages={len(reader.pages)}".encode()]
    for page in reader.pages:
        contents = page.get_contents()
        data = contents.get_data() if contents is not None else b""
        parts.append(data)
    return b"\n--page--\n".join(parts)


def render_plain(case: FakeCase, name: str, look: NoteLook | None = None) -> bytes:
    title, text = NOTES[name]
    return notes_pdf.render(case, title=title, text=text, look=look, created=CREATED).pdf


def _digests(tmp_path: Path) -> dict[str, str]:
    case = golden_case(tmp_path)
    return {
        name: hashlib.sha256(drawing(render_plain(case, name))).hexdigest()
        for name in NOTES
    }


@pytest.mark.parametrize("name", sorted(NOTES))
def test_a_note_without_a_look_prints_as_it_always_did(tmp_path, name):
    case = golden_case(tmp_path / "case")
    for look in (None, NoteLook(), NoteLook.model_validate({"style": "plain", "cover": {}}),
                 NoteLook.model_validate({"font": "", "size": ""}), NoteLook.model_validate({"web": "story"})):
        pdf = render_plain(case, name, look)
        digest = hashlib.sha256(drawing(pdf)).hexdigest()
        if digest != GOLDEN[name]:
            kept = tmp_path / f"{name}.pdf"
            kept.write_bytes(pdf)
            pytest.fail(f"the plain {name!r} note no longer prints as it did; see {kept}")


def test_the_fingerprint_reads_the_drawing_not_the_file(tmp_path):
    """Two renders a second apart differ in their bytes (the creation date) and
    agree on what they draw, so the digest is the page and not the file."""
    case = golden_case(tmp_path)
    title, text = NOTES["everything"]
    first = notes_pdf.render(case, title=title, text=text, created=CREATED).pdf
    later = notes_pdf.render(case, title=title, text=text,
                             created=CREATED.replace(second=59)).pdf
    assert first != later
    assert drawing(first) == drawing(later)


# -- written links that find what the case holds ---------------------------------------
#
# A written link finds the item the case holds at its address (`urltitles.AddressIndex`)
# and prints that item's entry. A case holding nothing at the notes' addresses changes
# nothing: the goldens above, and a styled note's drawing, are the same with an index of
# unrelated items as with no index at all. One note whose links do find their items is
# pinned below, from the engine that made them find them.


class IndexedCase(FakeCase):
    """A case that lists its items, as the address index reads them."""

    def page_entities(self, *, limit=100, cursor=None, types=None, **_):
        rows = [row for row in self._entities.values() if not types or row.get("type") in types]
        return {"items": rows, "next_cursor": None}


UNRELATED = {
    "elsewhere": {"id": "elsewhere", "type": "bookmark", "label": "Elsewhere",
                  "attrs": {"url": "https://example.net/elsewhere", "fetched_at": "2026-01-01T00:00:00Z"},
                  "provenance": {"at": "2026-01-01T00:00:00Z"}},
}

LINKED = """# Linked

The port authority [closed berths 10 to 14](https://www.port.example.org/notices/13#:~:text=berths)
the day after [the strike was posted](https://twitter.com/port_watch/status/1899?s=20), which
[a page the case never kept](https://news.example.com/strike) reported too.
"""

LINKED_ITEMS = {
    "notice": {"id": "notice", "type": "bookmark", "label": "Port authority notice",
               "attrs": {"url": "https://port.example.org/notices/13", "fetched_at": "2026-03-13T07:00:00Z",
                         "archive_url": "https://web.archive.org/web/20260313091500/https://port.example.org/notices/13"},
               "provenance": {"at": "2026-03-13T07:00:00Z"}},
    "post": {"id": "post", "type": "media", "label": "Strike on the port",
             "attrs": {"path": "media/strike.png", "kind": "image", "source_url": "https://x.com/port_watch/status/1899"},
             "provenance": {"at": "2026-03-13T08:00:00Z"}},
}

#: `LINKED` in a report, its first two links finding the bookmark and the file above.
LINKED_GOLDEN = "f3f6622c516cd5bb8bc1eace78e2fef099f8cc424351e5860c5efbf72894e0fb"


@pytest.mark.parametrize("name", sorted(NOTES))
def test_a_case_holding_nothing_at_the_notes_addresses_changes_nothing(tmp_path, name):
    plain = golden_case(tmp_path / "plain")
    indexed = IndexedCase(plain.path, {**plain._entities, **UNRELATED})
    assert hashlib.sha256(drawing(render_plain(indexed, name))).hexdigest() == GOLDEN[name]
    styled = NoteLook.model_validate({"style": "report"})
    assert drawing(render_plain(indexed, name, styled)) == drawing(render_plain(plain, name, styled))


def test_a_note_whose_links_find_their_items_prints_their_entries(tmp_path):
    png(tmp_path, "media/strike.png", size=(320, 180), color="#6a2a4a")
    case = IndexedCase(tmp_path, {**LINKED_ITEMS, **UNRELATED})
    pdf = notes_pdf.render(case, title="Linked", text=LINKED, look=NoteLook.model_validate({"style": "report"}),
                           created=CREATED).pdf
    annex = "".join(pdf_text(pdf).split("\nSources\n")[1].split())
    assert "[1]Portauthoritynotice·Webpage·port.example.org·collected13March2026" in annex
    assert "Archive:https://web.archive.org/web/20260313091500/" in annex
    assert "[2]Strikeontheport·Picture·x.com·collected13March2026" in annex
    assert "[3]apagethecaseneverkept·Webpage·news.example.com" in annex
    digest = hashlib.sha256(drawing(pdf)).hexdigest()
    if digest != LINKED_GOLDEN:
        kept = tmp_path / "linked.pdf"
        kept.write_bytes(pdf)
        pytest.fail(f"the linked note no longer prints as it did ({digest}); see {kept}")
