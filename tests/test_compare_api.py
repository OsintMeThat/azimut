"""Compare sessions, their media working file, animated exports and band frames."""

import io
from pathlib import Path

import graph_read
import pytest
from PIL import Image

from azimut import config, layout
from azimut.api import compare as compare_api
from azimut.api.compare import MAX_GIF_EDGE, _gif_frames, change_refusal
from azimut.engine import links as link_engine
from azimut.workspace import Case


def _png(color: tuple[int, int, int], size: tuple[int, int] = (96, 64)) -> bytes:
    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, "PNG")
    return out.getvalue()


def _side(provider: str = "esri-world-imagery", **extra) -> dict:
    return {
        "present": True,
        "provider": provider,
        "overlays": [],
        "sentinel": {"layer": "TRUE_COLOR", "date": "", "maxcc": 100},
        "wayback_release": None,
        **extra,
    }


def _spec() -> dict:
    return {
        "version": 2,
        "camera": {"lat": 48.8584, "lon": 2.2945, "zoom": 17.25, "bearing": 31},
        "mode": "swipe",
        "divider": 63,
        "opacity": 45,
        "a": _side(
            overlays=["roads", "boundaries", "firms", "nightlights", "saved"],
            firms={
                "sensor": "viirs_snpp",
                "window": "dates",
                "first": "2026-09-01",
                "last": "2026-09-03",
            },
            nightlights={"source": "snpp", "day": "2026-09-02"},
        ),
        "b": _side(
            "esri-wayback",
            overlays=["railway"],
            sentinel={"layer": "FALSE_COLOR", "date": "2026-09-01", "maxcc": 40},
            wayback_release=146,
        ),
    }


def _case(client, name: str) -> str:
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _save(client, cid: str, title: str, spec: dict | None = None, **extra):
    return client.post(
        f"/api/cases/{cid}/compare/sessions",
        json={"title": title, "spec": spec or _spec(), **extra},
    )


def _preview(client, cid: str, name: str, colour=(30, 60, 90), fmt: str = "png", **dates):
    files = {"image_a": ("a.png", _png(colour), "image/png")}
    if fmt == "blink":
        files["image_b"] = ("b.png", _png((20, 40, 220)), "image/png")
    return client.post(
        f"/api/cases/{cid}/compare/sessions/{name}/preview",
        files=files,
        data={"format": fmt, **dates},
    )


def _entities(cid: str, type_: str) -> list[dict]:
    return [entity for entity in graph_read.entities(cid) if entity["type"] == type_]


# -- the editable session -------------------------------------------------------


