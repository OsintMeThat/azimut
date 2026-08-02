"""Fonts for the notes PDF, and what happens when a script has none.

A PDF embeds the faces it draws with, so the export cannot lean on whatever the
machine happens to have installed: the same note has to come out the same from
the three binaries. The faces ship in `assets/fonts/` for that — see the README
there for the list and the licences — and only the glyphs a document actually
uses are embedded, so a note with three Burmese words does not carry the Burmese
font.

Three faces are always loaded and the other thirty-odd are not. A note in French
should not pay to parse a Korean font, so the script faces are added per
document, decided from the note's own text by the `SCRIPTS` table below: a
character's Unicode range names both the face that draws it and the script the
warning calls it, without opening a file to find out.

Whatever is still uncovered is named. fpdf2 draws nothing for a glyph it has no
face for, so the warning is the only sign the analyst would get — and "no font on
this machine covers Cherokee" reads as a limit, where a silently short line reads
as lost work.

Text shaping is on for the whole document. Without it Arabic comes out unjoined
and Burmese mis-stacked — text that looks like text and is wrong, which is worse
than text that is missing.

The faces go in as fpdf2 *fallbacks* rather than being switched by hand, which
is what keeps a right-to-left phrase whole: fpdf2 picks a face per character and
still hands the run to HarfBuzz in one piece.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fpdf import FPDF

FONT_DIR = Path(__file__).resolve().parent.parent / "assets" / "fonts"

#: Families the document asks for by name.
SERIF = "azimut-serif"
SANS = "azimut-sans"
MONO = "azimut-mono"

#: (family, style) → file. Sans has no italic and mono no bold on purpose: each
#: face is another half megabyte in all three binaries, and the ones left out
#: only ever serve emphasis inside a heading or a code span.
CORE_FACES: dict[tuple[str, str], str] = {
    (SERIF, ""): "NotoSerif-Regular.ttf",
    (SERIF, "B"): "NotoSerif-Bold.ttf",
    (SERIF, "I"): "NotoSerif-Italic.ttf",
    (SERIF, "BI"): "NotoSerif-BoldItalic.ttf",
    (SANS, ""): "NotoSans-Regular.ttf",
    (SANS, "B"): "NotoSans-Bold.ttf",
    (MONO, ""): "NotoSansMono-Regular.ttf",
}


@dataclass(frozen=True)
class Script:
    """A writing system, the face that draws it and where it lives in Unicode."""

    #: How a warning names it, so a failure reads as a limit and not as a bug.
    name: str
    file: str
    ranges: tuple[tuple[int, int], ...]

    def holds(self, code: int) -> bool:
        return any(start <= code <= end for start, end in self.ranges)


#: Living scripts, in code-point order. Historical ones (Cuneiform, Linear B,
#: Ogham) are left out: they are a megabyte each for text no case will hold.
#: Latin, Greek and Cyrillic are absent because the body faces already have
#: them — this table is only consulted for what they lack.
#:
#: CJK is Droid Sans Fallback plus Nanum Gothic rather than Noto Sans CJK: 6 MB
#: between them against 19 MB for Noto's, for the same coverage of Chinese,
#: Japanese and Korean. Bundled rather than borrowed from the system, so a note
#: exported on Windows and the same note exported on Linux are the same document.
SCRIPTS: tuple[Script, ...] = (
    Script("Armenian", "NotoSansArmenian-Regular.ttf", ((0x0530, 0x058F),)),
    Script("Hebrew", "NotoSansHebrew-Regular.ttf", ((0x0590, 0x05FF),)),
    Script(
        "Arabic",
        "NotoSansArabic-Regular.ttf",
        ((0x0600, 0x06FF), (0x0750, 0x077F), (0xFB50, 0xFDFF), (0xFE70, 0xFEFF)),
    ),
    Script("Syriac", "NotoSansSyriac-Regular.ttf", ((0x0700, 0x074F),)),
    Script("Thaana", "NotoSansThaana-Regular.ttf", ((0x0780, 0x07BF),)),
    Script("N'Ko", "NotoSansNKo-Regular.ttf", ((0x07C0, 0x07FF),)),
    Script("Devanagari", "NotoSansDevanagari-Regular.ttf", ((0x0900, 0x097F),)),
    Script("Bengali", "NotoSansBengali-Regular.ttf", ((0x0980, 0x09FF),)),
    Script("Gurmukhi", "NotoSansGurmukhi-Regular.ttf", ((0x0A00, 0x0A7F),)),
    Script("Gujarati", "NotoSansGujarati-Regular.ttf", ((0x0A80, 0x0AFF),)),
    Script("Odia", "NotoSansOriya-Regular.ttf", ((0x0B00, 0x0B7F),)),
    Script("Tamil", "NotoSansTamil-Regular.ttf", ((0x0B80, 0x0BFF),)),
    Script("Telugu", "NotoSansTelugu-Regular.ttf", ((0x0C00, 0x0C7F),)),
    Script("Kannada", "NotoSansKannada-Regular.ttf", ((0x0C80, 0x0CFF),)),
    Script("Malayalam", "NotoSansMalayalam-Regular.ttf", ((0x0D00, 0x0D7F),)),
    Script("Sinhala", "NotoSansSinhala-Regular.ttf", ((0x0D80, 0x0DFF),)),
    Script("Thai", "NotoSansThai-Regular.ttf", ((0x0E00, 0x0E7F),)),
    Script("Lao", "NotoSansLao-Regular.ttf", ((0x0E80, 0x0EFF),)),
    Script("Burmese", "NotoSansMyanmar-Regular.ttf", ((0x1000, 0x109F), (0xA9E0, 0xA9FF))),
    Script("Georgian", "NotoSansGeorgian-Regular.ttf", ((0x10A0, 0x10FF), (0x2D00, 0x2D2F))),
    Script("Ethiopic", "NotoSansEthiopic-Regular.ttf", ((0x1200, 0x139F),)),
    Script("Cherokee", "NotoSansCherokee-Regular.ttf", ((0x13A0, 0x13FF), (0xAB70, 0xABBF))),
    Script(
        "Canadian Aboriginal syllabics",
        "NotoSansCanadianAboriginal-Regular.ttf",
        ((0x1400, 0x167F),),
    ),
    Script("Khmer", "NotoSansKhmer-Regular.ttf", ((0x1780, 0x17FF), (0x19E0, 0x19FF))),
    Script("Mongolian", "NotoSansMongolian-Regular.ttf", ((0x1800, 0x18AF),)),
    Script("Balinese", "NotoSansBalinese-Regular.ttf", ((0x1B00, 0x1B7F),)),
    Script("Coptic", "NotoSansCoptic-Regular.ttf", ((0x2C80, 0x2CFF),)),
    Script("Tifinagh", "NotoSansTifinagh-Regular.ttf", ((0x2D30, 0x2D7F),)),
    Script(
        "Korean",
        "NanumGothic-Regular.ttf",
        ((0x1100, 0x11FF), (0x3130, 0x318F), (0xA960, 0xA97F), (0xAC00, 0xD7FF)),
    ),
    Script("Yi", "NotoSansYi-Regular.ttf", ((0xA000, 0xA4CF),)),
    Script("Vai", "NotoSansVai-Regular.ttf", ((0xA500, 0xA62B),)),
    Script("Javanese", "NotoSansJavanese-Regular.ttf", ((0xA980, 0xA9DF),)),
    Script("Cham", "NotoSansCham-Regular.ttf", ((0xAA00, 0xAA5F),)),
    Script(
        "Chinese and Japanese",
        "DroidSansFallbackFull.ttf",
        (
            (0x2E80, 0x2FFF),
            (0x3000, 0x312F),
            (0x3190, 0x31EF),
            (0x3200, 0x9FFF),
            (0xF900, 0xFAFF),
            (0x20000, 0x2FA1F),
        ),
    ),
    Script("Adlam", "NotoSansAdlam-Regular.ttf", ((0x1E900, 0x1E95F),)),
)

#: Arrows, ticks, box drawing and degree signs — the punctuation a note collects
#: from pasted terminal output and spreadsheets, which the Noto text faces do not
#: carry. Always added, because it is small and almost every note wants one.
SYMBOL_FAMILY = "azimut-symbols"
SYMBOL_FILE = "DejaVuSans.ttf"


class FontError(Exception):
    """A face the export cannot do without is missing or unreadable."""


def _add(pdf: "FPDF", family: str, style: str, filename: str) -> None:
    path = FONT_DIR / filename
    try:
        pdf.add_font(family, style, str(path))
    except (OSError, RuntimeError, ValueError) as exc:
        raise FontError(f"the bundled font {filename} could not be read: {exc}") from exc


def scripts_in(text: str) -> list[Script]:
    """The script faces this text needs, in the table's order.

    Decided from the characters alone, so a note that is only Latin never opens
    a font file it will not draw with.
    """
    codes = {ord(char) for char in set(text) if not char.isascii()}
    return [script for script in SCRIPTS if any(script.holds(code) for code in codes)]


def install(pdf: "FPDF", text: str) -> None:
    """Load the faces this document needs and turn shaping on.

    The script faces go in as fallbacks: fpdf2 then picks one per character, so
    a Burmese word inside an English sentence keeps its own face and its own
    shaping without the caller cutting the line into runs.
    """
    for (family, style), filename in CORE_FACES.items():
        _add(pdf, family, style, filename)
    _add(pdf, SYMBOL_FAMILY, "", SYMBOL_FILE)
    fallbacks = [SYMBOL_FAMILY]
    for script in scripts_in(text):
        family = f"azimut-{Path(script.file).stem.lower()}"
        _add(pdf, family, "", script.file)
        fallbacks.append(family)
    # Symbols last: a script face is the better answer whenever it has the glyph.
    pdf.set_fallback_fonts([*fallbacks[1:], SYMBOL_FAMILY], exact_match=False)
    pdf.set_text_shaping(True)


def uncovered(pdf: "FPDF", text: str) -> set[str]:
    """Characters no loaded face can draw, which the caller names in a warning."""
    # A core font is one of the PDF base fourteen and has no cmap to read; only
    # the TrueType faces this module adds are worth asking.
    charmaps = [font.cmap for font in pdf.fonts.values() if hasattr(font, "cmap")]
    missing = set()
    for char in set(text):
        if char.isascii() or char in "\n\r\t":
            continue
        if not any(ord(char) in charmap for charmap in charmaps):
            missing.add(char)
    return missing


def script_of(char: str) -> str:
    """What to call this character's script in a warning."""
    code = ord(char)
    return next((script.name for script in SCRIPTS if script.holds(code)), "some characters")
