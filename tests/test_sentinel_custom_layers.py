"""Copernicus layers written in Azimut rather than in the Copernicus dashboard.

A layer is a name the whole app already knows how to carry — a variant id, a
URL path segment, a tile-cache directory, a line of provenance. What is new is
where the *rendering* comes from: an evalscript saved here, sent with a base
layer that supplies the data collection. So these tests are about the seam:
that the name survives everything downstream, that the request asks the
instance for a layer it actually serves, and that one list reaches every tab.
"""

from __future__ import annotations

import base64
import re
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

from azimut import config
from azimut.api import satellite as api
from azimut.engine import sentinel, tiles

PLUME = {
    "id": "PLUME_SWIR",
    "label": "SWIR plume",
    "base": "TRUE_COLOR",
    "script": "//VERSION=3\nfunction setup(){}\n",
    "hint": "B12/B11/B04 for hot spots",
}


def script_of(url: str) -> str:
    """The evalscript a request carries, back as its source."""
    value = parse_qs(urlparse(url).query)["EVALSCRIPT"][0]
    return base64.b64decode(value).decode("utf-8")


# -- the shape of one ----------------------------------------------------------


def test_a_custom_layer_is_named_like_any_other_layer():
    entry = sentinel.parse_custom_layer(PLUME)
    assert entry["id"] == "PLUME_SWIR"
    assert entry["base"] == "TRUE_COLOR"
    # the name has to survive being a variant id and a directory name
    assert sentinel.parse_variant(f"{entry['id']}~2026-05-11~2026-05-11~CC20")[0] == "PLUME_SWIR"


@pytest.mark.parametrize(
    "bad",
    [
        {"id": "plume", "script": "x"},  # lower case would not parse as a variant
        {"id": "PLUME SWIR", "script": "x"},  # a space in a path segment
        {"id": "PLUME~SWIR", "script": "x"},  # the variant separator itself
        {"id": "../ESCAPE", "script": "x"},  # traversal, as a directory name
        {"id": "P" * 41, "script": "x"},
        {"id": "PLUME", "script": "   "},  # a layer that renders nothing
        {"id": "PLUME", "script": "x", "base": "true_color"},
        "not an object",
    ],
)
def test_a_malformed_custom_layer_is_refused(bad):
    with pytest.raises(ValueError):
        sentinel.parse_custom_layer(bad)


def test_a_script_is_bounded_so_the_request_stays_sendable():
    too_long = {"id": "BIG", "script": "x" * (sentinel.CUSTOM_SCRIPT_MAX + 1)}
    with pytest.raises(ValueError):
        sentinel.parse_custom_layer(too_long)
    fits = {"id": "BIG", "script": "x" * sentinel.CUSTOM_SCRIPT_MAX}
    assert sentinel.parse_custom_layer(fits)["id"] == "BIG"


def test_a_layer_with_no_label_reads_as_its_name():
    assert sentinel.parse_custom_layer({"id": "NDWI_MINE", "script": "x"})["label"] == "NDWI_MINE"


# -- the list ------------------------------------------------------------------


def test_the_list_skips_what_it_cannot_read_rather_than_breaking():
    settings = {"sentinel_layers": [PLUME, {"id": "nope"}, {"script": "x"}, 7]}
    assert [entry["id"] for entry in sentinel.custom_layers(settings)] == ["PLUME_SWIR"]


def test_a_name_means_one_layer():
    settings = {"sentinel_layers": [PLUME, {**PLUME, "script": "//VERSION=3\nother\n"}]}
    found = sentinel.custom_layers(settings)
    assert len(found) == 1
    assert found[0]["script"] == PLUME["script"]


def test_no_layers_is_not_an_error():
    assert sentinel.custom_layers({}) == []
    assert sentinel.custom_layers({"sentinel_layers": None}) == []


# -- how a name becomes a request ----------------------------------------------


