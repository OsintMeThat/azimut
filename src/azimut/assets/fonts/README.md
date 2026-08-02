# Fonts shipped with the notes PDF export

A PDF embeds the faces it draws with, so `engine/notes_pdf.py` cannot use
whatever the machine has installed: the same note must come out the same from
the Windows, Linux and macOS binaries. These faces ship in the wheel and in the
frozen binaries (`packaging/azimut.spec`), and only the glyphs a document uses
are embedded in it — a note with three Burmese words does not carry the Burmese
font.

| File | Drawn as | Covers |
|---|---|---|
| `NotoSerif-Regular/Bold/Italic/BoldItalic` | body text | Latin, Greek, Cyrillic |
| `NotoSans-Regular/Bold` | headings, tables, footer | Latin, Greek, Cyrillic |
| `NotoSansMono-Regular` | code | Latin, Greek, Cyrillic |
| `DroidSansFallbackFull` | fallback | Chinese, Japanese |
| `NanumGothic-Regular` | fallback | Korean |
| `NotoSans<Script>-Regular` × 28 | fallback | Arabic, Hebrew, Burmese, Thai, the Indic scripts, Georgian, Armenian, Ethiopic, Khmer, Lao and the rest of the living scripts |
| `DejaVuSans` | fallback | arrows, ticks, box drawing, degree signs |

About 15 MB in total, 7 MB of it compressed into the wheel. Which face draws
which range is declared once, in `engine/pdffonts.py`'s `SCRIPTS` table, and
`tests/test_notes_pdf.py` fails if a file named there is missing — or if a file
here is named nowhere.

Nothing is borrowed from the machine, including CJK: a note exported on Windows
and the same note exported on Linux have to be the same document, and a font
that is only sometimes installed cannot promise that.

Arabic, Burmese and the Indic scripts need their letters joined, stacked and
reordered, which fpdf2 does through HarfBuzz (`uharfbuzz`, a hard dependency for
that reason).

Licences: the Noto faces and Nanum Gothic are SIL Open Font License 1.1
(`OFL.txt`), Droid Sans Fallback is Apache 2.0 (`APACHE-2.0.txt`), and DejaVu is
the Bitstream Vera / Arev licence (`BITSTREAM-VERA.txt`). All are
redistributable, and all require their licence to travel with the files.
