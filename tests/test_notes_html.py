"""The Notebook's HTML report (`engine/notes_html.py`): the markup the reader's
stylesheet and script are written against, and the rules a published file keeps.

Most tests read one investigation (`ambushfixture.py`) rendered once in each edition,
parsed back as a page: what a file holds is checked the way a browser would find it,
never by trusting the code that wrote it.
"""

from __future__ import annotations

import base64
import io
import re
import subprocess
import tempfile
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path

import pytest
from PIL import Image

from azimut import config
from azimut.engine import notefill, notes_html, notes_markdown, notes_pdf
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from ambushfixture import (
    ARCHIVE_URL,
    CLIP_SECRET,
    DIAGRAM,
    DIAGRAM_SVG,
    FILMER,
    PNG_SECRET,
    POST_URL,
    ambush_case,
    ambush_note,
)
from test_notes_pdf import pdf_text

TITLE = "Ambush on the Wadi Sahm road"
LOOK = NoteLook.model_validate({
    "style": "report", "tlp": "amber", "toc": True, "numbered": True,
    "cover": {"on": True, "subtitle": "What open sources show", "date": "2025-10-28"},
})
CREATED = datetime(2025, 10, 28, 12, 0)
VOID = frozenset("area base br col embed hr img input link meta source track wbr".split())


# -- a page, parsed back ----------------------------------------------------------------


class Node:
    def __init__(self, tag: str, attrs: dict[str, str], parent: "Node | None") -> None:
        self.tag, self.attrs, self.parent = tag, attrs, parent
        self.children: list[Node] = []
        self.text = ""
        #: Its words and its children, in the order the page has them.
        self.parts: list[Node | str] = []

    @property
    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def walk(self):
        yield self
        for child in self.children:
            yield from child.walk()

    def find(self, tag: str = "", cls: str = "", **attrs: str) -> list["Node"]:
        return [node for node in self.walk() if (not tag or node.tag == tag) and (not cls or cls in node.classes)
                and all(node.attrs.get(key.replace("_", "-")) == value for key, value in attrs.items())]

    def one(self, tag: str = "", cls: str = "", **attrs: str) -> "Node":
        found = self.find(tag, cls, **attrs)
        assert found, f"no {tag}.{cls} {attrs}"
        return found[0]

    def words(self) -> str:
        return " ".join(self._said().split())

    def _said(self) -> str:
        return "".join(part if isinstance(part, str) else part._said() for part in self.parts)

    def ancestors(self):
        node = self.parent
        while node is not None:
            yield node
            node = node.parent


class Page(HTMLParser):
    def __init__(self, source: str) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("#root", {}, None)
        self.at = self.root
        self.comments: list[str] = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        node = Node(tag, {key: value or "" for key, value in attrs}, self.at)
        self.at.children.append(node)
        self.at.parts.append(node)
        if tag not in VOID:
            self.at = node

    def handle_startendtag(self, tag, attrs):
        node = Node(tag, {key: value or "" for key, value in attrs}, self.at)
        self.at.children.append(node)
        self.at.parts.append(node)

    def handle_endtag(self, tag):
        node = self.at
        while node is not None and node.tag != tag:
            node = node.parent
        if node is not None and node.parent is not None:
            self.at = node.parent

    def handle_data(self, data):
        self.at.text += data
        self.at.parts.append(data)

    def handle_comment(self, data):
        self.comments.append(data)


def parse(document: bytes) -> Node:
    return Page(document.decode("utf-8")).root


def payload(uri: str) -> bytes:
    assert uri.startswith("data:"), uri[:40]
    return base64.b64decode(uri.split(",", 1)[1])


# -- the investigation, rendered once in each edition -------------------------------------


@pytest.fixture(scope="module")
def report(tmp_path_factory):
    """The ambush register in a workspace of its own, rendered in both editions."""
    home = tmp_path_factory.mktemp("html-report")
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("AZIMUT_HOME", str(home))
        patch.setattr(config, "_pointer_dir", lambda: home / ".pointer")
        patch.setattr(config, "DEFAULT_ROOT", home)
        config.forget_workspace_root()
        case = Case.create("Wadi Sahm ambush")
        made = ambush_case(case)
        text = ambush_note(made)
        identity = notefill.Identity()
        diagrams = {notes_markdown.diagram_key(DIAGRAM): DIAGRAM_SVG}
        earlier = [{"at": "2025-10-27T18:02:11Z", "edition": "public", "format": "html", "sha256": "3f" * 32,
                    "changes": "First edition."}]
        internal = notes_html.render(case, title=TITLE, text=text, look=LOOK, identity=identity, diagrams=diagrams,
                                     created=CREATED)
        public = notes_html.render(case, title=TITLE, text=text, look=LOOK, identity=identity, diagrams=diagrams,
                                   created=CREATED, public=True, changes="V10 is captured, not destroyed.",
                                   earlier=earlier)
        yield {"case": case, "made": made, "text": text, "internal": internal, "public": public,
               "page": parse(internal.html), "public_page": parse(public.html), "home": home}
        config.forget_workspace_root()


