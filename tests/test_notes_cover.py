"""A first page of one's own, the placeholders a note fills when it prints, and the
three pictures every note can show (`engine/notefill.py`).

The red line under all of it: a note whose look does not ask for its own page, and
whose text holds no placeholder, prints exactly as before (`test_notes_pdf_golden.py`
holds the plain document; the tests here hold the style's cover and Off).
"""

from __future__ import annotations

import base64
import os
import re
import sys
from datetime import datetime
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut import config
from azimut.engine import notefill, notelook, notes_pdf
from azimut.engine.notelook import NoteLook, TemplateLook

from test_notes_pdf import FakeCase

CREATED = datetime(2026, 11, 5, 12, 0)

COVER = """::: center
![Azimut](azimut:logo){width=25% align=center}

# {title}

<!--? A line under the title: what this report is -->

{date}
:::
<!-- cover -->
## Summary

The body starts here.
"""

SIGNATURE = """## Findings

The mast matches.

::: right
![Signature](azimut:my-signature){width=30% align=right}

**{name}**\\
{role}, {organisation}\\
{date}
:::
"""


def look(**values) -> NoteLook:
    return NoteLook.model_validate(values)


def own(**values) -> NoteLook:
    cover = {"on": True, "mode": "own", **values.pop("cover", {})}
    return look(cover=cover, **values)


def a_png(path: Path, size=(300, 120)) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGBA", size, (30, 60, 120, 255)).save(path)
    return path


def png_data(size=(300, 120)) -> bytes:
    buffer = BytesIO()
    Image.new("RGBA", size, (30, 60, 120, 255)).save(buffer, "PNG")
    return buffer.getvalue()


def who(tmp_path: Path | None = None, *, logo=False, signature=False, **values) -> notefill.Identity:
    return notefill.Identity(
        **values,
        logo=a_png(tmp_path / "logo.png") if logo and tmp_path else None,
        signature=a_png(tmp_path / "signature.png") if signature and tmp_path else None,
    )


def render(text, *, the_look=None, identity=None, case=None, title="Port strike", **kwargs):
    return notes_pdf.render(case, title=title, text=text, look=the_look, identity=identity or who(),
                            created=CREATED, **kwargs)


def squash(text: str) -> str:
    return re.sub(r"\s+", "", text)


def pages(data: bytes) -> list[str]:
    return [page.extract_text() for page in PdfReader(BytesIO(data)).pages]


def kinds(out) -> list[tuple[str, int | None, str]]:
    return list(zip(out.warnings, out.warning_lines, out.warning_kinds))


# -- the look ------------------------------------------------------------------------


def test_the_cover_s_new_keys_are_written_only_once_they_are_set():
    assert notelook.COVER_LATE_KEYS == ("mode", "top")
    assert look(cover={"on": True}).model_dump(mode="json")["cover"] == {
        "on": True, "subtitle": "", "image": "", "date": "",
    }
    stored = own(cover={"top": True}).model_dump(mode="json")["cover"]
    assert stored["mode"] == "own" and stored["top"] is True
    assert own().cover.own and not look(cover={"mode": "own"}).cover.own
    assert not look(cover={"on": True}).cover.own


def test_a_look_from_a_later_azimut_keeps_its_cover_but_its_unknown_mode():
    parsed = notelook.parse({"style": "report", "cover": {"on": True, "mode": "poster", "subtitle": "Kept"}})
    assert parsed is not None
    assert parsed.style == "report" and parsed.cover.on and parsed.cover.subtitle == "Kept"
    assert parsed.cover.mode == ""


