"""Compare sessions, their media working file, animated exports and band frames."""

import io
from pathlib import Path

import graph_read
import pytest
from PIL import Image

from azimut import config
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


def _preview(client, cid: str, name: str, colour=(30, 60, 90), fmt: str = "png"):
    files = {"image_a": ("a.png", _png(colour), "image/png")}
    if fmt == "blink":
        files["image_b"] = ("b.png", _png((20, 40, 220)), "image/png")
    return client.post(
        f"/api/cases/{cid}/compare/sessions/{name}/preview",
        files=files,
        data={"format": fmt},
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
        "base": "side",
        "visible": True,
        "blink": True,
    }
    spec["blink"] = {"interval": 1200}
    spec["annotations"] = [
        {"id": "before", "kind": "text", "side": "a", "colour": "#f6a81a",
         "points": [[2.2945, 48.8584]], "text": "Before"},
        {"id": "yard", "kind": "polygon", "colour": "#22c55e",
         "points": [[2.29, 48.85], [2.30, 48.85], [2.30, 48.86]], "fill_opacity": 0.2},
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
    assert loaded["spec"]["blink"] == {"interval": 1200}
    assert loaded["spec"]["annotations"][0]["side"] == "a"
    assert loaded["spec"]["annotations"][1]["points"][2] == [2.30, 48.86]

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
        lambda spec: spec.update(change_assist={"method": "ratio"}),
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


# -- which pairs a pixel reading is fair on --------------------------------------


def _pair(a: dict, b: dict, mode: str = "change", method: str = "colour") -> dict:
    spec = _spec()
    spec.update(mode=mode, a=a, b=b, change_assist={"method": method})
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
        (_side("esri-wayback", wayback_release=146), _side("esri-wayback", wayback_release=146), "colour", "different Esri"),
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
    # the same pair is still a perfectly good side-by-side reading
    assert _save(client, cid, "Plain pair", _pair(a, b, mode="side", method=method)).status_code == 200


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