def test_a_configured_layer_answers_for_itself():
    assert sentinel.resolve_layer("SWIR", []) == ("SWIR", "")


def test_a_layer_written_here_is_asked_for_through_its_base():
    customs = sentinel.custom_layers({"sentinel_layers": [PLUME]})
    asked, script = sentinel.resolve_layer("PLUME_SWIR", customs)
    # the instance has never heard of PLUME_SWIR; it knows TRUE_COLOR
    assert asked == "TRUE_COLOR"
    assert script == PLUME["script"]


def test_a_name_written_here_wins_over_a_configured_one():
    # otherwise a layer later added to the configuration under the same name
    # would quietly change what everything already filed under it renders
    customs = sentinel.custom_layers({"sentinel_layers": [{**PLUME, "id": "TRUE_COLOR"}]})
    asked, script = sentinel.resolve_layer("TRUE_COLOR", customs)
    assert (asked, script) == ("TRUE_COLOR", PLUME["script"])


def test_the_url_carries_the_script_as_base64_beside_the_window():
    url = sentinel.wmts_url("TRUE_COLOR", "2026-05-11", "2026-05-11", script=PLUME["script"])
    assert "LAYER=TRUE_COLOR" in url
    assert "TIME=2026-05-11/2026-05-11" in url
    assert script_of(url) == PLUME["script"]


def test_a_script_with_an_accent_in_a_comment_still_sends():
    # the radar script is ASCII, a person's notes are not
    script = "//VERSION=3\n// zone brûlée\n"
    assert script_of(sentinel.wmts_url("TRUE_COLOR", script=script)) == script


def test_no_script_sends_no_evalscript():
    assert "EVALSCRIPT=" not in sentinel.wmts_url("TRUE_COLOR", "2026-05-11", "2026-05-11")


# -- the seam with everything downstream ---------------------------------------


def test_the_variant_keeps_the_name_and_renders_the_script(client):
    config.update_settings(
        lambda settings: settings.update(
            api_keys={"sentinelhub": "inst-uuid"}, sentinel_layers=[PLUME]
        )
    )
    provider = tiles.get_provider("sentinel2~PLUME_SWIR~2026-05-11~2026-05-11")
    # the id is what the analyst asked for, so the cache and provenance key on it
    assert provider.id == "sentinel2~PLUME_SWIR~2026-05-11~2026-05-11"
    # the request is what the instance can answer
    assert "LAYER=TRUE_COLOR" in provider.url
    assert script_of(provider.url) == PLUME["script"]
    assert "TIME=2026-05-11/2026-05-11" in provider.url


def test_two_custom_layers_cache_apart(client):
    config.update_settings(
        lambda settings: settings.update(
            api_keys={"sentinelhub": "inst-uuid"},
            sentinel_layers=[PLUME, {**PLUME, "id": "PLUME_NBR", "script": "//VERSION=3\nnbr\n"}],
        )
    )
    one = tiles.get_provider("sentinel2~PLUME_SWIR~2026-05-11~2026-05-11")
    other = tiles.get_provider("sentinel2~PLUME_NBR~2026-05-11~2026-05-11")
    assert one.id != other.id  # the disk cache keys on the id
    assert script_of(one.url) != script_of(other.url)


# -- one list, every tab -------------------------------------------------------


def test_every_tab_is_offered_them_without_a_request(client):
    """Satellite, both Compare sides, Detect and the analyzer builder all read
    this one route, so a layer written here reaches them by existing."""
    config.update_settings(lambda settings: settings.update(sentinel_layers=[PLUME]))
    body = client.get("/api/satellite/sentinel/layers").json()
    assert body["source"] == "catalogue"  # nothing phoned out
    mine = [entry for entry in body["layers"] if entry.get("custom")]
    assert [entry["id"] for entry in mine] == ["PLUME_SWIR"]
    assert mine[0]["label"] == "SWIR plume"
    assert mine[0]["hint"] == "B12/B11/B04 for hot spots"
    # and the standard layer is still the first entry every picker falls back to
    assert body["layers"][0]["id"] == sentinel.DEFAULT_LAYER