def test_a_template_s_look_can_ask_for_its_own_page_and_round_trips(client):
    data = {"body": COVER, "look": {"style": "report", "cover": {"on": True, "mode": "own"}}}
    saved = client.post("/api/templates/note", json={"name": "Report", "data": data})
    assert saved.status_code == 200, saved.text
    listed = client.get("/api/templates").json()["note"][0]["data"]
    assert listed["look"]["cover"] == {"on": True, "subtitle": "", "image": "", "date": "", "mode": "own"}
    assert listed["body"] == COVER
    # a template whose cover is the style's writes neither new key
    plain = {"body": "x", "look": {"style": "report", "cover": {"on": True}}}
    client.post("/api/templates/note", json={"name": "Old", "data": plain})
    old = client.get("/api/templates").json()["note"][1]["data"]
    assert old["look"]["cover"] == {"on": True, "subtitle": "", "image": "", "date": ""}
    assert TemplateLook.model_validate(listed["look"]).cover.own


# -- the own cover page ----------------------------------------------------------------


@pytest.mark.parametrize("style", ["plain", "report", "brief", "journal"])
@pytest.mark.parametrize("page", ["a4", "letter"])
def test_the_own_cover_prints_alone_on_page_one_with_its_tlp_label(style, page):
    out = render(COVER, the_look=own(style=style, page=page, tlp="amber"))
    first, second = pages(out.pdf)[:2]
    assert "Port strike" in first and "5 November 2026" in first
    assert "The body starts here." not in first and "The body starts here." in second
    # no running header, footer or page number on it, and the label at its top and foot
    assert first.count("TLP:AMBER") == 2
    for furniture in ("REPORT", "BRIEF", "LOG", "AZIMUTNOTES"):
        assert furniture not in squash(first).upper()
    assert not re.search(r"Page \d", first)
    assert out.pages[1] == COVER.split("\n").index("<!-- cover -->") + 1
    assert out.warnings == []


def test_the_own_cover_page_has_no_footer_in_plain_either():
    out = render(COVER, the_look=own())
    first = pages(out.pdf)[0]
    # the plain footer is the note's name over its page number
    assert first.strip().splitlines()[-1].strip() == "5 November 2026"
    assert pages(out.pdf)[1].rstrip().endswith("2")


def test_without_tlp_the_own_cover_shows_no_label():
    assert "TLP" not in pages(render(COVER, the_look=own(style="report")).pdf)[0]


def logo_top(out) -> float:
    return next(picture.box[1] for picture in out.pictures if picture.ref == "azimut:logo")


def test_the_own_cover_is_centred_down_the_page_unless_it_starts_at_the_top():
    centred = render(COVER, the_look=own(style="report"))
    top = render(COVER, the_look=own(style="report", cover={"top": True}))
    assert logo_top(top) < 0.12
    assert 0.35 < logo_top(centred) < 0.5
    # moved as one: the page's links move with its drawing
    linked = "# {title}\n\n[Port Watch](https://example.org/watch)\n\n<!-- cover -->\nBody.\n"
    for the_look, low, high in ((own(style="report"), 300, 500), (own(style="report", cover={"top": True}), 600, 800)):
        reader = PdfReader(BytesIO(render(linked, the_look=the_look).pdf))
        rect = reader.pages[0]["/Annots"][0].get_object()["/Rect"]
        assert low < float(rect[1]) < high  # points up from the foot


def test_a_cover_too_long_for_a_page_runs_on_bare_and_says_so():
    text = "\n\n".join(f"Line {number} of a long cover." for number in range(80)) + "\n<!-- cover -->\nBody.\n"
    out = render(text, the_look=own(style="report", tlp="red"))
    printed = pages(out.pdf)
    assert "Body." not in printed[0] + printed[1] and printed[1].count("TLP:RED") == 2
    assert not re.search(r"Page \d", printed[0] + printed[1])
    end = text.split("\n").index("<!-- cover -->")
    assert kinds(out) == [("Your own cover page runs over one page.", end, "other")]


def test_the_cover_s_heading_is_set_as_a_cover_title_and_is_no_section():
    out = render(COVER, the_look=own(style="report", numbered=True, toc=True))
    reader = PdfReader(BytesIO(out.pdf))
    titles = [item.title for item in reader.outline if not isinstance(item, list)]
    assert "Port strike" not in " ".join(titles)
    assert "1  Summary" in titles
    assert "1" not in pages(out.pdf)[0].split("Port strike")[0]