# -- the document -------------------------------------------------------------------------


def test_the_document_says_its_look_its_edition_and_loads_nothing(report):
    html = report["page"].one("html")
    assert html.attrs["lang"] == "en" and html.attrs["dir"] == "auto"
    assert html.attrs["data-look"] == "report" and html.attrs["data-edition"] == "internal"
    assert html.attrs["data-tlp"] == "amber"
    assert report["public_page"].one("html").attrs["data-edition"] == "public"
    metas = report["page"].find("meta")
    assert any(meta.attrs.get("name") == "referrer" and meta.attrs["content"] == "no-referrer" for meta in metas)
    policy = next(meta.attrs["content"] for meta in metas if meta.attrs.get("http-equiv") == "Content-Security-Policy")
    assert policy == notes_html.CSP
    assert "default-src 'none'" in policy and "base-uri 'none'" in policy and "form-action 'none'" in policy


def test_the_reader_assets_are_inlined_whole(report):
    page = report["page"]
    styles = [node.text for node in page.find("style")]
    scripts = [node for node in page.find("script")]
    css = (notes_html.ASSETS / "reader.css").read_text(encoding="utf-8")
    js = (notes_html.ASSETS / "reader.js").read_text(encoding="utf-8")
    assert any(text.strip() == css.replace("</", "<\\/").strip() for text in styles)
    assert len(scripts) == 1 and not scripts[0].attrs.get("src")
    assert scripts[0].text.strip() == js.replace("</", "<\\/").strip()


def test_the_top_of_the_page_is_cover_then_contents_then_body(report):
    body = report["page"].one("body")
    order = [node for node in body.children if node.tag in ("header", "nav", "main")]
    assert [node.tag for node in order] == ["header", "nav", "main"]
    cover = body.one("header", "az-cover")
    assert cover.one(cls="az-tlp").attrs["data-tlp"] == "amber"
    assert "TLP:AMBER" in cover.one(cls="az-tlp").words()
    assert cover.one("h1", "az-title").words() == TITLE
    assert cover.one("time", "az-date").attrs["datetime"] == "2025-10-28"
    assert body.one("nav", "az-contents").children[0].tag == "ol"
    assert body.one("main", "az-body")


def test_every_link_inside_the_page_names_a_part_of_it(report):
    """The reader script takes a press on such a link itself (the Page pane's frame
    would otherwise leave for the app's address): each must find what it names."""
    for page in (report["page"], report["public_page"]):
        ids = {node.attrs["id"] for node in page.walk() if node.attrs.get("id")}
        inside = [node.attrs["href"][1:] for node in page.find("a") if node.attrs.get("href", "").startswith("#")]
        assert inside and set(inside) <= ids


def test_sections_have_stable_ids_the_contents_link_to(report):
    page = report["page"]
    headings = page.find("h2") + page.find("h3")
    ids = {node.attrs["id"] for node in headings if node.attrs.get("id")}
    assert {"summary", "the-footage", "where-it-happened", "the-register", "the-phone-photo"} <= ids
    linked = {node.attrs["href"][1:] for node in page.one("nav", "az-contents").find("a")}
    assert {"summary", "the-register", "the-phone-photo", "limits", "sources"} <= linked
    assert linked <= {node.attrs.get("id") for node in page.walk()}
    # numbered as the look asks, in the heading and its contents line alike
    assert page.one("h2", id="summary").one(cls="az-num").words() == "1"
    assert page.one("h3", id="the-phone-photo").one(cls="az-num").words() == "4.1"


def test_a_picture_is_a_figure_with_its_caption_credit_and_chain(report):
    figure = next(node for node in report["page"].find("figure", "az-figure", data_kind="picture")
                  if "From above" in node.words() or "junction from above" in node.words())
    button = figure.one("button", "az-zoom")
    assert button.children[0].tag == "img" and button.children[0].attrs["src"].startswith("data:image/")
    caption = figure.one("figcaption")
    assert caption.one(cls="az-caption")
    credit = caption.one(cls="az-credit")
    assert "Esri World Imagery" in credit.words() and "Esri, Maxar" in credit.words()
    chain = figure.one("details", "az-checked").one("ol", "az-chain")
    assert chain.find(cls="az-hash") and chain.find(cls="az-imagery")


def test_a_proof_says_its_sentence_its_points_and_both_dates(report):
    figure = report["page"].one("figure", "az-figure", data_kind="proof")
    assert "Sana'a road meets the wadi track" in figure.one(cls="az-proof-sentence").words()
    points = figure.one("ul", "az-points").find("a", "az-point")
    assert len(points) == 2 and all(point.attrs["href"].startswith("https://www.openstreetmap.org/") for point in points)
    assert all(point.children[0].tag == "bdi" for point in points)
    pov = [point for point in points if "az-pov" in point.classes]
    assert len(pov) == 1 and f"{FILMER[0]:.6f}" in pov[0].words()
    dates = figure.one(cls="az-dates").words()
    assert "Imagery: Esri World Imagery, about 3 June 2025" in dates and "Footage: 24 October 2025" in dates
    assert figure.one("a", "az-posted").attrs["href"].startswith("https://x.com/our_desk/")
    # the chain goes back through the frame to the post
    chain = figure.one("ol", "az-chain")
    assert any(node.attrs.get("href") == POST_URL for node in chain.find("a", "az-original"))