def test_compare_session_roundtrip_rename_and_sidebar_delete(client):
    cid = _case(client, "Compare")
    spec = _spec()
    spec["change_assist"] = {
        "method": "structure",
        "index": "nbr",
        "threshold": "manual",
        "sensitivity": 62,
        "normalize": "mean",
        "smoothing": 2,
        "alignment": 5,
        "cleanup": 2,
        "min_area": 250,
        "ignore_clouds": False,
        "ignore_shadows": True,
        "cloud_margin": 80,
        "classes": ["loss", "gain", "loss"],
        "display": "outline",
        "palette": "colourblind",
        "zones": False,
        "opacity": 71,
        "base": "a",
        "blink": True,
    }
    spec["blink"] = {"interval": 1200}
    spec["annotations"] = [
        {"id": "before", "kind": "text", "side": "a", "colour": "#f6a81a",
         "points": [[2.2945, 48.8584]], "text": "Before"},
        {"id": "yard", "kind": "polygon", "colour": "#22c55e",
         "points": [[2.29, 48.85], [2.30, 48.85], [2.30, 48.86]], "fill_opacity": 0.2},
        {"id": "one", "kind": "number", "colour": "#ef4444",
         "points": [[2.2946, 48.8585]], "number": 2, "font_size": 20},
        {"id": "truck", "kind": "icon", "colour": "#38bdf8",
         "points": [[2.2947, 48.8586]], "glyph": "vehicle"},
        # drawn on a camera turned 30° anticlockwise, so its sides run along that screen
        {"id": "roof", "kind": "rect", "colour": "#f6a81a",
         "points": [[2.2945, 48.8584], [2.2950, 48.8580]], "angle": -30},
    ]
    saved = _save(client, cid, "Harbour change", spec)
    assert saved.status_code == 200, saved.text
    assert saved.json()["spec_path"] == ".compare/Harbour change.json"

    listing = client.get(f"/api/cases/{cid}/compare/sessions").json()
    assert listing == [{
        "name": "Harbour change",
        "title": "Harbour change",
        "updated_at": listing[0]["updated_at"],
        "provider_a": "esri-world-imagery",
        "provider_b": "esri-wayback",
        "mode": "swipe",
        "preview": None,
    }]
    loaded = client.get(f"/api/cases/{cid}/compare/sessions/Harbour change").json()
    assert loaded["azimut_compare"] == 1
    assert loaded["spec"]["camera"]["zoom"] == 17.25
    assert loaded["spec"]["b"]["overlays"] == ["railway"]
    assert loaded["spec"]["a"]["nightlights"] == {"source": "snpp", "day": "2026-09-02"}
    assist = loaded["spec"]["change_assist"]
    assert assist["classes"] == ["loss", "gain"]
    assert {key: assist[key] for key in ("method", "min_area", "display")} == {
        "method": "structure", "min_area": 250, "display": "outline",
    }
    # The overlay's own blink, and a mask margin in ground metres because the
    # reading follows the camera.
    assert (assist["blink"], assist["cloud_margin"]) == (True, 80)
    assert assist["base"] == "a"
    assert loaded["spec"]["difference"] is False
    assert loaded["spec"]["blink"] == {"interval": 1200}
    assert loaded["spec"]["annotations"][0]["side"] == "a"
    assert loaded["spec"]["annotations"][1]["points"][2] == [2.30, 48.86]
    # the two stamps: one press, one point, and what each one carries
    assert loaded["spec"]["annotations"][2]["number"] == 2
    assert loaded["spec"]["annotations"][3]["glyph"] == "vehicle"
    assert loaded["spec"]["annotations"][4]["angle"] == 330
    assert loaded["spec"]["annotations"][0]["angle"] == 0

    entity = _entities(cid, "compare-session")[0]
    renamed = _save(client, cid, "Harbour after", rename_from="Harbour change")
    assert renamed.status_code == 200, renamed.text
    after = _entities(cid, "compare-session")
    assert len(after) == 1 and after[0]["id"] == entity["id"]
    assert after[0]["attrs"]["spec"] == ".compare/Harbour after.json"
    assert not Case.open(cid).resolve_inside(".compare/Harbour change.json").exists()

    client.delete(f"/api/cases/{cid}/entities/{entity['id']}")
    assert client.get(f"/api/cases/{cid}/compare/sessions").json() == []


@pytest.mark.parametrize(
    "mutate",
    [
        lambda spec: spec["a"].update(provider="missing"),
        lambda spec: spec["a"].update(overlays=["buildings"]),
        lambda spec: spec["camera"].update(zoom=30),
        lambda spec: spec.update(version=1),
        lambda spec: spec.update(annotations=[{
            "id": "x", "kind": "arrow", "colour": "#ffffff", "points": [[2, 48]],
        }]),
        lambda spec: spec.update(annotations=[{
            "id": "x", "kind": "line", "colour": "#ffffff", "points": [[200, 48], [2, 48]],
        }]),
        lambda spec: spec.update(annotations=[{
            "id": "x", "kind": "text", "colour": "#ffffff", "points": [[2, 48]], "text": "  ",
        }]),
        lambda spec: spec.update(frame={"points": [[2, 48]]}),
        lambda spec: spec.update(frame={"points": [[2, 48], [2, 48]]}),
        lambda spec: spec.update(frame={"points": [[2, 48], [200, 48]]}),
        lambda spec: spec.update(frame={"points": [[2, 48], [3, 47]], "angle": "north"}),
        lambda spec: spec.update(change_assist={"method": "ratio"}),
        # Difference is a switch over the view now, not a mode
        lambda spec: spec.update(mode="change"),
        lambda spec: spec.update(change_assist={"base": "side"}),
        # a stamp is one point, and its number is a count rather than a label
        lambda spec: spec.update(annotations=[{
            "id": "x", "kind": "number", "colour": "#ffffff", "points": [[2, 48], [3, 48]],
        }]),
        lambda spec: spec.update(annotations=[{
            "id": "x", "kind": "icon", "colour": "#ffffff", "points": [[2, 48]], "number": 0,
        }]),
    ],
)
def test_compare_session_refuses_what_it_cannot_reopen(client, mutate):
    cid = _case(client, "Compare validation")
    spec = _spec()
    mutate(spec)
    assert _save(client, cid, "Bad", spec).status_code == 422


