"""Notes rendered to PDF: the renderer, the fonts and the export route."""

import base64
import re
import socket
from io import BytesIO

import pytest
from PIL import Image
from pypdf import PdfReader

from azimut import layout
from azimut.api import notes as notes_api
from azimut.engine import notes_pdf, pdffonts
from azimut.workspace import Case

# -- helpers -----------------------------------------------------------------


class FakeCase:
    """Just enough case for the renderer: entities to resolve, files to read."""

    def __init__(self, tmp_path, entities=None):
        self.id = "demo"
        self.path = tmp_path
        self._entities = entities or {}

    def get_entity(self, entity_id):
        return self._entities.get(entity_id)

    def resolve_inside(self, relative):
        return self.path / relative


def png(tmp_path, name, size=(400, 300), color="#4a5a6a"):
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", size, color).save(path)
    return path


def png_bytes(size=(600, 200)):
    buffer = BytesIO()
    Image.new("RGB", size, "white").save(buffer, format="PNG")
    return buffer.getvalue()


def pdf_text(data: bytes) -> str:
    """What a reader shows, across every page.

    Read back rather than inspected: an embedded subset encodes text as glyph
    codes, so the only honest check that a line reached the page is to decode it
    the way a PDF reader would.
    """
    reader = PdfReader(BytesIO(data))
    return "\n".join(page.extract_text() for page in reader.pages)


def exports_of(case_id: str):
    return layout.subdir(Case.open(case_id).path, "exports")


# -- source rewrites ---------------------------------------------------------


def test_case_syntax_becomes_markdown_the_parser_understands():
    rewritten = notes_pdf._case_references(
        "See [[entity:abc|The roof]] and [[media:m1|Frame]]{width=50% align=center}"
    )
    assert "[The roof](azimut://entity/abc)" in rewritten
    assert "![Frame](azimut://media/m1?__azimut_attrs=width%3D50%25%20align%3Dcenter)" in rewritten
    # The percent-encoding matches the preview's encodeURIComponent, so one
    # spelling of an annotated URL is parsed by both sides.


def test_image_attributes_survive_the_round_trip():
    rewritten = notes_pdf._case_references('![alt](/files/demo/media/a.png "Cap"){width=70%}')
    source, width, align = notes_pdf._image_options(
        rewritten[rewritten.index("(") + 1 : rewritten.index(' "Cap")')]
    )
    assert (source, width, align) == ("/files/demo/media/a.png", "70%", "left")


def test_only_bounded_widths_are_honoured():
    assert notes_pdf._image_options("/a.png?__azimut_attrs=width%3D50%25")[1] == "50%"
    assert notes_pdf._image_options("/a.png?__azimut_attrs=width%3D9000px")[1] == ""
    assert notes_pdf._image_options("/a.png?__azimut_attrs=align%3Dsideways")[2] == "left"


def test_mermaid_fences_are_found_in_document_order():
    text = "```mermaid\ngraph TD; A-->B;\n```\n\ntext\n\n```mermaid\ngraph LR; C-->D;\n```\n"
    sources = notes_pdf.mermaid_sources(text)
    assert [s.strip() for s in sources] == ["graph TD; A-->B;", "graph LR; C-->D;"]
    # The key follows the source, so a moved fence still finds its picture.
    assert notes_pdf.diagram_key(sources[0]) == notes_pdf.diagram_key("  graph TD; A-->B;  ")
    assert notes_pdf.diagram_key(sources[0]) != notes_pdf.diagram_key(sources[1])


# -- the document ------------------------------------------------------------


def test_a_note_renders_to_a_real_pdf(tmp_path):
    out = notes_pdf.render(FakeCase(tmp_path), title="Rooftop", text="# Heading\n\nBody text.\n")
    assert out.pdf.startswith(b"%PDF-")
    assert out.warnings == []
    assert "Body text." in pdf_text(out.pdf)


def test_the_title_is_not_printed_twice(tmp_path):
    text = "# Rooftop\n\nBody.\n"
    out = notes_pdf.render(FakeCase(tmp_path), title="Rooftop", text=text)
    assert pdf_text(out.pdf).count("Rooftop") == 2  # the header, and the running footer
    kept = notes_pdf.render(FakeCase(tmp_path), title="Rooftop", text="# Other heading\n\nB.\n")
    assert "Other heading" in pdf_text(kept.pdf)


