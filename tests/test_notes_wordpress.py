"""A note sent to WordPress as a draft: the block markup, the REST flow and the secret.

The markup is held three ways: a golden of the ambush register and of a note made of
every block (both normalised for hashes and the day the test runs), a reading of the
block grammar that checks every block's own markup against what WordPress's editor
writes for it, and, outside this suite, the same drafts opened in a real WordPress 7.1
whose editor found every block valid. The flow runs against a WordPress faked with
`httpx.MockTransport`: pictures first, then the post, always as a draft.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import stat
import sys
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from PIL import Image

from azimut import config
from azimut.engine import notefill, notes_markdown, notes_wordpress, publishsecrets
from azimut.engine import notes_html as report
from azimut.engine.notelook import NoteLook
from azimut.workspace import Case

from sourcesfixture import AS_BEFORE
from ambushfixture import (
    DIAGRAM,
    PNG_SECRET,
    _ground,
    _image,
    _terrain,
    ambush_case,
    ambush_note,
)
from test_notes_report import make_case, make_note

FIXTURES = Path(__file__).parent / "fixtures"
TITLE = "Ambush on the Wadi Sahm road"
#: A report as it printed before styles carried profiles; what one carries now is `test_notes_profiles.py`'s.
LOOK = NoteLook.model_validate({"style": "report", "cover": {"on": True, "subtitle": "What open sources show",
                                                               "date": "2025-10-28"}, **AS_BEFORE})
CREATED = datetime(2025, 10, 28, 12, 0)
#: What the internal passage of the ambush note says, which no request may carry.
SECRET = "The second source asked not to be named"
APP_PASSWORD = "abcd EFGH 1234 ijkl MNOP 6789"


def _diagram_png() -> bytes:
    buffer = io.BytesIO()
    image = Image.new("RGB", (480, 120), "white")
    image.info["comment"] = "drawn"
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _placed(draft: notes_wordpress.Draft) -> dict[int, dict[str, Any]]:
    return {index: {"id": 100 + index, "url": f"https://desk.example.org/wp-content/uploads/{upload.name}",
                    "full": f"https://desk.example.org/wp-content/uploads/{upload.name}", "size": "large"}
            for index, upload in enumerate(draft.uploads)}


MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December"


def _normalised(markup: str) -> str:
    """The markup without what changes from one machine or day to the next: hashes, the
    names they make, and the day a picture was filed (the fixture files them today)."""
    markup = re.sub(r"\b[0-9a-f]{64}\b", "<sha256>", markup)
    markup = re.sub(r"-[0-9a-f]{8}\.(jpg|png|gif|mp4)", r"-<sha8>.\1", markup)
    return re.sub(rf"\b(made|collected|captured) \d{{1,2}} (?:{MONTHS}) \d{{4}}", r"\1 <day>", markup)


def _golden(name: str, markup: str) -> None:
    path = FIXTURES / name
    written = _normalised(markup)
    if os.environ.get("AZIMUT_WRITE_GOLDEN"):
        path.write_text(written, encoding="utf-8")
    assert written == path.read_text(encoding="utf-8"), f"the draft's markup moved from {path.name}"


@pytest.fixture(scope="module")
def ambush(tmp_path_factory):
    """The ambush register in a workspace of its own, made into a draft once."""
    home = tmp_path_factory.mktemp("wordpress")
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("AZIMUT_HOME", str(home))
        patch.setattr(config, "_pointer_dir", lambda: home / ".pointer")
        patch.setattr(config, "DEFAULT_ROOT", home)
        # a clip copied the same way on every machine, ffmpeg or not
        patch.setattr(report, "_clip_bytes", lambda path: b"\x00\x00\x00\x18ftypmp42 a clip without metadata")
        config.forget_workspace_root()
        case = Case.create("Wadi Sahm ambush")
        made = ambush_case(case)
        text = ambush_note(made)
        draft = notes_wordpress.build(case, title=TITLE, text=text, look=LOOK, identity=notefill.Identity(),
                                      created=CREATED, diagrams={notes_markdown.diagram_key(DIAGRAM): _diagram_png()})
        yield {"case": case, "made": made, "text": text, "draft": draft,
               "markup": draft.markup(_placed(draft))}
        config.forget_workspace_root()


# -- the markup -----------------------------------------------------------------------


def test_the_ambush_register_as_block_markup(ambush):
    _golden("wordpress-ambush.html", ambush["markup"])


def test_a_note_of_every_block_as_block_markup(tmp_workspace, monkeypatch):
    monkeypatch.setattr(config, "DEFAULT_ROOT", Path(tmp_workspace))
    case = Case.create("Every block")
    wide = _image(case, "The road at dawn", _ground(5), {"type": "clipboard"})
    sat = _image(case, "The bridge", _terrain((900, 500), 9), {
        "type": "satellite", "provider": "esri-world-imagery", "provider_label": "Esri World Imagery",
        "attribution": "Esri, Maxar", "imagery_date": "2025-06-03", "imagery_exact": True,
        "lat": 15.4, "lon": 44.2, "zoom": 17, "fetched_at": "2025-10-26T10:00:00Z"}, entity_type="capture")
    text = f"""# Every block

