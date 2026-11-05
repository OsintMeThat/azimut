"""Where a printed note says its items come from: the one reading of sources, the
numbered list at the end, and the check before an export.

Every credit line, video link, reference link and list entry reads
`engine/notesources.py`, so these hold the reading once and then each surface that
prints it. The plain document notes always printed as is held, to the byte, by
`test_notes_pdf_golden.py`; plain lists no sources unless its look asks.
"""

from __future__ import annotations

import json
from io import BytesIO

import pytest
from pydantic import ValidationError
from pypdf import PdfReader

from azimut.api import notes as notes_api
from azimut.engine import links as link_engine
from azimut.engine import notelook, notes_pdf, notes_style, notesources
from azimut.engine.notelook import NoteLook
from azimut.workspace import CASE_SCHEMA, Case

from sourcesfixture import (
    ACCOUNT_URL,
    ARCHIVE_URL,
    HORIZON_CREDITS,
    MAPS_URL,
    NOTICE_URL,
    POST_URL,
    sourced_case,
    sourced_note,
)
from test_notes_pages import link_targets, pages
from test_notes_pdf import FakeCase, pdf_text, png
from test_notes_report import make_case, make_note, tree


def look(**values) -> NoteLook:
    return NoteLook.model_validate(values)


def squash(text: str) -> str:
    return "".join(text.split())


def internal_links(data: bytes) -> list[tuple[int, int]]:
    """Every link inside the document, as (page it is on, page it goes to)."""
    reader = PdfReader(BytesIO(data))
    refs = [page.indirect_reference for page in reader.pages]
    found = []
    for number, page in enumerate(reader.pages):
        for annotation in page.get("/Annots") or []:
            target = annotation.get_object().get("/Dest")
            if target is not None:
                found.append((number, refs.index(target[0])))
    return found


@pytest.fixture()
def sourced(client):
    cid = make_case(client)
    case = Case.open(cid)
    return cid, case, sourced_case(case)


# -- the one reading ----------------------------------------------------------------


def test_a_frame_credits_the_post_its_video_came_from(sourced):
    _, case, made = sourced
    reader = notesources.Reader(case)
    frame = reader.entity(made["frame"]["id"])
    assert frame is not None and frame.derived and frame.at == "1:23.5"
    assert [origin.entity_id for origin in frame.origins] == [made["video"]["id"]]
    assert frame.address == "" and frame.sourced
    assert frame.credit() == notesources.Credit("Source", "x.com", POST_URL)
    assert frame.link == POST_URL
    video = reader.entity(made["video"]["id"])
    assert video is not None and video.noun == "Video" and video.kind == notesources.POST
    assert notesources.details(video) == [
        "Video", "x.com", "by Port Watch", "posted 12 March 2026", "collected 13 March 2026",
    ]
    assert video.sha256 == made["video"]["sha256"]


def test_an_item_made_of_several_says_the_first_and_how_many_more(sourced):
    _, case, made = sourced
    reader = notesources.Reader(case)
    collage = reader.entity(made["collage"]["id"])
    assert [origin.entity_id for origin in collage.origins] == [made["frame"]["id"], made["photo"]["id"]]
    assert collage.credit() == notesources.Credit("Source", "x.com +1", POST_URL)
    proof = reader.entity(made["proof"]["id"])
    assert proof.noun == "Proof" and proof.arrival == "made"
    assert [origin.entity_id for origin in proof.origins] == [made["frame"]["id"], made["capture"]["id"]]
    assert proof.credit() == notesources.Credit("Source", "x.com +1", POST_URL)