def test_a_pair_is_two_pictures_and_a_slider_each_half_dated(report):
    figure = report["page"].one("figure", "az-figure", data_kind="pair")
    compare = figure.one(cls="az-compare")
    tags = [(node.tag, sorted(node.classes)) for node in compare.children]
    assert tags[:3] == [("img", ["az-before"]), ("img", ["az-after"]), ("input", ["az-slider"])]
    slider = compare.one("input", "az-slider")
    assert slider.attrs["type"] == "range" and slider.attrs["value"] == "50" and slider.attrs["aria-label"]
    labels = compare.find(cls="az-side-label")
    assert [label.attrs["data-side"] for label in labels] == ["a", "b"]
    assert "12 March 2025" in labels[0].words() and "Esri Wayback" in labels[0].words()
    assert "about 26 October 2025" in labels[1].words()
    assert payload(compare.one("img", "az-before").attrs["src"]) != payload(compare.one("img", "az-after").attrs["src"])


def test_a_pair_kept_before_its_sides_stays_a_still(report):
    case, made = report["case"], report["made"]
    path = made["pair"]["path"]
    item = case.media_items_by_paths([path])[0]
    source = {key: value for key, value in item["source"].items() if key != "sides"}
    case.upsert_media_item({**item, "source": source}, entity_id=made["pair"]["id"])
    try:
        page = parse(notes_html.render(case, title="Still", text=f"[[media:{made['pair']['id']}|Pair]]",
                                       identity=notefill.Identity()).html)
    finally:
        case.upsert_media_item(item, entity_id=made["pair"]["id"])
    assert not page.find(cls="az-compare")
    assert page.one("figure", "az-figure", data_kind="picture")


def test_a_clip_plays_from_the_timecodes_that_name_it(report):
    figure = report["page"].one("figure", "az-figure", data_kind="clip")
    video = figure.one("video", "az-clip")
    if not report["made"]["clip"]["real"]:
        pytest.skip("ffmpeg not installed: the clip is a link")
    assert video.attrs["id"] == "clip-1" and video.attrs["preload"] == "metadata"
    assert video.attrs["src"].startswith("data:video/mp4;base64,") and video.attrs["poster"].startswith("data:image/")
    times = report["page"].find("a", "az-time")
    assert [(node.attrs["data-t"], node.attrs.get("data-end")) for node in times[:2]] == [("1", "4"), ("9", None)]
    assert all(node.attrs["href"] == "#clip-1" and node.attrs["data-clip"] == "clip-1" for node in times)


def test_a_clip_with_no_room_left_is_its_still_and_a_watch_link(report, monkeypatch):
    monkeypatch.setattr(notes_html, "MAX_BYTES", 2000)
    rendered = notes_html.render(report["case"], title=TITLE, text=report["text"], look=LOOK,
                                 identity=notefill.Identity(), created=CREATED)
    page = parse(rendered.html)
    figure = page.one("figure", "az-figure", data_kind="clip")
    assert figure.attrs["data-linked"] == "true" and not figure.find("video")
    watch = figure.one("a", "az-watch")
    assert watch.attrs["href"] == POST_URL and watch.attrs["target"] == "_blank"
    assert watch.attrs["rel"] == "noopener noreferrer" and watch.one("img", "az-poster")
    times = page.find("a", "az-watch")[1:]
    assert times and all(node.words().startswith("Watch [") for node in times)
    assert [said for said, _ in rendered.links] == ["The strike"]
    assert any("past the" in said for said in rendered.warnings)


def test_the_check_weighs_the_file_without_writing_a_clip(report):
    checked = notes_html.render(report["case"], title=TITLE, text=report["text"], look=LOOK,
                                identity=notefill.Identity(), created=CREATED, check=True)
    assert abs(checked.weight - len(report["internal"].html)) < 0.02 * len(report["internal"].html) + 4096
    assert "data:video/mp4" not in checked.html.decode("utf-8")


def test_a_reference_is_its_words_and_a_citation_its_entry(report):
    page = report["page"]
    references = page.find(cls="az-ref")
    assert references and all("entity" not in node.attrs.get("href", "") for node in references)
    entries = {node.attrs["id"] for node in page.one("section", "az-sources").find("li")}
    cites = page.find("a", "az-cite")
    assert cites
    for cite in cites:
        number = cite.attrs["data-src"]
        assert cite.attrs["href"] == f"#src-{number}" and f"src-{number}" in entries


def test_a_coded_row_can_be_linked_to(report):
    page = report["page"]
    wrap = page.one("div", "az-table-wrap")
    table = wrap.one("table", "az-table")
    assert table.attrs["data-rows"] == "14"
    rows = table.one("tbody").find("tr")
    assert [row.attrs.get("id") for row in rows][:3] == ["V01", "V02", "V03"]
    assert page.one("a", href="#V12")
    # a link to a row of the page is no fault on a page
    assert not any('"#V12"' in said for said in report["internal"].warnings)


