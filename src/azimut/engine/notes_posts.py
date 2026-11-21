"""A kept post as each document draws it: the HTML page, the PDF and the WordPress draft.

Every document reads the block the same way (`socialposts.card`) and draws the same
parts, in the note's own look, never as a screenshot of the site: who posted it (the
profile picture, or initials on a coloured round when it is hidden or none was kept),
the words with the passage the analyst highlighted, the analyst's translation under
them, the pictures, the day and time, "Geolocated · Proof N" when a proof of the case
comes from it, and the links to the post and to its archived copy. No counter: frozen
when it was read, a like count says nothing a reader can use.

Three forms: the **card**, several posts on one card making a thread numbered as
published; the **quote**, the words alone, large, the name under them; and the
**compact** line, for annexes and lists of sources. Words written right to left (Arabic,
Hebrew, Persian…) are set right to left in each.
"""

from __future__ import annotations

import html
import math
import re
from collections.abc import Callable
from functools import partial
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image as PILImage
from PIL import ImageOps

from . import notesources, socialposts
from .socialposts import Card, Picture, Post

#: A picture drawn into a page: `(address, (width, height))`, or None when it cannot be read.
Encoded = tuple[str, tuple[int, int]]
PictureFn = Callable[[Path, int, str], "Encoded | None"]

#: The pixels a profile picture and a post's picture are kept at in a page.
AVATAR_PIXELS = 96
PICTURE_PIXELS = 1400
#: The site's mark beside the name, drawn as the page's own SVG.
GLYPHS = {
    "x": ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2'
          'l-4.9-6.4L5.3 21H2.2l7.2-8.3L2 3h6.4l4.4 5.8L17.8 3zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5z"/></svg>'),
    "bluesky": ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M6.3 4.3C8.6 6 11 9.5 12 11.4c1'
                '-1.9 3.4-5.4 5.7-7.1 1.7-1.2 4.3-2.2 4.3.8 0 .6-.3 5-.5 5.7-.7 2.5-3.2 3.1-5.5 2.7 4 .7 5 2.9 2.8 5.2'
                '-4.2 4.3-6-1.1-6.5-2.5l-.3-.8-.3.8c-.5 1.4-2.3 6.8-6.5 2.5-2.2-2.3-1.2-4.5 2.8-5.2-2.3.4-4.8-.2-5.5-2.7'
                'C2.3 10.1 2 5.7 2 5.1c0-3 2.6-2 4.3-.8z"/></svg>'),
}
PIN = ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13'
       'a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>')
#: A language tag safe to write into the page.
LANG = re.compile(r"^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$")


def _text(value: str) -> str:
    return html.escape(value, quote=False)


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


def _out(url: str) -> str:
    """A link out of the page: a new tab, no referrer, as every outside link of a report."""
    return f'href="{_attr(url)}" target="_blank" rel="noopener noreferrer"'


def _stretches(part: list[tuple[str, bool]]) -> str:
    return "".join(f"<mark>{_text(words)}</mark>" if lit else _text(words) for words, lit in part)


def _words(post: Post) -> str:
    """The post's words, a paragraph each in its own direction, each highlighted passage in a `<mark>`."""
    return "".join(f'<p dir="{"rtl" if rtl else "ltr"}">{_stretches(part)}</p>' for rtl, part in post.paragraphs)


def _lang(post: Post) -> str:
    return f' lang="{_attr(post.lang)}"' if LANG.match(post.lang or "") else ""


def _dir(post: Post) -> str:
    return "rtl" if post.rtl else "auto"


def _avatar(post: Post, shown: bool, picture: PictureFn) -> str:
    """The profile picture, or the initials on the account's own colours."""
    if shown and post.avatar is not None:
        encoded = picture(post.avatar, AVATAR_PIXELS, f"{post.name or post.handle} profile picture")
        if encoded is not None:
            return f'<span class="az-post-avatar"><img src="{_attr(encoded[0])}" alt="" width="40" height="40"></span>'
    first, second = post.tint
    return (f'<span class="az-post-avatar az-post-initials" style="--az-a:{first};--az-b:{second}" aria-hidden="true">'
            f"{_text(post.initials)}</span>")


def _who(post: Post) -> str:
    name = post.name or post.handle
    handle = f'<span class="az-post-handle">@{_text(post.handle)}</span>' if post.handle else ""
    return f'<span class="az-post-who"><b dir="auto">{_text(name)}</b>{handle}</span>'


def _site(post: Post) -> str:
    return f'<span class="az-post-site">{GLYPHS.get(post.site, "")}{_text(post.site_label)}</span>'


