"""The style is the profile: what a note carries after its text, decided per style.

Each style carries the sources list and how it is written (academic, web, short), five
annexes (geolocations, credits, how this was made, limits, editions and corrections) and
how strictly the check before export names its links. Azimut's own answer is
`notelook.PROFILES`; Settings › Publishing › Styles changes it for every note and a look
for one. Plain stays the document notes always printed as, to the byte
(`test_notes_pdf_golden.py`); each other style is pinned here once.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from azimut import config
from azimut.engine import noteannexes, notelook, notes_html, notes_markdown, notes_pdf, notes_wordpress, notesources
from azimut.engine.notelook import NoteLook
from azimut.engine.notesources import Source
from azimut.workspace import Case

from sourcesfixture import POST_URL, sourced_case
from test_notes_pdf import FakeCase, pdf_text, png
from test_notes_pdf_golden import CREATED, LINKED, LINKED_ITEMS, UNRELATED, IndexedCase, drawing
from test_notes_report import make_case

FIXTURE = Path(__file__).parent / "fixtures" / "note-styles.json"


def look(**values) -> NoteLook:
    return NoteLook.model_validate(values)


def squash(text: str) -> str:
    return "".join(text.split())


@pytest.fixture()
def sourced(client):
    cid = make_case(client)
    case = Case.open(cid)
    return cid, case, sourced_case(case)


# -- the profiles ---------------------------------------------------------------------


def test_the_frontend_reads_the_same_defaults_the_documents_print():
    """`tests/fixtures/note-styles.json` holds `PROFILES`, and `look.test.js` holds the
    Look's `STYLE_DEFAULTS` to it: one table, read from both sides."""
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == {
        style: profile.as_json() for style, profile in notelook.PROFILES.items()}
    assert set(notelook.PROFILES) == set(notelook.STYLES) == set(notelook.Style.__args__)


def test_each_style_carries_what_the_study_settled():
    plain, report, article = (notelook.PROFILES[name] for name in ("plain", "report", "article"))
    assert not plain.sources and not any(plain.annex(key) for key in notelook.ANNEXES)
    assert report.sources_style == "academic" and report.link_check == "each"
    assert all(report.annex(key) for key in notelook.ANNEXES)
    assert article.sources_style == "web" and article.credits and article.editions and not article.method
    for style in ("brief", "journal"):
        kept = notelook.PROFILES[style]
        assert kept.sources and kept.sources_style == "short" and kept.link_check == "grouped"
    assert notelook.SOURCES_OFF_STYLES == ("plain",)


def test_a_look_overrides_each_switch_and_settings_change_the_style():
    table = notelook.styles_table({"report": {"method": False, "sources_style": "web"}})
    assert look(style="report").profile(table).method is False
    assert look(style="report").profile(table).sources_style == "web"
    assert look(style="report").profile().method is True  # this machine's settings: Azimut's own
    mixed = look(style="report", sources_style="short", link_check="grouped",
                 annexes={"credits": "off", "limits": "off"}).profile(table)
    assert (mixed.sources_style, mixed.link_check, mixed.credits, mixed.limits, mixed.geolocations) == (
        "short", "grouped", False, False, True)
    assert look(style="plain", annexes={"credits": "on"}).profile().credits is True


def test_a_saved_table_keeps_only_what_differs_and_reads_what_it_can():
    saved = notelook.saved_styles({"report": {"method": True, "credits": False}, "plain": {"sources": True}})
    assert saved == {"report": {"credits": False}, "plain": {"sources": True}}
    table = notelook.styles_table({"report": {"credits": "no", "limits": False, "sources_style": "chicago"},
                                   "nonsense": {"credits": True}, "brief": "everything"})
    assert table["report"].credits is True and table["report"].limits is False
    assert table["report"].sources_style == "academic"
    assert table["brief"] == notelook.PROFILES["brief"]