def test_imagery_says_whose_and_of_which_day(sourced):
    _, case, made = sourced
    reader = notesources.Reader(case)

    def credit(name):
        return reader.entity(made[name]["id"]).credit()

    assert credit("capture") == notesources.Credit("Imagery", "Esri World Imagery, about 2 March 2024 · Esri, Maxar")
    # an extension capture names its imagery and day, and links to the page it was taken on
    assert credit("screenshot") == notesources.Credit(
        "Imagery", "Google Maps, 1 November 2025 · Imagery ©2025 Airbus", MAPS_URL)
    # a pair says both of its days
    assert credit("compare") == notesources.Credit(
        "Imagery", "Esri Wayback, 1 May 2023 and Esri World Imagery, about 2 June 2025")
    assert credit("detect") == notesources.Credit("Imagery", "Sentinel-2, 2 March 2025 and 11 April 2025")
    horizon = reader.entity(made["horizon"]["id"])
    assert horizon.credit() == notesources.Credit("Terrain", HORIZON_CREDITS)
    assert horizon.noun == "Terrain view" and horizon.seen == "eye at 14.79801, 42.95402, facing 245°"


def test_a_file_the_case_knows_nothing_about_has_no_source_and_is_still_evidence(sourced):
    _, case, made = sourced
    paste = notesources.Reader(case).entity(made["paste"]["id"])
    assert paste.credit() is None and not paste.sourced
    assert paste.citable and len(paste.sha256) == 64


def test_records_link_to_their_page_then_their_archive(sourced):
    _, case, made = sourced
    reader = notesources.Reader(case)
    notice = reader.entity(made["notice"]["id"])
    assert (notice.address, notice.archive, notice.link) == (NOTICE_URL, ARCHIVE_URL, NOTICE_URL)
    assert notice.collected == "2026-03-13" and notice.noun == "Web page"
    assert reader.entity(made["account"]["id"]).link == ACCOUNT_URL
    place = reader.entity(made["place"]["id"])
    assert place is not None and not place.citable
    assert reader.entity("gone") is None


def test_a_confirmed_posted_edge_names_the_author(sourced):
    _, case, made = sourced
    case.add_link(made["account"]["id"], made["paste"]["id"], link_engine.POSTED, by="user")
    case.add_link(made["account"]["id"], made["horizon"]["id"], link_engine.POSTED, by="propose-links",
                  status="suggested")
    reader = notesources.Reader(case)
    assert reader.entity(made["paste"]["id"]).author == "@portwatch"
    assert reader.entity(made["horizon"]["id"]).author == ""


def test_origins_stop_at_a_loop_and_after_a_few_hops(tmp_path):
    """Read off the same `derived-from` closure Geo Proof and the Post composer use,
    bounded however the chain was written."""
    rows = {f"m{n}": {"id": f"m{n}", "type": "media", "label": f"M{n}",
                      "attrs": {"path": f"media/m{n}.png"}} for n in range(8)}
    rows["m7"]["attrs"]["source_url"] = "https://example.org/far"
    edges = [(f"m{n}", f"m{n + 1}") for n in range(7)] + [("m3", "m1")]

    class ChainCase(FakeCase):
        def links_of(self, entity_id):
            return [{"id": f"{a}-{b}", "from": a, "to": b, "type": link_engine.DERIVED_FROM}
                    for a, b in edges if entity_id in (a, b)]

    source = notesources.Reader(ChainCase(tmp_path, rows)).entity("m0")
    depth, one = 0, source
    while one.origins:
        one, depth = one.origins[0], depth + 1
    assert depth == notesources.MAX_HOPS
    assert source.credit() is None  # the address five hops away is past the bound


def test_a_written_link_is_a_web_page_named_by_its_words():
    source = notesources.Reader(None).link("https://www.example.org/a", "the notice")
    assert (source.label, source.noun, source.host, source.key) == (
        "the notice", "Web page", "example.org", "url:https://www.example.org/a")
    assert notesources.Reader(None).link("https://example.org/b").label == "example.org"


def test_days_are_said_in_words():
    assert notesources.spoken_day("2024-03-12") == "12 March 2024"
    assert notesources.spoken_day("2024-03-12~") == "about 12 March 2024"
    assert notesources.spoken_day("2026-03-02T10:22:00Z") == "2 March 2026, 10:22 UTC"
    assert notesources.spoken_day("") == ""


# -- one list, one number per source ----------------------------------------------