def test_the_title_block_gives_way_to_the_own_cover():
    # the report's title block opens on its day in capitals; the running footer has it in words
    assert "5NOVEMBER2026" in squash(pages(render(COVER, the_look=look(style="report")).pdf)[0])
    assert "5NOVEMBER2026" not in squash(pages(render(COVER, the_look=own(style="report")).pdf)[1])


@pytest.mark.parametrize("text", ["No cover line here.\n", "<!--? guidance only -->\n<!-- cover -->\nBody.\n"])
def test_an_own_cover_with_nothing_above_its_line_prints_none_and_says_so(text):
    out = render(text, the_look=own(style="report"))
    assert len(pages(out.pdf)) == 1
    assert "Port strike" in pages(out.pdf)[0]  # the title block is back
    line = 1 if "<!-- cover -->" in text else None
    assert kinds(out) == [(notefill.EMPTY_COVER, line, "other")]


def test_with_the_style_s_cover_or_none_the_lines_above_print_as_text():
    for the_look in (look(style="report", cover={"on": True}), look(style="report")):
        out = render(COVER, the_look=the_look)
        text = "\n".join(pages(out.pdf))
        assert "Port strike" in text and "The body starts here." in text
        assert "cover" not in text.replace("Port strike", "")


def test_the_style_s_cover_is_unchanged_by_this_round():
    the_look = look(style="report", cover={"on": True, "subtitle": "Sub"}, tlp="red")
    text = "# Rooftop\n\nBody.\n"
    before = render(text, the_look=the_look).pdf
    assert render(text, the_look=look(style="report", cover={"on": True, "subtitle": "Sub", "mode": ""}, tlp="red")).pdf == before
    # who signs never reaches a note that holds no placeholder
    assert render(text, the_look=the_look, identity=who(name="A. Analyst", role="Lead")).pdf == before


def test_a_marker_in_code_or_a_quote_is_no_cover_line():
    text = "```\n<!-- cover -->\n```\n\n> <!-- cover -->\n\nBody.\n"
    out = render(text, the_look=own())
    assert kinds(out) == [(notefill.EMPTY_COVER, None, "other")]


def test_an_internal_passage_on_the_cover_stays_out_of_the_public_edition():
    text = "# {title}\n\n> [!internal]\n> Draft for the team.\n\n<!-- cover -->\nBody.\n"
    internal = render(text, the_look=own(style="report"))
    public = render(text, the_look=own(style="report"), public=True)
    assert "Draft for the team." in pages(internal.pdf)[0]
    assert "Draft for the team." not in "\n".join(pages(public.pdf))
    assert internal.internal == public.internal == 1
    assert internal.text_sha256 != public.text_sha256


def test_a_cover_inside_an_internal_passage_is_internal():
    text = "Body first.\n\n> [!internal]\n> ::: right\n> ![Signature](azimut:my-signature)\n> :::\n"
    public = render(text, the_look=look(style="report"), public=True)
    assert not any(picture.ref == "azimut:my-signature" for picture in public.pictures)
    assert public.warnings == []


def test_the_cover_s_citations_are_listed_with_the_body_s():
    text = "# {title}\n\n[Port Watch](https://example.org/watch)\n\n<!-- cover -->\nBody.\n"
    out = render(text, the_look=own(style="report"))
    assert "example.org/watch" in pages(out.pdf)[-1]


# -- placeholders ------------------------------------------------------------------------


def test_placeholders_are_filled_where_they_stand():
    out = render(SIGNATURE, the_look=look(style="report"),
                 identity=who(name="A. Analyst", role="Lead analyst", organisation="Open Watch"))
    text = "\n".join(pages(out.pdf))
    assert "A. Analyst" in text and "Lead analyst, Open Watch" in text and "5 November 2026" in text
    assert "{" not in text