def test_a_layer_written_here_replaces_the_configured_row_of_that_name(client):
    config.update_settings(
        lambda settings: settings.update(sentinel_layers=[{**PLUME, "id": "TRUE_COLOR"}])
    )
    layers = client.get("/api/satellite/sentinel/layers").json()["layers"]
    rows = [entry for entry in layers if entry["id"] == "TRUE_COLOR"]
    assert len(rows) == 1  # one name, one row
    assert rows[0]["custom"] is True


def test_the_list_is_empty_until_something_is_written(client):
    layers = client.get("/api/satellite/sentinel/layers").json()["layers"]
    assert not [entry for entry in layers if entry.get("custom")]


# -- keeping them --------------------------------------------------------------


def test_saving_reading_and_forgetting_one(client):
    saved = client.put("/api/satellite/sentinel/custom-layers", json=PLUME)
    assert saved.status_code == 200
    assert saved.json()["id"] == "PLUME_SWIR"

    listed = client.get("/api/satellite/sentinel/custom-layers").json()
    assert listed["layers"][0]["script"] == PLUME["script"]
    assert listed["max_script"] == sentinel.CUSTOM_SCRIPT_MAX

    assert client.delete("/api/satellite/sentinel/custom-layers/PLUME_SWIR").json() == {
        "deleted": True
    }
    assert client.get("/api/satellite/sentinel/custom-layers").json()["layers"] == []


def test_saving_over_a_name_replaces_that_layer(client):
    client.put("/api/satellite/sentinel/custom-layers", json=PLUME)
    client.put(
        "/api/satellite/sentinel/custom-layers",
        json={**PLUME, "script": "//VERSION=3\nsecond\n"},
    )
    layers = client.get("/api/satellite/sentinel/custom-layers").json()["layers"]
    assert len(layers) == 1
    assert layers[0]["script"] == "//VERSION=3\nsecond\n"


@pytest.mark.parametrize(
    "body",
    [
        {"id": "plume", "script": "x"},
        {"id": "PLUME", "script": ""},
        {"id": "PLUME"},
        {"id": "PLUME", "script": "x", "nonsense": 1},
    ],
)
def test_the_editor_cannot_save_a_layer_the_app_could_not_render(client, body):
    assert client.put("/api/satellite/sentinel/custom-layers", json=body).status_code == 422


def test_forgetting_a_layer_that_is_not_there_is_not_an_error(client):
    assert client.delete("/api/satellite/sentinel/custom-layers/NOPE").status_code == 200


def test_the_library_has_a_ceiling(client):
    from azimut.api import satellite as api

    for index in range(api.MAX_CUSTOM_LAYERS):
        kept = client.put(
            "/api/satellite/sentinel/custom-layers", json={**PLUME, "id": f"L{index}"}
        )
        assert kept.status_code == 200
    full = client.put("/api/satellite/sentinel/custom-layers", json={**PLUME, "id": "ONE_MORE"})
    assert full.status_code == 409
    # a name already kept is still savable: it replaces, it does not grow the list
    assert client.put(
        "/api/satellite/sentinel/custom-layers", json={**PLUME, "id": "L0"}
    ).status_code == 200


def test_a_backup_carries_them(client):
    client.put("/api/satellite/sentinel/custom-layers", json=PLUME)
    blob = client.get("/api/settings/export").json()
    assert blob["settings"]["sentinel_layers"][0]["script"] == PLUME["script"]

    client.delete("/api/satellite/sentinel/custom-layers/PLUME_SWIR")
    assert client.get("/api/satellite/sentinel/custom-layers").json()["layers"] == []

    restored = client.post("/api/settings/import", json=blob)
    assert restored.status_code == 200
    back = client.get("/api/satellite/sentinel/custom-layers").json()["layers"]
    assert back[0]["id"] == "PLUME_SWIR"
    assert back[0]["script"] == PLUME["script"]


