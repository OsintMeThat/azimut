"""The four ways a note prints, and the page furniture they share.

`plain` is the document every note printed as before looks existed, and its
numbers are the ones `notes_pdf` always used: changing one here changes every
old note's PDF, which the golden test (`tests/test_notes_pdf_golden.py`) is
there to refuse.

The other three are built on the same body and differ where a reader notices:

- **report**: a think-tank paper. Serif body on a wider margin, a running
  header with the title and the TLP label, "Page X / Y" in the footer, numbered
  sections and figures when asked, callouts set in tinted boxes, a cover and a
  table of contents when asked.
- **brief**: one or two pages read in a minute. A dark band carries the title,
  the day and the TLP label, the note's first verdict sits in a large box right
  under it, and the body is a tight sans.
- **journal**: a dated log. Each `### 2026-11-04 14:32 (UTC+1)` entry sets its
  time in a left gutter on a timeline rule, the text runs beside it in a compact
  serif, and the first entry of a new day names the day.

Colour belongs to the style until the analyst picks an accent; every tint is
mixed from that one colour so a chosen accent re-colours the whole document
coherently. The faces belong to the style too, until the look picks one of the
shipped ones (`pdffonts.FONTS`), and so does the text size, until the look asks
for it a step smaller or larger: then the body, the headings and the spaces
between them all move together, and the page furniture stays as it is.
"""

from __future__ import annotations

import types
from dataclasses import dataclass, field, replace
from datetime import date
from typing import Callable, Sequence

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos
from fpdf.outline import OutlineSection

from . import pdffonts
from .notelook import TLP_LABELS, NoteLook

RGB = tuple[int, int, int]

WHITE: RGB = (255, 255, 255)
BLACK: RGB = (0, 0, 0)

#: Page sizes in millimetres, which is fpdf2's unit here. A4 stays at the round
#: numbers the plain document has always been laid out against.
PAGES: dict[str, tuple[float, float, str]] = {
    "a4": (210.0, 297.0, "A4"),
    "letter": (215.9, 279.4, "Letter"),
}

#: The FIRST TLP 2.0 sentence for each label, printed on a cover under the label.
TLP_MEANINGS: dict[str, str] = {
    "clear": "Recipients can spread this to the world, there is no limit on disclosure.",
    "green": "Limited disclosure, recipients can spread this within their community.",
    "amber": (
        "Limited disclosure, recipients can only spread this on a need-to-know basis "
        "within their organization and its clients."
    ),
    "amber-strict": "Limited disclosure, restricted to the organization only.",
    "red": "For the eyes and ears of individual recipients only, no further disclosure.",
}
#: FIRST asks for the label in 12-point type or larger, for readers with low vision.
TLP_SIZE = 12.0
#: How far a TLP label on a note's own cover page sits from the top and the bottom edge.
COVER_TLP_EDGE = 7.4

#: The callouts a brief may lift to the top of its first page: the ones that say
#: how far a finding stands, as opposed to a lead to follow or an aside.
VERDICTS = ("confirmed", "unverified")


def mix(colour: RGB, other: RGB, amount: float) -> RGB:
    """``amount`` of the way from ``colour`` to ``other``."""
    return (
        round(colour[0] + (other[0] - colour[0]) * amount),
        round(colour[1] + (other[1] - colour[1]) * amount),
        round(colour[2] + (other[2] - colour[2]) * amount),
    )


def hex_rgb(value: str) -> RGB:
    return (int(value[1:3], 16), int(value[3:5], 16), int(value[5:7], 16))