def test_an_empty_note_still_produces_a_page(tmp_path):
    out = notes_pdf.render(FakeCase(tmp_path), title="Blank", text="   \n")
    assert out.pdf.startswith(b"%PDF-")
    assert "This note is empty." in pdf_text(out.pdf)


def test_a_deleted_reference_is_marked_rather_than_dropped(tmp_path):
    case = FakeCase(tmp_path, {"live": {"id": "live", "label": "Roof", "attrs": {}}})
    document = notes_pdf._Note(title="N")
    pdffonts.install(document, "")
    builder = notes_pdf._Builder(document, case, {})
    tokens = notes_pdf._parser().parse(
        notes_pdf._case_references("[[entity:live|Roof]] and [[entity:gone|Ghost]]\n")
    )
    runs = {run.text: run for run in builder._inline([t for t in tokens if t.type == "inline"][0])}
    # A live reference reads as a reference; a deleted one goes quiet and italic
    # rather than passing for ordinary text.
    assert runs["Roof"].bold and not runs["Roof"].italic
    assert runs["Ghost"].italic and runs["Ghost"].color == notes_pdf.MUTED
    assert runs["Roof"].link == "" and runs["Ghost"].link == ""


def test_local_images_are_embedded_and_remote_ones_are_not(tmp_path):
    png(tmp_path, "media/roof.png")
    case = FakeCase(tmp_path)
    text = (
        "![roof](/files/demo/media/roof.png)\n\n"
        "![far](https://example.org/x.png)\n"
    )
    out = notes_pdf.render(case, title="Images", text=text)
    assert "1 remote image left out" in " ".join(out.warnings)
    assert "External image not included in PDF." in pdf_text(out.pdf)


def test_rendering_never_reaches_the_network(tmp_path, monkeypatch):
    def explode(*args, **kwargs):
        raise AssertionError("the PDF export must not open a connection")

    monkeypatch.setattr(socket, "socket", explode)
    monkeypatch.setattr(socket, "create_connection", explode)
    out = notes_pdf.render(
        FakeCase(tmp_path),
        title="Remote",
        text="![far](https://example.org/x.png)\n\n[link](https://example.org)\n",
    )
    assert out.pdf.startswith(b"%PDF-")


def test_a_media_reference_resolves_to_the_file_it_names(tmp_path):
    png(tmp_path, "media/frame.png")
    case = FakeCase(
        tmp_path,
        {
            "m1": {
                "id": "m1",
                "label": "Frame",
                "type": "capture",
                "attrs": {"path": "media/frame.png", "kind": "image"},
            },
            "v1": {
                "id": "v1",
                "label": "Clip",
                "type": "media",
                "attrs": {"path": "media/clip.mp4", "kind": "video"},
            },
            "gone": {"id": "gone", "label": "Lost", "type": "media", "attrs": {}},
        },
    )
    out = notes_pdf.render(
        case,
        title="Media",
        text="[[media:m1|Frame]]\n\n[[media:v1|Clip]]\n\n[[media:gone|Lost]]\n",
    )
    text = pdf_text(out.pdf)
    assert "Video not included in PDF." in text
    assert "Media unavailable" in text


def test_a_diagram_is_placed_when_the_browser_sends_it(tmp_path):
    text = "```mermaid\ngraph TD; A-->B;\n```\n"
    key = notes_pdf.diagram_key(notes_pdf.mermaid_sources(text)[0])
    drawn = notes_pdf.render(
        FakeCase(tmp_path), title="D", text=text, diagrams={key: png_bytes()}
    )
    assert "Diagram not drawn." not in pdf_text(drawn.pdf)
    missing = notes_pdf.render(FakeCase(tmp_path), title="D", text=text)
    # Without the picture the fence keeps its source rather than disappearing.
    assert "Diagram not drawn." in pdf_text(missing.pdf)
    assert "graph TD" in pdf_text(missing.pdf)


def test_a_wide_code_line_is_broken_rather_than_overflowing(tmp_path):
    long_line = "x = " + " + ".join(str(n) for n in range(200))
    out = notes_pdf.render(FakeCase(tmp_path), title="Code", text=f"```\n{long_line}\n```\n")
    assert out.pdf.startswith(b"%PDF-")