def _shot(post: Post, one: Picture, picture: PictureFn, alone: bool) -> str:
    """One picture of the post, linked to the post; a video shows its still and its length."""
    alt = one.alt or ("Video" if one.kind == "video" else "Picture") + f" posted by @{post.handle}"
    inner = ""
    if one.path is not None:
        encoded = picture(one.path, PICTURE_PIXELS, alt)
        if encoded is not None:
            uri, (width, height) = encoded
            inner = f'<img src="{_attr(uri)}" alt="{_attr(alt)}" width="{width}" height="{height}">'
    if one.kind == "video":
        inner += '<span class="az-post-play" aria-hidden="true"></span>'
        length = socialposts.said_duration(one.duration)
        if length:
            inner += f'<span class="az-post-dur">{_text(length)}</span>'
    blank = "" if one.path is not None else " az-post-blank"
    label = "" if one.path is not None else f' aria-label="{_attr(alt)}"'
    shape = ' data-alone="true"' if alone else ""
    return f'<a class="az-post-shot{blank}"{shape}{label} {_out(post.url)}>{inner}</a>'


def _media(post: Post, picture: PictureFn) -> str:
    shown = post.pictures[: socialposts.MAX_PICTURES]
    if not shown:
        return ""
    alone = len(shown) == 1
    return (f'<div class="az-post-media" data-count="{len(shown)}">'
            f'{"".join(_shot(post, one, picture, alone) for one in shown)}</div>')


def _translation(post: Post) -> str:
    if not post.translation.strip():
        return ""
    return (f'<p class="az-post-translation" dir="auto"><small>Translation</small>'
            f"{_text(post.translation.strip())}</p>")


def _proof(post: Post) -> str:
    if post.proof is None:
        return ""
    said = _text(socialposts.proof_said(post.proof))
    named = f' title="{_attr(post.proof.label)}"'
    posted = notesources.web(post.proof.posted)
    if posted:
        return f'<a class="az-post-proof"{named} {_out(posted)}>{PIN}{said}</a>'
    return f'<span class="az-post-proof"{named}>{PIN}{said}</span>'


def _links(post: Post) -> str:
    links = [f'<a {_out(post.url)}>View on {_text(post.site_label)} ↗</a>']
    archive = notesources.web(post.archive)
    if archive:
        links.append(f'<a {_out(archive)}>Archived copy ↗</a>')
    return f'<span class="az-post-links">{"".join(links)}</span>'


def _article(post: Post, drawn: Card, picture: PictureFn, *, number: int, foot: str) -> str:
    total = len(drawn.posts)
    corner = f'<span class="az-post-num">{number}/{total}</span>' if total > 1 else _site(post)
    head = f'<header class="az-post-head">{_avatar(post, drawn.avatar, picture)}{_who(post)}{corner}</header>'
    text = (f'<div class="az-post-text" dir="{_dir(post)}"{_lang(post)}>{_words(post)}</div>'
            if post.text.strip() else "")
    return f'<article class="az-post-item">{head}{text}{_translation(post)}{_media(post, picture)}{foot}</article>'


def _foot(drawn: Card, cite: str) -> str:
    """The card's last line: when, the proof it is geolocated by, the links, its citation."""
    first = drawn.posts[0]
    when = drawn.span if drawn.thread else first.when
    stamp = f'<time datetime="{_attr(first.posted_at)}">{_text(when)}</time>' if when else ""
    proofs = []
    seen: set[str] = set()
    for post in drawn.posts:
        if post.proof is not None and post.proof.entity_id not in seen:
            seen.add(post.proof.entity_id)
            proofs.append(_proof(post))
    return f'<footer class="az-post-foot">{stamp}{"".join(proofs)}{_links(first)}{cite}</footer>'


def html_card(drawn: Card, picture: PictureFn, *, cite: str = "", ident: str = "") -> str:
    """A `::: post` block as a figure of the HTML page, in its form."""
    if not drawn.posts:
        return ""
    opening = f'<figure class="az-figure az-post" data-kind="post" data-form="{drawn.form}"'
    opening += f' id="{_attr(ident)}">' if ident else ">"
    if drawn.form == "quote":
        return f"{opening}\n{_quote(drawn, picture, cite)}</figure>\n"
    if drawn.form == "compact":
        lines = "".join(_line(post, drawn, picture) for post in drawn.posts)
        cited = f'<p class="az-post-cite">{cite}</p>' if cite else ""
        return f"{opening}\n{lines}{cited}</figure>\n"
    articles = []
    for number, post in enumerate(drawn.posts, 1):
        foot = _foot(drawn, cite) if number == len(drawn.posts) else ""
        articles.append(_article(post, drawn, picture, number=number, foot=foot))
    thread = " az-post-thread" if drawn.thread else ""
    return f'{opening}\n<div class="az-post-card{thread}">{"".join(articles)}</div>\n</figure>\n'


def quoted_words(post: Post) -> str:
    """What the quote form says: the passages the analyst highlighted, else every word."""
    kept = [part for part, lit in post.segments if lit]
    return " … ".join(" ".join(one.split()) for one in kept) if kept else post.text.strip()