def test_the_new_keys_are_late_and_an_older_reader_still_reads_the_rest():
    assert NoteLook().model_dump(mode="json") == NoteLook.model_validate(
        {"style": "plain", "sources_style": "", "link_check": "", "annexes": {}}).model_dump(mode="json")
    dumped = NoteLook().model_dump(mode="json")
    assert not {"sources_style", "link_check", "annexes"} & set(dumped)
    set_ = look(style="article", sources_style="academic", annexes={"method": "on"}).model_dump(mode="json")
    assert set_["sources_style"] == "academic" and set_["annexes"] == {"method": "on"} and "link_check" not in set_
    # a later Azimut's annex or value is dropped, the rest kept
    read = notelook.parse({"style": "report", "annexes": {"method": "off", "sketches": "on"}, "link_check": "loud"})
    assert read is not None and read.annexes.method == "off" and read.link_check == ""
    with pytest.raises(ValueError):
        NoteLook.model_validate({"annexes": {"method": "maybe"}})


def test_a_template_carries_its_choices_and_one_without_them_reads_as_before(client):
    plain = client.post("/api/templates/note", json={"name": "Old", "data": {"body": "x", "look": {"style": "report"}}})
    assert plain.status_code == 200, plain.text
    assert set(plain.json()["data"]["look"]) == set(NoteLook(style="report").model_dump(mode="json"))
    chosen = client.post("/api/templates/note", json={"name": "Desk", "data": {"body": "x", "look": {
        "style": "article", "sources_style": "academic", "annexes": {"method": "on"}, "link_check": "each"}}})
    assert chosen.status_code == 200, chosen.text
    kept = next(item for item in client.get("/api/templates").json()["note"] if item["name"] == "Desk")
    assert kept["data"]["look"]["annexes"] == {"method": "on"}
    assert kept["data"]["look"]["sources_style"] == "academic" and kept["data"]["look"]["link_check"] == "each"


# -- Settings › Publishing › Styles ----------------------------------------------------


def test_settings_answer_every_style_whole_and_keep_only_the_changes(client):
    body = client.get("/api/settings").json()
    assert body["note_styles"] == body["note_styles_default"] == json.loads(FIXTURE.read_text(encoding="utf-8"))
    table = body["note_styles"]
    table["report"]["method"] = False
    table["plain"]["credits"] = True
    answered = client.put("/api/settings/prefs", json={"note_styles": table}).json()
    assert answered["note_styles"]["report"]["method"] is False and answered["note_styles"]["plain"]["credits"] is True
    assert config.load_settings()["note_styles"] == {"report": {"method": False}, "plain": {"credits": True}}
    assert look(style="report").profile().method is False  # every note keeping its style's own
    assert client.put("/api/settings/prefs", json={"note_styles": {}}).json()["note_styles"]["report"]["method"]
    assert config.load_settings()["note_styles"] == {}


def test_a_value_settings_cannot_hold_is_refused(client):
    refused = client.put("/api/settings/prefs", json={"note_styles": {"report": {"sources_style": "mla"}}})
    assert refused.status_code == 422
    assert client.put("/api/settings/prefs", json={"note_styles": {"poster": {}}}).status_code == 422


def test_the_backup_carries_the_styles_table(client):
    client.put("/api/settings/prefs", json={"note_styles": {"brief": {"credits": True}}})
    blob = client.get("/api/settings/export").json()
    assert blob["settings"]["note_styles"] == {"brief": {"credits": True}}
    client.put("/api/settings/prefs", json={"note_styles": {}})
    blob["settings"]["note_styles"]["report"] = {"limits": "never", "method": False}
    imported = client.post("/api/settings/import", json=blob)
    assert imported.status_code == 200, imported.text
    assert config.load_settings()["note_styles"] == {"brief": {"credits": True}, "report": {"method": False}}


# -- one source, written in a style ---------------------------------------------------------


FULL = Source(key="entity:b", label="Yemen's Houthis seize strategic Red Sea city of Mocha", kind="page",
              noun="Web page", address="https://www.aljazeera.com/news/2026/9/10/mocha", author="Staff writer",
              archive="https://web.archive.org/web/20261118093012/https://www.aljazeera.com/news/2026/9/10/mocha",
              archived="2026-11-18", published="2026-09-10", collected="2026-11-17", entity_id="b")


