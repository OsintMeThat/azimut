"""Footnotes (`^[words]`): one reading of where they are, letters in reading order, the
Notes before the sources in the page, the PDF and a WordPress draft, a link inside one
cited like any other, and the running text read without them wherever a note is summed up.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from azimut.engine import (
    notediff, notefill, notelinks, notepieces, notes_html, notes_markdown, notes_pdf, notes_wordpress, notetext,
)
from azimut.engine.notelook import NoteLook

from test_notes_html import parse
from test_notes_pdf import pdf_text

FIXTURE = Path(__file__).parent / "fixtures" / "footnotes.json"
CASES = json.loads(FIXTURE.read_text(encoding="utf-8"))["cases"]

#: A style that lists its sources and carries a contents, so the Notes are seen beside both.
REPORT = NoteLook.model_validate({"style": "report", "toc": True})
NOTE = """# The strait

The strait was open to both,^[The 1921 text calls it a “common passage”, [see the treaty](https://example.org/treaty).] for most of the century.

## Later

Ships passed,^[A second *aside*.] as [the log](https://example.com/log) says.
"""
TREATY = "The 1921 text calls it a “common passage”, see the treaty"


def footnotes_of(line: str) -> list[str]:
    """The words of each footnote the parser reads on ``line``, as written."""
    inline = next(token for token in notes_markdown.parse(line) if token.type == "inline")
    return [child.content for child in inline.children or [] if child.type == notes_markdown.FOOTNOTE_TOKEN]


def html_page(text: str = NOTE, **options):
    return notes_html.render(None, title="The strait", text=text, identity=notefill.Identity(), **options)


# -- the reading ----------------------------------------------------------------------------


@pytest.mark.parametrize("case", CASES, ids=[case["line"][:40] for case in CASES])
def test_the_parser_reads_each_footnote_of_the_fixture(case):
    # the parser reads a record's chip as the link it rewrites it to first
    assert footnotes_of(case["line"]) == [notes_markdown.case_references(words) for words in case["notes"]]


@pytest.mark.parametrize("case", CASES, ids=[case["line"][:40] for case in CASES])
def test_the_plain_reader_finds_the_same_footnotes_as_the_parser(case):
    line = case["line"]
    assert [line[start + 2 : end - 1] for start, end in notetext.footnote_spans(line)] == case["notes"]


def test_a_footnote_holds_its_words_parsed_and_never_another_footnote():
    inline = next(token for token in notes_markdown.parse("A^[See [it](https://example.org/a), *now* ^[no].] b")
                  if token.type == "inline")
    footnote = next(child for child in inline.children if child.type == notes_markdown.FOOTNOTE_TOKEN)
    kinds = [child.type for child in footnote.children]
    assert kinds == ["text", "link_open", "text", "link_close", "text", "em_open", "text", "em_close", "text"]
    assert footnote.children[-1].content == " ^[no]."
    # the running text holds none of its words, and the walk that looks for links finds its link
    assert notes_markdown.inline_text(inline) == "A b"
    hrefs = [notes_markdown.token_attr(child, "href") for child in notes_markdown.with_footnotes(inline.children)
             if child.type == "link_open"]
    assert hrefs == ["https://example.org/a"]


def test_a_link_s_words_hold_no_footnote():
    assert footnotes_of("[words ^[x] more](https://example.org)") == []


def test_the_letters_run_a_to_z_then_aa_ab():
    letters = [notes_markdown.footnote_letter(index) for index in range(60)]
    assert letters[:3] == ["a", "b", "c"]
    assert letters[25:29] == ["z", "aa", "ab", "ac"]
    assert letters[51:53] == ["az", "ba"]
    assert notes_markdown.footnote_letter(26 + 26 * 26) == "aaa"


# -- the HTML page --------------------------------------------------------------------------


def test_the_page_marks_each_footnote_where_it_stands():
    page = html_page().html.decode()
    assert ('both,<sup class="az-fn" id="fnref-a"><a href="#fn-a" data-card="fn-a" data-label="Note a">[a]</a></sup>'
            ' for most') in page
    assert '<sup class="az-fn" id="fnref-b"><a href="#fn-b" data-card="fn-b" data-label="Note b">[b]</a></sup>' in page


def test_the_page_lists_the_notes_before_the_sources_and_in_its_contents():
    rendered = html_page(look=REPORT)
    page = rendered.html.decode()
    root = parse(rendered.html)
    notes = root.one("section", "az-notes", id="notes")
    assert notes.attrs["aria-labelledby"] == "notes-title"
    assert notes.one("h2", id="notes-title").words() == "Notes"
    lettered = notes.one("ol")
    assert lettered.attrs["type"] == "a"
    items = lettered.find("li")
    assert [item.attrs["id"] for item in items] == ["fn-a", "fn-b"]
    back = items[0].one("a", "az-back")
    assert back.attrs == {"class": "az-back", "href": "#fnref-a", "aria-label": "Back to the text"}
    assert items[0].words().startswith(f"^ {TREATY}")
    assert items[1].one("em").words() == "aside"
    assert page.index('id="notes"') < page.index('id="sources"')
    contents = [link.attrs["href"] for link in root.one("nav", "az-contents").find("a")]
    assert contents.index("#notes") == contents.index("#sources") - 1


def test_a_link_inside_a_footnote_cites_its_source_like_any_other():
    root = parse(html_page(look=REPORT).html)
    note = root.one("li", id="fn-a")
    link = note.one("a", href="https://example.org/treaty")
    assert link.words() == "see the treaty"
    # its words open the card of its entry, as any citing words do
    entry = root.one("section", "az-sources").one("li", id=link.attrs["data-card"])
    assert "example.org" in entry.words()
    # the footnote's source comes where its letter stands: before the log, cited after it
    assert link.attrs["data-card"] == "src-1"


def test_the_page_says_what_it_is_about_without_its_footnotes():
    assert html_page(text="Open to both,^[An aside.] for a century.").description == "Open to both, for a century."


def test_a_page_with_no_footnote_has_no_notes():
    page = html_page(text="Plain words.", look=REPORT).html.decode()
    assert "az-notes" not in page.split("<body", 1)[1].split("<script", 1)[0]
    assert 'href="#notes"' not in page


def test_a_heading_called_notes_never_takes_the_notes_id():
    root = parse(html_page(text="## Notes\n\nWords.^[An aside.]\n").html)
    assert root.one("h2", "", dir="auto").attrs["id"] == "notes-section"
    assert len(root.find(id="notes")) == 1


def test_the_public_edition_letters_only_the_footnotes_it_shows():
    text = ("First.^[One.]\n\n> [!internal] Who told us.^[A source's name.]\n\nLast.^[Two.]\n")
    internal = parse(html_page(text=text).html)
    public = parse(html_page(text=text, public=True).html)
    said = lambda root: [item.words() for item in root.one("section", "az-notes").find("li")]  # noqa: E731
    assert said(internal) == ["^ One.", "^ A source's name.", "^ Two."]
    assert said(public) == ["^ One.", "^ Two."]
    assert [sup.words() for sup in public.find("sup", "az-fn")] == ["[a]", "[b]"]


# -- the PDF --------------------------------------------------------------------------------


def test_the_pdf_raises_each_letter_and_lists_the_notes_before_the_sources():
    text = pdf_text(notes_pdf.render(None, title="The strait", text=NOTE, look=REPORT,
                                     identity=notefill.Identity()).pdf)
    assert "both,[a] for most of the century." in text
    assert "Ships passed,[b] as the log[2] says." in text
    assert f"a {TREATY}[1]." in text
    assert "b A second aside." in text
    body = text.split("CONTENTS", 1)[1]
    assert body.index("\nNotes\n") < body.index("\nSources\n")
    # the contents name the Notes too, before the sources
    contents = body.split("REPORT", 1)[0]
    assert contents.index("Notes") < contents.index("Sources")


def test_a_pdf_with_no_footnote_has_no_notes():
    text = pdf_text(notes_pdf.render(None, title="T", text="Plain words.", identity=notefill.Identity()).pdf)
    assert "Notes" not in text


# -- the WordPress draft --------------------------------------------------------------------


def test_a_draft_anchors_each_letter_to_its_words_under_notes():
    draft = notes_wordpress.build(None, title="The strait", text=NOTE, look=REPORT, identity=notefill.Identity())
    content = draft.content
    assert 'both,<sup id="fnref-a"><a href="#fn-a">[a]</a></sup> for most' in content
    assert '<!-- wp:list {"ordered":true,"type":"lower-alpha"} -->' in content
    assert '<ol style="list-style-type:lower-alpha" class="wp-block-list">' in content
    assert '<li id="fn-a"><a href="#fnref-a" aria-label="Back to the text">^</a> The 1921 text' in content
    assert '<a href="https://example.org/treaty">see the treaty</a>' in content
    assert content.index('<h2 class="wp-block-heading" id="notes">Notes</h2>') < content.index('id="sources"')
    assert draft.excerpt == "The strait was open to both, for most of the century."


# -- what reads a note as text ---------------------------------------------------------------


def test_a_summary_and_a_word_count_leave_a_footnote_out():
    text = "# The strait\n\nOpen to both,^[The 1921 text says so.] for a century.\n"
    assert notetext.excerpt(text, "The strait") == "Open to both, for a century."
    assert notetext.word_count(text) == 8  # the title's two and the sentence's six
    assert notetext.plain_line("Open,^[An aside.] then.", footnotes=False) == "Open, then."


def test_search_and_a_record_s_citations_still_read_a_footnote():
    text = "Open to both,^[About [[entity:p1|the port]], [see it](https://example.org/a).] for a century.\n"
    assert notetext.find(text, "port")[1] == "Open to both, (About the port, see it.) for a century."
    assert notetext.citations(text, "p1") == [(0, "Open to both, (About the port, see it.) for a century.")]
    assert notetext.mentioned_ids(text) == ["p1"]


def test_a_count_in_a_footnote_is_read_as_the_text_is():
    inline = next(token for token in notes_markdown.parse("Seen,^[12 trucks were there.] at least 4 tanks.")
                  if token.type == "inline")
    assert notes_markdown.exact_counts(inline) == ["12 trucks"]


def test_a_link_in_a_footnote_is_one_of_the_note_s_links():
    text = "Words.^[See [the treaty](https://example.org/treaty) and https://example.com/bare.]\n"
    assert notelinks.outside_links(text) == ["https://example.org/treaty", "https://example.com/bare"]


def test_a_post_says_a_footnote_in_brackets_with_its_link():
    handed = notepieces.hand(None, title="T", text="Open to both,^[The 1921 text, [see it](https://example.org/t).] "
                                                   "for a century.")
    assert handed.pieces == [{"kind": "text",
                              "text": "Open to both, (The 1921 text, see it https://example.org/t.) for a century."}]


def test_an_edition_changed_only_in_a_footnote_says_so():
    old = "## Strait\n\nOpen to both,^[The 1921 text.] for a century.\n"
    new = old.replace("1921", "1923")
    answer = notediff.compare(old, new)
    parts = answer.paragraphs[0]["parts"]
    assert ["-", "1921"] in parts and ["+", "1923"] in parts