def test_one_original_cited_twice_is_one_entry(sourced):
    cid, case, made = sourced
    text = (f"[[entity:{made['video']['id']}|The video]], again [[entity:{made['video']['id']}|here]], "
            f"its page [on X]({POST_URL}) and bare {POST_URL}.\n\n[[media:{made['frame']['id']}|Frame]]\n")
    out = notes_pdf.render(case, title="T", text=text, look=look(style="report"))
    printed = pdf_text(out.pdf)
    body, annex = printed.split("\nSources\n")
    # a reference, a link to its page and its address written bare are all the video
    assert "The video[1], again here[1], its page on X[1]" in body and f"{POST_URL}[1]" in squash(body)
    assert "Source: x.com [2]" in body  # the frame, whose credit is its video's
    assert squash(annex).count("[1]Strikeontheport") == 1 and annex.count("SHA-256") == 2
    assert "[3]" not in annex and "from [1]" in annex


def test_each_style_lists_its_sources_and_plain_only_when_asked(sourced):
    _, case, made = sourced
    text = f"[[media:{made['frame']['id']}|Frame]]\n"
    for style in ("report", "brief", "journal"):
        assert "SOURCES" in pdf_text(notes_pdf.render(case, title="T", text=text, look=look(style=style)).pdf).upper()
        off = notes_pdf.render(case, title="T", text=text, look=look(style=style, sources="off"))
        assert "SOURCES" not in pdf_text(off.pdf).upper() and "[1]" not in pdf_text(off.pdf)
    plain = pdf_text(notes_pdf.render(case, title="T", text=text).pdf)
    assert "Sources" not in plain and "Source: x.com" in plain
    asked = pdf_text(notes_pdf.render(case, title="T", text=text, look=look(sources="on")).pdf)
    assert "Sources" in asked and "Source: x.com [1]" in asked


def test_a_note_citing_nothing_prints_no_list_at_all(tmp_path):
    """No heading, no contents line, no page: a template's thumbnail and a fresh
    report look as they did."""
    text = "## One\n\nAt [[entity:place|Berth 12]], 14.7980, 42.9540, by mail to [us](mailto:a@b.org).\n"
    case = FakeCase(tmp_path, {"place": {"id": "place", "type": "place", "label": "Berth 12", "attrs": {}}})
    for owner in (case, None):
        listed = notes_pdf.render(owner, title="T", text=text, look=look(style="report", toc=True))
        unlisted = notes_pdf.render(owner, title="T", text=text, look=look(style="report", toc=True, sources="off"))
        assert "Sources" not in pdf_text(listed.pdf)
        assert len(listed.pages) == len(unlisted.pages)
        assert [o.title for o in PdfReader(BytesIO(listed.pdf)).outline] == ["One"]


def test_numbers_link_to_their_entries(sourced):
    _, case, made = sourced
    text = (f"[[entity:{made['notice']['id']}|The notice]].\n\n[[media:{made['frame']['id']}|Frame]]\n\n"
            f"[[media:{made['collage']['id']}|Collage]]\n")
    out = notes_pdf.render(case, title="T", text=text, look=look(style="report"))
    printed = pages(out.pdf)
    annex_page = next(number for number, page in enumerate(printed) if "Sources" in page)
    internal = internal_links(out.pdf)
    # the reference, two credit lines, then each `from [k]` inside the list
    assert sum(1 for at, to in internal if at < annex_page) >= 3
    assert all(to == annex_page for _, to in internal)
    entries = squash(printed[annex_page])
    # the notice, the frame, the video it was cut from, the collage and its other piece
    for said in ("[1]Portauthoritynotice", "[2]Strikeframeat1_23", "from[3]", "[3]Strikeontheport",
                 "[4]Quaycollage", "from[2],[5]", "[5]Craneonthequay"):
        assert said in entries, said