# -- a layer being written -----------------------------------------------------


def test_a_draft_renders_before_it_is_saved(client):
    config.update_settings(lambda settings: settings.update(api_keys={"sentinelhub": "inst-uuid"}))
    draft = client.put(
        "/api/satellite/sentinel/draft-layer",
        json={"base": "TRUE_COLOR", "script": "//VERSION=3\nfirst\n"},
    ).json()
    assert draft["id"].startswith(sentinel.DRAFT_PREFIX)

    provider = tiles.get_provider(f"sentinel2~{draft['id']}~2026-05-11~2026-05-11")
    assert "LAYER=TRUE_COLOR" in provider.url
    assert script_of(provider.url) == "//VERSION=3\nfirst\n"


def test_a_changed_draft_renders_under_a_new_name(client):
    """The name is the disk cache's key, so two attempts must not share one."""
    first = client.put(
        "/api/satellite/sentinel/draft-layer", json={"script": "//VERSION=3\nfirst\n"}
    ).json()["id"]
    second = client.put(
        "/api/satellite/sentinel/draft-layer", json={"script": "//VERSION=3\nsecond\n"}
    ).json()["id"]
    assert first != second
    # and only one draft is kept, not a pile of them
    assert config.load_settings()["sentinel_draft_layer"]["id"] == second


def test_the_same_draft_twice_is_the_same_name(client):
    body = {"script": "//VERSION=3\nsame\n"}
    first = client.put("/api/satellite/sentinel/draft-layer", json=body).json()["id"]
    second = client.put("/api/satellite/sentinel/draft-layer", json=body).json()["id"]
    assert first == second


def test_a_draft_is_never_offered_as_a_layer(client):
    client.put("/api/satellite/sentinel/draft-layer", json={"script": "//VERSION=3\nx\n"})
    layers = client.get("/api/satellite/sentinel/layers").json()["layers"]
    assert not [entry for entry in layers if sentinel.is_draft_layer(entry["id"])]
    # nor among the layers the editor manages
    kept = client.get("/api/satellite/sentinel/custom-layers").json()["layers"]
    assert kept == []


def test_closing_the_editor_forgets_the_draft(client):
    client.put("/api/satellite/sentinel/draft-layer", json={"script": "//VERSION=3\nx\n"})
    assert client.delete("/api/satellite/sentinel/draft-layer").json() == {"cleared": True}
    assert config.load_settings()["sentinel_draft_layer"] is None


def test_a_draft_does_not_travel_in_a_backup(client):
    client.put("/api/satellite/sentinel/draft-layer", json={"script": "//VERSION=3\nx\n"})
    client.put("/api/satellite/sentinel/custom-layers", json=PLUME)
    blob = client.get("/api/settings/export").json()
    # the saved layer travels; this machine's scratch work does not
    assert blob["settings"]["sentinel_layers"][0]["id"] == "PLUME_SWIR"
    assert "sentinel_draft_layer" not in blob["settings"]


def test_the_editor_is_told_which_layer_is_the_radar_one(client):
    """A script reading Sentinel-2 bands through the radar layer renders
    nothing, so the editor has to be able to keep it off the list."""
    body = client.get("/api/satellite/sentinel/custom-layers").json()
    assert body["radar_layer"] == ""
    assert "B12" in body["bands"] and "B10" not in body["bands"]

    config.update_settings(lambda settings: settings.update(sentinel1_layer="RADAR"))
    assert client.get("/api/satellite/sentinel/custom-layers").json()["radar_layer"] == "RADAR"


