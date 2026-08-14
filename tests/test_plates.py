"""Analysis plates: writing a reading out as a page, and refusing what is not one."""

from __future__ import annotations

import base64
import io
import json

from PIL import Image

from azimut import layout
from azimut.api import plates
from azimut.workspace import Case


SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"'
    ' viewBox="0 0 800 600"><text x="10" y="20">Rooftop match</text>'
    '<circle cx="40" cy="40" r="12" fill="#3f6ea8" /></svg>'
)


def _case(client, name: str = "Plate case") -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def exports_of(case_id: str):
    return layout.subdir(Case.open(case_id).path, "exports")


def _png() -> str:
    data = io.BytesIO()
    Image.new("RGB", (40, 30), (250, 250, 250)).save(data, "PNG")
    return base64.b64encode(data.getvalue()).decode("ascii")


def _write(client, case_id: str, **body):
    return client.post(
        f"/api/cases/{case_id}/plates",
        json={"filename": "graph-rooftop-match-202608132010", "format": "svg", **body},
    )


def test_a_plate_lands_in_the_case_exports_folder(client):
    case_id = _case(client)

    response = _write(client, case_id, svg=SVG)

    assert response.status_code == 200, response.text
    assert response.json()["file"] == "graph-rooftop-match-202608132010.svg"
    assert response.json()["path"] == str(exports_of(case_id))
    written = exports_of(case_id) / response.json()["file"]
    assert written.read_text(encoding="utf-8") == SVG

    # Inside the case a re-export refreshes rather than accumulating copies, which is
    # the rule the notes PDF already follows for that folder.
    again = _write(client, case_id, svg=SVG.replace("Rooftop match", "Rooftop match 2"))
    assert again.json()["file"] == response.json()["file"]
    assert "Rooftop match 2" in written.read_text(encoding="utf-8")


def test_a_plate_goes_to_the_folder_the_analyst_chose_and_never_overwrites(
    client, tmp_path
):
    case_id = _case(client)
    chosen = tmp_path / "reports"
    chosen.mkdir()
    assert client.put(
        "/api/settings/prefs", json={"export_dirs": {"views": str(chosen)}}
    ).status_code == 200

    first = _write(client, case_id, svg=SVG)
    second = _write(client, case_id, svg=SVG)

    assert first.status_code == 200, first.text
    assert first.json()["path"] == str(chosen)
    # Their folder, their files: the second export takes a name of its own.
    assert second.json()["file"] != first.json()["file"]
    assert {path.name for path in chosen.iterdir()} == {
        first.json()["file"], second.json()["file"]
    }


def test_a_png_plate_is_written_as_an_image(client):
    case_id = _case(client)

    response = _write(client, case_id, format="png", png=_png(), svg="")

    assert response.status_code == 200, response.text
    assert response.json()["file"].endswith(".png")
    written = exports_of(case_id) / response.json()["file"]
    assert written.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")


def test_what_a_plate_may_not_carry_into_a_folder_of_documents(client):
    """The app's own generator writes none of this, so a body holding it is not ours.

    A plate is written where the analyst opens documents, and an SVG a browser opens is
    a document a browser executes. Refusing beats filing and hoping.
    """
    case_id = _case(client)

    refused = [
        SVG.replace("<text", "<script>alert(1)</script><text"),
        SVG.replace("<circle", '<circle onclick="alert(1)"'),
        SVG.replace("<text", '<foreignObject><b>hi</b></foreignObject><text'),
        SVG.replace("<text", '<image href="https://example.com/x.png" /><text'),
        SVG.replace("<text", '<use xlink:href="https://example.com/x.svg" /><text'),
    ]
    for markup in refused:
        response = _write(client, case_id, svg=markup)
        assert response.status_code == 422, markup[:60]

    assert _write(client, case_id, svg="<html><body>no</body></html>").status_code == 422
    assert _write(client, case_id, svg="   ").status_code == 422
    assert _write(client, case_id, format="png", png="not base64!", svg="").status_code == 422
    assert _write(
        client, case_id, format="png", png=base64.b64encode(b"GIF89a").decode(), svg=""
    ).status_code == 422
    # A local reference is how the drawing points at its own arrowhead marker.
    assert _write(
        client, case_id, svg=SVG.replace("<circle", '<path marker-end="url(#plate-arrow)" /><circle')
    ).status_code == 200


def test_one_broken_character_does_not_take_the_export_down(client):
    """A label cut through an emoji leaves half a surrogate pair behind.

    JSON carries it and UTF-8 cannot express it, so writing the file raised and the
    whole export failed over one entity's name. The half stands for nothing drawable,
    so it is dropped and the plate is written.
    """
    case_id = _case(client)
    # Sent the way a browser sends it: `JSON.stringify` escapes a lone surrogate to
    # `\ud83c`, so the body is ASCII on the wire and only becomes one when parsed.
    body = json.dumps({
        "filename": "graph-emoji",
        "format": "svg",
        "svg": SVG.replace("Rooftop match", "Rooftop \ud83c match"),
    })

    response = client.post(
        f"/api/cases/{case_id}/plates",
        content=body.encode("ascii"),
        headers={"content-type": "application/json"},
    )

    assert response.status_code == 200, response.text
    written = (exports_of(case_id) / response.json()["file"]).read_text(encoding="utf-8")
    assert "Rooftop  match" in written


def test_a_plate_larger_than_the_bound_is_refused_before_it_is_written(client, monkeypatch):
    case_id = _case(client)
    monkeypatch.setattr(plates, "MAX_SVG_CHARS", 200)

    padded = SVG.replace("</svg>", f"<text>{'x' * 400}</text></svg>")
    response = _write(client, case_id, svg=padded)

    assert response.status_code == 413
    assert "too large" in response.json()["detail"]


def test_the_body_limit_covers_the_plate_route(client, monkeypatch):
    """The picture-carrying routes are bounded before Pydantic materialises them."""
    case_id = _case(client)
    monkeypatch.setattr(plates, "MAX_PLATE_BODY_BYTES", 200)

    response = _write(client, case_id, svg=SVG * 40)

    assert response.status_code == 413
    assert response.json()["detail"] == "request body too large"


def test_an_unnamed_plate_still_gets_a_name(client):
    case_id = _case(client)

    response = client.post(
        f"/api/cases/{case_id}/plates", json={"filename": "///", "svg": SVG}
    )

    assert response.status_code == 200, response.text
    assert response.json()["file"].endswith(".svg")


def test_the_reveal_route_takes_no_path_from_the_browser(client, monkeypatch):
    case_id = _case(client)
    opened: list[str] = []
    monkeypatch.setattr(
        plates.reveal_engine, "reveal",
        lambda path, workspace_only=True: opened.append(str(path)),
    )

    response = client.post(f"/api/cases/{case_id}/plates/reveal")

    assert response.status_code == 200, response.text
    assert opened and opened[0].endswith("exports")
    assert response.json()["path"] == opened[0]