def test_the_date_is_the_cover_s_day_when_the_look_sets_one():
    out = render("{date}\n", the_look=look(cover={"date": "2026-03-12"}))
    assert "12 March 2026" in pages(out.pdf)[0]


@pytest.mark.parametrize(
    ("values", "line"),
    [
        ({"role": "", "organisation": "Open Watch"}, "Open Watch"),
        ({"role": "Lead analyst", "organisation": ""}, "Lead analyst"),
    ],
)
def test_an_empty_placeholder_goes_with_its_punctuation(values, line):
    filled = notefill.fill("{role}, {organisation}", values)
    assert filled == line


def test_a_line_an_empty_placeholder_leaves_wordless_goes_and_the_lines_after_keep_their_number():
    text = "**{name}**\\\n{role}, {organisation}\\\n{date}\n\nAfter."
    filled = notefill.fill(text, {"name": "", "role": "", "organisation": "", "date": "5 November 2026"})
    lines = filled.split("\n")
    assert lines[0] == "5 November 2026"
    assert lines.index("After.") == 4  # where it was
    # and the hard break left at the paragraph's end goes with the lines after it
    ending = notefill.fill("**{name}**\\\n{role}\n\nAfter.", {"name": "Ann", "role": ""})
    assert ending.split("\n")[0] == "**Ann**"
    assert ending.split("\n").index("After.") == 3


def test_a_chapter_line_after_a_line_taken_out_keeps_its_number():
    filled = notefill.fill("Text\n{role}\n[[include:ch]]\nAfter", {"role": ""})
    assert filled.split("\n") == ["Text", "", "[[include:ch]]", "After"]


def test_placeholders_in_code_stay_as_typed_and_values_print_as_themselves():
    text = "```\nf\"{name}\"\n```\n\nInline `{name}` and {name}.\n"
    filled = notefill.fill(text, {"name": "Ann *Lee* [x]"})
    assert 'f"{name}"' in filled and "`{name}`" in filled
    assert "Ann \\*Lee\\* \\[x\\]" in filled
    out = render(text, identity=who(name="Ann *Lee* [x]"))
    assert "Ann *Lee* [x]" in pages(out.pdf)[0]


def test_a_note_without_a_placeholder_is_left_as_it_is():
    text = "A {brace} and {other} stay.\n"
    assert notefill.fill(text, {"name": "", "date": "x"}) == text


def test_a_chapter_s_title_is_its_own():
    resolve = {"ch": ("Chapter note", "Written in {title}.\n")}.get
    out = notes_pdf.render(None, title="Main", text="In {title}.\n\n[[include:ch]]\n", look=look(style="report"),
                           resolve=resolve, identity=who(), created=CREATED)
    text = "\n".join(pages(out.pdf))
    assert "In Main." in text and "Written in Chapter note." in text


def test_no_name_set_is_said_where_the_signature_asks_for_one():
    out = render(SIGNATURE, the_look=look(style="report"))
    assert (notefill.NO_NAME, 7, "setting") in kinds(out)
    assert not any(kind == "setting" for _, _, kind in kinds(render("No name here.\n")))


# -- the three pictures --------------------------------------------------------------------


def test_the_azimut_logo_prints_from_the_app(tmp_path):
    out = render("![Azimut](azimut:logo){width=25%}\n", case=FakeCase(tmp_path))
    [picture] = out.pictures
    assert picture.ref == "azimut:logo" and picture.width == "25%"
    assert out.warnings == []


def test_the_analyst_s_logo_and_signature_print_when_set(tmp_path):
    text = "![Logo](azimut:my-logo){width=25%}\n\n![Signature](azimut:my-signature){width=30% align=right}\n"
    out = render(text, the_look=look(style="report", numbered=True), identity=who(tmp_path, logo=True, signature=True))
    assert [picture.ref for picture in out.pictures] == ["azimut:my-logo", "azimut:my-signature"]
    # no figure number for a logo or a signature
    assert "Figure" not in "\n".join(pages(out.pdf))
    assert out.warnings == []