def test_the_radar_layer_is_never_offered_as_a_display(client, monkeypatch):
    """Radar lives in the same configuration as the optical layers and
    GetCapabilities does not say which collection a layer reads, so the
    instance hands it back among the rest — often first. Offered as a display
    it would be picked, dated and cloud-filtered by a calendar that is not its
    own; the radar road reads ``sentinel1_layer``, never this list.
    """
    config.update_settings(
        lambda settings: settings.update(
            api_keys={"sentinelhub": "inst-uuid"}, sentinel1_layer="RADAR"
        )
    )
    monkeypatch.setattr(
        sentinel,
        "capabilities_layers",
        lambda *args, **kw: [
            {"id": "RADAR", "label": "RADAR", "hint": ""},
            {"id": "TRUE_COLOR", "label": "True colour", "hint": ""},
        ],
    )

    body = client.get("/api/satellite/sentinel/layers?check=true").json()
    assert body["source"] == "instance"
    assert [entry["id"] for entry in body["layers"]] == ["TRUE_COLOR"]
    # so the first entry every picker falls back to is an optical layer again
    assert body["layers"][0]["id"] == sentinel.DEFAULT_LAYER
    # and nothing was taken away from radar: it is reached from settings
    assert config.load_settings()["sentinel1_layer"] == "RADAR"


def test_the_route_takes_exactly_the_body_the_editor_sends(client):
    """The editor's draft holds more than a layer, and this route forbids what
    it does not know. The two lists are written out separately, so they are
    checked against each other rather than trusted."""
    source = Path("frontend/src/lib/customLayers.js").read_text(encoding="utf-8")
    sent = re.search(r"export function layerPayload\(form, script\) \{\s*return \{(.+?)\};",
                     source, re.S).group(1)
    # `key: value` and the shorthand `key,` are both a key being sent
    keys = set(re.findall(r"^\s*(\w+)\s*[:,]", sent, re.M))
    assert keys == set(api.CustomLayerIn.model_fields)

    # and that body really is accepted, memo and all
    kept = client.put(
        "/api/satellite/sentinel/custom-layers",
        json={**{key: "" for key in keys if key not in ("form",)},
              "id": "PLUME_SWIR", "base": "TRUE_COLOR", "script": "//VERSION=3\n",
              "form": {"way": "index", "high": "B12", "low": "B11",
                       "ramp": "heat", "threshold": 0.15}},
    )
    assert kept.status_code == 200
    assert kept.json()["form"] == {
        "way": "index", "high": "B12", "low": "B11", "ramp": "heat", "threshold": 0.15,
    }


# -- what a form wrote ---------------------------------------------------------


def test_a_layer_remembers_the_form_that_wrote_it(client):
    client.put(
        "/api/satellite/sentinel/custom-layers",
        json={"id": "PLUME", "base": "TRUE_COLOR", "script": "//VERSION=3\n",
              "form": {"way": "composite", "red": "B12", "green": "B11",
                       "blue": "B04", "gain": 2.5}},
    )
    kept = client.get("/api/satellite/sentinel/custom-layers").json()["layers"][0]
    # without this, every saved layer reopens as JavaScript — the ones nobody typed too
    assert kept["form"]["way"] == "composite"
    assert kept["form"]["red"] == "B12"


def test_a_script_somebody_typed_remembers_nothing(client):
    client.put(
        "/api/satellite/sentinel/custom-layers",
        json={"id": "BYHAND", "base": "TRUE_COLOR", "script": "//VERSION=3\n"},
    )
    kept = client.get("/api/satellite/sentinel/custom-layers").json()["layers"][0]
    assert "form" not in kept