def test_an_entry_says_what_it_is_and_its_addresses_in_full(sourced):
    _, case, made = sourced
    text = f"[[entity:{made['notice']['id']}|The notice]] and [[media:{made['frame']['id']}|Frame]]\n"
    out = notes_pdf.render(case, title="T", text=text, look=look(style="brief"))
    annex = pdf_text(out.pdf)
    annex = annex[annex.index("SOURCES"):]
    joined = squash(annex)
    # long addresses wrap and are never cut: a reader may have to type them
    assert squash(NOTICE_URL) in joined and squash(f"Archive:{ARCHIVE_URL}") in joined
    assert "…" not in annex
    assert "Webpage·port-authority.example.org·collected13March2026" in joined
    assert f"SHA-256{made['video']['sha256']}" in joined
    assert "Picture·at1:23.5" in joined
    assert NOTICE_URL in link_targets(out.pdf) and ARCHIVE_URL in link_targets(out.pdf)


def test_a_record_without_a_source_and_a_generated_link_are_not_listed(sourced):
    _, case, made = sourced
    text = (f"At [[entity:{made['place']['id']}|Berth 12]], 14.7980, 42.9540, "
            f"see [[entity:{made['account']['id']}|@portwatch]].\n")
    out = notes_pdf.render(case, title="T", text=text, look=look(style="report"))
    printed = pdf_text(out.pdf)
    annex = printed[printed.index("Sources"):]
    assert "@portwatch" in annex and "Berth 12" not in annex and "openstreetmap" not in annex
    assert "[2]" not in annex
    assert any("openstreetmap.org" in target for target in link_targets(out.pdf))


def test_the_list_is_in_the_contents_and_the_bookmarks_and_starts_a_report_page(sourced):
    _, case, made = sourced
    text = f"## Findings\n\n[[media:{made['frame']['id']}|Frame]]\n\nShort.\n"
    out = notes_pdf.render(case, title="T", text=text, look=look(style="report", toc=True))
    reader = PdfReader(BytesIO(out.pdf))
    assert [o.title for o in reader.outline if not isinstance(o, list)] == ["Findings", "Sources"]
    printed = pages(out.pdf)
    assert "Sources" in printed[0]  # the contents
    assert printed[-1].startswith("REPORT T\nSources\n[1]") and "Short." in printed[-2]
    brief = pages(notes_pdf.render(case, title="T", text=text, look=look(style="brief")).pdf)
    assert len(brief) == 1 and "SOURCES" in brief[0]


@pytest.mark.parametrize("values", [
    {"style": "report", "page": "letter", "size": "large"},
    {"style": "brief", "size": "small"},
    {"style": "journal", "font": "sans"},
    {"style": "plain", "sources": "on", "font": "book"},
])
def test_the_list_stays_inside_the_margins(sourced, values):
    cid, case, made = sourced
    text = sourced_note(made, cid)
    out = notes_pdf.render(case, title="T", text=text, look=look(**values))
    theme = notes_style.theme_for(look(**values))
    reader = PdfReader(BytesIO(out.pdf))
    annex = [page for page in reader.pages if "Sources" in page.extract_text() or "SOURCES" in page.extract_text()]
    assert annex
    for page in annex:
        starts: list[float] = []

        def seen(text, cm, tm, *_):
            if text.strip():
                starts.append(tm[4] * cm[0] + tm[5] * cm[2] + cm[4])

        page.extract_text(visitor_text=seen)
        width = float(page.mediabox.width)
        for x in starts:
            assert theme.margin_side * 72 / 25.4 - 3 <= x <= width - theme.margin_side * 72 / 25.4, x


def test_a_long_address_wraps_after_a_slash_and_keeps_every_character():
    from fpdf import FPDF

    pdf = FPDF()
    pdf.add_page()
    pdf.set_font("helvetica", size=8)
    lines = notes_pdf._wrap_address(pdf, NOTICE_URL + "?" + "q=" * 60, 40, 60)
    assert "".join(lines) == NOTICE_URL + "?" + "q=" * 60
    assert pdf.get_string_width(lines[0]) <= 40 and all(pdf.get_string_width(line) <= 60 for line in lines)
    assert lines[0][-1] in notes_pdf.ADDRESS_BREAKS  # cut after a separator, not inside a word