@pytest.mark.parametrize(("change", "academic"), [
    ({}, "Staff writer, “Yemen's Houthis seize strategic Red Sea city of Mocha”, Al Jazeera, 10 September 2026, "
         "https://www.aljazeera.com/news/2026/9/10/mocha, archived 18 November 2026 at "
         "https://web.archive.org/web/20261118093012/https://www.aljazeera.com/news/2026/9/10/mocha, "
         "accessed 17 November 2026."),
    ({"author": ""}, "“Yemen's Houthis seize strategic Red Sea city of Mocha”, Al Jazeera, 10 September 2026, "
                     "https://www.aljazeera.com/news/2026/9/10/mocha, archived 18 November 2026 at "
                     "https://web.archive.org/web/20261118093012/https://www.aljazeera.com/news/2026/9/10/mocha, "
                     "accessed 17 November 2026."),
    ({"author": "", "published": "", "archive": "", "archived": ""},
     "“Yemen's Houthis seize strategic Red Sea city of Mocha”, Al Jazeera, https://www.aljazeera.com/news/2026/9/10/mocha, "
     "accessed 17 November 2026."),
    ({"author": "", "archived": "", "collected": ""},
     "“Yemen's Houthis seize strategic Red Sea city of Mocha”, Al Jazeera, 10 September 2026, "
     "https://www.aljazeera.com/news/2026/9/10/mocha, archived at "
     "https://web.archive.org/web/20261118093012/https://www.aljazeera.com/news/2026/9/10/mocha."),
    ({"author": "", "label": "aljazeera.com", "published": "", "archive": "", "collected": ""},
     "Al Jazeera, https://www.aljazeera.com/news/2026/9/10/mocha."),
])
def test_an_academic_entry_leaves_out_what_the_case_does_not_know(change, academic):
    source = Source(**{**FULL.__dict__, **change})
    written = notesources.entry_text(notesources.entry(source, "academic"))
    assert written == academic
    assert "n.d." not in written and ", ," not in written and "None" not in written


def test_the_outlet_is_in_italics_and_each_address_a_link_of_its_own():
    parts = notesources.entry(FULL, "academic", [3, 4])
    assert [part.text for part in parts if part.kind == "outlet"] == ["Al Jazeera"]
    assert [part.link for part in parts if part.kind == "address"] == [FULL.address, FULL.archive]
    assert [part.number for part in parts if part.kind == "cite"] == [3, 4]
    assert notesources.entry_text(parts).endswith("accessed 17 November 2026, from [3], [4].")


def test_a_web_entry_names_the_outlet_links_the_title_and_the_archived_copy():
    parts = notesources.entry(FULL, "web")
    assert notesources.entry_text(parts) == ("Staff writer on Al Jazeera, “Yemen's Houthis seize strategic Red Sea city "
                                             "of Mocha”, 10 Sep 2026. Archived copy.")
    assert [(part.kind, part.link) for part in parts if part.link] == [("title", FULL.address), ("link", FULL.archive)]


def test_a_post_names_its_account_and_a_file_keeps_what_it_is():
    post = Source(key="entity:v", label="Field tour", kind="post", noun="Video", address=POST_URL,
                  published="2026-03-12", collected="2026-03-13", sha256="a" * 64, path="media/v.mp4", entity_id="v")
    assert notesources.entry_text(notesources.entry(post, "academic")) == (
        f"@portwatch, “Field tour”, video, X, 12 March 2026, {POST_URL}, collected 13 March 2026.")
    named = Source(**{**post.__dict__, "author": "Port Watch"})
    assert notesources.entry_text(notesources.entry(named, "academic")).startswith("Port Watch (@portwatch), ")
    assert notesources.entry_text(notesources.entry(named, "web")) == "Port Watch (@portwatch) on X, “Field tour”, 12 Mar 2026."


def test_a_written_link_quotes_the_title_the_note_gave_it_never_its_citation():
    reader = notesources.Reader(None)
    first = reader.link("https://www.bbc.com/news/articles/x1", "BBC, 5 Oct")
    assert notesources.entry_text(notesources.entry(first, "academic")) == "BBC News, https://www.bbc.com/news/articles/x1."
    reader.link("https://www.bbc.com/news/articles/x1", "Yemeni military says it has retaken Mokha")
    titled = reader.latest(first)
    assert notesources.entry_text(notesources.entry(titled, "academic")).startswith(
        "“Yemeni military says it has retaken Mokha”, BBC News, ")
    # a title may name its site and still be one
    copy = reader.link("https://web.archive.org/web/20141002002913/http://dsca.mil/sales/uae", "DSCA 14-26: UAE, MRAPs")
    assert notesources.entry_text(notesources.entry(copy, "academic")) == (
        "“DSCA 14-26: UAE, MRAPs”, DSCA, archived 2 October 2014 at "
        "https://web.archive.org/web/20141002002913/http://dsca.mil/sales/uae.")