@pytest.mark.parametrize(
    "memo",
    [
        {"way": "nonsense", "high": "B08", "low": "B04"},
        {"way": "index", "high": "B99", "low": "B04"},  # not a band
        {"way": "index", "high": "B08"},  # half an index
        {"way": "index", "high": "B08", "low": "B04", "threshold": 4},  # off the scale
        {"way": "index", "high": "B08", "low": "B04", "ramp": "../escape"},
        {"way": "composite", "red": "B12", "green": "B11"},  # two of three channels
        {"way": "composite", "red": "B12", "green": "B11", "blue": "B04", "gain": 0},
        "not an object",
        None,
    ],
)
def test_a_memo_this_build_cannot_read_is_dropped_not_refused(memo):
    """The script is what renders. A layer whose memo is nonsense still works —
    it just reopens as the script, which is all anyone could say about it."""
    entry = sentinel.parse_custom_layer(
        {"id": "PLUME", "base": "TRUE_COLOR", "script": "//VERSION=3\n", "form": memo}
    )
    assert entry["script"] == "//VERSION=3\n"
    assert "form" not in entry


def test_a_backup_carries_how_a_layer_was_written(client):
    client.put(
        "/api/satellite/sentinel/custom-layers",
        json={"id": "PLUME", "base": "TRUE_COLOR", "script": "//VERSION=3\n",
              "form": {"way": "index", "high": "B12", "low": "B11", "threshold": 0.15}},
    )
    blob = client.get("/api/settings/export").json()
    client.post("/api/settings/import", json=blob)
    back = client.get("/api/satellite/sentinel/custom-layers").json()["layers"][0]
    assert back["form"]["threshold"] == 0.15


def test_an_index_layer_is_already_a_rule_this_engine_measures():
    """The bridge the builder offers rests on `nd` existing: a normalised
    difference of two bands is a quantity a rule reads, so the arithmetic an
    analyst settled on looking at the map does not have to be typed twice."""
    from azimut.engine.analysis_models import Rule

    rule = Rule(measure="nd", bands=("B12", "B11"), on="b", op="ge", value=0.15)
    assert set(rule.bands_read()) == {"B12", "B11"}
    # and the threshold an index layer paints with is the line a rule crosses
    assert rule.value == 0.15


# -- in Detect -----------------------------------------------------------------


def test_detect_reviews_a_run_on_a_layer_written_here(client):
    """A run records the layer its pictures were drawn from, and a name written
    here is a layer name like any other — so a detection can be reviewed over
    the analyst's own composite."""
    from azimut.engine.analysis_models import Source

    source = Source(provider="sentinel2", date="2026-10-04", layer="PLUME_SWIR")
    assert source.layer == "PLUME_SWIR"
    # and that is what the picture is fetched through, resolved to base + script
    config.update_settings(lambda settings: settings.update(sentinel_layers=[PLUME]))
    customs = sentinel.renderable_layers(config.load_settings())
    asked, script = sentinel.resolve_layer(source.layer, customs)
    assert (asked, script) == ("TRUE_COLOR", PLUME["script"])


def test_a_rule_still_reads_bands_whatever_the_picture_is(client):
    """The division the whole feature rests on: a layer is the picture, a rule is
    the measurement. Changing the display must not change what is measured."""
    from azimut.engine.analysis_models import Recipe, Rule, recipe_products

    recipe = Recipe(
        id="mine", name="Mine", method="rules", phenomenon="x",
        rules=[Rule(measure="nd", bands=("B12", "B11"), on="b", op="ge", value=0.15)],
    )
    # the products are named by the rule's bands, never by the layer on screen
    assert recipe_products(recipe) == ["bands-B11-B12"]


def test_the_display_a_frame_is_drawn_through_is_not_the_data_it_reads(client):
    """`band_frame` renders our evalscript through a layer, so a custom layer's
    base is enough: the script the analyst wrote paints nothing a rule reads."""
    config.update_settings(lambda settings: settings.update(sentinel_layers=[PLUME]))
    customs = sentinel.renderable_layers(config.load_settings())
    asked, _ = sentinel.resolve_layer("PLUME_SWIR", customs)
    # a band product asks the instance for a layer it serves, and nothing else
    assert asked == "TRUE_COLOR"