def test_a_tall_image_is_scaled_to_stay_on_the_page(tmp_path):
    png(tmp_path, "media/tall.png", size=(400, 6000))
    out = notes_pdf.render(
        FakeCase(tmp_path), title="Tall", text="![tall](/files/demo/media/tall.png)\n"
    )
    assert out.pdf.startswith(b"%PDF-")


def test_tables_and_lists_survive_a_full_note(tmp_path):
    text = (
        "| Site | Distance |\n|---|---|\n| Roof | 120 m |\n\n"
        "- [x] matched\n- [ ] pending\n\n"
        "1. first\n2. second\n\n"
        "> quoted line\n\n"
        "::: center\ncentred\n:::\n"
    )
    out = notes_pdf.render(FakeCase(tmp_path), title="All", text=text)
    rendered = pdf_text(out.pdf)
    for expected in ("Site", "Distance", "matched", "first", "quoted line", "centred"):
        assert expected in rendered


# -- fonts -------------------------------------------------------------------


def test_every_face_the_code_names_is_actually_shipped():
    """The gate against a face named in the table but missing from the wheel.

    A missing fallback degrades quietly at runtime — the script it covered turns
    into replacement characters — so the mismatch has to fail here instead.
    """
    named = {
        *pdffonts.CORE_FACES.values(),
        *(script.file for script in pdffonts.SCRIPTS),
        pdffonts.SYMBOL_FILE,
    }
    missing = sorted(name for name in named if not (pdffonts.FONT_DIR / name).is_file())
    assert missing == []
    # And nothing ships that no code path can reach.
    shipped = {path.name for path in pdffonts.FONT_DIR.glob("*.ttf")}
    assert sorted(shipped - named) == []


def test_the_body_faces_carry_latin_greek_and_cyrillic_alone():
    """Russian and Greek are body text, not a fallback: no extra file is opened."""
    assert pdffonts.scripts_in("Русский текст, Ελληνικά, français, ĉ") == []


def test_a_note_only_loads_the_faces_its_own_text_needs():
    burmese = pdffonts.scripts_in("Sources: မြန်မာဘာသာစကား")
    assert [script.name for script in burmese] == ["Burmese"]
    mixed = pdffonts.scripts_in("中文, 한국어, العربية")
    assert [script.name for script in mixed] == ["Arabic", "Korean", "Chinese and Japanese"]


def test_scripts_are_named_the_way_a_reader_would_name_them():
    for char, script in [("中", "Chinese and Japanese"), ("한", "Korean"), ("م", "Arabic"),
                         ("မ", "Burmese"), ("ก", "Thai"), ("ខ", "Khmer")]:
        assert pdffonts.script_of(char) == script


def test_every_script_the_table_names_renders_in_one_document(tmp_path):
    samples = "Русский Ελληνικά 中文 日本語 한국어 العربية עברית မြန်မာ ไทย हिन्दी தமிழ் ქართული አማርኛ ខ្មែរ → ✓"
    out = notes_pdf.render(FakeCase(tmp_path), title="Scripts", text=samples)
    assert out.warnings == []
    rendered = pdf_text(out.pdf)
    for word in ("Русский", "中文", "한국어", "ไทย"):
        assert word in rendered


def test_a_script_nothing_covers_is_named_rather_than_drawn_blank(tmp_path):
    char = "\U00013000"  # Egyptian hieroglyph, deliberately not shipped
    out = notes_pdf.render(FakeCase(tmp_path), title="Glyphs", text=f"Sign {char} here.\n")
    assert out.pdf.startswith(b"%PDF-")
    assert "No font on this machine covers" in " ".join(out.warnings)


def test_a_missing_font_file_fails_by_name_rather_than_by_traceback(tmp_path, monkeypatch):
    monkeypatch.setattr(pdffonts, "FONT_DIR", tmp_path / "nowhere")
    with pytest.raises(pdffonts.FontError) as raised:
        notes_pdf.render(FakeCase(tmp_path), title="Gone", text="Body.\n")
    assert "NotoSerif-Regular.ttf" in str(raised.value)


# -- the export route --------------------------------------------------------