def test_callouts_limits_and_the_internal_box(report):
    page, public = report["page"], report["public_page"]
    limits = page.one("aside", "az-callout", data_kind="limits")
    assert limits.attrs["id"] == "limits" and "minimum" in limits.words()
    assert page.one("aside", "az-callout", data_kind="confirmed")
    internal = page.one("aside", "az-internal")
    assert "asked not to be named" in internal.words()
    assert not public.find("aside", "az-internal")
    assert "asked not to be named" not in public.words()


def test_a_graphic_picture_is_veiled_and_announced(report):
    page = report["page"]
    figure = page.one("figure", "az-graphic")
    assert figure.attrs["data-graphic"] == "true"
    body = page.one("body")
    first = next(node for node in body.children if node.tag not in ("#root",))
    assert "az-graphic-warning" in first.classes


def test_the_steps_and_their_bar(report):
    section = report["page"].one("section", "az-steps")
    steps = section.find(cls="az-step")
    assert [step.attrs["data-step"] for step in steps] == ["1", "2", "3"]
    assert [step.attrs["data-label"] for step in steps] == ["23 Oct 2025", "24 Oct 2025", "25 Oct 2025"]
    assert all(step.one("figure", "az-figure") for step in steps)
    assert all(step.attrs["style"] == f"--az-n:{step.attrs['data-step']}" for step in steps)
    bar = section.one(cls="az-steps-bar")
    assert "hidden" in bar.attrs and len(bar.one("ol", "az-steps-dots").find("button")) == 3


def test_the_story_pairs_each_picture_with_its_words(report):
    story = report["page"].one("section", "az-story")
    figures = story.one(cls="az-story-figures").find("figure")
    steps = story.one(cls="az-story-steps").find(cls="az-story-step")
    assert [node.attrs["data-step"] for node in figures] == [node.attrs["data-step"] for node in steps] == ["1", "2"]
    assert figures[0].attrs["data-zoom"] == "0.3,0.4,0.4,0.4" and "data-zoom" not in figures[1].attrs
    assert "close order" in steps[0].words() and "pushed off the road" in steps[1].words()
    assert "under a minute" in story.one(cls="az-story-lead").words()


def test_the_sources_corrections_and_footer_close_the_page(report):
    page = report["public_page"]
    body = page.one("body")
    tail = [node for node in body.children if node.tag in ("section", "footer")]
    assert [sorted(node.classes)[0] for node in tail] == ["az-sources", "az-corrections", "az-footer"]
    sources = page.one("section", "az-sources")
    assert sources.attrs["id"] == "sources"
    assert sources.find(cls="az-hash") and sources.find("a", "az-verify") and sources.find("a", "az-posted")
    assert any(node.attrs.get("href") == ARCHIVE_URL for node in sources.find("a", "az-archive"))
    corrections = page.one("section", "az-corrections")
    assert "V10 is captured" in corrections.words() and "First edition." in corrections.words()
    footer = page.one("footer", "az-footer")
    assert "Public edition" in footer.words() and report["public"].text_sha256 in footer.words()
    # an internal page has no earlier edition to list
    assert not report["page"].find("section", "az-corrections")


def test_a_diagram_is_inline_svg_with_its_own_ids_and_nothing_that_runs(report):
    figure = report["page"].one("figure", "az-figure", data_kind="diagram")
    svg = figure.one("svg")
    assert svg.attrs["id"] == "az-diagram-1"
    assert not figure.find("script") and not figure.find("foreignobject")
    assert all(not name.startswith("on") for node in svg.walk() for name in node.attrs)
    assert all(node.attrs.get("href", "#").startswith("#") for node in svg.walk())
    assert "#az-diagram-1 .label" in svg.one("style").text and "azimut-mermaid-0" not in svg.one("style").text


def test_a_diagram_with_no_svg_says_so_its_source_a_press_away(report):
    rendered = notes_html.render(None, title="T", text=f"```mermaid\n{DIAGRAM}```\n", identity=notefill.Identity())
    page = parse(rendered.html)
    figure = page.one("figure", "az-figure", data_kind="diagram")
    assert figure.attrs["data-missing"] == "true" and not figure.find("svg")
    assert figure.one("p", "az-diagram-missing").words() == "Diagram not drawn in this file."
    details = figure.one("details")
    assert details.one("summary").words() == "Its source" and "A[Post] --> B[Clip]" in details.one("pre").words()
    assert rendered.diagrams == [(notes_markdown.diagram_key(DIAGRAM), DIAGRAM)]


def test_the_app_never_signs_the_cover_and_a_kicker_is_the_looks_own():
    def kicker(look):
        page = parse(notes_html.render(None, title="T", text="Words.", look=look, identity=notefill.Identity()).html)
        return [node.words() for node in page.find(cls="az-kicker")]

    assert kicker(None) == []
    assert kicker(NoteLook(style="plain", cover={"on": True})) == []
    assert kicker(NoteLook(style="report")) == []
    assert kicker(NoteLook(style="report", cover={"on": True})) == ["Report"]
    assert kicker(NoteLook(style="brief", cover={"on": True})) == ["Brief"]
    assert "Azimut".casefold() not in parse(notes_html.render(None, title="T", text="Words.",
                                                              identity=notefill.Identity()).html).one(
        "header").words().casefold()