def test_the_list_stops_at_its_bound_and_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(notesources, "MAX_ENTRIES", 3)
    text = " ".join(f"[page {n}](https://example.org/{n})" for n in range(6)) + "\n"
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text=text, look=look(style="report"))
    printed = pdf_text(out.pdf)
    assert "[3]" in printed and "[4]" not in printed
    assert ("The sources list stops at 3; 3 more are not listed.", None, "other") in zip(
        out.warnings, out.warning_lines, out.warning_kinds)


def test_a_video_made_from_a_posted_one_is_watched_at_that_post(sourced):
    _, case, made = sourced
    path = "media/Strike enhanced.mp4"
    case.resolve_inside(path).write_bytes(b"made from the strike video")
    enhanced = case.add_entity("media", "Strike enhanced", attrs={"path": path, "kind": "video"}, by="inspect")
    link_engine.link_all(case, enhanced["id"], link_engine.DERIVED_FROM, [made["video"]["path"]], by="inspect")
    out = notes_pdf.render(case, title="T", text=f"[[media:{enhanced['id']}|Enhanced]]\n")
    assert f"Watch it at {POST_URL}" in pdf_text(out.pdf)
    assert POST_URL in link_targets(out.pdf)


def test_each_producer_s_picture_prints_what_it_recorded(sourced):
    """Plain, as a note always printed: every picture whose producer recorded where
    it came from now says so under it, and one the case knows nothing about says
    nothing."""
    cid, case, made = sourced
    out = notes_pdf.render(case, title="T", text=sourced_note(made, cid))
    credits = [line for line in pdf_text(out.pdf).splitlines() if line.startswith(("Source:", "Imagery:", "Terrain:"))]
    assert credits == [
        "Source: x.com",
        "Imagery: Esri World Imagery, about 2 March 2024 · Esri, Maxar",
        "Imagery: Google Maps, 1 November 2025 · Imagery ©2025 Airbus",
        "Imagery: Esri Wayback, 1 May 2023 and Esri World Imagery, about 2 June 2025",
        "Imagery: Sentinel-2, 2 March 2025 and 11 April 2025",
        f"Terrain: {HORIZON_CREDITS}",
        "Source: x.com +1",
        "Source: x.com +1",
    ]
    targets = link_targets(out.pdf)
    # the video's reference, the written link, then the frame's, the collage's and the proof's credits
    assert targets.count(POST_URL) == 5 and MAPS_URL in targets
    assert "Sources" not in pdf_text(out.pdf) and out.warning_kinds == []


def test_the_cover_picture_is_the_first_source(sourced):
    _, case, made = sourced
    text = f"See [[entity:{made['notice']['id']}|the notice]].\n"
    out = notes_pdf.render(case, title="T", text=text,
                           look=look(style="report", cover={"on": True, "image": made["capture"]["id"]}))
    annex = squash(pdf_text(out.pdf).split("\nSources\n")[1])
    assert annex.startswith("[1]Portfromabove·Imagery") and "[2]Portauthoritynotice" in annex


def test_a_citation_in_a_heading_or_a_table_keeps_its_number(sourced):
    _, case, made = sourced
    notice = made["notice"]["id"]
    text = (f"## As [[entity:{notice}|the notice]] says\n\n| Who | What |\n|---|---|\n"
            f"| [[entity:{made['frame']['id']}|frame]] | cut |\n")
    out = notes_pdf.render(case, title="T", text=text, look=look(style="report"))
    printed = pdf_text(out.pdf)
    assert "As the notice[1] says" in printed and "frame[2] cut" in printed
    assert [o.title for o in PdfReader(BytesIO(out.pdf)).outline] == ["As the notice says", "Sources"]
    # the heading's number, then the frame's `from` in the list; a table cell has one
    # link and the frame's already goes to its post
    assert internal_links(out.pdf) == [(0, 1), (1, 1)]
    assert POST_URL in link_targets(out.pdf)


def test_a_template_lists_the_web_pages_it_links_to():
    text = "## Context\n\nRead [the brief](https://example.org/brief) first.\n"
    out = notes_pdf.render(None, title="T", text=text, look=look(style="report"))
    assert "Read the brief[1] first." in pdf_text(out.pdf)
    assert "[1] the brief · Web page · example.org" in pdf_text(out.pdf)