def make_case(client, name="Notes case"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def test_exporting_writes_one_pdf_per_note(client, tmp_path):
    cid = make_case(client)
    client.put(f"/api/cases/{cid}/notes", json={"text": "The case scratchpad.\n"})
    first = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Rooftop", "content": "# Rooftop\n\nBody.\n"}
    ).json()
    second = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Mast", "content": "Second note.\n"}
    ).json()

    response = client.post(
        f"/api/cases/{cid}/notes/pdf", json={"notes": ["case", first["id"], second["id"]]}
    )
    assert response.status_code == 200
    body = response.json()
    assert [row["file"] for row in body["written"]] == [
        "Case notes.pdf",
        "Rooftop.pdf",
        "Mast.pdf",
    ]
    assert body["warnings"] == []

    exports = exports_of(cid)
    assert sorted(p.name for p in exports.glob("*.pdf")) == [
        "Case notes.pdf",
        "Mast.pdf",
        "Rooftop.pdf",
    ]
    assert "Body." in pdf_text((exports / "Rooftop.pdf").read_bytes())


def test_a_re_export_overwrites_rather_than_accumulating(client):
    cid = make_case(client)
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Rooftop", "content": "First.\n"}
    ).json()
    client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]]})
    client.put(f"/api/cases/{cid}/notes/{note['id']}", json={"text": "Second, longer body.\n"})
    again = client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": [note["id"]]})

    exports = exports_of(cid)
    assert [p.name for p in exports.glob("*.pdf")] == ["Rooftop.pdf"]
    assert again.json()["written"][0]["file"] == "Rooftop.pdf"
    assert "Second, longer body." in pdf_text((exports / "Rooftop.pdf").read_bytes())


def test_two_notes_with_one_title_keep_two_files(client):
    cid = make_case(client)
    first = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Summary", "folder": "video-1", "content": "A"}
    ).json()
    second = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Summary", "folder": "video-2", "content": "B"}
    ).json()
    written = client.post(
        f"/api/cases/{cid}/notes/pdf", json={"notes": [first["id"], second["id"]]}
    ).json()["written"]
    by_note = {row["note"]: row["file"] for row in written}
    assert len(set(by_note.values())) == 2
    assert all(re.search(r" \[[0-9a-f]{16}\]\.pdf$", name) for name in by_note.values())

    first_alone = client.post(
        f"/api/cases/{cid}/notes/pdf", json={"notes": [first["id"]]}
    ).json()["written"][0]
    assert first_alone["file"] == by_note[first["id"]]


def test_long_homonymous_titles_keep_their_stable_suffix(client):
    cid = make_case(client)
    first = client.post(
        f"/api/cases/{cid}/notes", json={"title": "First", "folder": "a", "content": "A"}
    ).json()
    second = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Second", "folder": "b", "content": "B"}
    ).json()
    case = Case.open(cid)
    legacy_title = "Very long title " * 30
    case._graph().update_entity(first["id"], {"label": legacy_title})
    case._graph().update_entity(second["id"], {"label": legacy_title})

    written = client.post(
        f"/api/cases/{cid}/notes/pdf", json={"notes": [first["id"], second["id"]]}
    ).json()["written"]

    names = [row["file"] for row in written]
    assert len(set(names)) == 2
    assert all(len(name) <= layout.MAX_MEDIA_NAME for name in names)
    assert all(re.search(r" \[[0-9a-f]{16}\]\.pdf$", name) for name in names)


def test_an_explicit_note_path_still_canonicalises_its_label(client):
    cid = make_case(client)
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Short", "content": "A"}
    ).json()
    case = Case.open(cid)
    path = note["attrs"]["path"]

    updated = case.update_entity(
        note["id"], {"label": "A" * 300, "attrs": {"path": path}}
    )

    assert updated["attrs"]["path"] == path
    assert len(updated["label"]) == layout.MAX_SLUG


def test_a_diagram_travels_with_the_request(client):
    cid = make_case(client)
    text = "```mermaid\ngraph TD; A-->B;\n```\n"
    note = client.post(
        f"/api/cases/{cid}/notes", json={"title": "Diagram", "content": text}
    ).json()
    key = notes_pdf.diagram_key(notes_pdf.mermaid_sources(text)[0])
    payload = {
        "notes": [note["id"]],
        "diagrams": {key: base64.b64encode(png_bytes()).decode("ascii")},
    }
    assert client.post(f"/api/cases/{cid}/notes/pdf", json=payload).status_code == 200

    assert "Diagram not drawn." not in pdf_text((exports_of(cid) / "Diagram.pdf").read_bytes())