def test_compare_session_keeps_google_maps_js_as_a_reopenable_source(client):
    cid = _case(client, "Compare Google JS")
    client.put("/api/settings/keys", json={"google_js": "AIza.js"})
    spec = _spec()
    spec["b"]["provider"] = "google-js"

    assert _save(client, cid, "Google reading", spec).status_code == 200
    loaded = client.get(f"/api/cases/{cid}/compare/sessions/Google reading").json()
    assert loaded["spec"]["b"]["provider"] == "google-js"


def test_compare_session_keeps_an_optional_export_frame_on_the_ground(client):
    cid = _case(client, "Compare frame")
    spec = _spec()
    spec["frame"] = {"points": [[2.2945, 48.8584], [2.2961, 48.8572]], "angle": 405}

    assert _save(client, cid, "Framed reading", spec).status_code == 200
    loaded = client.get(f"/api/cases/{cid}/compare/sessions/Framed reading").json()
    # The bearing it was drawn at comes back with it, folded into one turn.
    assert loaded["spec"]["frame"] == {**spec["frame"], "angle": 45}


# -- which pairs a pixel reading is fair on --------------------------------------


def _pair(a: dict, b: dict, difference: bool = True, method: str = "colour") -> dict:
    spec = _spec()
    spec.update(difference=difference, a=a, b=b, change_assist={"method": method})
    return spec


@pytest.mark.parametrize(
    ("a", "b", "method"),
    [
        (_side("esri-wayback", wayback_release=145), _side("esri-wayback", wayback_release=146), "colour"),
        # the same Esri chain: World Imagery is the newest Wayback release
        (_side("esri-world-imagery"), _side("esri-wayback", wayback_release=146), "structure"),
        (
            _side("sentinel2", sentinel={"layer": "TRUE_COLOR", "date": "2026-05-01", "maxcc": 20}),
            _side("sentinel2", sentinel={"layer": "TRUE_COLOR", "date": "2026-06-01", "maxcc": 60}),
            "colour",
        ),
        (
            _side("sentinel2", sentinel={"layer": "SWIR", "date": "2026-05-01", "maxcc": 100}),
            _side("sentinel2", sentinel={"layer": "NDVI", "date": "2026-06-01", "maxcc": 100}),
            "index",
        ),
        (
            _side("osm", overlays=["nightlights"], nightlights={"source": "noaa20", "day": "2026-01-01"}),
            _side("osm", overlays=["nightlights"], nightlights={"source": "noaa20", "day": "2026-02-01"}),
            "brightness",
        ),
    ],
)
def test_change_assist_accepts_comparable_pairs(client, a, b, method):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    cid = _case(client, "Compare change")
    response = _save(client, cid, "Fair pair", _pair(a, b, method=method))
    assert response.status_code == 200, response.text


@pytest.mark.parametrize(
    ("a", "b", "method", "reason"),
    [
        (_side("esri-world-imagery"), _side("osm"), "colour", "reads Sentinel-2"),
        (_side("esri-wayback", wayback_release=146), _side("esri-wayback", wayback_release=146), "colour", "same picture"),
        (
            _side("esri-wayback", wayback_release=145, overlays=["roads"]),
            _side("esri-wayback", wayback_release=146),
            "colour",
            "reference layers",
        ),
        (
            _side("sentinel2", sentinel={"layer": "TRUE_COLOR", "date": "2026-05-01", "maxcc": 100}),
            _side("sentinel2", sentinel={"layer": "SWIR", "date": "2026-06-01", "maxcc": 100}),
            "colour",
            "same layer",
        ),
        (_side("esri-wayback", wayback_release=145), _side("esri-wayback", wayback_release=146), "index", "Sentinel-2 on both"),
        (
            _side("sentinel2", sentinel={"layer": "TRUE_COLOR", "date": "", "maxcc": 100}),
            _side("sentinel2", sentinel={"layer": "TRUE_COLOR", "date": "2026-06-01", "maxcc": 100}),
            "index",
            "dated pass",
        ),
    ],
)
def test_change_assist_refuses_misleading_pairs(client, a, b, method, reason):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    cid = _case(client, "Compare change refused")
    refused = _save(client, cid, "Unfair pair", _pair(a, b, method=method))
    assert refused.status_code == 422
    assert reason in refused.json()["detail"]
    # the same pair is still a perfectly good reading without the highlights
    assert _save(client, cid, "Plain pair", _pair(a, b, difference=False, method=method)).status_code == 200