def test_a_picture_nobody_set_prints_nothing_and_the_check_says_so(tmp_path):
    text = "Before.\n\n![Logo](azimut:my-logo)\n\n![Signature](azimut:my-signature)\n\nAfter.\n"
    out = render(text, case=FakeCase(tmp_path))
    assert out.pictures == []
    assert "Image not included" not in "\n".join(pages(out.pdf))
    assert kinds(out) == [
        ("No logo set in Settings › Publishing.", 2, "setting"),
        ("No signature set in Settings › Publishing.", 4, "setting"),
    ]


def test_the_three_pictures_are_no_sources(tmp_path):
    text = "![Azimut](azimut:logo)\n\n![Logo](azimut:my-logo)\n"
    out = render(text, the_look=look(style="report", sources="on"), case=FakeCase(tmp_path),
                 identity=who(tmp_path, logo=True))
    joined = "\n".join(pages(out.pdf))
    assert "Sources" not in joined
    assert not any(kind == "unsourced" for _, _, kind in kinds(out))


def test_the_logo_shipped_is_the_readme_s_lockup():
    """The PDF's logo and the README's are the same drawing: the mark's two flanks,
    then the six letters, unchanged."""
    root = Path(__file__).resolve().parent.parent
    readme = (root / "docs" / "media" / "lockup-light.svg").read_text(encoding="utf-8")
    shipped = notefill.AZIMUT_LOGO.read_text(encoding="utf-8")

    def drawing(svg: str) -> list[str]:
        return re.findall(r'<(?:g|path)\b[^>]*>', svg)

    assert drawing(shipped) == drawing(readme)
    assert f'viewBox="0 0 {notefill.AZIMUT_LOGO_SIZE[0]} {notefill.AZIMUT_LOGO_SIZE[1]}"' in shipped


def test_only_the_three_names_are_pictures():
    assert [notefill.picture_name(f"azimut:{name}") for name in notefill.PICTURES] == list(notefill.PICTURES)
    for other in ("azimut:other", "azimut://media/logo", "azimut:logo?x=1", "https://e.org/logo", "logo"):
        assert notefill.picture_name(other) is None


# -- the routes ------------------------------------------------------------------------------


def test_the_editor_is_served_the_three_pictures_by_name(client):
    logo = client.get("/api/notes/pictures/logo")
    assert logo.status_code == 200
    assert logo.headers["content-type"].startswith("image/svg+xml")
    assert logo.headers["cache-control"] == "no-cache"
    for name in ("my-logo", "my-signature", "other", "..%2Fsettings.json"):
        assert client.get(f"/api/notes/pictures/{name}").status_code == 404
    client.post("/api/settings/signature", files={"file": ("logo.png", png_data(), "image/png")})
    client.post("/api/settings/report-signature", files={"file": ("sig.png", png_data(), "image/png")})
    for name in ("my-logo", "my-signature"):
        served = client.get(f"/api/notes/pictures/{name}")
        assert served.status_code == 200 and served.headers["content-type"] == "image/png"
        assert served.content == png_data()


def make_case(client) -> str:
    return client.post("/api/cases", json={"name": "Cover case"}).json()["id"]


def test_the_check_before_export_names_what_settings_lacks(client):
    cid = make_case(client)
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Signed", "content": SIGNATURE}).json()
    checked = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note["id"]]}).json()
    said = [(item["text"], item["kind"]) for item in checked["notes"][0]["warnings"]]
    assert ("No signature set in Settings › Publishing.", "setting") in said
    assert (notefill.NO_NAME, "setting") in said

    client.put("/api/settings/prefs", json={"report_name": "A. Analyst"})
    client.post("/api/settings/report-signature", files={"file": ("sig.png", png_data(), "image/png")})
    checked = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [note["id"]]}).json()
    assert checked["notes"][0]["warnings"] == []