def _quote(drawn: Card, picture: PictureFn, cite: str) -> str:
    first = drawn.posts[0]
    said = "".join(
        f'<p dir="{_dir(post)}"{_lang(post)}>“{_text(quoted_words(post))}”</p>{_translation(post)}'
        for post in drawn.posts if quoted_words(post)
    )
    name = first.name or first.handle
    when = socialposts.said_day(first.posted_at)
    byline = (f'{_avatar(first, drawn.avatar, picture)}<span><b dir="auto">{_text(name)}</b> on '
              f'{_text(first.site_label)}{f" · {_text(when)}" if when else ""} · <a {_out(first.url)}>view ↗</a>'
              f"{_proof(first) and ' · ' + _proof(first)}{cite}</span>")
    return (f'<blockquote class="az-post-quote" cite="{_attr(first.url)}">{said}</blockquote>\n'
            f'<figcaption class="az-post-by">{byline}</figcaption>\n')


def _line(post: Post, drawn: Card, picture: PictureFn) -> str:
    """One post on one line: who, where and when, its first words, its first picture small."""
    first = next((one for one in post.pictures if one.path is not None), None)
    thumb = ""
    if first is not None and first.path is not None:
        encoded = picture(first.path, 240, f"Picture posted by @{post.handle}")
        if encoded is not None:
            thumb = f'<img class="az-post-thumb" src="{_attr(encoded[0])}" alt="">'
    words = " ".join((post.translation or post.text).split())
    day = socialposts.said_day(post.posted_at)
    who = (f'<span class="az-post-line-who"><b dir="auto">{_text(post.name or post.handle)}</b> · {_text(post.site_label)}'
           f'{f" · {_text(day)}" if day else ""}</span>')
    return (f'<a class="az-post-line" {_out(post.url)}>{_avatar(post, drawn.avatar, picture)}'
            f'<span class="az-post-line-words">{who}<span class="az-post-line-text" dir="auto">{_text(words)}</span></span>'
            f"{thumb}</a>\n")


# -- WordPress ------------------------------------------------------------------------


def wordpress_card(drawn: Card, *, upload: Callable[[Path, str, int], int | None], paragraph: Callable[..., str],
                   image: Callable[..., str], group: Callable[[list[str]], str], quote: Callable[[list[str]], str],
                   ref: Callable[[int, str], str], cite: str = "") -> list[str]:
    """A `::: post` block as block editor markup a careful person would make by hand: a
    group holding who posted it, the words, the translation, its pictures as image blocks
    uploaded as the note's others are, and the line with the day and the links. The
    quote form is a quote block, the compact form a paragraph per post."""
    if not drawn.posts:
        return []

    def avatar(post: Post) -> str:
        if drawn.avatar and post.avatar is not None:
            index = upload(post.avatar, f"{post.name or post.handle} profile picture", socialposts.AVATAR_SIDE)
            if index is not None:
                return (f'<img class="wp-image-{ref(index, "id")}" style="width:40px;border-radius:50%;vertical-align:middle" '
                        f'src="{ref(index, "url")}" alt=""> ')
        return ""

    def who(post: Post) -> str:
        handle = f" @{_text(post.handle)}" if post.handle else ""
        return f"{avatar(post)}<strong>{_text(post.name or post.handle)}</strong>{handle} · {_text(post.site_label)}"

    def links(post: Post) -> str:
        said = [f'<a href="{_attr(post.url)}">View on {_text(post.site_label)} ↗</a>']
        archive = notesources.web(post.archive)
        if archive:
            said.append(f'<a href="{_attr(archive)}">Archived copy ↗</a>')
        if post.proof is not None:
            posted = notesources.web(post.proof.posted)
            badge = _text(socialposts.proof_said(post.proof))
            said.insert(0, f'<a href="{_attr(posted)}">{badge}</a>' if posted else badge)
        return " · ".join(said)

    if drawn.form == "compact":
        lines: list[str] = []
        for post in drawn.posts:
            words = " ".join((post.translation or post.text).split())
            if len(words) > 160:
                words = words[:160].rsplit(" ", 1)[0] + "…"
            day = socialposts.said_day(post.posted_at)
            lines.append(paragraph(f'{who(post)}{f" · {_text(day)}" if day else ""}<br>{_text(words)} '
                                   f'<a href="{_attr(post.url)}">↗</a>'))
        if cite:
            lines[-1] = lines[-1].replace("</p>", f"{cite}</p>", 1)
        return lines
    if drawn.form == "quote":
        inner = []
        for post in drawn.posts:
            said = quoted_words(post)
            if said:
                inner.append(paragraph(f"“{_text(said)}”"))
            if post.translation.strip():
                inner.append(paragraph(f"<em>Translation:</em> {_text(post.translation.strip())}"))
        first = drawn.posts[0]
        when = socialposts.said_day(first.posted_at)
        inner.append(paragraph(f'{who(first)}{f" · {_text(when)}" if when else ""} · {links(first)}{cite}'))
        return [quote(inner)]
    out: list[str] = []
    for number, post in enumerate(drawn.posts, 1):
        inner = [paragraph(who(post) + (f" · {number}/{len(drawn.posts)}" if drawn.thread else ""))]
        for rtl, part in post.paragraphs:
            words = _mark_words(part).replace("\n", "<br>")
            inner.append(paragraph(f'<span dir="rtl">{words}</span>' if rtl else words))
        if post.translation.strip():
            inner.append(paragraph(f"<em>Translation:</em> {_text(post.translation.strip())}"))
        for one in post.pictures:
            if one.path is None:
                continue
            alt = one.alt or f"{'Video' if one.kind == 'video' else 'Picture'} posted by @{post.handle}"
            index = upload(one.path, alt, PICTURE_PIXELS)
            if index is not None:
                inner.append(image(index, alt, href=post.url))
        when = drawn.span if drawn.thread else post.when
        if number == len(drawn.posts):
            inner.append(paragraph(f'{_text(when)}{" · " if when else ""}{links(drawn.posts[0])}{cite}'))
        out.append(group(inner))
    return out