# -- what a published file never holds ---------------------------------------------------


def _outside_data(document: bytes) -> str:
    return re.sub(r"data:[\w/+.-]+;base64,[A-Za-z0-9+/=]+", "data:", document.decode("utf-8"))


def test_the_public_file_holds_no_internal_passage_guidance_or_comment(report):
    text = _outside_data(report["public"].html)
    assert "asked not to be named" not in text and "Keep their handle out" not in text
    assert "Write the summary first" not in text
    assert "a comment the page must not carry" not in text
    assert not Page(report["public"].html.decode("utf-8")).comments


def test_the_public_file_names_no_record_and_no_path(report):
    text = _outside_data(report["public"].html)
    case = report["case"]
    for item in report["made"].values():
        for one in item if isinstance(item, list) else [item]:
            assert one["id"] not in text
    assert "azimut://" not in text and "[[entity:" not in text and "[[media:" not in text
    assert str(case.path) not in text and f"/files/{case.id}" not in text
    assert str(report["home"]) not in text and str(Path.home()) not in text
    assert "/home/analyst" not in text


def test_every_resource_is_inside_the_file_and_only_links_reach_out(report):
    page = report["public_page"]
    for node in page.walk():
        for name, value in node.attrs.items():
            if name in ("src", "poster"):
                assert value.startswith(("data:", "#")), (node.tag, value[:60])
            if re.match(r"\s*https?:", value):
                assert node.tag == "a" and name == "href", (node.tag, name, value)
    css = "\n".join(node.text for node in page.find("style")) + "\n".join(
        node.attrs.get("style", "") for node in page.walk())
    for found in re.findall(r"url\(\s*['\"]?([^)'\"]*)", css):
        assert found.startswith(("data:", "#")), found[:60]
    for link in page.find("a"):
        if link.attrs.get("href", "").startswith("http"):
            assert link.attrs["target"] == "_blank" and link.attrs["rel"] == "noopener noreferrer"
    assert not any(link.attrs.get("href", "").startswith(("javascript:", "file:", "http://localhost"))
                   for link in page.find("a"))


def test_pictures_leave_their_exif_gps_and_text_behind(report):
    page = report["public_page"]
    jpegs = pngs = 0
    for image in page.find("img"):
        src = image.attrs["src"]
        if src.startswith("data:image/jpeg"):
            data = payload(src)
            jpegs += 1
            with Image.open(io.BytesIO(data)) as picture:
                assert not picture.getexif(), "EXIF left in a JPEG"
            assert b"Exif" not in data[:4096] and b"taken by a named person" not in data
        elif src.startswith("data:image/png"):
            data = payload(src)
            pngs += 1
            with Image.open(io.BytesIO(data)) as picture:
                assert not getattr(picture, "text", {}), "a PNG kept its text"
            assert PNG_SECRET.encode() not in data
    assert jpegs and pngs  # the overlay shows through, so it stays a PNG


@pytest.mark.skipif(not notes_html.ffmpeg_engine.ffmpeg_available(), reason="ffmpeg not installed")
def test_a_clip_leaves_its_container_metadata_behind(report):
    video = report["public_page"].one("video", "az-clip")
    data = payload(video.attrs["src"])
    assert CLIP_SECRET.encode() not in data
    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as handle:
        handle.write(data)
    try:
        probe = subprocess.run(
            [notes_html.ffmpeg_engine.ffprobe_exe(), "-v", "error", "-show_entries", "format_tags", "-of", "json",
             handle.name], capture_output=True, text=True, check=True, timeout=30,
        ).stdout
    finally:
        Path(handle.name).unlink()
    assert "Filmed at" not in probe and "location" not in probe.lower()


def test_coordinates_and_plus_codes_are_isolated_with_bdi_never_marks(report):
    page = report["page"]
    coords = page.one("a", "az-coords")
    assert coords.children[0].tag == "bdi" and "15.4127, 44.2381" in coords.words()
    assert any(node.words() == "7HXQ8C2X+3G" for node in page.find("bdi"))
    text = report["internal"].html.decode("utf-8")
    assert not re.search("[⁦-⁩‪-‮]", text)


def test_right_to_left_words_read_as_they_are_written():
    note = "## ضربة على المرفأ\n\nشوهد الدخان فوق الرصيف ١٢ صباح الثلاثاء، 14.7980, 42.9540.\n"
    page = parse(notes_html.render(None, title="تقرير", text=note, identity=notefill.Identity()).html)
    heading = page.one("h2")
    assert heading.attrs["dir"] == "auto" and heading.words() == "ضربة على المرفأ"
    paragraph = page.one("main").one("p")
    assert paragraph.attrs["dir"] == "auto" and paragraph.one("bdi").words() == "14.7980, 42.9540"