# -- the check before export ----------------------------------------------------------


def kinds(out) -> list[tuple[str, int | None, str]]:
    return list(zip(out.warnings, out.warning_lines, out.warning_kinds))


def test_a_record_or_a_chapter_no_longer_in_the_case_is_said_with_its_line(tmp_path):
    case = FakeCase(tmp_path, {})
    text = "Intro.\n\nAs [[entity:gone|the roof]] shows, twice [[entity:gone|the roof]].\n\n[[include:old]]\n"
    out = notes_pdf.render(case, title="T", text=text, resolve=lambda note: None)
    assert kinds(out) == [
        ('The record "the roof" is no longer in the case.', 2, "missing"),
        ("An included note is no longer in the case.", 4, "missing"),
    ]


def test_a_picture_without_a_source_is_said_only_while_sources_are_listed(sourced):
    cid, case, made = sourced
    text = (f"Line.\n\n[[media:{made['paste']['id']}|Roof]]\n\n[[media:{made['frame']['id']}|Frame]]\n\n"
            f"[[media:{made['paste']['id']}|Roof again]]\n")
    listed = notes_pdf.render(case, title="T", text=text, look=look(style="report"))
    assert [row for row in kinds(listed) if row[2] == "unsourced"] == [('Picture "Roof" has no source.', 2, "unsourced")]
    for quiet in (look(style="report", sources="off"), look()):
        assert not any(kind == "unsourced" for kind in notes_pdf.render(case, title="T", text=text, look=quiet).warning_kinds)


def test_open_tasks_are_counted_in_a_styled_document_only(tmp_path):
    text = "Plan.\n\n- [x] Geolocate\n- [ ] Check the date\n\n[[include:c]]\n"
    chapter = "- [ ] Ask the port\n"
    for style in ("report", "brief", "journal"):
        out = notes_pdf.render(FakeCase(tmp_path), title="T", text=text, look=look(style=style),
                               resolve=lambda note: ("Chapter", chapter))
        assert ("2 tasks are still open.", 3, "open-task") in kinds(out)
    plain = notes_pdf.render(FakeCase(tmp_path), title="T", text=text, resolve=lambda note: ("Chapter", chapter))
    assert "open-task" not in plain.warning_kinds
    one = notes_pdf.render(FakeCase(tmp_path), title="T", text="- [ ] Only\n", look=look(style="report"))
    assert kinds(one) == [("1 task is still open.", 0, "open-task")]


def test_a_link_a_reader_cannot_open_is_said_once_with_its_line(tmp_path):
    png(tmp_path, "media/a.png")
    text = ("[local](http://localhost:8477/x) and [lan](http://192.168.1.20/report)\n"
            "[file](file:///home/someone/x.pdf), [up](../notes/x.md), [anchor](#method)\n\n"
            "Bare http://127.0.0.1:8477/y here, [again](http://localhost:8477/x).\n\n"
            "[ok](https://example.org) [mail](mailto:a@b.org) [case](/files/demo/media/a.png) "
            "[intranet](http://intranet/x)\n")
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text=text)
    local = [(warning, line) for warning, line, kind in kinds(out) if kind == "local-link"]
    assert local == [
        ('The link "http://localhost:8477/x" will not open for a reader.', 0),
        ('The link "http://192.168.1.20/report" will not open for a reader.', 0),
        ('The link "file:///home/someone/x.pdf" will not open for a reader.', 1),
        ('The link "../notes/x.md" will not open for a reader.', 1),
        ('The link "#method" will not open for a reader.', 1),
        ('The link "http://127.0.0.1:8477/y" will not open for a reader.', 3),
        ('The link "http://intranet/x" will not open for a reader.', 5),
    ]
    listed = notes_pdf.render(FakeCase(tmp_path), title="T", text=text, look=look(style="report"))
    annex = pdf_text(listed.pdf)
    annex = annex[annex.index("Sources"):]
    assert "example.org" in annex and "localhost" not in annex and "a.png" in annex


