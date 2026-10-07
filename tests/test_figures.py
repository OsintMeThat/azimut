"""Figures: one place, one day, several renderings, laid out for publication.

The figure an analyst publishes is the same ground three or four times — true
colour for what a reader recognises, a short-wave composite for the heat, an
index for the measurement — each captioned, with one line saying where and
when. What these tests hold is what makes that evidence rather than a picture:
every panel is a real capture with its own provenance, every panel is the *same*
acquisition, and the figure opens as a composition that can still be annotated.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

from azimut import config
from azimut.engine import figures, tiles


def _fake_tile(client, url):  # offline: every tile is a solid square
    return Image.new("RGB", (256, 256), (10, 120, 10))


def keyed(client) -> str:
    config.update_settings(lambda settings: settings.update(api_keys={"sentinelhub": "inst-uuid"}))
    return client.post("/api/cases", json={"name": "Figure"}).json()["id"]


def build(client, cid, **over):
    body = {
        "title": "Fujairah plume",
        "lat": 26.383333,
        "lon": 56.438333,
        "zoom": 14,
        "width": 512,
        "height": 512,
        "day": "2026-10-04",
        "panels": [
            {"layer": "TRUE_COLOR", "caption": "Visible plume (RGB)"},
            {"layer": "SWIR", "caption": "SWIR hotspot (B12-B11-B04)"},
        ],
        **over,
    }
    return client.post(f"/api/cases/{cid}/satellite/figure", json=body)


# -- the layout, on its own ----------------------------------------------------


def test_captions_are_numbered_so_the_text_can_refer_to_panel_two():
    assert figures.caption_for("SWIR hotspot", 1, 4) == "2. SWIR hotspot"
    # one panel is not a numbered figure, it is a picture
    assert figures.caption_for("SWIR hotspot", 0, 1) == "SWIR hotspot"
    assert figures.caption_for("SWIR hotspot", 0, 4, numbered=False) == "SWIR hotspot"
    # a panel with no caption still carries its number
    assert figures.caption_for("", 2, 4) == "3."


def test_the_footer_says_when_where_and_from_what():
    line = figures.footer_line("2026-10-04", "26.383333, 56.438333")
    assert "Date: 2026-10-04" in line
    assert "Coordinates: 26.383333, 56.438333" in line
    assert "Copernicus Sentinel-2 L2A" in line


def test_the_footer_states_only_what_it_knows():
    # an undated figure says nothing about a date rather than printing a blank
    assert "Date" not in figures.footer_line("", "1, 2")
    assert figures.footer_line("", "", "") == ""


def test_panels_fill_rows_across_the_chosen_width():
    entries = [
        {"src": f"media/{n}.png", "label": f"L{n}", "natural": (512, 512), "lat": 1.0, "lon": 2.0}
        for n in range(4)
    ]
    rows = [panel["row"] for panel in figures.spec(entries, per_row=2)["panels"]]
    assert rows == [0, 0, 1, 1]
    assert [panel["row"] for panel in figures.spec(entries, per_row=1)["panels"]] == [0, 1, 2, 3]
    # a nonsense count is clamped rather than allowed to divide by zero
    assert [panel["row"] for panel in figures.spec(entries, per_row=0)["panels"]] == [0, 1, 2, 3]


def test_the_spec_leaves_the_look_to_the_composer():
    entries = [{"src": "media/a.png", "label": "A", "natural": (8, 8), "lat": 1.0, "lon": 2.0}]
    built = figures.spec(entries, footer="x")
    # everything the composer fills from its own defaults stays absent
    assert set(built) == {
        "azimut_proof", "panels", "pastes", "shapes", "notes",
        "legendOrder", "material", "sources", "footer",
    }
    assert built["shapes"] == []  # so the analyst's arrows are the only ones


# -- the route -----------------------------------------------------------------


def test_a_figure_files_every_panel_as_a_dated_capture(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = keyed(client)

    built = build(client, cid)
    assert built.status_code == 200
    body = built.json()
    assert [panel["caption"] for panel in body["panels"]] == [
        "Visible plume (RGB)",
        "SWIR hotspot (B12-B11-B04)",
    ]

    captures = client.get(f"/api/cases/{cid}/satellite").json()
    assert len(captures) == 2
    for capture in captures:
        # each panel answers for itself: which layer, which pass, which point
        assert capture["provider"].startswith("sentinel2~")
        assert capture["zoom"] == 14
    layers = sorted(capture["provider"] for capture in captures)
    assert layers[0].startswith("sentinel2~SWIR~2026-10-04~2026-10-04")
    assert layers[1].startswith("sentinel2~TRUE_COLOR~2026-10-04~2026-10-04")


def test_the_figure_opens_as_a_composition_with_its_credit_line_written(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = keyed(client)
    name = build(client, cid).json()["proof"]["name"]

    spec = client.get(f"/api/cases/{cid}/proofs/{name}").json()
    assert [panel["caption"] for panel in spec["panels"]] == [
        "1. Visible plume (RGB)",
        "2. SWIR hotspot (B12-B11-B04)",
    ]
    assert spec["panels"][0]["row"] == 0 and spec["panels"][1]["row"] == 0
    assert "Date: 2026-10-04" in spec["footer"]
    assert "26.383333, 56.438333" in spec["footer"]
    # the point rides on each panel, so the composer can offer the coordinates
    assert spec["panels"][0]["meta"]["lat"] == 26.383333
    # and nothing is drawn on it yet
    assert spec["shapes"] == []


def test_every_panel_is_the_same_acquisition(client, monkeypatch):
    """A figure is one pass seen several ways. Panels of different dates would
    compare two things at once, which is what Compare is for."""
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = keyed(client)
    build(client, cid)
    dates = {
        capture["provider"].split("~")[2]
        for capture in client.get(f"/api/cases/{cid}/satellite").json()
    }
    assert dates == {"2026-10-04"}


def test_a_figure_holds_each_layer_once(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = keyed(client)
    twice = build(
        client, cid,
        panels=[{"layer": "SWIR", "caption": "one"}, {"layer": "SWIR", "caption": "again"}],
    )
    assert twice.status_code == 422
    assert "each layer once" in twice.json()["detail"]


def test_a_panel_captioned_by_nothing_reads_as_its_layer(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = keyed(client)
    name = build(client, cid, panels=[{"layer": "SWIR"}]).json()["proof"]["name"]
    spec = client.get(f"/api/cases/{cid}/proofs/{name}").json()
    # one panel is not numbered, and the layer id is better than an empty bar
    assert spec["panels"][0]["caption"] == "SWIR"


def test_a_layer_written_here_can_be_a_panel(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = keyed(client)
    client.put(
        "/api/satellite/sentinel/custom-layers",
        json={"id": "PLUME_SWIR", "base": "TRUE_COLOR", "script": "//VERSION=3\\nx\\n"},
    )
    built = build(
        client, cid,
        panels=[{"layer": "PLUME_SWIR", "caption": "My plume"}],
    )
    assert built.status_code == 200
    capture = client.get(f"/api/cases/{cid}/satellite").json()[0]
    # the capture is filed under the name the analyst chose, not its base
    assert capture["provider"].startswith("sentinel2~PLUME_SWIR~")


def test_an_undated_figure_is_refused_at_the_edge(client):
    cid = keyed(client)
    assert build(client, cid, day="").status_code == 422
    assert build(client, cid, day="most recent").status_code == 422


def test_a_figure_needs_a_panel_and_stops_at_eight(client):
    cid = keyed(client)
    assert build(client, cid, panels=[]).status_code == 422
    too_many = [{"layer": f"L{n}"} for n in range(figures.MAX_PANELS + 1)]
    assert build(client, cid, panels=too_many).status_code == 422


def test_a_layer_the_app_cannot_render_is_named_in_the_refusal(client, monkeypatch):
    monkeypatch.setattr(tiles, "_default_fetch", _fake_tile)
    cid = client.post("/api/cases", json={"name": "No key"}).json()["id"]
    # no Copernicus key, so sentinel2 is not a provider this app can serve
    refused = build(client, cid)
    assert refused.status_code == 404


def test_the_browser_holds_the_same_caps_as_the_engine():
    """The dialog stops a figure the route would refuse, so its numbers are
    this module's. They are written out twice, and must not drift."""
    source = Path("frontend/src/lib/figures.js").read_text(encoding="utf-8")
    assert f"MAX_PANELS = {figures.MAX_PANELS};" in source
    assert f"DEFAULT_PER_ROW = {figures.DEFAULT_PER_ROW};" in source