def test_credits_stay_beside_their_picture_and_street_view_is_said_once(report):
    page = report["page"]
    street = next(node for node in page.find("figure", "az-figure") if "Street level" in node.words())
    assert "Street View" in street.one(cls="az-credit").words()
    notices = [said for said in report["internal"].warnings if "Street View" in said]
    assert len(notices) == 1


def test_a_link_no_reader_can_open_keeps_its_words_only():
    note = ("[here](http://localhost:8477/x), [there](http://192.168.1.4/y), [mail](mailto:a@example.org) "
            "and file:///home/analyst/z.png\n")
    page = parse(notes_html.render(None, title="T", text=note, identity=notefill.Identity()).html)
    hrefs = [node.attrs.get("href") for node in page.one("main").find("a")]
    assert hrefs == ["mailto:a@example.org"]
    assert "here" in page.words() and "[a local file]" in page.words() and "/home/analyst" not in page.words()


# -- what the check reads off it ----------------------------------------------------------


def test_points_of_view_are_listed_and_rounded_on_demand(report):
    exact = report["internal"].pov
    assert len(exact) == 1 and f"{FILMER[0]:.6f}, {FILMER[1]:.6f}" in exact[0][0]
    rounded = notes_html.render(report["case"], title=TITLE, text=report["text"], look=LOOK,
                                identity=notefill.Identity(), created=CREATED, public=True, round_pov=True)
    page = parse(rounded.html)
    point = page.one("a", "az-pov")
    shown = point.words()
    lat, lon = (float(part) for part in shown.split(","))
    assert shown != f"{FILMER[0]:.6f}, {FILMER[1]:.6f}" and abs(lat - FILMER[0]) < 0.0015 and abs(lon - FILMER[1]) < 0.0015
    assert f"{FILMER[0]:.6f}" not in _outside_data(rounded.html)
    assert "rounded to about 150 m" in page.one(cls="az-pov-note").words()
    # the junction itself is no point of view and keeps its digits
    assert "15.412700, 44.238100" in page.one("figure", "az-figure", data_kind="proof").words()


def test_a_count_read_as_exact_is_one_warning_a_minimum_or_range_is_not():
    note = ("At least 60 vehicles, 40–60 trucks, 40 to 60 tanks, about 30 people, up to 9 drones and some 12 "
            "tanks were seen; over 5 boats, more than 4 homes, ~8 strikes, ≥3 buildings. We saw 12 trucks, "
            "**at least** 7 pickups and 3 civilians, and 12 trucks again. 200 base, 2 above, 6 distant, 6 BATT, "
            "8 Tygor, 35 identified, a T-72 tank, 14 km, 90% sure, 2024 and `19 vehicles` in code.\n\n"
            "| Count | What |\n|---|---|\n| 19 vehicles | in a table |\n\n## 4 tanks in a heading\n\n"
            "> 5 fighters in a quote.\n\n- 2 soldiers in a list\n")
    rendered = notes_html.render(None, title="T", text=note, identity=notefill.Identity())
    counts = [said for said, kind in zip(rendered.warnings, rendered.warning_kinds) if kind == notes_html.COUNT]
    assert counts == ['3 counts read as exact: "12 trucks", "3 civilians", "2 soldiers". '
                      'Say "at least" or give a range.']
    # a confidence is printed as typed
    assert "90% sure" in parse(rendered.html).words()


def test_more_counts_than_the_warning_quotes_are_counted_and_cut():
    note = "".join(f"We saw {number} {noun}. " for number, noun in
                   ((2, "tanks"), (3, "trucks"), (4, "boats"), (5, "drones"), (6, "homes"), (7, "people")))
    rendered = notes_html.render(None, title="T", text=note, identity=notefill.Identity())
    counts = [said for said, kind in zip(rendered.warnings, rendered.warning_kinds) if kind == notes_html.COUNT]
    assert counts == ['6 counts read as exact: "2 tanks", "3 trucks", "4 boats", "5 drones", "6 homes", … '
                      'Say "at least" or give a range.']
    single = notes_html.render(None, title="T", text="We saw 2 tanks.", identity=notefill.Identity())
    assert single.warnings == ['1 count reads as exact: "2 tanks". Say "at least" or give a range.']
    # one phrase written twice is one count, as it is one quote
    twice = notes_html.render(None, title="T", text="We saw 19 vehicles. Then 19 vehicles again.",
                              identity=notefill.Identity())
    assert twice.warnings == ['1 count reads as exact: "19 vehicles". Say "at least" or give a range.']


def test_the_check_says_what_the_pdf_check_says(report):
    kinds = set(report["internal"].warning_kinds)
    assert {"unsourced", "open-task", "local-link", "count"} <= kinds
    assert set(report["internal"].warning_kinds) <= set(notes_html.WARNING_KINDS)


def test_the_public_edition_refuses_a_page_with_a_passage_left(monkeypatch):
    monkeypatch.setattr(notes_markdown, "strip_internal", lambda text: (text, 0))
    with pytest.raises(notes_html.NotesHtmlError):
        notes_html.render(None, title="T", text="Body.\n\n> [!internal] Secret.\n", public=True,
                          identity=notefill.Identity())


