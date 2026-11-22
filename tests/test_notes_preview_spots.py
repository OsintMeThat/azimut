"""A double-click on the Page pane's preview takes the note there, as a TeX viewer takes
its source there: the PDF preview says where each block starts and its line, and the HTML
preview writes the line on each element. The files written out carry neither."""

from __future__ import annotations

import re

from azimut.engine import notes_html, notes_pdf

TEXT = "# Front\n\nFirst words of the piece.\n\n## Where it stopped\n\nThe line held.\n\n- one\n- two\n\nLast words.\n"


def test_the_pdf_says_where_each_block_starts_and_its_line_in_order():
    spots = notes_pdf.render(None, title="T", text=TEXT, light=True).spots
    lines = [line for _, _, line in spots]
    assert {2, 4, 6, 8, 11} <= set(lines)
    # drawn in reading order: down the page, then the next page
    assert spots == sorted(spots, key=lambda spot: (spot[0], spot[1]))
    assert all(page == 0 and 0 < top < 1 for page, top, _ in spots)


def test_a_block_on_a_later_page_says_that_page():
    long = "\n\n".join(f"Paragraph {number} " + "words " * 60 for number in range(40)) + "\n"
    rendered = notes_pdf.render(None, title="T", text=long, light=True)
    pages = {page for page, _, _ in rendered.spots}
    assert len(pages) > 1
    last_page, _, last_line = rendered.spots[-1]
    assert last_page == max(pages) and last_line == long.split("\n").index(next(
        line for line in long.split("\n") if line.startswith("Paragraph 39 ")))


def test_the_preview_s_header_carries_the_spots_flat(client):
    from test_notes_report import make_case

    cid = make_case(client, "Spots")
    answer = client.post(f"/api/cases/{cid}/notes/preview", json={"title": "T", "text": TEXT, "note": "case"})
    assert answer.status_code == 200, answer.text
    import json

    flat = json.loads(answer.headers["X-Note-Spots"])
    assert len(flat) % 3 == 0 and flat[2::3] and all(isinstance(value, int) for value in flat)
    assert 0 < flat[1] < 1000


def test_the_html_preview_writes_each_element_s_line_and_the_file_none():
    light = notes_html.render(None, title="T", text=TEXT, light=True).html.decode()
    found = dict((int(line), tag) for tag, line in re.findall(r'<(\w+)[^>]*\bdata-line="(\d+)"', light))
    assert found[2] == "p" and found[6] == "p" and found[8] == "ul" and found[11] == "p"
    assert found[4].startswith("h")
    written = notes_html.render(None, title="T", text=TEXT).html.decode()
    assert "data-line" not in written


def test_the_page_scripts_say_the_line_double_clicked_only_in_the_app():
    from pathlib import Path

    frame = (Path(__file__).resolve().parents[1] / "frontend/src/tools/notebook/HtmlPage.svelte").read_text()
    assert "addEventListener('dblclick'" in frame and "azimutLine" in frame
    reader = (Path(notes_html.__file__).parent / "notes_html_assets" / "reader.js").read_text()
    assert "azimutLine" not in reader