Words with **bold**, *italic*, ~~struck~~, `code`, a [link](https://example.org/a?b=1&c=2) and
a hard break\\
right here, at 15.41270, 44.23810.

## Pictures

[[media:{wide['id']}|The road at dawn]]{{align=center caption="Dawn over the road"}}

The bridge is [[media:{sat['id']}|seen from above]] too.

[[media:{sat['id']}|The bridge]]{{graphic caption="The bridge, struck"}}

### Lists

3. third
4. fourth
   - nested <one>
   - [x] done

> A quote over
> two lines.
>
> And a second paragraph.

> [!warning] Mind the gap.

| Left | Right |
|:-----|------:|
| a & b | 1 |

```python
print("<hi>")
```

---

::: map
title: Front line
layers: abc
:::

## Method

[a part of this page](#lists) and [one that is not](#nowhere).
"""
    draft = notes_wordpress.build(case, title="Every block", text=text, identity=notefill.Identity(),
                                  created=CREATED)
    assert draft.left["maps"] == 1
    assert notes_wordpress.left_said(draft.left) == "1 interactive map stays out."
    markup = draft.markup(_placed(draft))
    _golden("wordpress-every-block.html", markup)
    blocks = _blocks(markup)
    # the first heading only repeats the title, which the post has already
    assert [name for name, _, _ in blocks if name != "list-item"] == [
        "paragraph", "paragraph", "heading", "image", "paragraph", "details", "image", "heading", "list", "list",
        "quote", "paragraph", "paragraph", "paragraph", "table", "code", "separator", "heading", "paragraph"]
    figure = draft.uploads[1]
    assert figure.alt == "The bridge" and figure.name.startswith("the-bridge-"), "the figure describes the picture"
    assert "☑ done" in markup and 'href="#lists"' in markup and "#nowhere" not in markup


#: What WordPress's editor writes for each block this module makes, its inner blocks taken
#: out: the `save` output a block is checked against when the editor opens it.
SAVED = {
    "paragraph": re.compile(r'<p(?: class="wp-element-caption")?(?: id="[\w-]+")?>.*</p>', re.S),
    "heading": re.compile(r'<h([1-6]) class="wp-block-heading"(?: id="[\w:.-]+")?>.*</h\1>', re.S),
    "list": re.compile(r'<(ul|ol)(?: start="\d+")? class="wp-block-list">(?:\x01)*</\1>'),
    "list-item": re.compile(r'<li(?: id="source-\d+")?>.*</li>', re.S),
    "quote": re.compile(r'<blockquote class="wp-block-quote">(?:\x01)*</blockquote>'),
    "image": re.compile(r'<figure class="wp-block-image(?: aligncenter)? size-(large|full)">(?:<a href="[^"]+">)?'
                        r'<img src="https?://[^"]+" alt="[^"]*" class="wp-image-(\d+)"/>(?:</a>)?'
                        r'(?:<figcaption class="wp-element-caption">.*</figcaption>)?</figure>', re.S),
    "video": re.compile(r'<figure class="wp-block-video"><video controls(?: poster="https?://[^"]+")? '
                        r'src="https?://[^"]+"></video>(?:<figcaption class="wp-element-caption">.*</figcaption>)?'
                        r"</figure>", re.S),
    "columns": re.compile(r'<div class="wp-block-columns">(?:\x01)+</div>'),
    "column": re.compile(r'<div class="wp-block-column">(?:\x01)+</div>'),
    "details": re.compile(r'<details class="wp-block-details"><summary>[^<]+</summary>(?:\x01)+</details>'),
    "table": re.compile(r'<figure class="wp-block-table(?: is-style-stripes)?"><table>(?:<thead><tr>.*?</tr></thead>)?'
                        r'<tbody>.*</tbody></table>(?:<figcaption class="wp-element-caption">.*</figcaption>)?</figure>', re.S),
    "separator": re.compile(r'<hr class="wp-block-separator has-alpha-channel-opacity"/>'),
    "code": re.compile(r'<pre class="wp-block-code"><code>[^<]*</code></pre>', re.S),
}
DELIMITER = re.compile(r"<!-- (/)?wp:([a-z][a-z0-9_-]*)(?: (\{.*?\}))? (/)?-->")


def _blocks(markup: str) -> list[tuple[str, dict[str, Any], str]]:
    """Every block, in order, read with WordPress's block grammar: its name, its
    attributes and its own markup with each inner block as `\\x01`. Fails on a block left
    open, closed out of turn, or whose attributes are not JSON."""
    found: list[tuple[str, dict[str, Any], str]] = []
    stack: list[tuple[str, dict[str, Any], int, list[str]]] = []
    at = 0
    for match in DELIMITER.finditer(markup):
        closing, name, attrs, void = match.group(1), match.group(2), match.group(3), match.group(4)
        between = markup[at:match.start()]
        if stack:
            stack[-1][3].append(between)
        else:
            assert not between.strip(), f"markup outside any block: {between[:80]!r}"
        at = match.end()
        if closing:
            opened, parsed, index, parts = stack.pop()
            assert opened == name, f"wp:{name} closes wp:{opened}"
            own = "".join(parts)
            assert own.startswith("\n") and own.endswith("\n"), f"wp:{name} is not on lines of its own"
            found[index] = (name, parsed, own[1:-1])
            if stack:
                stack[-1][3].append("\x01")
            continue
        parsed = json.loads(attrs) if attrs else {}
        assert not void
        found.append((name, parsed, ""))
        stack.append((name, parsed, len(found) - 1, []))
    assert not stack, f"wp:{stack[-1][0]} is left open"
    assert not markup[at:].strip()
    return found


@pytest.mark.parametrize("which", ["ambush", "every"])
def test_every_block_is_what_the_editor_would_write(ambush, which):
    markup = ambush["markup"] if which == "ambush" else (FIXTURES / "wordpress-every-block.html").read_text("utf-8")
    blocks = _blocks(markup.replace("<sha256>", "0" * 64))
    assert blocks
    for name, attrs, own in blocks:
        own = re.sub(r"\n\n", "", own)
        pattern = SAVED[name]
        match = pattern.fullmatch(own)
        assert match, f"wp:{name} {attrs} does not read as the editor writes it:\n{own[:300]}"
        if name == "image":
            assert match.group(2) == str(attrs["id"]) and attrs["sizeSlug"] == match.group(1)
            assert attrs["linkDestination"] in ("none", "media", "custom")
        if name == "heading":
            assert attrs.get("level", 2) == int(match.group(1))
        if name == "list":
            assert attrs.get("ordered", False) == (match.group(1) == "ol")
        if name == "table":
            striped = 'class="wp-block-table is-style-stripes"' in own
            assert attrs == {"hasFixedLayout": False, **({"className": "is-style-stripes"} if striped else {})}
        if name == "paragraph" and 'class="wp-element-caption"' in own:
            assert attrs == {"className": "wp-element-caption"}


def test_attributes_are_written_as_wordpress_escapes_them():
    said = notes_wordpress.block("paragraph", "<p>x</p>", {"className": "a--b <c> & \"d\""})
    assert said.startswith('<!-- wp:paragraph {"className":"a\\u002d\\u002db \\u003cc\\u003e \\u0026 \\u0022d\\u0022"} -->')
    assert "--b" not in said.split("-->")[0][4:]


def test_the_draft_holds_the_public_edition_and_says_what_stayed_out(ambush):
    draft, markup = ambush["draft"], ambush["markup"]
    assert SECRET not in markup and "[!internal]" not in markup
    assert all(SECRET not in upload.caption and SECRET not in upload.alt for upload in draft.uploads)
    assert draft.left == {"internal": 1, "maps": 0, "clips": 0, "diagrams": 0, "other": 0}
    assert notes_wordpress.left_said(draft.left) == "1 internal passage stays out."
    assert "\x00" not in markup and "a comment the page must not carry" not in markup
    assert draft.excerpt == "What open sources show"
    assert draft.title == TITLE


def test_every_citation_links_to_a_numbered_source(ambush):
    markup = ambush["markup"]
    cited = set(re.findall(r'href="#source-(\d+)"', markup))
    listed = set(re.findall(r'<li id="source-(\d+)">', markup))
    assert cited and cited <= listed
    assert 'Check on Esri Wayback</a>' in markup and "Archived copy</a>" in markup


def test_a_comparison_is_two_pictures_side_by_side_each_labelled(ambush):
    blocks = _blocks(ambush["markup"])
    names = [name for name, _, _ in blocks]
    at = names.index("columns")
    assert names[at:at + 5] == ["columns", "column", "image", "column", "image"]
    labels = [own for name, _, own in blocks[at:at + 5] if name == "image"]
    assert "Before: Esri Wayback, 12 March 2025</figcaption>" in labels[0]
    assert "After: Esri World Imagery, about 26 October 2025</figcaption>" in labels[1]
    caption = blocks[at + 5]
    assert caption[0] == "paragraph" and caption[1] == {"className": "wp-element-caption"}


def test_a_graphic_picture_is_folded_and_said_once(ambush):
    markup = ambush["markup"]
    assert markup.count("<!-- wp:details -->") == 1
    assert f"<summary>{notes_wordpress.GRAPHIC_SUMMARY}</summary>" in markup
    assert markup.startswith("<!-- wp:paragraph -->\n<p><em>This article holds graphic pictures")


def test_pictures_go_up_without_their_metadata(ambush):
    for upload in ambush["draft"].uploads:
        assert PNG_SECRET.encode() not in upload.data and b"Exif" not in upload.data[:4096]
        if upload.mime.startswith("image/"):
            with Image.open(io.BytesIO(upload.data)) as image:
                assert not image.getexif().get_ifd(0x8825), upload.name
                assert "comment" not in image.info and not any(key.startswith("XML") for key in image.info)
    names = [upload.name for upload in ambush["draft"].uploads]
    assert len(names) == len(set(names))
    assert not any(str(ambush["case"].path) in upload.caption for upload in ambush["draft"].uploads)


def test_a_diagram_goes_as_a_png_and_one_not_drawn_stays_out(ambush, tmp_workspace, monkeypatch):
    diagrams = [upload for upload in ambush["draft"].uploads if upload.alt == "Diagram"]
    assert len(diagrams) == 1 and diagrams[0].mime == "image/png"
    with Image.open(io.BytesIO(diagrams[0].data)) as image:
        assert "comment" not in image.info
    draft = notes_wordpress.build(None, title="Diagram", text=f"```mermaid\n{DIAGRAM}```\n", identity=notefill.Identity())
    assert draft.left["diagrams"] == 1 and "wp:image" not in draft.content


def test_a_clip_past_the_budget_is_its_still_and_a_link(ambush, monkeypatch):
    monkeypatch.setattr(report, "MAX_BYTES", 10)
    draft = notes_wordpress.build(ambush["case"], title=TITLE, text=ambush["text"], look=LOOK,
                                  identity=notefill.Identity(), created=CREATED, check=True)
    assert draft.left["clips"] == 1 and not any(upload.mime.startswith("video/") for upload in draft.uploads)
    markup = draft.markup(_placed(draft))
    assert '"linkDestination":"custom"' in markup and "Watch on X</a>" in markup
    assert notes_wordpress.left_said(draft.left) == (
        "1 internal passage and 1 diagram stay out. 1 clip goes as its still and a link.")


def test_a_public_page_with_a_passage_left_is_refused(monkeypatch):
    monkeypatch.setattr(notes_markdown, "strip_internal", lambda text: (text, 0))
    with pytest.raises(notes_wordpress.NotesWordPressError):
        notes_wordpress.build(None, title="T", text="> [!internal]\n> secret\n", identity=notefill.Identity())


def test_left_said_names_each_kind_once():
    said = notes_wordpress.left_said({"internal": 2, "maps": 1, "clips": 0, "diagrams": 0, "other": 1})
    assert said == "2 internal passages, 1 interactive map and 1 picture the note cannot show stay out."
    assert notes_wordpress.left_said({"maps": 1}) == "1 interactive map stays out."
    assert notes_wordpress.left_said({"clips": 2}) == "2 clips go as their still and a link."
    assert notes_wordpress.left_said(dict.fromkeys(notes_wordpress.LEFT, 0)) == ""


# -- the address ------------------------------------------------------------------------------


@pytest.mark.parametrize("written,kept", [
    ("example.org", "https://example.org"),
    ("https://Example.org/blog/", "https://example.org/blog"),
    ("https://example.org/wp-admin/", "https://example.org"),
    ("https://example.org/news/wp-json", "https://example.org/news"),
    ("http://localhost:8080", "http://localhost:8080"),
    ("http://127.0.0.1", "http://127.0.0.1"),
    ("", ""),
])
def test_an_address_is_read_as_wordpress_is_reached(written, kept):
    assert notes_wordpress.site_address(written) == kept


@pytest.mark.parametrize("written,said", [
    ("http://example.org", "https"),
    ("https://user:pass@example.org", "username and password out"),
    ("https://desk.wordpress.com", "OAuth"),
    ("https://example.org/?p=1", "nothing after"),
    ("ftp://example.org", "web address"),
    ("https://exa mple.org", "web address"),
])
def test_an_address_azimut_will_not_send_to_says_why(written, said):
    with pytest.raises(notes_wordpress.WordPressError, match=said):
        notes_wordpress.site_address(written)


# -- a WordPress, faked -------------------------------------------------------------------------


NUMBERED = re.compile(r"/\d+$")


class FakeWordPress:
    """Enough of a WordPress REST API to take pictures and a draft, and say what it saw."""

    SITE = "https://desk.example.org"

    def __init__(self, *, plain: bool = False) -> None:
        self.plain = plain
        self.requests: list[httpx.Request] = []
        self.media: dict[int, dict[str, Any]] = {}
        self.posts: dict[int, dict[str, Any]] = {}
        self.next_id = 40
        self.fail: dict[str, httpx.Response] = {}
        #: A site whose PHP takes no body this large: a clip arrives empty.
        self.refuse_video = False

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=self.transport(), timeout=notes_wordpress.TIMEOUT, follow_redirects=False)

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = urlsplit(str(request.url))
        query = parse_qs(url.query)
        if url.path.startswith("/wp-json"):
            if self.plain:
                return httpx.Response(404, text="<html>Not found</html>")
            route = url.path[len("/wp-json"):] or "/"
        elif "rest_route" in query:
            route = query["rest_route"][0]
        else:
            return httpx.Response(404)
        for prefix, response in self.fail.items():
            if route.startswith(prefix):
                return response
        if route == "/":
            return httpx.Response(200, json={"name": "Open Source Desk", "url": self.SITE, "home": self.SITE,
                                             "namespaces": ["oembed/1.0", "wp/v2"],
                                             "authentication": {"application-passwords": {}}})
        if request.headers.get("authorization") != "Basic " + base64.b64encode(
                f"desk:{APP_PASSWORD}".encode()).decode():
            return httpx.Response(401, json={"code": "rest_not_logged_in", "message": "You are not currently logged in."})
        if route == "/wp/v2/users/me":
            return httpx.Response(200, json={"id": 1, "name": "Desk editor", "username": "desk",
                                             "capabilities": {"edit_posts": True, "upload_files": True}})
        if route == "/wp/v2/media" and request.method == "POST":
            if self.refuse_video and request.headers["content-type"].startswith("video/"):
                return httpx.Response(400, json={"code": "rest_upload_no_data", "message": "No data supplied."})
            disposition = request.headers["content-disposition"]
            name = re.search(r'filename="([^"]+)"', disposition).group(1)
            number = self._id()
            self.media[number] = {"id": number, "data": request.content, "type": request.headers["content-type"],
                                  "name": name, "alt_text": "", "caption": ""}
            return httpx.Response(201, json=self._media(number))
        found = re.fullmatch(r"/wp/v2/media/(\d+)", route)
        if found and request.method == "POST":
            number = int(found.group(1))
            if number not in self.media:
                return httpx.Response(404, json={"code": "rest_post_invalid_id"})
            self.media[number].update(json.loads(request.content))
            return httpx.Response(200, json=self._media(number))
        if route == "/wp/v2/posts" and request.method == "POST":
            number = self._id()
            self.posts[number] = json.loads(request.content)
            return httpx.Response(201, json=self._post(number))
        found = re.fullmatch(r"/wp/v2/posts/(\d+)", route)
        if found:
            number = int(found.group(1))
            if number not in self.posts:
                return httpx.Response(404, json={"code": "rest_post_invalid_id"})
            if request.method == "POST":
                self.posts[number].update(json.loads(request.content))
            return httpx.Response(200, json=self._post(number))
        return httpx.Response(404, json={"code": "rest_no_route"})

    def _id(self) -> int:
        self.next_id += 1
        return self.next_id

    def _media(self, number: int) -> dict[str, Any]:
        item = self.media[number]
        full = f"{self.SITE}/wp-content/uploads/{item['name']}"
        sizes = {"large": {"source_url": full.replace(".", "-1024x576.", 1)}} if item["type"] == "image/jpeg" else {}
        return {"id": number, "source_url": full, "alt_text": item["alt_text"], "media_details": {"sizes": sizes}}

    def _post(self, number: int) -> dict[str, Any]:
        post = self.posts[number]
        return {"id": number, "status": post.get("status"), "link": f"{self.SITE}/?p={number}"}

    def routes(self) -> list[str]:
        said = []
        for request in self.requests:
            url = urlsplit(str(request.url))
            route = url.path[len("/wp-json"):] if url.path.startswith("/wp-json") else parse_qs(url.query).get(
                "rest_route", ["?"])[0]
            said.append(f"{request.method} {NUMBERED.sub('/N', route)}")
        return said


def _site(fake: FakeWordPress, password: str = APP_PASSWORD) -> notes_wordpress.Site:
    return notes_wordpress.Site(fake.SITE, "desk", password, fake.client())


def test_pictures_go_up_first_then_the_post_as_a_draft(ambush):
    fake = FakeWordPress()
    sent = notes_wordpress.send(ambush["draft"], _site(fake))
    routes = fake.routes()
    assert routes[:2] == ["GET /", "GET /wp/v2/users/me"]
    uploads = [index for index, route in enumerate(routes) if route == "POST /wp/v2/media"]
    assert len(uploads) == len(ambush["draft"].uploads) == len(fake.media)
    assert routes[-1] == "POST /wp/v2/posts" and max(uploads) < len(routes) - 1
    post = fake.posts[sent.post]
    assert post["status"] == "draft" and post["title"] == TITLE and post["excerpt"] == "What open sources show"
    assert post["featured_media"] in fake.media
    for item in fake.media.values():
        assert item["name"].rsplit(".", 1)[0] in post["content"], item["name"]
    assert "\x00" not in post["content"] and "\\u0000" not in post["content"]
    assert sent.edit == f"{fake.SITE}/wp-admin/post.php?post={sent.post}&action=edit"
    assert sent.preview == f"{fake.SITE}/?p={sent.post}&preview=true" and not sent.updated
    described = [item for item in fake.media.values() if item["alt_text"]]
    assert len(described) == len(fake.media)
    for request in fake.requests:
        assert SECRET.encode() not in request.content and APP_PASSWORD.encode() not in request.content


def test_sending_again_updates_the_draft_until_it_leaves_the_drafts(ambush):
    fake = FakeWordPress()
    first = notes_wordpress.send(ambush["draft"], _site(fake))
    count = len(fake.media)
    second = notes_wordpress.send(ambush["draft"], _site(fake), previous={"post": first.post, "media": first.media})
    assert second.post == first.post and second.updated
    assert len(fake.media) == count, "pictures already up are reused, not uploaded again"
    assert fake.routes().count("POST /wp/v2/posts/N") == 1
    fake.posts[first.post]["status"] = "publish"
    third = notes_wordpress.send(ambush["draft"], _site(fake), previous={"post": first.post, "media": first.media})
    assert third.post != first.post and not third.updated
    assert fake.posts[first.post]["status"] == "publish", "a published post is never touched"
    assert fake.posts[third.post]["status"] == "draft"
    # a picture deleted from the library since is uploaded again
    del fake.media[next(iter(first.media.values()))]
    notes_wordpress.send(ambush["draft"], _site(fake), previous={"post": third.post, "media": first.media})
    assert len(fake.media) == count


def test_a_clip_the_site_refuses_is_its_still_and_a_link(ambush):
    fake = FakeWordPress()
    fake.refuse_video = True
    sent = notes_wordpress.send(ambush["draft"], _site(fake))
    assert len(sent.refused) == 1 and 'clip "The strike"' in sent.refused[0] and "No data supplied" in sent.refused[0]
    content = fake.posts[sent.post]["content"]
    assert "wp:video" not in content and "Watch on X</a>" in content and '"linkDestination":"custom"' in content
    assert "\x02" not in content and "\n\n\n" not in content
    assert not any(item["type"].startswith("video/") for item in fake.media.values())


def test_a_site_with_plain_permalinks_is_reached_by_rest_route(ambush):
    fake = FakeWordPress(plain=True)
    sent = notes_wordpress.send(ambush["draft"], _site(fake))
    assert sent.post in fake.posts
    assert any("rest_route=%2Fwp%2Fv2%2Fposts" in str(request.url) for request in fake.requests)


@pytest.mark.parametrize("failure,said", [
    ("password", "WordPress refused the password: make an application password in Users › Profile"),
    ("no-api", "No WordPress answers at this address"),
    ("timeout", "did not answer in time"),
    ("refused", "could not reach desk.example.org"),
    ("moved", "another address (www.desk.example.org)"),
    ("author", "may not upload pictures: it needs the Author role"),
    ("not-wordpress", "not as WordPress"),
])
def test_what_went_wrong_is_said_in_one_sentence(ambush, failure, said):
    fake = FakeWordPress()
    password = APP_PASSWORD
    if failure == "password":
        password = "my login password"
    elif failure == "no-api":
        fake.fail["/"] = httpx.Response(404, text="<html>Not found</html>")
    elif failure == "moved":
        fake.fail["/"] = httpx.Response(301, headers={"location": "https://www.desk.example.org/wp-json/"})
    elif failure == "author":
        fake.fail["/wp/v2/media"] = httpx.Response(403, json={"code": "rest_cannot_create"})
    elif failure == "not-wordpress":
        fake.fail["/"] = httpx.Response(200, text="<html>a shop</html>")

    def broken(request: httpx.Request) -> httpx.Response:
        if failure == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        raise httpx.ConnectError("refused", request=request)

    http = httpx.Client(transport=httpx.MockTransport(broken)) if failure in ("timeout", "refused") else fake.client()
    with pytest.raises(notes_wordpress.WordPressError) as raised:
        notes_wordpress.send(ambush["draft"], notes_wordpress.Site(fake.SITE, "desk", password, http))
    assert said in str(raised.value)
    assert APP_PASSWORD not in str(raised.value)
    assert not fake.posts


# -- the routes ----------------------------------------------------------------------------------


@pytest.fixture()
def sent_note(client, monkeypatch):
    """A filed note with a picture and an internal passage, and a faked WordPress set up."""
    fake = FakeWordPress()
    monkeypatch.setattr(notes_wordpress, "client", fake.client)
    cid = make_case(client, "Port strike")
    picture = _image(Case.open(cid), "The pier", _ground(3), {"type": "clipboard"})
    note = make_note(client, cid, title="Port strike", content=(
        f"## What we saw\n\nSmoke over the pier.\n\n[[media:{picture['id']}|The pier]]\n\n"
        f"> [!internal]\n> {SECRET}.\n\n::: map\ntitle: The port\n:::\n"))
    saved = client.put("/api/publishing/wordpress", json={"site": "desk.example.org", "user": "desk",
                                                          "password": APP_PASSWORD})
    assert saved.status_code == 200, saved.text
    return {"cid": cid, "note": note["id"], "fake": fake, "url": f"/api/cases/{cid}/notes/{note['id']}/wordpress"}


def test_the_route_sends_a_draft_and_the_note_keeps_its_record(client, sent_note):
    answer = client.post(sent_note["url"], json={})
    assert answer.status_code == 200, answer.text
    said = answer.json()
    assert said["left_said"] == "1 internal passage and 1 interactive map stay out."
    assert said["edit"].endswith(f"post.php?post={said['post']}&action=edit") and not said["updated"]
    fake = sent_note["fake"]
    assert fake.posts[said["post"]]["status"] == "draft"
    assert all(SECRET.encode() not in request.content for request in fake.requests)
    editions = client.get(f"/api/cases/{sent_note['cid']}/notes/{sent_note['note']}/editions").json()["editions"]
    assert len(editions) == 1
    record = editions[0]
    assert record["format"] == "wordpress" and record["site"] == "https://desk.example.org"
    assert record["post"] == said["post"] and record["edition"] == "public" and len(record["media"]) == 1
    again = client.post(sent_note["url"], json={}).json()
    assert again["updated"] and again["post"] == said["post"]
    editions = client.get(f"/api/cases/{sent_note['cid']}/notes/{sent_note['note']}/editions").json()["editions"]
    assert len(editions) == 1, "one line per draft however often it is sent"
    # a draft is no file: Show and Check find nothing to act on
    ref = {"at": record["at"], "file": "", "folder": ""}
    assert client.post(f"/api/cases/{sent_note['cid']}/notes/{sent_note['note']}/editions/check", json=ref).status_code == 404


def test_the_check_reaches_nothing_and_says_what_would_go(client, sent_note):
    answer = client.post(sent_note["url"], json={"check": True})
    assert answer.status_code == 200, answer.text
    said = answer.json()
    assert said["ready"] and said["pictures"] == 1 and said["clips"] == 0
    assert said["left"]["internal"] == 1 and said["left"]["maps"] == 1
    assert sent_note["fake"].requests == []


def test_a_site_not_set_up_is_said_and_nothing_is_sent(client, sent_note):
    client.delete("/api/publishing/wordpress")
    answer = client.post(sent_note["url"], json={})
    assert answer.status_code == 409 and "Settings › Website › WordPress" in answer.json()["detail"]
    assert client.post(sent_note["url"], json={"check": True}).json()["ready"] is False
    assert sent_note["fake"].requests == []


def test_a_refused_password_comes_back_as_its_sentence(client, sent_note):
    publishsecrets.write("wordpress", "the wrong one")
    answer = client.post(sent_note["url"], json={})
    assert answer.status_code == 502
    assert "Users › Profile" in answer.json()["detail"]


def test_settings_keep_the_password_apart_and_never_send_it_back(client, sent_note):
    state = client.get("/api/publishing").json()["wordpress"]
    assert state == {"site": "https://desk.example.org", "user": "desk", "password": {"set": True, "hint": "…6789"}}
    for path in ("/api/publishing", "/api/settings", "/api/settings/export"):
        body = client.get(path).text
        assert APP_PASSWORD not in body and APP_PASSWORD.replace(" ", "") not in body, path
    kept = publishsecrets.path()
    assert kept.parent == config.settings_dir() and json.loads(kept.read_text())["wordpress"]["password"] == APP_PASSWORD
    assert APP_PASSWORD not in config.settings_path().read_text()
    if sys.platform != "win32":
        assert stat.S_IMODE(kept.stat().st_mode) == 0o600
    # an empty password keeps the one kept; Forget takes all three away
    client.put("/api/publishing/wordpress", json={"password": ""})
    assert publishsecrets.read("wordpress") == APP_PASSWORD
    forgotten = client.delete("/api/publishing/wordpress").json()
    assert forgotten == {"site": "", "user": "", "password": {"set": False, "hint": ""}}
    assert not kept.exists()


def test_the_backup_carries_the_site_and_the_user_but_never_the_password(client, sent_note):
    """The address and the username travel; the application password is a live write
    credential and stays on the machine that made it, as cookies.txt does."""
    blob = client.get("/api/settings/export").json()
    assert blob["settings"]["wordpress_site"] == "https://desk.example.org"
    assert blob["settings"]["wordpress_user"] == "desk"
    said = json.dumps(blob)
    assert APP_PASSWORD not in said and APP_PASSWORD.replace(" ", "") not in said
    client.delete("/api/publishing/wordpress")
    restored = client.post("/api/settings/import", json=blob)
    assert restored.status_code == 200, restored.text
    state = client.get("/api/publishing").json()["wordpress"]
    assert state["site"] == "https://desk.example.org" and state["password"]["set"] is False


def test_an_address_typed_in_settings_is_checked_there(client):
    refused = client.put("/api/publishing/wordpress", json={"site": "http://desk.example.org"})
    assert refused.status_code == 422 and "https" in refused.json()["detail"]
    assert client.put("/api/publishing/wordpress", json={"site": "https://x.wordpress.com"}).status_code == 422
    assert client.put("/api/publishing/wordpress", json={"user": "a:b"}).status_code == 422
    assert client.get("/api/publishing").json()["wordpress"]["site"] == ""


def test_test_connection_says_who_or_why(client, sent_note):
    said = client.post("/api/publishing/wordpress/test").json()
    assert said == {"ok": True, "name": "Desk editor", "site_name": "Open Source Desk", "detail": ""}
    publishsecrets.write("wordpress", "wrong")
    said = client.post("/api/publishing/wordpress/test").json()
    assert said["ok"] is False and said["detail"].startswith("WordPress refused the password")


def test_a_draft_record_from_a_bundle_is_read_part_by_part(client):
    cid = make_case(client, "Records")
    note = make_note(client, cid, title="N")
    good = {"at": "2026-11-18T10:00:00Z", "edition": "public", "format": "wordpress", "site": "https://desk.example.org",
            "post": 12, "edit": "https://desk.example.org/wp-admin/post.php?post=12&action=edit",
            "preview": "https://desk.example.org/?p=12&preview=true", "text_sha256": "a" * 64,
            "media": {"0123456789abcdef": 4, "../etc": 5, "fedcba9876543210": True}}
    bad = [{**good, "edit": "javascript:alert(1)"}, {**good, "site": "http://desk.example.org"},
           {**good, "post": "12"}, {**good, "edition": "internal"}]
    Case.open(cid).update_entity(note["id"], {"attrs": {"editions": [good, *bad]}})
    editions = client.get(f"/api/cases/{cid}/notes/{note['id']}/editions").json()["editions"]
    assert len(editions) == 1 and editions[0]["media"] == {"0123456789abcdef": 4}


# -- nothing reaches the network but a press ------------------------------------------------------


def test_no_network_at_startup_or_on_any_read(monkeypatch, tmp_path):
    """Settings, the editions and the dialog's check read and write this machine only;
    Test connection and Send are the two presses that reach a site."""
    reached: list[str] = []

    def nowhere(self: Any, request: httpx.Request) -> httpx.Response:
        reached.append(str(request.url))
        raise AssertionError(f"reached {request.url}")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", nowhere)
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    from fastapi.testclient import TestClient

    from azimut.server import create_app

    with TestClient(create_app(), base_url="http://127.0.0.1") as client:
        client.put("/api/publishing/wordpress", json={"site": "https://desk.example.org", "user": "desk",
                                                      "password": APP_PASSWORD})
        cid = make_case(client, "Quiet")
        note = make_note(client, cid, title="Quiet", content="Words.\n")
        for path in ("/api/settings", "/api/publishing", f"/api/cases/{cid}/notes/{note['id']}/editions"):
            assert client.get(path).status_code == 200, path
        assert client.post(f"/api/cases/{cid}/notes/{note['id']}/wordpress", json={"check": True}).status_code == 200
        assert client.get("/api/settings/export").status_code == 200
    assert reached == []