def test_a_plain_look_uses_the_readers_fonts_and_a_styled_one_brings_its_own(report):
    plain = parse(notes_html.render(None, title="T", text="Words.", identity=notefill.Identity()).html)
    assert not plain.find("style", id="az-fonts")
    faces = report["page"].one("style", id="az-fonts").text
    assert faces.count("@font-face") == 6 and 'font-family:"az-body"' in faces and 'font-family:"az-head"' in faces
    woff = payload(re.search(r"url\((data:font/woff;base64,[^)]+)\)", faces).group(1))
    assert woff[:4] == b"wOFF"


def test_a_written_width_and_alignment_reach_the_figure(report):
    figure = next(node for node in report["page"].find("figure", "az-figure") if "lead tank stops" in node.words())
    assert figure.attrs["data-width"] == "70%" and figure.attrs["style"] == "--az-width:70%"
    assert figure.attrs["data-align"] == "center"


# -- the shared reading -------------------------------------------------------------------


def test_steps_and_story_blocks_cut_every_picture_into_a_step():
    text = ("::: steps\n![a](/x/a.png){caption=\"2 Mar 2026, One\"}\n![b](/x/b.png)\n:::\n\n"
            "::: story\n![w](/x/w.png){zoom=0.2,0.3,0.4,0.4 graphic}\nWords of one.\n:::\n")
    blocks = notes_markdown.alignment_blocks(text)
    kinds = [block.kind for block in blocks if block.tokens]
    assert kinds == ["steps", "story"]
    steps, story = (block for block in blocks if block.kind)
    lone = [token for token in steps.tokens if token.type == "inline"]
    assert [[child.type for child in token.children] for token in lone] == [["image"], ["image"]]
    inline = [token for token in story.tokens if token.type == "inline"]
    assert [token.children[0].type for token in inline] == ["image", "text"]
    src = inline[0].children[0].attrGet("src")
    assert notes_markdown.image_zoom(src) == (0.2, 0.3, 0.4, 0.4) and notes_markdown.image_graphic(src)
    assert notes_markdown.image_options(src).width == ""  # the PDF reads no width from either


@pytest.mark.parametrize("written", ["zoom=0.5,0.5,0.6,0.1", "zoom=0,0,0,0.5", "zoom=a,b,c,d", "graphics"])
def test_a_zoom_that_is_no_rectangle_is_none_and_graphic_is_a_word(written):
    src = notes_markdown.case_references(f"![x](/x.png){{{written}}}")
    href = re.search(r"\]\(([^)]+)\)", src).group(1)
    assert notes_markdown.image_zoom(href) is None
    assert not notes_markdown.image_graphic(href)


def test_the_pdf_prints_steps_and_story_as_written_each_picture_a_figure(tmp_path):
    from test_notes_pdf import FakeCase, png

    case = FakeCase(tmp_path)
    png(tmp_path, "one.png")
    png(tmp_path, "two.png", color="#a05030")
    one, two = "/files/demo/one.png", "/files/demo/two.png"
    text = (f"Before.\n\n::: steps\n![First]({one}){{caption=\"2 Mar 2026, The first\"}}\n![Second]({two})\n:::\n\n"
            f"::: story\n![Wide]({one}){{zoom=0.1,0.1,0.5,0.5}}\nThe words of the step.\n:::\n\nAfter.\n")
    rendered = notes_pdf.render(case, title="Steps", text=text)
    words = pdf_text(rendered.pdf)
    assert ":::" not in words and "steps" not in words.split()
    assert "2 Mar 2026, The first" in words and "The words of the step." in words
    assert words.index("Before.") < words.index("The words of the step.") < words.index("After.")
    assert len(rendered.pictures) == 3
    assert not any("[First]" in warning or "[Wide]" in warning for warning in rendered.warnings)


def test_the_pdf_boxes_a_limits_callout():
    rendered = notes_pdf.render(None, title="T", text="> [!limits] The count is a minimum.\n",
                                look=NoteLook(style="report"))
    words = pdf_text(rendered.pdf)
    assert "LIMITS" in words and "[!limits]" not in words


def test_a_gif_that_moves_keeps_moving_without_its_comment(tmp_path):
    frames = [Image.new("RGB", (60, 40), colour) for colour in ((200, 0, 0), (0, 200, 0))]
    frames[0].save(tmp_path / "blink.gif", save_all=True, append_images=frames[1:], duration=[300, 500], loop=0,
                   comment=b"filmed by a named person")
    data, mime, size = notes_html._encode_picture(tmp_path / "blink.gif", notes_html.PICTURE_SIDE)
    assert mime == "image/gif" and size == (60, 40) and b"named person" not in data
    with Image.open(io.BytesIO(data)) as moving:
        assert moving.n_frames == 2