def _mark_words(part: list[tuple[str, bool]]) -> str:
    """Words with each highlighted passage marked as the block editor's highlight marks it."""
    return "".join(
        f'<mark style="background-color:#f8f1e8" class="has-inline-color">{_text(words)}</mark>' if lit else _text(words)
        for words, lit in part
    )


# -- PDF ------------------------------------------------------------------------------


def cover_crop(path: Path, ratio: float, side: int = 1400) -> tuple[bytes, tuple[int, int]] | None:
    """A picture cut to ``ratio`` (width over height) from its middle and made again as a
    JPEG, its metadata left behind: what a tile of a post's pictures shows."""
    try:
        with PILImage.open(path) as opened:
            if opened.width * opened.height > 100_000_000:
                return None
            upright = ImageOps.exif_transpose(opened).convert("RGB")
    except (OSError, ValueError, PILImage.DecompressionBombError):
        return None
    width, height = upright.size
    if width <= 0 or height <= 0 or not math.isfinite(ratio) or ratio <= 0:
        return None
    if width / height > ratio:
        keep = int(round(height * ratio))
        box = ((width - keep) // 2, 0, (width - keep) // 2 + keep, height)
    else:
        keep = int(round(width / ratio))
        box = (0, (height - keep) // 2, width, (height - keep) // 2 + keep)
    cut = upright.crop(box)
    cut.thumbnail((side, side), PILImage.Resampling.LANCZOS)
    buffer = BytesIO()
    cut.save(buffer, "JPEG", quality=86, optimize=True)
    return buffer.getvalue(), cut.size


def qr_modules(url: str) -> list[list[bool]] | None:
    """The dark and light modules of a QR code for ``url``, or None when it cannot be made."""
    try:
        import segno
    except ImportError:
        return None
    try:
        code = segno.make(url, error="m", micro=False)
    except Exception:
        return None
    return [[bool(cell) for cell in row] for row in code.matrix]


def natural_size(path: Path) -> tuple[int, int] | None:
    try:
        with PILImage.open(path) as opened:
            return opened.size
    except (OSError, ValueError, PILImage.DecompressionBombError):
        return None


def rgb(colour: str) -> tuple[int, int, int]:
    value = colour.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


#: How a PDF cuts words into lines: each word with the spaces after it, a hard break alone.
_WORD = re.compile(r"\n|[^\S\n]*\S+[^\S\n]*|[^\S\n]+")
WHITE = (255, 255, 255)


class PdfCard:
    """A `::: post` block drawn by the PDF (`engine/notes_pdf.py`), in millimetres.

    It is laid out twice: once to measure it, so a card that fits on a page is never cut
    by a page break, and once to draw it. A thread taller than a page is drawn a post to
    a card, each numbered as published. Words written right to left are set from the
    right, each stretch shaped whole (`notes_pdf._runs` says why). The link to the post
    stays clickable on its name and on *View on X*; with ``qr: on`` a QR code beside the
    card leads there from paper.
    """

    PAD = 3.6
    AVATAR = 8.0
    QR = 20.0
    GAP = 2.4

    def __init__(self, renderer: Any, drawn: Card, cites: list[int] | None = None) -> None:
        self.r = renderer
        self.pdf = renderer.pdf
        self.theme = renderer.theme
        self.drawn = drawn
        self.cites = [number for number in dict.fromkeys(cites or []) if number]
        scale = self.theme.scale
        self.size = 9.6 * scale
        self.small = 7.6 * scale
        self.sans = self.theme.heading_family
        self.accent = self.theme.accent
        self.accent_ink = self.theme.accent_dark
        self.soft = _mix(self.theme.accent, WHITE, 0.86)
        self.muted = self.theme.muted
        self.measuring = False

    # -- the whole block ------------------------------------------------------------

    def draw(self) -> None:
        drawn, pdf = self.drawn, self.pdf
        if not drawn.posts:
            return
        if drawn.form == "quote":
            self._fit(self._quote)
            return
        if drawn.form == "compact":
            for post in drawn.posts:
                self._fit(partial(self._line, post))
            pdf.ln(self.theme.gap)
            return
        whole = partial(self._card, drawn.posts)
        if self._height(whole) <= pdf.page_break_trigger - pdf.t_margin - 2:
            self._fit(whole)
        else:
            for post in drawn.posts:
                self._fit(partial(self._card, [post]))
        pdf.ln(self.theme.gap)

    def _height(self, part: Callable[[float], float]) -> float:
        self.measuring = True
        top = self.pdf.get_y()
        try:
            return part(top) - top
        finally:
            self.measuring = False

    def _fit(self, part: Callable[[float], float]) -> None:
        """Draw ``part`` where it fits whole: here, or at the top of the next page."""
        pdf = self.pdf
        height = self._height(part)
        if pdf.will_page_break(height + 1):
            pdf.add_page()
        bottom = part(pdf.get_y())
        pdf.set_xy(pdf.l_margin, bottom)

    # -- one card -------------------------------------------------------------------

    @property
    def left(self) -> float:
        return float(self.pdf.l_margin)

    @property
    def width(self) -> float:
        return float(min(self.pdf.epw, 130.0 * max(1.0, self.theme.scale)))

    def _card(self, posts: list[Post], top: float) -> float:
        pdf, drawn = self.pdf, self.drawn
        qr = drawn.qr and (self._qr_matrix(posts[0].url) is not None)
        inner_left = self.left + self.PAD
        inner_width = self.width - 2 * self.PAD - (self.QR + self.GAP if qr else 0)
        y = top + self.PAD
        for position, post in enumerate(posts):
            if position:
                if not self.measuring:
                    with pdf.local_context():
                        pdf.set_draw_color(*self.theme.rule)
                        pdf.set_line_width(0.2)
                        pdf.set_dash_pattern(dash=0.8, gap=0.8)
                        pdf.line(self.left, y, self.left + self.width - (self.QR + self.GAP if qr else 0), y)
                y += self.PAD
            y = self._post(post, inner_left, inner_width, y, number=self._number(post))
        y = self._foot(posts, inner_left, inner_width, y)
        bottom = y + self.PAD * 0.7
        if qr:
            qr_top = max(top + self.PAD, bottom - self.PAD * 0.7 - self.QR - 4.0)
            if not self.measuring:
                self._qr(posts[0].url, self.left + self.width - self.PAD - self.QR, qr_top)
        if not self.measuring:
            with pdf.local_context():
                pdf.set_draw_color(*self.theme.rule)
                pdf.set_line_width(0.25)
                pdf.rect(self.left, top, self.width, bottom - top, style="D", round_corners=True, corner_radius=2.4)
        return bottom + 1.0

    def _number(self, post: Post) -> str:
        total = len(self.drawn.posts)
        return f"{self.drawn.posts.index(post) + 1}/{total}" if total > 1 else ""

    def _post(self, post: Post, x: float, width: float, y: float, *, number: str) -> float:
        pdf = self.pdf
        d = self.AVATAR
        self._avatar(post, x, y, d)
        name_x = x + d + 2.2
        if not self.measuring:
            with pdf.local_context():
                pdf.set_font(self.sans, "B", 8.8 * self.theme.scale)
                pdf.set_text_color(*self.theme.ink)
                name = post.name or post.handle
                pdf.set_xy(name_x - pdf.c_margin, y + 0.4)
                pdf.cell(min(pdf.get_string_width(name) + 2 * pdf.c_margin, width - d - 12), 4.2, name, link=post.url)
                pdf.set_font(self.sans, "", 7.6 * self.theme.scale)
                pdf.set_text_color(*self.muted)
                handle = " · ".join(part for part in (f"@{post.handle}" if post.handle else "", post.site_label) if part)
                pdf.set_xy(name_x - pdf.c_margin, y + 4.4)
                pdf.cell(pdf.get_string_width(handle) + 2 * pdf.c_margin, 3.6, handle)
                if number:
                    pdf.set_xy(x + width - 12, y + 2.0)
                    pdf.cell(12, 3.6, number, align="R")
        y += d + 1.6
        for order, (rtl, part) in enumerate(post.paragraphs):
            size = self.size * (1.22 if rtl else 1.0)
            y = self._words(part, x, width, y + (1.2 if order else 0.0), size=size, rtl=rtl, family=self.sans)
        if post.translation.strip():
            y = self._translation(post.translation.strip(), x, width, y + 1.0)
        if post.pictures:
            y = self._media(post, x, width, y + 1.6)
        return y

    # -- words ----------------------------------------------------------------------

    def _layout(self, segments: list[tuple[str, bool]], width: float, *, size: float, family: str,
                italic: bool = False) -> list[list[tuple[int, str]]]:
        pdf = self.pdf
        pdf.set_font(family, "I" if italic and (family, "I") in self.r.faces else "", size)
        lines: list[list[tuple[int, str]]] = [[]]
        used = 0.0
        for index, (text, _lit) in enumerate(segments):
            for word in _WORD.findall(text):
                if word == "\n":
                    lines.append([])
                    used = 0.0
                    continue
                if not lines[-1]:
                    word = word.lstrip()
                    if not word:
                        continue
                measured = pdf.get_string_width(word.rstrip())
                if lines[-1] and used + measured > width:
                    lines.append([])
                    used = 0.0
                    word = word.lstrip()
                if pdf.get_string_width(word.rstrip()) > width:
                    # a word longer than the line, an address most often: cut where it must be
                    piece = ""
                    for char in word:
                        if piece and pdf.get_string_width(piece + char) > width:
                            lines[-1].append((index, piece))
                            lines.append([])
                            piece = ""
                        piece += char
                    word = piece
                lines[-1].append((index, word))
                used += pdf.get_string_width(word)
        return [line for line in lines if line] or [[]]

    def _words(self, segments: list[tuple[str, bool]], x: float, width: float, y: float, *, size: float, rtl: bool,
               family: str, italic: bool = False, colour: tuple[int, int, int] | None = None) -> float:
        """Words wrapped to ``width`` from ``y``, each highlighted stretch on the accent's
        wash with the accent under it; answers where they end."""
        pdf = self.pdf
        leading = self.theme.leading * size / max(self.theme.body_size, 1.0) * 1.04
        lines = self._layout(segments, width, size=size, family=family, italic=italic)
        if self.measuring:
            return y + leading * len(lines) + 0.6
        style = "I" if italic and (family, "I") in self.r.faces else ""
        for line in lines:
            pieces: list[tuple[int, str]] = []
            for index, word in line:
                if pieces and pieces[-1][0] == index:
                    pieces[-1] = (index, pieces[-1][1] + word)
                else:
                    pieces.append((index, word))
            if pieces:
                pieces[-1] = (pieces[-1][0], pieces[-1][1].rstrip())
            pdf.set_font(family, style, size)
            widths = [pdf.get_string_width(text) for _, text in pieces]
            order = list(zip(pieces, widths))
            if rtl:
                order.reverse()
            at = x + (width - sum(widths) if rtl else 0.0)
            for (index, text), measured in order:
                lit = segments[index][1]
                if lit and text.strip():
                    with pdf.local_context():
                        pdf.set_fill_color(*self.soft)
                        pdf.rect(at - 0.3, y + 0.5, measured + 0.6, leading - 0.6, style="F")
                        pdf.set_draw_color(*self.accent)
                        pdf.set_line_width(0.45)
                        pdf.line(at - 0.3, y + leading - 0.25, at + measured + 0.3, y + leading - 0.25)
                pdf.set_font(family, style, size)
                pdf.set_text_color(*(colour or self.theme.ink))
                pdf.set_xy(at - pdf.c_margin, y)
                pdf.cell(measured + 2 * pdf.c_margin, leading, text)
                at += measured
            y += leading
        return y + 0.6

    def _translation(self, words: str, x: float, width: float, y: float) -> float:
        pdf = self.pdf
        bar = 0.9
        top = y
        if not self.measuring:
            with pdf.local_context():
                pdf.set_font(self.sans, "B", 6.0 * self.theme.scale)
                pdf.set_char_spacing(0.6)
                pdf.set_text_color(*self.muted)
                pdf.set_xy(x + bar + 2.4 - pdf.c_margin, y)
                pdf.cell(40, 3.0, "TRANSLATION")
                pdf.set_char_spacing(0)
        y = self._words([(words, False)], x + bar + 2.4, width - bar - 2.4, y + 3.0, size=self.size * 0.94,
                        rtl=socialposts.is_rtl(words), family=self.r._family, colour=self.theme.ink)
        if not self.measuring:
            with pdf.local_context():
                pdf.set_fill_color(*self.accent)
                pdf.rect(x, top, bar, y - top - 0.6, style="F")
        return y

    # -- pictures -------------------------------------------------------------------

    def _media(self, post: Post, x: float, width: float, y: float) -> float:
        shown = post.pictures[: socialposts.MAX_PICTURES]
        gap = 1.0
        if len(shown) == 1:
            one = shown[0]
            natural = natural_size(one.path) if one.path is not None else None
            ratio = (natural[0] / natural[1]) if natural and natural[1] else 16 / 9
            ratio = min(2.0, max(0.8, ratio))
            height = min(width / ratio, 62.0)
            tile_w = height * ratio if height < width / ratio else width
            self._tile(one, x, y, tile_w, height)
            return y + height + 0.8
        columns = 2
        tile_w = (width - gap) / columns
        tile_h = tile_w * 0.75
        rows = math.ceil(len(shown) / columns)
        for at, one in enumerate(shown):
            row, column = divmod(at, columns)
            self._tile(one, x + column * (tile_w + gap), y + row * (tile_h + gap), tile_w, tile_h)
        return y + rows * tile_h + (rows - 1) * gap + 0.8

    def _tile(self, one: Picture, x: float, y: float, w: float, h: float) -> None:
        if self.measuring:
            return
        pdf = self.pdf
        made = cover_crop(one.path, w / h) if one.path is not None else None
        if made is not None:
            self.r._picture(BytesIO(made[0]), x=x, y=y, w=w, h=h)
        else:
            with pdf.local_context():
                pdf.set_fill_color(42, 44, 48)
                pdf.rect(x, y, w, h, style="F")
        if one.kind == "video":
            radius = min(w, h) * 0.13
            cx, cy = x + w / 2, y + h / 2
            with pdf.local_context(fill_opacity=0.6):
                pdf.set_fill_color(0, 0, 0)
                pdf.ellipse(cx - radius, cy - radius, 2 * radius, 2 * radius, style="F")
            with pdf.local_context():
                pdf.set_fill_color(*WHITE)
                side = radius * 0.8
                pdf.polygon([(cx - side * 0.4, cy - side * 0.55), (cx - side * 0.4, cy + side * 0.55), (cx + side * 0.6, cy)],
                            style="F")
            length = socialposts.said_duration(one.duration)
            if length:
                with pdf.local_context():
                    pdf.set_font(self.sans, "", 6.4 * self.theme.scale)
                    label = pdf.get_string_width(length) + 2.4
                    with pdf.local_context(fill_opacity=0.65):
                        pdf.set_fill_color(0, 0, 0)
                        pdf.rect(x + 1.6, y + h - 5.2, label, 3.8, style="F")
                    pdf.set_text_color(*WHITE)
                    pdf.set_xy(x + 1.6, y + h - 5.2)
                    pdf.cell(label, 3.8, length, align="C")

    def _avatar(self, post: Post, x: float, y: float, d: float) -> None:
        if self.measuring:
            return
        pdf = self.pdf
        made = cover_crop(post.avatar, 1.0, 240) if (self.drawn.avatar and post.avatar is not None) else None
        if made is not None:
            with pdf.elliptic_clip(x, y, d, d):
                self.r._picture(BytesIO(made[0]), x=x, y=y, w=d, h=d)
            return
        first, second = post.tint
        with pdf.local_context():
            pdf.set_fill_color(*_mix(rgb(first), rgb(second), 0.45))
            pdf.ellipse(x, y, d, d, style="F")
            pdf.set_font(self.sans, "B", d * 1.05)
            pdf.set_text_color(*WHITE)
            pdf.set_xy(x, y)
            pdf.cell(d, d, post.initials, align="C")

    # -- the last line ----------------------------------------------------------------

    def _foot(self, posts: list[Post], x: float, width: float, y: float) -> float:
        """When, when it was kept, the proof it is geolocated by, and the links: one line, wrapped."""
        pdf = self.pdf
        first = posts[0]
        when = self.drawn.span if len(posts) > 1 else first.when
        parts: list[tuple[str, str | int, bool]] = []
        if when:
            parts.append((when, "", False))
        captured = socialposts.said_day(first.captured_at)
        if captured:
            parts.append((f"captured on {captured}", "", False))
        for post in posts:
            if post.proof is not None and not any(socialposts.proof_said(post.proof) == text for text, _, _ in parts):
                parts.append((socialposts.proof_said(post.proof), notesources.web(post.proof.posted), True))
        parts.append((f"View on {first.site_label}", first.url, True))
        archive = notesources.web(first.archive)
        if archive:
            parts.append(("Archived copy", archive, True))
        for number in self.cites:
            parts.append((f"[{number}]", self.r._entry_link(number), True))
        size = 6.8 * self.theme.scale
        leading = 3.6 * self.theme.scale
        y += 0.8
        if not self.measuring:
            with pdf.local_context():
                pdf.set_draw_color(*self.theme.tint if self.theme.tint != WHITE else self.theme.rule)
                pdf.set_line_width(0.2)
                pdf.line(x, y, x + width, y)
        y += 1.4
        at = x
        pdf.set_font(self.sans, "", size)
        separator = " · "
        for position, (text, link, accented) in enumerate(parts):
            said = (separator if position else "") + text
            measured = pdf.get_string_width(said)
            if at > x and at + measured > x + width:
                y += leading
                at = x
                said = text
                measured = pdf.get_string_width(said)
            if not self.measuring:
                pdf.set_font(self.sans, "B" if accented and link == "" and "Geolocated" in text else "", size)
                pdf.set_text_color(*(self.accent_ink if accented else self.muted))
                pdf.set_xy(at - pdf.c_margin, y)
                pdf.cell(measured + 2 * pdf.c_margin, leading, said, link=link or "")
                pdf.set_font(self.sans, "", size)
            at += measured
        return y + leading

    def _qr_matrix(self, url: str) -> list[list[bool]] | None:
        return qr_modules(url)

    def _qr(self, url: str, x: float, y: float) -> None:
        modules = self._qr_matrix(url)
        if not modules:
            return
        pdf = self.pdf
        side = self.QR
        cell = side / len(modules)
        with pdf.local_context():
            pdf.set_fill_color(*self.theme.ink)
            for row, line in enumerate(modules):
                for column, dark in enumerate(line):
                    if dark:
                        pdf.rect(x + column * cell, y + row * cell, cell + 0.01, cell + 0.01, style="F")
            pdf.link(x, y, side, side, url)
            pdf.set_font(self.sans, "", 5.6 * self.theme.scale)
            pdf.set_text_color(*self.muted)
            pdf.set_xy(x - 2, y + side + 0.4)
            pdf.cell(side + 4, 2.8, socialposts.short_address(url), align="C")

    # -- the other two forms --------------------------------------------------------

    def _quote(self, top: float) -> float:
        pdf, drawn = self.pdf, self.drawn
        first = drawn.posts[0]
        x = self.left + 5.0
        width = min(self.pdf.epw, 140.0) - 5.0
        y = top + 0.6
        for post in drawn.posts:
            said = quoted_words(post)
            if said:
                y = self._words([(f"“{said}”", False)], x, width, y, size=self.size * 1.45, rtl=post.rtl,
                                family=self.r._family, italic=not post.rtl)
            if post.translation.strip():
                y = self._translation(post.translation.strip(), x, width, y + 0.6)
        y += 1.2
        d = 4.6
        self._avatar(first, x, y, d)
        day = socialposts.said_day(first.posted_at)
        byline = [(first.name or first.handle, first.url, True, "B"), (f" on {first.site_label}", "", False, ""),
                  (f" · {day}" if day else "", "", False, ""), (" · view ↗", first.url, True, "")]
        if first.proof is not None:
            byline.append((f" · {socialposts.proof_said(first.proof)}", notesources.web(first.proof.posted), True, "B"))
        for number in self.cites:
            byline.append((f" [{number}]", self.r._entry_link(number), True, ""))
        at = x + d + 1.8
        size = 7.8 * self.theme.scale
        for text, link, accented, style in byline:
            if not text:
                continue
            pdf.set_font(self.sans, style, size)
            measured = pdf.get_string_width(text)
            if not self.measuring:
                pdf.set_text_color(*(self.theme.ink if style == "B" and not link else
                                     self.accent_ink if accented else self.muted))
                pdf.set_xy(at - pdf.c_margin, y + 0.4)
                pdf.cell(measured + 2 * pdf.c_margin, 3.8, text, link=link or "")
            at += measured
        bottom = y + d + 1.0
        if not self.measuring:
            with pdf.local_context():
                pdf.set_fill_color(*self.accent)
                pdf.rect(self.left, top, 0.9, bottom - top, style="F")
        return bottom + self.theme.gap

    def _line(self, post: Post, top: float) -> float:
        """One post on one line: who and when, its first words, its first picture small."""
        pdf = self.pdf
        x, width = self.left, min(self.pdf.epw, 140.0)
        d = 6.0
        y = top + 1.6
        self._avatar(post, x, y + 0.4, d)
        thumb = next((one for one in post.pictures if one.path is not None), None)
        words_x = x + d + 2.4
        words_w = width - (d + 2.4) - (16.0 if thumb else 0.0)
        day = socialposts.said_day(post.posted_at)
        who = " · ".join(part for part in (post.site_label, day) if part)
        text = " ".join((post.translation or post.text).split())
        if not self.measuring:
            with pdf.local_context():
                pdf.set_font(self.sans, "B", 7.8 * self.theme.scale)
                pdf.set_text_color(*self.theme.ink)
                name = post.name or post.handle
                pdf.set_xy(words_x - pdf.c_margin, y)
                pdf.cell(pdf.get_string_width(name) + 2 * pdf.c_margin, 3.4, name, link=post.url)
                named = pdf.get_string_width(name)
                pdf.set_font(self.sans, "", 7.4 * self.theme.scale)
                pdf.set_text_color(*self.muted)
                pdf.set_xy(words_x + named - pdf.c_margin, y)
                pdf.cell(pdf.get_string_width(f" · {who}") + 2 * pdf.c_margin, 3.4, f" · {who}")
                pdf.set_font(self.sans, "", 8.2 * self.theme.scale)
                pdf.set_text_color(*self.theme.ink)
                shown = text
                while shown and pdf.get_string_width(shown + "…") > words_w:
                    shown = shown[:-1]
                shown = shown if shown == text else shown.rstrip() + "…"
                pdf.set_xy(words_x - pdf.c_margin, y + 3.6)
                pdf.cell(words_w + 2 * pdf.c_margin, 4.0, shown, link=post.url)
            if thumb is not None and thumb.path is not None:
                made = cover_crop(thumb.path, 1.45, 300)
                if made is not None:
                    self.r._picture(BytesIO(made[0]), x=x + width - 14.0, y=y, w=14.0, h=9.6)
        bottom = y + 10.0
        if not self.measuring:
            with pdf.local_context():
                pdf.set_draw_color(*self.theme.rule)
                pdf.set_line_width(0.2)
                pdf.line(x, bottom, x + width, bottom)
        return bottom + 0.4


def _mix(colour: tuple[int, int, int], other: tuple[int, int, int], amount: float) -> tuple[int, int, int]:
    return (
        round(colour[0] + (other[0] - colour[0]) * amount),
        round(colour[1] + (other[1] - colour[1]) * amount),
        round(colour[2] + (other[2] - colour[2]) * amount),
    )