@dataclass(frozen=True)
class Theme:
    """Every number and colour a style lays a page out with."""

    style: str
    accent: RGB
    accent_dark: RGB
    ink: RGB = (32, 33, 36)
    muted: RGB = (119, 119, 119)
    rule: RGB = (216, 209, 200)
    code_bg: RGB = (248, 246, 243)
    table_head_bg: RGB = (241, 236, 229)
    note_bg: RGB = (250, 248, 245)
    #: A wash of the accent, for boxes and table stripes.
    tint: RGB = (250, 248, 245)
    body_family: str = pdffonts.SERIF
    #: Headings, titles, captions, table heads and the page furniture.
    heading_family: str = pdffonts.SANS
    #: The quiet italic lines: a subtitle, an aside.
    aside_family: str = pdffonts.SERIF
    #: How far the look moved the text size from the style's (1 is the style's own).
    scale: float = 1.0
    body_size: float = 10.0
    leading: float = 5.4
    gap: float = 3.4
    headings: dict[str, tuple[float, float]] = field(
        default_factory=lambda: {
            "h1": (16.0, 7.0),
            "h2": (13.5, 6.0),
            "h3": (11.5, 5.0),
            "h4": (10.5, 4.5),
            "h5": (10.0, 4.0),
            "h6": (9.5, 4.0),
        }
    )
    margin_top: float = 18.0
    margin_side: float = 16.0
    margin_bottom: float = 20.0
    page_width: float = 210.0
    page_height: float = 297.0
    page_format: str = "A4"
    #: The journal's gutter, where an entry's time is set.
    gutter: float = 0.0

    @property
    def plain(self) -> bool:
        return self.style == "plain"

    @property
    def frame(self) -> float:
        return self.page_width - 2 * self.margin_side

    @property
    def room(self) -> float:
        """The tallest picture a page holds, with a caption's worth to spare."""
        return self.page_height - self.margin_top - self.margin_bottom - 12


#: The plain document's own numbers, unchanged since the PDF export shipped.
PLAIN = Theme(style="plain", accent=(189, 122, 37), accent_dark=(109, 69, 21))

REPORT = Theme(
    style="report",
    accent=(31, 78, 121),
    accent_dark=(20, 50, 80),
    ink=(26, 28, 32),
    muted=(104, 110, 118),
    rule=(208, 213, 220),
    code_bg=(245, 247, 250),
    table_head_bg=(31, 78, 121),
    note_bg=(246, 248, 251),
    body_size=10.0,
    leading=5.3,
    gap=3.3,
    headings={
        "h1": (15.5, 8.5),
        "h2": (12.5, 6.0),
        "h3": (10.8, 4.8),
        "h4": (10.0, 4.2),
        "h5": (9.5, 4.0),
        "h6": (9.0, 4.0),
    },
    margin_top=26.0,
    margin_side=22.0,
    margin_bottom=22.0,
)

BRIEF = Theme(
    style="brief",
    accent=(164, 22, 26),
    accent_dark=(110, 14, 18),
    ink=(22, 24, 28),
    muted=(98, 104, 112),
    rule=(212, 214, 218),
    code_bg=(244, 245, 247),
    table_head_bg=(28, 32, 38),
    note_bg=(246, 246, 248),
    body_family=pdffonts.SANS,
    body_size=9.2,
    leading=4.6,
    gap=2.4,
    headings={
        "h1": (12.5, 5.0),
        "h2": (11.0, 4.4),
        "h3": (10.0, 3.6),
        "h4": (9.2, 3.2),
        "h5": (9.0, 3.0),
        "h6": (8.6, 3.0),
    },
    margin_top=20.0,
    margin_side=17.0,
    margin_bottom=19.0,
)

JOURNAL = Theme(
    style="journal",
    accent=(38, 99, 104),
    accent_dark=(22, 64, 68),
    ink=(30, 31, 33),
    muted=(112, 112, 112),
    rule=(214, 211, 204),
    code_bg=(246, 245, 241),
    table_head_bg=(38, 99, 104),
    note_bg=(248, 247, 243),
    body_size=9.5,
    leading=4.9,
    gap=2.7,
    headings={
        "h1": (15.0, 7.0),
        "h2": (12.5, 5.5),
        "h3": (10.5, 4.5),
        "h4": (9.8, 4.0),
        "h5": (9.5, 3.5),
        "h6": (9.0, 3.5),
    },
    margin_top=24.0,
    margin_side=18.0,
    margin_bottom=21.0,
    gutter=30.0,
)