def test_many_local_links_are_counted_past_the_first_ten(tmp_path):
    text = " ".join(f"[n{n}](http://localhost/{n})" for n in range(13)) + "\n"
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text=text)
    assert out.warnings[-1] == "3 more links will not open for a reader." and out.warning_lines[-1] is None
    assert out.warning_kinds.count("local-link") == 11


def test_an_anchor_link_prints_as_its_words_rather_than_failing_the_document(tmp_path):
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text="See [the method](#method).\n")
    assert "See the method." in pdf_text(out.pdf) and link_targets(out.pdf) == []
    assert kinds(out) == [('The link "#method" will not open for a reader.', 0, "local-link")]


def test_every_warning_has_a_kind(tmp_path):
    out = notes_pdf.render(FakeCase(tmp_path), title="T", text="## Empty\n\n## Full\n\nWords ![x](https://e.org/x.png)\n")
    assert kinds(out) == [
        ('Section "Empty" is empty.', 0, "empty-section"),
        ("1 remote image left out: the export never fetches from the network.", 4, "other"),
    ]
    assert set(notes_pdf.WARNING_KINDS) == {"missing", "unsourced", "open-task", "local-link", "empty-section", "other"}


def test_a_template_is_warned_about_nothing_of_a_case():
    text = "- [ ] Fill this in\n\n[x](http://localhost/x) [[entity:gone|A record]]\n"
    assert notes_pdf.render(None, title="T", text=text, look=look(style="report")).warnings == []