def test_known_outlets_and_handles_are_read_off_the_address():
    assert notesources.outlet("https://english.aawsat.com/x") == "Asharq Al-Awsat"
    assert notesources.outlet("https://yemen.liveuamap.com/en/x") == "Liveuamap"
    assert notesources.outlet("https://example.org/x") == "example.org"
    assert notesources.handle_of("https://twitter.com/port_watch/status/1") == "@port_watch"
    assert notesources.handle_of("https://x.com/i/web/status/1") == ""
    assert notesources.short_day("2026-09-10~") == "about 10 Sep 2026"


# -- the documents ---------------------------------------------------------------------------


def _geolocated(case, made) -> None:
    """The fixture's proof concluding on Berth 12, within 30 m, on a stated day."""
    spec = "proofs/.meta/Strike geolocated.json"
    case.resolve_inside(spec).parent.mkdir(parents=True, exist_ok=True)
    case.resolve_inside(spec).write_text(json.dumps({"coordsText": "14.79800, 42.95400"}), encoding="utf-8")
    case.update_entity(made["proof"]["id"], {"attrs": {"spec": spec, "when": "2026-03-12~",
                                                         "imagery_credits": "Esri World Imagery · Maxar"}})
    case.update_entity(made["place"]["id"], {"attrs": {"radius_m": 30}})
    case.add_link(made["proof"]["id"], made["place"]["id"], "depicts", by="proof-composer")


def _note(made) -> str:
    m = {name: item["id"] for name, item in made.items()}
    return (f"# Strike\n\nThe [[entity:{m['notice']}|notice]] and [the post]({POST_URL}).\n\n"
            f"[[media:{m['proof']}|Proof]]{{width=50%}}\n\n[[media:{m['capture']}|Port]]{{width=50%}}\n\n"
            "> [!limits] Nothing shows who fired.\n\n## Findings\n\nOne strike.\n")


EARLIER = [
    {"at": "2026-03-20T10:00:00Z", "edition": "public", "format": "html", "sha256": "b" * 64, "text_sha256": "t2",
     "changes": "The berth number."},
    {"at": "2026-03-19T10:00:00Z", "edition": "public", "format": "pdf", "pdf_sha256": "c" * 64, "text_sha256": "t1"},
    {"at": "2026-03-18T10:00:00Z", "edition": "public", "format": "html", "sha256": "d" * 64, "text_sha256": "t1"},
    {"at": "2026-03-17T10:00:00Z", "edition": "internal", "format": "pdf", "pdf_sha256": "e" * 64, "text_sha256": "t0"},
]


def test_a_report_ends_on_academic_sources_and_every_annex_in_the_pdf_and_the_page(sourced):
    _, case, made = sourced
    _geolocated(case, made)
    text = _note(made)
    pdf = notes_pdf.render(case, title="Strike", text=text, look=look(style="report"), public=True, earlier=EARLIER,
                           created=CREATED)
    printed = pdf_text(pdf.pdf)
    for heading in ("Sources", "Geolocations", "Credits", "How this was made", "Limits", "Editions and corrections"):
        assert heading in printed, heading
    flat = squash(printed)
    assert squash("“Port authority notice”, port-authority.example.org,") in flat
    assert squash("archived 13 March 2026 at") in flat and squash("accessed 13 March 2026") in flat
    assert squash("Berth 12, within 30 m") in flat and squash("about 12 March 2026") in flat
    assert "14.79800,42.95400" in flat
    assert squash("Esri World Imagery") in flat and squash("Noto Serif and Noto Sans, SIL Open Font License") in flat
    assert "Nothingshowswhofired." in flat
    # one row per published text, its first day and its formats, and what it corrected
    assert squash("This edition. PDF, 2 January 2026.") in flat
    assert squash("20 March 2026. HTML page. The berth number.") in flat
    assert squash("18 March 2026. PDF and HTML page.") in flat and "17March2026" not in flat
    page = notes_html.render(case, title="Strike", text=text, look=look(style="report"), public=True,
                             earlier=EARLIER, created=CREATED).html.decode()
    for key in ("geolocations", "credits", "method", "limits", "editions"):
        assert f'data-annex="{key}"' in page, key
    # the editions take the corrections' place, under their id
    assert page.count('id="corrections"') == 1 and 'class="az-annex az-corrections"' in page
    assert 'data-style="academic"' in page and "<cite>port-authority.example.org</cite>" in page
    assert 'href="#limits"' in page and '<a href="#az-geolocations">Geolocations</a>' in page