THEMES = {"plain": PLAIN, "report": REPORT, "brief": BRIEF, "journal": JOURNAL}

#: A step smaller or larger than the style's text: enough to be seen across a page,
#: not so much that the style's proportions stop holding.
SIZES = {"small": 0.9, "large": 1.12}


def theme_for(look: NoteLook) -> Theme:
    """The style's theme, sized to the page and re-coloured by the accent.

    The default look returns the plain theme itself, untouched, which is what
    keeps an old note's document the same to the byte.
    """
    theme = THEMES[look.style]
    width, height, page_format = PAGES[look.page]
    if (width, height) != (theme.page_width, theme.page_height):
        theme = replace(theme, page_width=width, page_height=height, page_format=page_format)
    accent = look.accent_rgb()
    if accent is not None:
        theme = replace(
            theme,
            accent=accent,
            accent_dark=mix(accent, BLACK, 0.38),
            table_head_bg=accent if not theme.plain else mix(accent, WHITE, 0.86),
        )
    if not theme.plain:
        theme = replace(theme, tint=mix(theme.accent, WHITE, 0.92))
    font = pdffonts.FONTS_BY_KEY.get(look.font)
    if font is not None:
        theme = replace(theme, body_family=font.body, heading_family=font.headings, aside_family=font.body)
    scale = SIZES.get(look.size)
    if scale is not None:
        theme = replace(
            theme,
            scale=scale,
            body_size=round(theme.body_size * scale, 2),
            leading=round(theme.leading * scale, 2),
            gap=round(theme.gap * scale, 2),
            headings={tag: (round(size * scale, 2), round(space * scale, 2))
                      for tag, (size, space) in theme.headings.items()},
        )
    return theme


def tlp_label(look: NoteLook) -> tuple[str, RGB] | None:
    return TLP_LABELS.get(look.tlp) if look.tlp else None


MONTHS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)
WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")


def long_date(day: date) -> str:
    """`4 November 2026`, spelled here rather than by the machine's locale, so a
    report made on a French system is still an English document."""
    return f"{day.day} {MONTHS[day.month - 1]} {day.year}"


# -- the page ------------------------------------------------------------------


@dataclass
class Box:
    """A tinted box or a rule drawn *behind* text that is laid out first.

    The text inside a callout has to be measured by drawing it, and a fill drawn
    afterwards would cover it. So the box remembers where in the page's content
    it began, and its paint is moved there once its height is known: the page
    then paints the box first and the text over it. A box that runs over a page
    is closed at the foot of one page and opened again at the head of the next.
    """

    left: float
    right: float
    top: float
    offset: int
    fill: RGB | None = None
    bar: RGB | None = None
    bar_width: float = 0.0