def test_change_refusal_needs_both_sides():
    assert change_refusal(_side(present=False), _side()) == "Difference needs imagery A and B"


# -- the rendered image is a media working file ----------------------------------


def test_the_rendered_comparison_is_a_media_working_file(client):
    cid = _case(client, "Compare working file")
    assert _save(client, cid, "Harbour reading").status_code == 200
    response = _preview(client, cid, "Harbour reading")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"path": "media/Harbour reading.png", "format": "png", "replaced": False}

    media = _entities(cid, "media")
    assert len(media) == 1
    assert media[0]["attrs"]["path"] == body["path"]
    assert media[0]["attrs"]["compare_session"] == ".compare/Harbour reading.json"
    session = _entities(cid, "compare-session")[0]
    assert session["attrs"]["preview"] == body["path"]
    # never `path`: that attribute is how a delete finds its artifact, and the
    # media's own delete must not resolve to the session
    assert "path" not in session["attrs"]

    item = next(row for row in client.get(f"/api/cases/{cid}/media").json() if row["path"] == body["path"])
    assert item["source"]["type"] == "compare"
    assert item["source"]["providers"] == {"a": "esri-world-imagery", "b": "esri-wayback"}
    assert item["source"]["mode"] == "swipe"

    collected = client.get(f"/api/cases/{cid}/media/page", params={"collected_only": "true"}).json()
    assert collected["items"] == []
    assert collected["facets"]["made_here_count"] == 1
    everything = client.get(f"/api/cases/{cid}/media/page").json()
    assert everything["facets"]["category_counts"]["comparison"] == 1
    assert everything["facets"]["category_counts"]["image"] == 0

    listing = client.get(f"/api/cases/{cid}/compare/sessions").json()
    assert listing[0]["preview"] == body["path"]


def test_saving_again_replaces_the_one_file(client):
    cid = _case(client, "Compare replace")
    _save(client, cid, "Harbour reading")
    first = _preview(client, cid, "Harbour reading", (10, 10, 10)).json()
    before = _entities(cid, "media")[0]

    second = _preview(client, cid, "Harbour reading", (240, 240, 240)).json()

    assert second == {**first, "replaced": True}
    after = _entities(cid, "media")
    assert len(after) == 1 and after[0]["id"] == before["id"]
    assert after[0]["attrs"]["sha256"] != before["attrs"]["sha256"]
    with Image.open(Case.open(cid).resolve_inside(second["path"])) as image:
        assert image.getpixel((0, 0)) == (240, 240, 240)


def test_a_new_format_becomes_a_new_file_and_the_old_render_goes_to_the_trash(client):
    cid = _case(client, "Compare format")
    _save(client, cid, "Harbour reading")
    still = _preview(client, cid, "Harbour reading").json()

    animated = _preview(client, cid, "Harbour reading", fmt="blink").json()

    assert animated["path"] == "media/Harbour reading.gif"
    assert [entity["attrs"]["path"] for entity in _entities(cid, "media")] == [animated["path"]]
    assert not Case.open(cid).resolve_inside(still["path"]).exists()
    with Image.open(Case.open(cid).resolve_inside(animated["path"])) as gif:
        assert gif.n_frames == 2


def test_a_render_something_was_built_on_is_never_overwritten(client):
    cid = _case(client, "Compare in use")
    _save(client, cid, "Harbour reading")
    first = _preview(client, cid, "Harbour reading", (10, 10, 10)).json()
    derived = client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": ("crop.png", _png((1, 2, 3)), "image/png")},
    ).json()
    case = Case.open(cid)
    link_engine.link_all(
        case, derived["entity"]["id"], link_engine.DERIVED_FROM, [first["path"]], by="test"
    )

    second = _preview(client, cid, "Harbour reading", (240, 240, 240)).json()

    assert second["replaced"] is False
    assert second["path"] != first["path"]
    with Image.open(case.resolve_inside(first["path"])) as image:
        assert image.getpixel((0, 0)) == (10, 10, 10)
    assert _entities(cid, "compare-session")[0]["attrs"]["preview"] == second["path"]


