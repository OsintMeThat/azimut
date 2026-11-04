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
| `NotoSans-Italic/BoldItalic` | emphasis, where the body is sans | Latin, Greek, Cyrillic |
| `Literata-Regular/Bold/Italic/BoldItalic` | the look's "book" face | Latin, Greek, Cyrillic |
| `IBMPlexSans-Regular/Bold/Italic/BoldItalic` | the look's "modern" face | Latin, Greek, Cyrillic |
| `NotoSansMono-Regular` | code | Latin, Greek, Cyrillic |
| `DroidSansFallbackFull` | fallback | Chinese, Japanese |
| `NanumGothic-Regular` | fallback | Korean |
| `NotoSans<Script>-Regular` × 28 | fallback | Arabic, Hebrew, Burmese, Thai, the Indic scripts, Georgian, Armenian, Ethiopic, Khmer, Lao and the rest of the living scripts |
| `DejaVuSans` | fallback | arrows, ticks, box drawing, degree signs |

About 18 MB in total. Which face draws which range is declared once, in
`engine/pdffonts.py`'s `SCRIPTS` table, the faces a look can pick in its `FONTS`
table, and `tests/test_notes_pdf.py` fails if a file named there is missing, or
if a file here is named nowhere. A look's face is loaded only by the document
that picks it; a letter it lacks is drawn by the Noto face of its kind.

Nothing is borrowed from the machine, including CJK: a note exported on Windows
and the same note exported on Linux have to be the same document, and a font
that is only sometimes installed cannot promise that.

Arabic, Burmese and the Indic scripts need their letters joined, stacked and
reordered, which fpdf2 does through HarfBuzz (`uharfbuzz`, a hard dependency for
that reason).

Licences: the Noto faces and Nanum Gothic are SIL Open Font License 1.1
(`OFL.txt`), Literata and IBM Plex Sans are too, each with its own copyright
line (`Literata-OFL.txt`, `IBMPlexSans-OFL.txt`; the files ship unmodified, so
Plex's reserved name is kept), Droid Sans Fallback is Apache 2.0
(`APACHE-2.0.txt`), and DejaVu is the Bitstream Vera / Arev licence
(`BITSTREAM-VERA.txt`). All are
redistributable, and all require their licence to travel with the files.