class NotePage(FPDF):
    """The document a note becomes, with its furniture: header, footer, cover,
    table of contents and the boxes drawn behind text.

    The plain look keeps the footer it always had (the note's name on the left,
    the page number on the right, over a hairline) and no header unless a TLP
    label asks for one.
    """

    def __init__(
        self,
        *,
        title: str,
        theme: Theme = PLAIN,
        look: NoteLook | None = None,
        day: date | None = None,
    ) -> None:
        super().__init__(orientation="P", unit="mm", format=theme.page_format)
        self.note_title = title
        self.theme = theme
        self.look = look if look is not None else NoteLook()
        self.day = day or date.today()
        self.set_margins(theme.margin_side, theme.margin_top, theme.margin_side)
        self.set_auto_page_break(True, margin=theme.margin_bottom)
        self.set_title(title)
        self.set_creator("Azimut")
        self.set_subject("Case notes")
        # The analyst's own name is not ours to write into a file they share.
        self.set_author("Azimut")
        #: Told each time a page begins, so the caller can say which line of the
        #: note it starts at.
        self.on_page: Callable[[], None] | None = None
        #: Where the body of the current page starts, under its header: a page
        #: break asked for on a page still at this point would leave it blank.
        self.body_top = 0.0
        #: How a picture is placed; the walk swaps in one that reuses decodings.
        self.place_picture: Callable[..., object] = self.image
        #: Pages drawn edge to edge by their own code: the cover.
        self.bare_pages: set[int] = set()
        #: The note's own cover pages, bare but for the TLP label, and whether the
        #: walk is drawing one now (a page it runs onto is one too).
        self.own_pages: set[int] = set()
        self.covering = False
        #: The brief's first page, whose header is its band.
        self.band_page = 0
        self.band_bottom = 0.0
        self.boxes: list[Box] = []
        self._widths: dict[tuple[object, ...], float] = {}

    #: The most text widths one document keeps (`get_string_width`).
    KEPT_WIDTHS = 20_000

    def get_string_width(self, s: str, normalized: bool = False, markdown: bool = False) -> float:
        """fpdf2's measure, kept for the document: every measure shapes the text
        again, and wrapping a long sources list measures the same words over and over."""
        key = (self.font_family, self.font_style, self.font_size_pt, self.char_spacing, self.font_stretching,
               s, normalized, markdown)
        width = self._widths.get(key)
        if width is None:
            if len(self._widths) >= self.KEPT_WIDTHS:
                self._widths.clear()
            width = self._widths[key] = super().get_string_width(s, normalized, markdown)
        return width

    # -- the boxes behind text ---------------------------------------------

    def open_box(self, **style: object) -> Box:
        box = Box(
            left=self.l_margin,
            right=self.w - self.r_margin,
            top=self.get_y(),
            offset=len(self._contents()),
            **style,  # type: ignore[arg-type]
        )
        self.boxes.append(box)
        return box

    def close_box(self, box: Box, bottom: float) -> None:
        if box in self.boxes:
            self.boxes.remove(box)
            self._paint([box], bottom)

    def _contents(self) -> bytearray:
        contents = self.pages[self.page].contents
        assert isinstance(contents, bytearray)
        return contents

    def _paint(self, boxes: list[Box], bottom: float) -> None:
        contents = self._contents()
        for box in sorted(boxes, key=lambda item: item.offset):
            if bottom - box.top <= 0.2:
                continue
            mark = len(contents)
            with self.local_context():
                height = bottom - box.top
                if box.fill is not None:
                    self.set_fill_color(*box.fill)
                    self.rect(box.left, box.top, box.right - box.left, height, style="F")
                if box.bar is not None:
                    self.set_fill_color(*box.bar)
                    self.rect(box.left, box.top, box.bar_width, height, style="F")
            chunk = bytes(contents[mark:])
            del contents[mark:]
            contents[box.offset : box.offset] = chunk
            # Whatever opened after this box sits after it in the stream, and has moved.
            for other in self.boxes:
                if other is not box and other.offset >= box.offset:
                    other.offset += len(chunk)

    # -- furniture ------------------------------------------------------------

    def _writing(self) -> bool:
        """False while fpdf2 lays something out to measure it (a table row, a dry
        run), when a page break it makes is undone afterwards. Nothing that keeps
        state may happen on such a page."""
        return isinstance(self._out, types.MethodType)

    def header(self) -> None:
        if not self._writing():
            return
        if self.on_page is not None:
            self.on_page()
        self.body_top = self.get_y()
        if self.covering:
            self.bare_pages.add(self.page)
            self.own_pages.add(self.page)
        if self.page in self.bare_pages:
            if self.page in self.own_pages:
                # a classification belongs on every page, a cover of one's own included
                self.tlp_mark(self.w - self.theme.margin_side, COVER_TLP_EDGE)
                for box in self.boxes:
                    box.top = self.get_y() - 1.6
                    box.offset = len(self._contents())
            return
        if self.page == self.band_page:
            self._band()
        elif not self.theme.plain:
            self._running_header()
        elif self.look.tlp:
            self.tlp_mark(self.w - self.theme.margin_side, 6.0)
        self.set_xy(self.l_margin, max(self.t_margin, self.band_bottom if self.page == self.band_page else 0))
        self.body_top = self.get_y()
        # A box still open from the page before carries on at the top of this one.
        for box in self.boxes:
            box.top = self.get_y() - 1.6
            box.offset = len(self._contents())

    def footer(self) -> None:
        if not self._writing():
            return
        if self.boxes:
            self._paint(list(self.boxes), self.h - self.b_margin)
        if self.page in self.bare_pages:
            if self.page in self.own_pages:
                self.tlp_mark(self.w - self.theme.margin_side, self.h - COVER_TLP_EDGE - 6.2)
            return
        theme = self.theme
        if theme.plain:
            self.set_y(-theme.margin_bottom + 6)
            self.set_draw_color(*theme.rule)
            self.set_line_width(0.15)
            self.line(
                theme.margin_side, self.get_y(), theme.page_width - theme.margin_side, self.get_y()
            )
            self.ln(1.5)
            self.set_font(self.theme.heading_family, size=7.5)
            self.set_text_color(*theme.muted)
            width = theme.frame / 2
            label = self.look.tlp and TLP_LABELS[self.look.tlp][0]
            mark = self.tlp_width() + 3 if label else 0.0
            self.cell(width, 4, self.note_title, align=Align.L)
            self.cell(width - mark, 4, str(self.page_no()), align=Align.R)
            if label:
                self.tlp_mark(theme.page_width - theme.margin_side, self.get_y() - 1.0)
            return
        self._running_footer()

    def tlp_width(self) -> float:
        label = TLP_LABELS.get(self.look.tlp)
        if label is None:
            return 0.0
        with self.local_context():
            self.set_font(pdffonts.SANS, "B", TLP_SIZE)
            return self.get_string_width(label[0]) + 4.0

    def tlp_mark(self, right: float, top: float) -> None:
        """The TLP label, coloured on black, its right edge at ``right``."""
        label = TLP_LABELS.get(self.look.tlp)
        if label is None:
            return
        text, colour = label
        width = self.tlp_width()
        x, y = self.get_x(), self.get_y()
        with self.local_context():
            self.set_fill_color(*BLACK)
            self.rect(right - width, top, width, 6.2, style="F")
            self.set_font(pdffonts.SANS, "B", TLP_SIZE)
            self.set_text_color(*colour)
            self.set_xy(right - width, top)
            self.cell(width, 6.2, text, align=Align.C)
        self.set_xy(x, y)

    def _running_header(self) -> None:
        theme = self.theme
        left, right = theme.margin_side, self.w - theme.margin_side
        mark = self.tlp_width()
        base = theme.margin_top - 9.0
        with self.local_context():
            self.set_font(self.theme.heading_family, "B", 7.2)
            self.set_text_color(*theme.accent)
            kicker = KICKERS[theme.style]
            self.set_char_spacing(0.6)
            self.set_xy(left, base)
            self.cell(self.get_string_width(kicker) + 4, 5, kicker)
            self.set_char_spacing(0)
            self.set_font(self.theme.heading_family, "", 7.5)
            self.set_text_color(*theme.muted)
            room = right - self.get_x() - (mark + 4 if mark else 0)
            self.cell(room, 5, fit_line(self, self.note_title, room))
            self.set_draw_color(*theme.rule)
            self.set_line_width(0.2)
            self.line(left, base + 6.6, right, base + 6.6)
        if mark:
            self.tlp_mark(right, base - 0.8)

    def _running_footer(self) -> None:
        theme = self.theme
        left, right = theme.margin_side, self.w - theme.margin_side
        mark = self.tlp_width()
        top = self.h - theme.margin_bottom + 8.0
        with self.local_context():
            self.set_draw_color(*theme.rule)
            self.set_line_width(0.2)
            self.line(left, top, right, top)
            self.set_font(self.theme.heading_family, "", 7.5)
            self.set_text_color(*theme.muted)
            self.set_xy(left, top + 1.8)
            stamp = long_date(self.day)
            self.cell((right - left) / 2, 4.5, stamp)
            page = f"Page {self.page_no()} / {{nb}}"
            self.set_font(self.theme.heading_family, "B", 7.5)
            self.set_text_color(*theme.ink)
            width = (right - left) / 2 - (mark + 3 if mark else 0)
            self.cell(width, 4.5, page, align=Align.R)
        if mark:
            self.tlp_mark(right, top + 1.4)

    def _band(self) -> None:
        """The brief's first page opens on a dark band: what, when, how shared."""
        theme = self.theme
        look = self.look
        ground = mix(theme.accent, (22, 24, 29), 0.94)
        left, right = theme.margin_side, self.w - theme.margin_side
        width = right - left
        mark = self.tlp_width()
        with self.local_context():
            self.set_font(self.theme.heading_family, "B", 18)
            lines = self.multi_cell(width - (mark + 4 if mark else 0), 8.0, self.note_title,
                                    align=Align.L, dry_run=True, output="LINES")
            assert isinstance(lines, list)
            subtitle = look.cover.subtitle
            height = 18.0 + 8.0 * len(lines) + (6.0 if subtitle else 0.0) + 6.0
            self.set_fill_color(*ground)
            self.rect(0, 0, self.w, height, style="F")
            self.set_fill_color(*theme.accent)
            self.rect(0, height, self.w, 1.6, style="F")
            self.set_xy(left, 9.0)
            self.set_font(self.theme.heading_family, "B", 7.5)
            self.set_char_spacing(1.0)
            self.set_text_color(*mix(theme.accent, WHITE, 0.55))
            self.cell(self.get_string_width("BRIEF") + 5, 5, "BRIEF")
            self.set_char_spacing(0)
            self.set_font(self.theme.heading_family, "", 8)
            self.set_text_color(*mix(ground, WHITE, 0.7))
            self.cell(80, 5, long_date(self.day))
            self.set_xy(left, 16.0)
            self.set_font(self.theme.heading_family, "B", 18)
            self.set_text_color(*WHITE)
            self.multi_cell(width - (mark + 4 if mark else 0), 8.0, self.note_title, align=Align.L,
                            new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            if subtitle:
                self.set_x(left)
                self.set_font(self.theme.heading_family, "", 9.5)
                self.set_text_color(*mix(ground, WHITE, 0.78))
                self.cell(width, 6.0, fit_line(self, subtitle, width))
        if mark:
            self.tlp_mark(right, 8.4)
        self.band_bottom = height + 1.6 + 6.0


    # -- the cover ------------------------------------------------------------

    def cover(
        self,
        *,
        image: tuple[object, tuple[int, int]] | None = None,
        placeholder: str = "",
    ) -> None:
        """A page of its own: a picture or a field of colour, then the title.

        ``image`` is a file and its pixel size, drawn to fill the top of the page
        and cropped rather than squeezed; ``placeholder`` names the picture a
        template will show once a case gives it one.
        """
        theme = self.theme
        look = self.look
        self.bare_pages.add(self.page + 1)
        self.add_page()
        # everything on a cover is placed by hand, so nothing on it may break a page
        self.set_auto_page_break(False)
        width, height = self.w, self.h
        left = max(theme.margin_side, 20.0)
        field_height = round(height * 0.52, 1)
        ground = mix(theme.accent, BLACK, 0.55)
        with self.local_context():
            self.set_fill_color(*ground)
            self.rect(0, 0, width, field_height, style="F")
            if image is not None:
                source, (pixels_wide, pixels_high) = image
                scale = max(width / pixels_wide, field_height / pixels_high)
                drawn_w, drawn_h = pixels_wide * scale, pixels_high * scale
                with self.rect_clip(0, 0, width, field_height):
                    self.place_picture(
                        source,
                        x=(width - drawn_w) / 2,
                        y=(field_height - drawn_h) / 2,
                        w=drawn_w,
                        h=drawn_h,
                    )
                # A dark foot under the kicker keeps it readable on a bright picture.
                with self.local_context(fill_opacity=0.55):
                    self.set_fill_color(*BLACK)
                    self.rect(0, 0, width, 17.0, style="F")
            else:
                self._contours(ground, field_height)
                if placeholder:
                    self.set_font(self.theme.heading_family, "", 9)
                    self.set_text_color(*mix(ground, WHITE, 0.6))
                    self.set_xy(0, field_height / 2 - 3)
                    self.cell(width, 6, placeholder, align=Align.C)
            self.set_fill_color(*theme.accent)
            self.rect(0, field_height, width, 2.4, style="F")
            self.set_xy(left, 8.0)
            self.set_font(self.theme.heading_family, "B", 8)
            self.set_char_spacing(1.4)
            self.set_text_color(*WHITE)
            kicker = KICKERS[theme.style]
            self.cell(self.get_string_width(kicker) + 4, 5, kicker)
            self.set_char_spacing(0)

            frame = width - 2 * left
            y = field_height + 18.0
            self.set_fill_color(*theme.accent)
            self.rect(left, y, 16.0, 1.3, style="F")
            self.set_xy(left, y + 6.0)
            self.set_font(self.theme.heading_family, "B", 28)
            self.set_text_color(*theme.ink)
            self.multi_cell(frame, 11.5, self.note_title, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            if look.cover.subtitle:
                self.ln(2.5)
                self.set_x(left)
                self.set_font(self.theme.aside_family, "I", 13.5)
                self.set_text_color(*theme.muted)
                self.multi_cell(frame, 6.6, look.cover.subtitle, align=Align.L, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.ln(7)
            self.set_x(left)
            self.set_font(self.theme.heading_family, "B", 10)
            self.set_text_color(*theme.accent_dark)
            self.cell(frame, 5, long_date(self.day))

            label = TLP_LABELS.get(look.tlp)
            if label is not None:
                foot = height - 30.0
                self.set_draw_color(*theme.rule)
                self.set_line_width(0.2)
                self.line(left, foot, width - left, foot)
                self.set_xy(left, foot + 4.5)
                self.set_font(self.theme.heading_family, "", 8)
                self.set_text_color(*theme.muted)
                self.multi_cell(frame - self.tlp_width() - 6, 4.2, TLP_MEANINGS[look.tlp], align=Align.L)
        if label is not None:
            self.tlp_mark(width - left, 7.4)
            self.tlp_mark(width - left, height - 30.0 + 4.0)
        self.set_auto_page_break(True, margin=theme.margin_bottom)

    def _contours(self, ground: RGB, field_height: float) -> None:
        """A quiet pattern of rings for a cover with no picture: a bearing plot's
        range circles, off-centre, faint enough to read as texture."""
        self.set_draw_color(*mix(ground, WHITE, 0.09))
        self.set_line_width(0.25)
        cx, cy = self.w * 0.78, field_height * 0.62
        with self.rect_clip(0, 0, self.w, field_height):
            for ring in range(1, 15):
                radius = ring * 11.0
                self.circle(cx, cy, radius, style="D")
            self.set_draw_color(*mix(ground, WHITE, 0.14))
            self.line(cx, 0, cx, field_height)
            self.line(cx - 160, cy, self.w, cy)

    # -- the table of contents ----------------------------------------------

    def contents_page(self, outline: Sequence[OutlineSection], *, first_page: int, pages: int) -> None:
        """Draw the reserved contents pages: the sections down to the second level,
        each linked to its page, with a dotted leader to the number."""
        theme = self.theme
        left, right = self.l_margin, self.w - self.r_margin
        # fpdf2 hands the page back where the placeholder stood: under a title, or at the top
        top = max(self.get_y(), self.t_margin)
        self.set_xy(left, top)
        if top > self.t_margin + 1:
            self.set_font(self.theme.heading_family, "B", 8)
            self.set_text_color(*theme.accent)
            self.set_char_spacing(1.0)
            self.cell(0, 5, "CONTENTS", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.set_char_spacing(0)
            self.ln(2.5)
        else:
            self.set_fill_color(*theme.accent)
            self.rect(left, self.get_y(), 16.0, 1.2, style="F")
            self.ln(5)
            self.set_font(self.theme.heading_family, "B", 20)
            self.set_text_color(*theme.ink)
            self.cell(0, 10, "Contents", new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.ln(5)
        entries = [section for section in outline if section.level <= 1]
        last_page = first_page + pages - 1
        for position, section in enumerate(entries):
            level = section.level
            height = 7.4 if level == 0 else 6.0
            if self.get_y() + height > self.h - self.b_margin - 6:
                if self.page >= last_page:
                    self.set_font(self.theme.aside_family, "I", 9)
                    self.set_text_color(*theme.muted)
                    more = len(entries) - position
                    self.cell(0, 6, f"{more} more in the document's bookmarks.")
                    break
                self.add_page()
                self.set_xy(left, self.t_margin)
            name = section.name
            page = section.page_number
            indent = 0.0 if level == 0 else 7.0
            if level == 0:
                self.set_font(self.theme.heading_family, "B", 10.5)
                self.set_text_color(*theme.ink)
            else:
                self.set_font(theme.body_family, "", 9.8)
                self.set_text_color(*mix(theme.ink, WHITE, 0.15))
            number = str(page)
            room = right - left - indent - 14
            label = fit_line(self, name, room)
            link = self.add_link(page=page)
            y = self.get_y()
            self.set_xy(left + indent, y)
            self.cell(self.get_string_width(label) + 1.5, height, label, link=link)
            start = self.get_x() + 1
            with self.local_context():
                self.set_draw_color(*theme.rule)
                self.set_line_width(0.3)
                self.set_dash_pattern(dash=0.3, gap=1.2)
                self.line(start, y + height * 0.72, right - 9, y + height * 0.72)
            self.set_xy(right - 9, y)
            self.set_font(self.theme.heading_family, "B" if level == 0 else "", 9.5)
            self.set_text_color(*(theme.accent if level == 0 else theme.muted))
            self.cell(9, height, number, align=Align.R, link=link)
            self.set_xy(left, y + height + (1.4 if level == 0 else 0.4))
        while self.page < last_page:
            self.add_page()


KICKERS = {"plain": "AZIMUT NOTES", "report": "REPORT", "brief": "BRIEF", "journal": "LOG"}


def fit_line(pdf: FPDF, text: str, width: float) -> str:
    """One line of ``text`` that fits ``width``, cut with an ellipsis if it must be."""
    if pdf.get_string_width(text) <= width:
        return text
    cut = longest_prefix(lambda n: pdf.get_string_width(text[:n] + "…") <= width, len(text) - 1)
    return text[:cut].rstrip() + "…"


def longest_prefix(fits: Callable[[int], bool], most: int) -> int:
    """The largest ``n`` up to ``most`` for which ``fits(n)`` holds, 0 when none does.

    A prefix of a text is never wider than the text, so a halving search finds the
    cut a walk back one letter at a time would: a long address measured a dozen
    times rather than once per letter, each measure shaping the whole prefix again.
    """
    low, high = 0, max(0, most)
    while low < high:
        middle = (low + high + 1) // 2
        if fits(middle):
            low = middle
        else:
            high = middle - 1
    return low