def test_the_preview_prints_who_signs_from_settings(client):
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst", "report_organisation": "Open Watch"})
    response = client.post("/api/templates/note/preview", json={"title": "T", "text": SIGNATURE})
    assert response.status_code == 200
    text = "\n".join(pages(response.content))
    assert "A. Analyst" in text and "Open Watch" in text and "," not in text.split("A. Analyst")[1].split("Open Watch")[0]


# -- settings: who signs, and their signature ---------------------------------------------------


def test_who_signs_is_kept_on_one_line_and_bounded(client):
    saved = client.put("/api/settings/prefs", json={"report_name": "  A.\n  Analyst ", "report_role": "Lead"})
    assert saved.status_code == 200
    assert saved.json()["report_name"] == "A. Analyst"
    read = client.get("/api/settings").json()
    assert (read["report_name"], read["report_role"], read["report_organisation"]) == ("A. Analyst", "Lead", "")
    assert client.put("/api/settings/prefs", json={"report_organisation": "x" * 81}).status_code == 422
    assert client.put("/api/settings/prefs", json={"report_organisation": "x" * 80}).status_code == 200


def test_the_handwritten_signature_is_a_small_png_kept_owner_only(client):
    assert client.get("/api/settings").json()["report_signature"] is False
    assert client.post("/api/settings/report-signature",
                       files={"file": ("s.gif", b"GIF89a", "image/gif")}).status_code == 422
    big = config.PNG_MAGIC + b"\0" * config.REPORT_SIGNATURE_MAX_BYTES
    too_big = client.post("/api/settings/report-signature", files={"file": ("s.png", big, "image/png")})
    assert too_big.status_code == 413
    assert too_big.json()["detail"] == "signature must be under 1 MB"
    saved = client.post("/api/settings/report-signature", files={"file": ("s.png", png_data(), "image/png")})
    assert saved.json() == {"report_signature": True}
    path = config.report_signature_path()
    assert path.read_bytes() == png_data()
    if sys.platform != "win32":
        assert os.stat(path).st_mode & 0o777 == 0o600
    assert client.get("/api/settings").json()["report_signature"] is True
    assert client.delete("/api/settings/report-signature").json() == {"report_signature": False}
    assert not path.exists()


def test_the_backup_carries_who_signs_and_their_signature(client):
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst", "report_role": "Lead",
                                            "report_organisation": "Open Watch"})
    client.post("/api/settings/report-signature", files={"file": ("s.png", png_data(), "image/png")})
    bundle = client.get("/api/settings/export").json()
    assert bundle["settings"]["report_name"] == "A. Analyst"
    assert base64.b64decode(bundle["report_signature_png"]) == png_data()

    client.put("/api/settings/prefs", json={"report_name": "", "report_role": "", "report_organisation": ""})
    client.delete("/api/settings/report-signature")
    restored = client.post("/api/settings/import", json=bundle).json()
    assert restored["report_signature"] is True
    assert config.report_signature_path().read_bytes() == png_data()
    read = client.get("/api/settings").json()
    assert (read["report_name"], read["report_role"], read["report_organisation"]) == ("A. Analyst", "Lead", "Open Watch")