def test_the_image_outlives_its_session_and_a_lost_image_is_filed_again(client):
    cid = _case(client, "Compare lifetimes")
    _save(client, cid, "Harbour reading")
    first = _preview(client, cid, "Harbour reading").json()

    media = _entities(cid, "media")[0]
    assert client.delete(f"/api/cases/{cid}/entities/{media['id']}").status_code == 200
    assert client.get(f"/api/cases/{cid}/compare/sessions").json()[0]["preview"] is None
    again = _preview(client, cid, "Harbour reading").json()
    assert again["replaced"] is False
    assert Case.open(cid).resolve_inside(again["path"]).is_file()
    assert first["path"]

    assert client.delete(f"/api/cases/{cid}/compare/sessions/Harbour reading").status_code == 200
    assert _entities(cid, "compare-session") == []
    assert [entity["attrs"]["path"] for entity in _entities(cid, "media")] == [again["path"]]


def test_renaming_the_session_renames_its_image_on_the_next_save(client):
    cid = _case(client, "Compare rename")
    _save(client, cid, "Harbour reading")
    _preview(client, cid, "Harbour reading")
    _save(client, cid, "Harbour at dusk", rename_from="Harbour reading")

    renamed = _preview(client, cid, "Harbour at dusk").json()

    assert renamed == {"path": "media/Harbour at dusk.png", "format": "png", "replaced": True}
    assert [entity["attrs"]["path"] for entity in _entities(cid, "media")] == [renamed["path"]]


def test_the_rendered_comparison_carries_the_date_of_each_picture(client):
    """Two instants, never a range: the image does not say anything happened
    between them. An estimated date says so on the axis."""
    cid = _case(client, "Compare dated")
    _save(client, cid, "Harbour reading")
    body = _preview(client, cid, "Harbour reading", imagery_a="2024-05-03", imagery_a_exact="false",
                    imagery_b="2026-09-02T05:42:10Z").json()

    item = next(row for row in client.get(f"/api/cases/{cid}/media").json() if row["path"] == body["path"])
    assert item["source"]["imagery_a"] == "2024-05-03"
    assert item["source"]["imagery_a_exact"] is False
    assert item["source"]["imagery_b"] == "2026-09-02T05:42:10Z"
    assert "imagery_b_exact" not in item["source"]

    media = _entities(cid, "media")[0]
    page = client.get(f"/api/cases/{cid}/timeline", params={"entity": media["id"], "category": "media"}).json()
    rows = {row["kind"]: row for row in page["items"]}
    assert rows["imagery-a"]["raw"] == "2024-05-03~" and rows["imagery-a"]["approximate"]
    assert rows["imagery-b"]["precision"] == "second"

    # Saving again restates the dates of the pictures shown now, and drops the old.
    _preview(client, cid, "Harbour reading", imagery_b="2026-09-03")
    item = next(row for row in client.get(f"/api/cases/{cid}/media").json() if row["path"] == body["path"])
    assert "imagery_a" not in item["source"] and item["source"]["imagery_b"] == "2026-09-03"


@pytest.mark.parametrize("value", ["yesterday", "2026-09-02T05:42:10", "2026-09-02T05:42:10+02:00"])
def test_a_picture_date_is_a_day_or_a_utc_instant(client, value):
    cid = _case(client, "Compare date refused")
    _save(client, cid, "Harbour reading")
    assert _preview(client, cid, "Harbour reading", imagery_a=value).status_code == 422


def test_a_preview_needs_its_session_and_a_blink_needs_b(client):
    cid = _case(client, "Compare preview refused")
    assert _preview(client, cid, "Nothing here").status_code == 404
    _save(client, cid, "Harbour reading")
    refused = client.post(
        f"/api/cases/{cid}/compare/sessions/Harbour reading/preview",
        files={"image_a": ("a.png", _png((0, 0, 0)), "image/png")},
        data={"format": "blink"},
    )
    assert refused.status_code == 422


# -- finished animated copies -----------------------------------------------------