def test_the_preview_sends_each_warning_s_kind_beside_it(client):
    cid = make_case(client)
    note = make_note(client, cid)
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "report"})
    text = "## Empty\n\n## Full\n\n- [ ] Open\n\n[x](http://localhost/x)\n"
    response = client.post(f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": text})
    assert response.status_code == 200, response.text
    warnings = json.loads(response.headers["x-note-warnings"])
    found = json.loads(response.headers["x-note-warning-kinds"])
    assert len(found) == len(warnings) == len(json.loads(response.headers["x-note-warning-lines"]))
    assert found == ["empty-section", "open-task", "local-link"]


def test_the_check_answers_each_note_in_order_and_writes_nothing(client):
    cid = make_case(client)
    clean = make_note(client, cid, title="Clean", content="All good.\n")
    report = make_note(client, cid, title="Rooftop", content="## Method\n\n## Found\n\n- [ ] Date it\n")
    client.put(f"/api/cases/{cid}/notes/{report['id']}/look", json={"style": "report"})
    client.put(f"/api/cases/{cid}/notes", json={"text": "See [x](http://localhost/x).\n"})
    client.get(f"/api/cases/{cid}/notes/index")  # the first read may restate old mentions
    case = Case.open(cid)
    before = tree(case.path)
    response = client.post(f"/api/cases/{cid}/notes/pdf/check",
                           json={"notes": [report["id"], clean["id"], "case", report["id"]]})
    assert response.status_code == 200, response.text
    assert response.json() == {"notes": [
        {"note": report["id"], "title": "Rooftop", "warnings": [
            {"text": 'Section "Method" is empty.', "line": 0, "kind": "empty-section"},
            {"text": "1 task is still open.", "line": 4, "kind": "open-task"},
        ]},
        {"note": clean["id"], "title": "Clean", "warnings": []},
        {"note": "case", "title": "Case notes", "warnings": [
            {"text": 'The link "http://localhost/x" will not open for a reader.', "line": 0, "kind": "local-link"},
        ]},
    ]}
    assert tree(case.path) == before


def test_the_check_is_bounded_like_the_export(client):
    cid = make_case(client)
    route = f"/api/cases/{cid}/notes/pdf/check"
    assert client.post(route, json={"notes": []}).status_code == 422
    assert client.post(route, json={"notes": ["n"] * (notes_api.MAX_NOTES + 1)}).status_code == 422
    assert client.post(route, json={}).status_code == 422
    assert client.post(route, json={"notes": ["nope"]}).status_code == 404


def test_a_note_that_cannot_be_laid_out_answers_why(client, monkeypatch):
    cid = make_case(client)
    broken = make_note(client, cid, title="Broken", content="x\n")
    fine = make_note(client, cid, title="Fine", content="y\n")
    real = notes_pdf.render

    def render(case, *, title, **kwargs):
        if title == "Broken":
            raise notes_pdf.NotesPdfError("the note could not be laid out: no room")
        return real(case, title=title, **kwargs)

    monkeypatch.setattr(notes_pdf, "render", render)
    response = client.post(f"/api/cases/{cid}/notes/pdf/check", json={"notes": [broken["id"], fine["id"]]})
    assert response.json()["notes"] == [
        {"note": broken["id"], "title": "Broken",
         "warnings": [{"text": "the note could not be laid out: no room", "line": None, "kind": "other"}]},
        {"note": fine["id"], "title": "Fine", "warnings": []},
    ]


# -- the look key ------------------------------------------------------------------------


def test_the_sources_key_follows_the_style_unless_set():
    assert notelook.LATE_KEYS == ("font", "size", "sources")
    assert notelook.SOURCES_OFF_STYLES == ("plain",)
    for style in ("plain", "report", "brief", "journal"):
        assert look(style=style).sources_on is (style not in notelook.SOURCES_OFF_STYLES)
        assert look(style=style, sources="on").sources_on is True
        assert look(style=style, sources="off").sources_on is False
    assert "sources" not in look(style="report").model_dump(mode="json")
    assert look(sources="on").model_dump(mode="json")["sources"] == "on"
    assert look(sources="").is_default and not look(sources="on").is_default
    assert notelook.TemplateLook.model_validate({"sources": "off"}).sources == "off"


@pytest.mark.parametrize("bad", ["yes", True, 1, None, "ON"])
def test_a_sources_value_it_does_not_know_is_refused_and_dropped_when_read(bad):
    with pytest.raises(ValidationError):
        NoteLook.model_validate({"sources": bad})
    kept = notelook.parse({"style": "report", "toc": True, "sources": bad})
    assert kept is not None and (kept.style, kept.toc, kept.sources) == ("report", True, "")


def test_the_routes_take_the_key_and_refuse_a_value_they_do_not_know(client):
    cid = make_case(client)
    note = make_note(client, cid)
    route = f"/api/cases/{cid}/notes/{note['id']}/look"
    assert client.put(route, json={"style": "report", "sources": "maybe"}).status_code == 422
    saved = client.put(route, json={"style": "report", "sources": "off"})
    assert saved.status_code == 200 and saved.json()["look"]["sources"] == "off"
    assert Case.open(cid).get_entity(note["id"])["attrs"]["look"]["sources"] == "off"
    client.put(route, json={"style": "report", "sources": ""})
    assert "sources" not in Case.open(cid).get_entity(note["id"])["attrs"]["look"]
    assert client.post(f"/api/cases/{cid}/notes/preview", json={"note": note["id"], "text": "x",
                                                               "look": {"sources": "nope"}}).status_code == 422
    template = client.post("/api/templates/note", json={"name": "T", "data": {"body": "x", "look": {"sources": "on"}}})
    assert template.status_code == 200 and template.json()["data"]["look"]["sources"] == "on"
    assert client.post("/api/templates/note", json={"name": "U", "data": {"look": {"sources": 2}}}).status_code == 422


def test_a_case_with_the_key_still_reads_as_0_3_3_reads_it(client):
    """0.3.3 never reads a look: the key is one more value inside an attr it ignores,
    the note's Markdown is untouched and the case schema has not moved."""
    cid = make_case(client)
    note = make_note(client, cid, content="Body.\n")
    client.put(f"/api/cases/{cid}/notes/{note['id']}/look", json={"style": "plain", "sources": "on"})
    client.put(f"/api/cases/{cid}/notes/case/look", json={"style": "report", "sources": "off"})
    assert CASE_SCHEMA == 11
    case = Case.open(cid)
    assert case.read_note(note["id"]) == "Body.\n"
    assert case.get_entity(note["id"])["attrs"]["look"] == {**NoteLook().model_dump(mode="json"), "sources": "on"}
    assert json.loads(case.get_setting(notelook.CASE_LOOK))["sources"] == "off"