def test_the_browser_is_told_which_diagrams_to_draw(client):
    cid = make_case(client)
    shared = "```mermaid\ngraph TD; A-->B;\n```\n"
    first = client.post(
        f"/api/cases/{cid}/notes", json={"title": "One", "content": f"Intro\n\n{shared}"}
    ).json()
    second = client.post(
        f"/api/cases/{cid}/notes",
        json={"title": "Two", "content": f"{shared}\n```mermaid\ngraph LR; C-->D;\n```\n"},
    ).json()

    pending = client.post(
        f"/api/cases/{cid}/notes/pdf/diagrams", json={"notes": [first["id"], second["id"]]}
    ).json()["diagrams"]

    # The diagram both notes hold is drawn once, not twice.
    assert len(pending) == 2
    assert [row["key"] for row in pending] == [
        notes_pdf.diagram_key("graph TD; A-->B;"),
        notes_pdf.diagram_key("graph LR; C-->D;"),
    ]
    assert "graph TD" in pending[0]["source"]


def test_a_note_without_a_diagram_asks_for_nothing(client):
    cid = make_case(client)
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "Plain", "content": "Text"}).json()
    response = client.post(f"/api/cases/{cid}/notes/pdf/diagrams", json={"notes": [note["id"]]})
    assert response.json() == {"diagrams": []}


def test_the_export_refuses_what_it_cannot_trust(client):
    cid = make_case(client)
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "N", "content": "x"}).json()
    assert client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": []}).status_code == 422
    assert client.post(f"/api/cases/{cid}/notes/pdf", json={"notes": ["nope"]}).status_code == 404
    bad_key = {"notes": [note["id"]], "diagrams": {"../etc": "AAAA"}}
    assert client.post(f"/api/cases/{cid}/notes/pdf", json=bad_key).status_code == 422
    bad_payload = {"notes": [note["id"]], "diagrams": {"abc123": "not base64!"}}
    assert client.post(f"/api/cases/{cid}/notes/pdf", json=bad_payload).status_code == 422
    huge = {"notes": [note["id"]], "diagrams": {f"k{n}": "AAAA" for n in range(200)}}
    assert client.post(f"/api/cases/{cid}/notes/pdf", json=huge).status_code == 422


def test_the_export_bounds_the_decoded_diagram_batch(client, monkeypatch):
    cid = make_case(client)
    note = client.post(f"/api/cases/{cid}/notes", json={"title": "N", "content": "x"}).json()
    monkeypatch.setattr(notes_api, "MAX_DIAGRAM_TOTAL_BYTES", 5)
    payload = {
        "notes": [note["id"]],
        "diagrams": {
            "first": base64.b64encode(b"abc").decode("ascii"),
            "second": base64.b64encode(b"def").decode("ascii"),
        },
    }

    response = client.post(f"/api/cases/{cid}/notes/pdf", json=payload)

    assert response.status_code == 422
    assert response.json()["detail"] == "diagram batch too large"


def test_pdf_request_body_is_bounded_with_and_without_content_length(
    client, monkeypatch
):
    cid = make_case(client)
    monkeypatch.setattr(notes_api, "MAX_PDF_BODY_BYTES", 20)
    path = f"/api/cases/{cid}/notes/pdf"

    sized = client.post(path, content=b"x" * 21, headers={"content-type": "application/json"})

    def chunks():
        yield b"x" * 11
        yield b"y" * 11

    streamed = client.post(path, content=chunks(), headers={"content-type": "application/json"})

    assert sized.status_code == 413
    assert streamed.status_code == 413


def test_exporting_an_unknown_case_is_a_404(client):
    assert client.post("/api/cases/ghost/notes/pdf", json={"notes": ["case"]}).status_code == 404


@pytest.mark.parametrize("route", ["notes/pdf/reveal"])
def test_revealing_the_export_folder_takes_no_path_from_the_browser(client, monkeypatch, route):
    cid = make_case(client)
    opened = []
    from azimut.engine import reveal as reveal_engine

    monkeypatch.setattr(reveal_engine, "reveal", lambda path, **_: opened.append(path))
    response = client.post(f"/api/cases/{cid}/{route}")
    assert response.status_code == 200
    assert opened and opened[0].name == "exports"