def test_a_web_article_writes_its_sources_for_the_web_with_credits_and_corrections(sourced):
    _, case, made = sourced
    text = _note(made)
    page = notes_html.render(case, title="Strike", text=text, look=look(style="article"), public=True,
                             earlier=EARLIER, changes="A typo.", created=CREATED).html.decode()
    assert 'data-look="article"' in page and 'data-style="web"' in page
    assert 'data-annex="credits"' in page and 'data-annex="editions"' in page
    assert 'data-annex="method"' not in page and 'data-annex="geolocations"' not in page
    assert '<a class="az-archive"' in page and "A typo." in page
    printed = pdf_text(notes_pdf.render(case, title="Strike", text=text, look=look(style="article"),
                                        created=CREATED).pdf)
    assert "ARTICLE" in printed and "Credits" in printed and "How this was made" not in printed


def test_a_brief_and_a_journal_keep_the_short_sources_and_no_annex(sourced):
    _, case, made = sourced
    text = _note(made)
    for style in ("brief", "journal"):
        printed = pdf_text(notes_pdf.render(case, title="Strike", text=text, look=look(style=style)).pdf)
        assert squash("Port authority notice · Web page · port-authority.example.org") in squash(printed)
        assert "Credits" not in printed and "How this was made" not in printed
        page = notes_html.render(case, title="Strike", text=text, look=look(style=style)).html.decode()
        assert "az-annex" not in page.split("<footer")[0].split("</main>")[-1]


def test_a_note_with_its_own_limits_section_is_not_given_a_second(tmp_path):
    case = FakeCase(tmp_path, {})
    text = "# T\n\n> [!limits] One.\n\n## Limitations\n\nTwo.\n"
    printed = squash(pdf_text(notes_pdf.render(case, title="T", text=text, look=look(style="report")).pdf))
    assert "One.Page" not in printed
    boxed = pdf_text(notes_pdf.render(case, title="T", text="# T\n\n> [!limits] One\n> more.\n", look=look(style="report")).pdf)
    assert "Onemore.Page1" in squash(boxed)


def test_the_limits_annex_links_back_to_each_box(tmp_path):
    from test_notes_sources import internal_links

    out = notes_pdf.render(FakeCase(tmp_path, {}), title="T", look=look(style="report"),
                           text="# T\n\n> [!limits] First.\n\n<!-- pagebreak -->\n\n> [!limits] Second.\n")
    back = [to for at, to in internal_links(out.pdf) if at == len(out.pages) - 1]
    assert back[-2:] == [0, 1]


def test_how_this_was_made_says_facts_the_case_recorded(sourced, monkeypatch):
    monkeypatch.setattr(noteannexes, "__version__", "9.9.9")
    _, case, made = sourced
    cited = notes_markdown.Cited(case, look=look(style="report"), styled=True)
    blocks = {}
    pieces = notes_markdown.expand("Strike", _note(made), resolve=None)
    for piece in pieces:
        if piece.kind == "text":
            blocks[id(piece)] = notes_markdown.alignment_blocks(piece.text)
    cited.collect(pieces, blocks)
    facts = noteannexes.build(case, cited, cited.profile, day=CREATED.date(), public=True).method
    assert facts[0] == "This PDF is the public edition, made with Azimut 9.9.9 on 2 January 2026."
    said = " ".join(facts)
    assert "web page" in said and "map capture" in said and "proof" in said
    assert "1 of its 2 outside addresses has an archived copy." in said
    assert "Its imagery is Esri World Imagery, dated 2 March 2024." in said
    assert "Made in the case with Geo Proof" in said and "Inspect" in said