def _faces(document: bytes) -> list:
    from fontTools.ttLib import TTFont

    faces = re.findall(r"url\(data:font/woff;base64,([^)]+)\)", document.decode("utf-8"))
    return [TTFont(io.BytesIO(base64.b64decode(face))).getBestCmap() for face in faces]


def test_a_word_written_in_lower_case_and_shown_in_capitals_has_every_glyph():
    """The stylesheet upper-cases labels: a face cut to the page's lower case letters
    drew `LI MITS` with a gap where another face stood in."""
    look = NoteLook(style="brief")
    note = "> [!limits] détruits, abîmés, straße, øre, ünd.\n\nWords in lower case only: ça, œuvre, ægir.\n"
    rendered = notes_html.render(None, title="t", text=note, look=look, identity=notefill.Identity())
    faces = _faces(rendered.html)
    assert faces
    shown = "LIMITS DÉTRUITS ABÎMÉS STRASSE ØRE ÜND ÇA ŒUVRE ÆGIR CONTENTS SOURCES"
    for cmap in faces:
        assert not [char for char in shown if not char.isspace() and ord(char) not in cmap]


def test_every_character_the_reader_writes_itself_is_in_each_face():
    """What reader.css and reader.js put on the page themselves (counters, `2 / 4`,
    `×`, `‹ ›`, `↗`) is drawn in the page's own face wherever that face has it."""
    from fontTools.ttLib import TTFont

    from azimut.engine import pdffonts

    own = {char for name in notes_html.ASSET_NAMES
           for char in (notes_html.ASSETS / name).read_text(encoding="utf-8")
           if not char.isspace() and ord(char) >= 0x20}
    own |= set(notes_html.ALWAYS_DRAWN) - {" "}
    rendered = notes_html.render(None, title="t", text="Words.", look=NoteLook(style="report"),
                                 identity=notefill.Identity())
    whole = TTFont(str(pdffonts.FONT_DIR / "NotoSerif-Regular.ttf")).getBestCmap()
    cmap = _faces(rendered.html)[0]
    missing = [char for char in own if ord(char) in whole and ord(char) not in cmap]
    assert not missing, missing
    assert all(char in own for char in "0123456789/·↗‹›×…→‘’“”–—")


def test_a_figure_has_one_credit_line_each_name_said_once(client):
    """A proof made from eight Apple Maps captures credited them as "Apple Maps · Apple
    Maps · Data from TomTom… +7" and said "Imagery: Apple Maps" again under it."""
    from azimut.engine import links as link_engine
    from azimut.engine import media as media_engine
    from test_notes_report import make_case

    case = Case.open(make_case(client, "Credits"))
    notice = "Data from TomTom, © OpenStreetMap and other data providers"
    captures = []
    for index, provider in enumerate(("Apple Maps", "Apple Maps", "APPLE MAPS", "Apple Maps")):
        filed = media_engine.import_image(case, Image.new("RGB", (40, 30), (index * 40, 90, 90)), f"c{index}.png", {
            "type": "satellite", "provider": "apple", "provider_label": provider,
            "attribution": f"{provider} · {notice}"}, title=f"Capture {index}", dedupe=False, entity_type="capture")
        captures.append(filed["item"]["path"])
    picture = media_engine.import_image(case, Image.new("RGB", (40, 30)), "proof.png", {"type": "clipboard"},
                                        title="Where they lie", dedupe=False)
    link_engine.link_all(case, picture["entity"]["id"], link_engine.DERIVED_FROM, captures, by="proof-composer")
    many = media_engine.import_image(case, Image.new("RGB", (40, 30)), "many.png", {"type": "clipboard"},
                                     title="Many", dedupe=False)
    others = []
    for index, provider in enumerate(("Esri World Imagery", "Google Satellite", "Bing", "Yandex", "Mapbox")):
        filed = media_engine.import_image(case, Image.new("RGB", (40, 30), (9, index * 40, 9)), f"o{index}.png", {
            "type": "satellite", "provider_label": provider, "imagery_date": "2025-06-0" + str(index + 1)},
            title=f"Other {index}", dedupe=False, entity_type="capture")
        others.append(filed["item"]["path"])
    link_engine.link_all(case, many["entity"]["id"], link_engine.DERIVED_FROM, others, by="proof-composer")
    note = (f"[[media:{picture['entity']['id']}|Where they lie]]{{caption=\"Imagery: Apple Maps.\"}}\n\n"
            f"[[media:{many['entity']['id']}|Many]]\n")
    page = parse(notes_html.render(case, title="T", text=note, identity=notefill.Identity()).html)
    first, second = page.find("figure", "az-figure")
    credits = first.find(cls="az-credit")
    assert len(credits) == 1 and not first.find(cls="az-dates")
    said = credits[0].words()
    assert said.startswith("Imagery: Apple Maps · " + notice) and "+" not in said
    assert said.casefold().count("apple maps") == 1 and said.count(notice) == 1
    # the caption keeps its own words
    assert first.one(cls="az-caption").words() == "Imagery: Apple Maps."
    more = second.one(cls="az-credit").words()
    assert more.startswith("Imagery: Esri World Imagery, 1 June 2025 · ") and more.endswith("and 1 more")