def test_a_backup_s_signature_that_fails_the_gate_is_dropped(client):
    for encoded in ("not base64!", base64.b64encode(b"GIF89a").decode(),
                    base64.b64encode(config.PNG_MAGIC + b"\0" * config.REPORT_SIGNATURE_MAX_BYTES).decode()):
        response = client.post("/api/settings/import", json={"report_signature_png": encoded})
        assert response.status_code == 200
        assert response.json()["report_signature"] is False
    assert not config.report_signature_path().exists()
    huge = "A" * (4 * (config.REPORT_SIGNATURE_MAX_BYTES // 3 + 1) + 2048)
    assert client.post("/api/settings/import", json={"report_signature_png": huge}).status_code == 422


def test_a_backup_with_an_over_long_name_is_refused_whole(client):
    response = client.post("/api/settings/import", json={"settings": {"units": "imperial", "report_name": "x" * 81}})
    assert response.status_code == 422
    assert client.get("/api/settings").json()["units"] == "metric"


def test_a_hand_dropped_signature_no_gate_saw_stays_out_of_the_backup(client):
    path = config.report_signature_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"GIF89a")
    assert client.get("/api/settings/export").json()["report_signature_png"] == ""


def test_the_logo_upload_is_now_kept_owner_only_too(client):
    client.post("/api/settings/signature", files={"file": ("logo.png", png_data(), "image/png")})
    if sys.platform != "win32":
        assert os.stat(config.signature_path()).st_mode & 0o777 == 0o600


def test_the_identity_is_read_from_settings(client):
    client.put("/api/settings/prefs", json={"report_name": "A. Analyst"})
    identity = notefill.Identity.from_settings()
    assert identity.name == "A. Analyst" and identity.logo is None and identity.signature is None
    assert identity.picture("logo") == notefill.AZIMUT_LOGO
    client.post("/api/settings/signature", files={"file": ("logo.png", png_data(), "image/png")})
    assert notefill.Identity.from_settings().picture("my-logo") == config.signature_path()


# -- aligned blocks keep what a paragraph at the left keeps ---------------------------------


def fonts(data: bytes) -> set[str]:
    resources = PdfReader(BytesIO(data)).pages[0]["/Resources"]["/Font"]
    return {str(font.get_object()["/BaseFont"]) for font in resources.values()}


@pytest.mark.parametrize("side", ["center", "right"])
def test_a_paragraph_in_an_aligned_block_keeps_its_styling_and_links(side):
    styled = render(f"::: {side}\nA **bold** word and a [link](https://example.org/b).\n:::\n")
    plain = render(f"::: {side}\nA bold word and a link.\n:::\n")
    # the bold word is set in a bold face of its own
    assert len(fonts(styled.pdf)) == len(fonts(plain.pdf)) + 1
    annotations = PdfReader(BytesIO(styled.pdf)).pages[0]["/Annots"]
    assert [item.get_object()["/A"]["/URI"] for item in annotations] == ["https://example.org/b"]
    assert "A bold word and a link." in pages(styled.pdf)[0]


def test_a_citation_in_an_aligned_block_is_raised_and_linked_to_its_entry():
    out = render("::: center\nSeen in a [post](https://example.org/p).\n:::\n", the_look=look(style="report"))
    reader = PdfReader(BytesIO(out.pdf))
    links = [item.get_object() for item in reader.pages[0]["/Annots"]]
    assert any("/Dest" in link for link in links)  # the [1] goes to its entry
    assert any(link.get("/A", {}).get("/URI") == "https://example.org/p" for link in links)


def test_an_aligned_block_keeps_its_lines_where_they_were():
    """The same lines at the same height: a hard break starts a line, as before."""
    out = render("::: right\n**Ann**\\\nOpen Watch\\\n5 November 2026\n:::\n\nAfter.\n")
    lines = [line.strip() for line in pages(out.pdf)[0].splitlines()]
    assert lines[lines.index("Ann"):lines.index("Ann") + 3] == ["Ann", "Open Watch", "5 November 2026"]


@pytest.mark.parametrize(("side", "left"), [("center", 0.5), ("right", 1.0)])
def test_a_picture_in_an_aligned_block_stands_as_its_block_unless_it_says(tmp_path, side, left):
    case = FakeCase(tmp_path)
    a_png(tmp_path / "media" / "p.png", size=(400, 300))
    text = (f"::: {side}\n![p](/files/demo/media/p.png){{width=30%}}\n\n"
            "![q](/files/demo/media/p.png){width=30% align=left}\n:::\n")
    out = render(text, case=case)
    follows, says = out.pictures
    x, _, width, _ = follows.box
    if left == 0.5:
        assert abs(x + width / 2 - 0.5) < 0.01
    else:
        assert abs(x + width - (1 - 16 / 210)) < 0.01  # the plain page's right margin
    assert says.box[0] < 0.1
    assert follows.align == "left"  # as written: nothing was written