def test_a_map_credit_joins_the_credits_once():
    annexes = noteannexes.Annexes(credits=[("Imagery", "Esri"), ("Typefaces", "Noto Serif")])
    noteannexes.add_map_credit(annexes, "© OpenStreetMap contributors")
    noteannexes.add_map_credit(annexes, "© OpenStreetMap contributors")
    noteannexes.add_map_credit(annexes, "Layer: Front, example.org")
    assert annexes.credits == [("Imagery", "Esri"), ("Maps", "© OpenStreetMap contributors; Layer: Front, example.org"),
                               ("Typefaces", "Noto Serif")]


def test_wordpress_writes_the_same_sources_and_annexes(sourced):
    _, case, made = sourced
    draft = notes_wordpress.build(case, title="Strike", text=_note(made), look=look(style="report"), earlier=EARLIER)
    assert "<em>port-authority.example.org</em>" in draft.content and "accessed 13 March 2026" in draft.content
    assert 'id="annex-method"' in draft.content and "How this was made" in draft.content
    assert "Editions and corrections" in draft.content and "The berth number." in draft.content


# -- the check before export ----------------------------------------------------------------


LINKS = "# T\n\nSee [one](https://example.org/a), [two](https://example.org/b) and [three](https://example.net/c).\n"


def test_a_report_checks_each_link_and_a_brief_groups_them(tmp_path):
    case = IndexedCase(tmp_path, dict(UNRELATED))
    each = notes_pdf.render(case, title="T", text=LINKS, look=look(style="report"))
    unarchived = [text for text, kind in zip(each.warnings, each.warning_kinds) if kind == notes_markdown.UNARCHIVED]
    assert unarchived == ["“one” has no archived copy.", "“two” has no archived copy.", "“three” has no archived copy."]
    assert all(line == 2 for line, kind in zip(each.warning_lines, each.warning_kinds) if kind == notes_markdown.UNSEEN)
    grouped = notes_pdf.render(case, title="T", text=LINKS, look=look(style="brief"))
    assert [text for text, kind in zip(grouped.warnings, grouped.warning_kinds) if kind == notes_markdown.UNARCHIVED] == [
        "3 outside links have no archived copy."]
    assert len(grouped.listed[notes_markdown.UNARCHIVED]) == 3
    loose = notes_pdf.render(case, title="T", text=LINKS, look=look(style="report", link_check="grouped"))
    assert sum(kind == notes_markdown.UNARCHIVED for kind in loose.warning_kinds) == 1


# -- one golden per style -----------------------------------------------------------------------


LIMITED = LINKED + "\n> [!limits] Nothing in the post shows who fired.\n"

#: `LIMITED` in each style, from the engine that gave styles their profiles. A brief and a
#: journal carry nothing new, and their digests are the ones 31bb73e drew before profiles;
#: Plain is `test_notes_pdf_golden.py`'s, unchanged.
STYLE_GOLDEN = {
    "report": "905871fec5eae23e052b9f98662be420f8dcc6563894d913cb45c6e395f7d0bb",
    "article": "34e31709beff8ca1c9099466fec17c8a152ecea31ef8277a934fb99d0f37e0c1",
    "brief": "afb5d24eef188dfa1ce76e6b7f233e3510000b1c5994745f1d98f15bc224cf0f",
    "journal": "fc1f17b93bd23aa1d8f36ab4c9a2aac8104b17a4c9c9fab131f48a3a81591bcf",
}


@pytest.mark.parametrize("style", sorted(STYLE_GOLDEN))
def test_each_style_prints_as_it_was_pinned(tmp_path, monkeypatch, style):
    monkeypatch.setattr(noteannexes, "__version__", "0.0.0")
    png(tmp_path, "media/strike.png", size=(320, 180), color="#6a2a4a")
    case = IndexedCase(tmp_path, {**LINKED_ITEMS, **UNRELATED})
    pdf = notes_pdf.render(case, title="Linked", text=LIMITED, look=look(style=style), created=CREATED,
                           earlier=EARLIER[:2]).pdf
    digest = hashlib.sha256(drawing(pdf)).hexdigest()
    if digest != STYLE_GOLDEN[style]:
        kept = tmp_path / f"{style}.pdf"
        kept.write_bytes(pdf)
        pytest.fail(f"the {style} note no longer prints as it did ({digest}); see {kept}")
