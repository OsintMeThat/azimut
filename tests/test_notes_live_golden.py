"""A live map changes nothing but the web folder that asks for it.

The live map (MapLibre on OpenFreeMap, `notes_html_assets/reader.live.js`) is the web
folder's alone. The single HTML file stays one offline file, and a folder whose maps the
analyst keeps offline is the folder it was before. This holds both to a fingerprint
taken from the engine before the live map existed: a note with a paragraph, a picture
and a map, as an article and as a story, laid out as one file and as a folder.

**What the fingerprint reads.** The page as written, with three things set aside: the
reader's own script (`reader.js` with its map part spliced in), whose offline behaviour
the reader's own suite holds (`frontend/src/lib/notes/htmlReaderMap.test.js`) and which
learned to hand a map over to a live one; the bytes of every `data:` address (a picture
or a font subset, encoded by libraries free to compress the same input differently on
another OS); and the content hash in a folder file's name. What is left is every tag,
attribute, word, style rule and the page's policy.

**When it fails.** The single file or the offline folder changed. If that is meant,
the digests are taken again with ``_digests`` on the commit before and after, and the
difference read for its reason.
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import pytest

from azimut.engine import notefill, notes_html, notes_maps, notes_web
from azimut.engine.notelook import NoteLook

from test_notes_maps import _fixture_map
from test_notes_pdf_golden import CREATED, golden_case

TEXT = """# The front

The line moved twice in October, then went.

![The roof](/files/demo/media/roof.png)

::: map
title: The line
layer: Front
ground: e_ground1
:::

What the map shows, said after it.
"""

LOOKS = {"article": NoteLook(), "story": NoteLook.model_validate({"web": "story"})}

#: Taken at 0e0a2ba, the commit before the live map, then again each time the reader's own
#: style sheet changed and nothing else did (read line by line): charts appended their section,
#: then the annexes theirs, then charts and infographics moved to sheets of their own that only
#: a page holding one carries, then a table that fits stopped being a frame of its own on a phone,
#: then a story's picture rules stopped reaching a picture wall's frames and its cards let a press
#: through to the stage.
#: 2026-11-20: a map's tools gained the whole screen as a group of their own, the timeline names a day
#: only where it has room, and the whole screen's own rules came in, all in reader.map.css; nothing else.
#: 2026-11-20: the reader's sheet gained the byline's and the signature's rules (eight lines); nothing else.
#: 2026-11-20, web maps: a feature's card gained its facts, rows, history and place, its words fold as
#: one, a line wears no halo until pointed at and a mark's name is set lighter, as the app's map draws
#: them; fifteen lines of reader.map.css, read line by line, and nothing else. Both changes together,
#: on the merged branch, are those twenty-three lines and nothing else.
#: 2026-11-20: a map step's words under its name, on its story card and under the row of steps: four
#: lines of reader.map.css, nothing else.
#: 2026-11-20: the analyst's name and logo link to their Website: four lines of reader.css, nothing else.
#: 2026-11-20: the whole screen's clip spares the live map's own marks: one selector of reader.map.css, nothing else.
#: 2026-11-20: a footer's Made with Azimut line: two lines of reader.css, nothing else.
GOLDEN = {
    "single-article": "8f0195d08cb740a06ccbdaad58d37eaf0b1add7fa7f28274a77f44d0a568976e",
    "single-story": "87f1687a649dbe6ad5b31220b440d89daf8677670ed2e0c90e8fd84afaa1a992",
    "folder-article": "026fafca16ccc6895c755d279a69a8cc0c89d20459b62e34ba6a6414656a321d",
    "folder-story": "5513099a9e816191c48c5046a958b58057ace1612b2ea14e713b10404218fc8e",
}


def _fingerprint(page: str) -> str:
    page = re.sub(r"<script>.*?</script>", "<script>READER</script>", page, flags=re.S)
    page = re.sub(r"data:([\w/+.-]+);base64,[A-Za-z0-9+/=]+", r"data:\1;base64,…", page)
    page = re.sub(r"assets/[0-9a-f]{8,16}-", "assets/…-", page)
    return hashlib.sha256(page.encode("utf-8")).hexdigest()


def _render(tmp_path: Path, look: NoteLook, *, folder: bool) -> str:
    case = golden_case(tmp_path)
    made = notes_html.Folder(csp=notes_web.folder_csp()) if folder else None
    rendered = notes_html.render(case, title="The front", text=TEXT, look=look, public=True, created=CREATED,
                                 identity=notefill.Identity(), folder=made)
    page = rendered.html.decode("utf-8")
    if made is None:
        return page
    # a folder's style sheet is a file of its own, read with the page
    sheets = [data.decode("utf-8") for path, data in made.files.items() if path.endswith(".css")]
    return page + "".join(f"\n<!-- {sheet} -->" for sheet in sheets)


def _digests(tmp_path: Path) -> dict[str, str]:
    found = {}
    for kind in ("single", "folder"):
        for name, look in LOOKS.items():
            found[f"{kind}-{name}"] = _fingerprint(_render(tmp_path / f"{kind}-{name}", look, folder=kind == "folder"))
    return found


@pytest.fixture()
def fixed_map(monkeypatch):
    """The map the reader's tests read (`mapFigure.fixture.html`), whatever the case holds."""
    monkeypatch.setattr(notes_maps, "derive", lambda *args, **kwargs: _fixture_map())


@pytest.mark.parametrize("name", sorted(GOLDEN))
def test_the_single_file_and_an_offline_folder_are_as_they_were(tmp_path, fixed_map, name):
    kind, look = name.split("-")
    page = _render(tmp_path, LOOKS[look], folder=kind == "folder")
    # nothing of a live map: no base map host, no MapLibre file and nothing naming one; the reader's
    # own script may say where a live map would come from, and is held by its own tests
    markup = re.sub(r"<script>.*?</script>", "", page, flags=re.S)
    assert "openfreemap" not in markup and "maplibre" not in markup.lower() and 'id="az-gl"' not in markup
    found = _fingerprint(page)
    if found != GOLDEN[name]:
        kept = tmp_path / f"{name}.html"
        kept.write_text(page, encoding="utf-8")
        pytest.fail(f"the {name} page is no longer what it was; see {kept}")