def test_compare_gif_exports_blink_and_slide(client):
    cid = _case(client, "Compare GIF")
    for animation, expected_frames in (("blink", 2), ("slide", 16)):
        response = client.post(
            f"/api/cases/{cid}/compare/gif",
            files={
                "image_a": ("a.png", _png((220, 30, 30)), "image/png"),
                "image_b": ("b.png", _png((20, 40, 220)), "image/png"),
            },
            data={"animation": animation, "filename": "Harbour reading", "interval": "1500"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["file"] == f"Harbour reading-{animation}.gif"
        with Image.open(Path(response.json()["path"]) / response.json()["file"]) as gif:
            assert gif.n_frames == expected_frames
            if animation == "blink":
                assert gif.info["duration"] == 1500


def test_a_second_gif_by_the_same_name_is_kept_beside_the_first(client):
    """Exports are named by their pictures' dates, which two comparisons of one
    pair share, so the case's own folder never overwrites one with the other."""
    cid = _case(client, "Compare GIF twice")
    written = []
    for colour in ((220, 30, 30), (30, 220, 30)):
        response = client.post(
            f"/api/cases/{cid}/compare/gif",
            files={
                "image_a": ("a.png", _png(colour), "image/png"),
                "image_b": ("b.png", _png((20, 40, 220)), "image/png"),
            },
            data={"animation": "blink", "filename": "compare-2024-05-03_2026-09-02"},
        )
        assert response.status_code == 200, response.text
        written.append(Path(response.json()["path"]) / response.json()["file"])
    assert written[0] != written[1]
    assert all(path.is_file() for path in written)


def test_compare_gif_rejects_non_png_and_unknown_animation(client):
    cid = _case(client, "Compare GIF bad")
    assert client.post(
        f"/api/cases/{cid}/compare/gif",
        files={
            "image_a": ("a.png", b"not an image", "image/png"),
            "image_b": ("b.png", _png((0, 0, 0)), "image/png"),
        },
        data={"animation": "blink", "filename": "Bad"},
    ).status_code == 422
    assert client.post(
        f"/api/cases/{cid}/compare/gif",
        files={
            "image_a": ("a.png", _png((0, 0, 0)), "image/png"),
            "image_b": ("b.png", _png((255, 255, 255)), "image/png"),
        },
        data={"animation": "fade", "filename": "Bad"},
    ).status_code == 422


def test_compare_gif_scales_large_frames_before_building_the_animation():
    frames = _gif_frames(
        Image.new("RGB", (MAX_GIF_EDGE * 2, 300), "black"),
        Image.new("RGB", (MAX_GIF_EDGE * 2, 300), "white"),
        "slide",
    )
    assert len(frames) == 16
    assert frames[0].size == (MAX_GIF_EDGE, 150)


# -- evolutions -------------------------------------------------------------------


def _sequence(client, cid: str, frames: list[bytes], **data):
    return client.post(
        f"/api/cases/{cid}/compare/sequence",
        files=[("frames", (f"{index}.png", frame, "image/png")) for index, frame in enumerate(frames)],
        data={"filename": "Harbour 2024-05-03_2026-09-02", **data},
    )


def test_an_evolution_is_one_gif_of_every_picture_in_order_with_the_last_held(client):
    cid = _case(client, "Compare evolution")
    colours = [(220, 30, 30), (30, 220, 30), (20, 40, 220), (240, 240, 20)]
    response = _sequence(client, cid, [_png(colour) for colour in colours], interval="600")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["file"] == "Harbour 2024-05-03_2026-09-02-evolution.gif"
    assert body["frames"] == 4
    with Image.open(Path(body["path"]) / body["file"]) as gif:
        assert gif.n_frames == 4
        durations, firsts = [], []
        for index in range(gif.n_frames):
            gif.seek(index)
            durations.append(gif.info["duration"])
            firsts.append(gif.convert("RGB").getpixel((5, 5)))
    assert durations == [600, 600, 600, 600 * compare_api.SEQUENCE_HOLD]
    for seen, colour in zip(firsts, colours):
        assert all(abs(a - b) < 12 for a, b in zip(seen, colour))


def test_an_evolution_takes_the_first_pictures_size_and_the_gif_edge(client):
    cid = _case(client, "Compare evolution sizes")
    wide = (MAX_GIF_EDGE * 2, 200)
    response = _sequence(client, cid, [_png((0, 0, 0), wide), _png((255, 255, 255), (40, 40))])
    assert response.status_code == 200, response.text
    with Image.open(Path(response.json()["path"]) / response.json()["file"]) as gif:
        assert gif.size == (MAX_GIF_EDGE, 100)


def test_an_evolution_is_refused_outside_its_bounds(client, monkeypatch):
    cid = _case(client, "Compare evolution bounds")
    one = _sequence(client, cid, [_png((0, 0, 0))])
    assert one.status_code == 422
    assert "2 to" in one.json()["detail"]
    monkeypatch.setattr(compare_api, "MAX_SEQUENCE_FRAMES", 3)
    assert _sequence(client, cid, [_png((index, 0, 0)) for index in range(4)]).status_code == 422
    unreadable = _sequence(client, cid, [_png((0, 0, 0)), b"not an image"])
    assert unreadable.status_code == 422
    assert unreadable.json()["detail"] == "comparison frame 2 is unreadable"
    assert _sequence(client, cid, [_png((0, 0, 0))] * 2, interval="50").status_code == 422


def test_an_evolution_frame_is_refused_by_its_header_before_it_is_decoded(client, monkeypatch):
    cid = _case(client, "Compare evolution pixels")
    monkeypatch.setattr(compare_api, "MAX_SEQUENCE_FRAME_PIXELS", 96 * 64 - 1)
    response = _sequence(client, cid, [_png((0, 0, 0)), _png((9, 9, 9))])
    assert response.status_code == 413
    assert response.json()["detail"] == "comparison frame 1 has too many pixels"
    monkeypatch.setattr(compare_api, "MAX_SEQUENCE_FRAME_BYTES", 20)
    assert _sequence(client, cid, [_png((0, 0, 0)), _png((9, 9, 9))]).status_code == 413


def test_the_body_limit_covers_the_evolution_route(client, monkeypatch):
    cid = _case(client, "Compare evolution body")
    monkeypatch.setattr(compare_api, "MAX_SEQUENCE_BODY_BYTES", 200)
    response = _sequence(client, cid, [_png((0, 0, 0)), _png((9, 9, 9))])
    assert response.status_code == 413
    assert response.json()["detail"] == "request body too large"


# -- Sentinel-2 band frames ------------------------------------------------------


FRAME_BODY = {
    "west": 250_000, "south": 6_250_000, "east": 251_000, "north": 6_250_600,
    "width": 320, "height": 192, "day": "2026-05-11", "product": "ndvi", "maxcc": 40,
}


def test_band_frame_needs_a_key_and_refuses_when_the_tier_is_spent(client, monkeypatch):
    sent = []
    monkeypatch.setattr(compare_api.sentinel, "band_frame", lambda *a, **k: sent.append(a) or b"")
    assert client.post("/api/compare/sentinel-frame", json=FRAME_BODY).status_code == 404

    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    monkeypatch.setattr(compare_api.config, "usage_blocked", lambda meter: True)
    assert client.post("/api/compare/sentinel-frame", json=FRAME_BODY).status_code == 429
    assert sent == []


def test_band_frame_is_metered_and_answered_as_a_png(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    asked = {}

    def frame(instance, bbox, width, height, day, product, maxcc, *, layer):
        asked.update(instance=instance, bbox=bbox, size=(width, height), day=day,
                     product=product, maxcc=maxcc, layer=layer)
        return _png((1, 2, 3), (width, height))

    monkeypatch.setattr(compare_api.sentinel, "band_frame", frame)
    before = config.month_usage("sentinelhub")

    response = client.post("/api/compare/sentinel-frame", json=FRAME_BODY)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "image/png"
    assert asked == {
        "instance": "inst-uuid", "bbox": (250_000, 6_250_000, 251_000, 6_250_600),
        "size": (320, 192), "day": "2026-05-11", "product": "change-ndvi", "maxcc": 40,
        "layer": "TRUE_COLOR",
    }
    assert config.month_usage("sentinelhub") == before + 1


def test_band_frame_validates_before_asking(client, monkeypatch):
    client.put("/api/settings/keys", json={"sentinelhub": "inst-uuid"})
    monkeypatch.setattr(
        compare_api.sentinel, "band_frame",
        lambda *a, **k: (_ for _ in ()).throw(ValueError("the frame is empty")),
    )
    before = config.month_usage("sentinelhub")
    assert client.post("/api/compare/sentinel-frame", json={**FRAME_BODY, "product": "evi"}).status_code == 422
    assert client.post("/api/compare/sentinel-frame", json={**FRAME_BODY, "width": 5000}).status_code == 422
    assert client.post("/api/compare/sentinel-frame", json=FRAME_BODY).status_code == 422
    assert config.month_usage("sentinelhub") == before


@pytest.mark.parametrize("folded", [False, True], ids=["linux", "windows-macos"])
def test_a_change_of_case_renames_the_comparison_in_place(client, monkeypatch, folded):
    import casefold

    cid = _case(client, "Recased")
    _save(client, cid, "Harbour")
    if folded:
        casefold.fold_names(monkeypatch, layout.COMPARE_DIR)

    renamed = _save(client, cid, "harbour", rename_from="Harbour")

    assert renamed.status_code == 200, renamed.text
    folder = Case.open(cid).tool_root / layout.COMPARE_DIR
    assert [p.name for p in folder.glob("*.json")] == ["harbour.json"]
    assert client.get(f"/api/cases/{cid}/compare/sessions/harbour").status_code == 200


def test_two_comparisons_differing_only_by_case_cannot_both_be_saved(client):
    cid = _case(client, "One name")
    _save(client, cid, "Harbour")

    assert _save(client, cid, "harbour").status_code == 409
    _save(client, cid, "Quay")
    assert _save(client, cid, "harbour", rename_from="Quay").status_code == 409


# -- mark colours in a GIF -------------------------------------------------------------

MARKS = {"red": (0xEF, 0x44, 0x44), "blue": (0x38, 0xBD, 0xF8), "green": (0x22, 0xC5, 0x5E)}


def _marked_imagery() -> bytes:
    """Grey-green fields with three thin outlines, the case median cut got wrong."""
    import random

    from PIL import ImageDraw

    rng = random.Random(1)
    image = Image.new("RGB", (800, 500))
    image.putdata([
        (g, g + rng.randint(-10, 20), g - rng.randint(0, 25))
        for g in (rng.randint(60, 140) for _ in range(800 * 500))
    ])
    draw = ImageDraw.Draw(image)
    for index, colour in enumerate(MARKS.values()):
        draw.rectangle((50 + index * 150, 200, 150 + index * 150, 300), outline=colour, width=3)
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


def _first_frame_marks(path: Path) -> list[tuple[int, int, int]]:
    with Image.open(path) as gif:
        gif.seek(0)
        frame = gif.convert("RGB")
    return [frame.getpixel((51 + index * 150, 250)) for index in range(len(MARKS))]


def test_a_gif_keeps_the_colours_it_is_asked_to_keep(client):
    cid = _case(client, "Compare GIF colours")
    keep = ",".join("#%02x%02x%02x" % colour for colour in MARKS.values())
    written = {}
    for asked in ("", keep):
        response = client.post(
            f"/api/cases/{cid}/compare/gif",
            files={
                "image_a": ("a.png", _marked_imagery(), "image/png"),
                "image_b": ("b.png", _marked_imagery(), "image/png"),
            },
            data={"animation": "blink", "filename": f"Colours {len(asked)}", "keep": asked},
        )
        assert response.status_code == 200, response.text
        written[asked] = _first_frame_marks(Path(response.json()["path"]) / response.json()["file"])
    assert written[keep] == list(MARKS.values())
    # Without the list, median cut spends the palette on the fields.
    assert written[""] != list(MARKS.values())


def test_an_evolution_keeps_its_mark_colours_too(client):
    cid = _case(client, "Compare evolution colours")
    keep = ",".join("#%02x%02x%02x" % colour for colour in MARKS.values())
    response = _sequence(client, cid, [_marked_imagery(), _marked_imagery()], keep=keep)
    assert response.status_code == 200, response.text
    assert _first_frame_marks(Path(response.json()["path"]) / response.json()["file"]) == list(MARKS.values())


@pytest.mark.parametrize("keep", ["red", "#12345", "#123456,", ",".join(["#123456"] * 33)])
def test_a_colour_list_the_app_never_writes_is_refused(client, keep):
    cid = _case(client, "Compare GIF bad colours")
    response = client.post(
        f"/api/cases/{cid}/compare/gif",
        files={
            "image_a": ("a.png", _png((0, 0, 0)), "image/png"),
            "image_b": ("b.png", _png((9, 9, 9)), "image/png"),
        },
        data={"animation": "blink", "filename": "Bad", "keep": keep},
    )
    assert response.status_code == 422


def test_a_session_saved_with_the_retired_labels_layer_saves_without_it(client):
    # CARTO's labels went when their tiles began asking for a key. A session kept
    # from before, or a tab left open across the update, still sends the id.
    cid = _case(client, "Retired labels")
    spec = _spec()
    spec["a"]["overlays"] = ["labels", "roads", "labels"]
    everything = ["labels", "boundaries", "roads", "railway", "power", "seamarks",
                  "gpstraces", "firms", "nightlights", "saved"]
    spec["b"]["overlays"] = everything
    res = _save(client, cid, "Before the key", spec=spec)
    assert res.status_code == 200, res.text
    loaded = client.get(f"/api/cases/{cid}/compare/sessions/Before%20the%20key").json()
    assert loaded["spec"]["a"]["overlays"] == ["roads"]
    assert "labels" not in loaded["spec"]["b"]["overlays"]
    assert len(loaded["spec"]["b"]["overlays"]) == len(everything) - 1
