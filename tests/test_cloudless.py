"""EOX's Sentinel-2 cloudless as a basemap: a year's mosaic, shown and never captured."""

import pytest

from azimut import config
from azimut.engine import cloudless, mapplates, tiles


def test_each_year_names_its_layer_its_credit_and_its_licence():
    assert cloudless.tile_url(2016) == (
        "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/GoogleMapsCompatible/{z}/{y}/{x}.jpg")
    assert "s2cloudless-2024_3857" in cloudless.tile_url(2024)
    # the words EOX asks for, the years of data each picture is made of
    assert "(Contains modified Copernicus Sentinel data 2016 & 2017)" in cloudless.attribution(2016)
    assert "(Contains modified Copernicus Sentinel data 2017 & 2018)" in cloudless.attribution(2018)
    assert "(Contains modified Copernicus Sentinel data 2025)" in cloudless.attribution(2025)
    assert cloudless.attribution(2016).endswith("CC BY 4.0")
    assert cloudless.attribution(2025).endswith("CC BY-NC-SA 4.0, non-commercial use")
    assert cloudless.NEWEST == max(cloudless.YEARS)


@pytest.mark.parametrize("bad", ["2017", "1999", "x", "2016/../x", ""])
def test_a_year_without_a_stated_licence_is_refused(bad):
    with pytest.raises(ValueError):
        cloudless.parse_variant(bad)


def test_the_basemap_is_listed_view_only_and_resolves_a_year(monkeypatch, tmp_path):
    monkeypatch.setenv("AZIMUT_HOME", str(tmp_path))
    config.save_settings(config.DEFAULT_SETTINGS)
    base = next(p for p in tiles.all_providers() if p.id == cloudless.BASE_ID)
    # a mosaic of many passes holds no single date: it is never filed as a capture
    assert base.capturable is False
    assert base.max_native_zoom == 14
    year = tiles.get_provider("s2cloudless~2016")
    assert year.id == "s2cloudless~2016"
    assert year.url == cloudless.tile_url(2016)
    assert year.attribution == cloudless.attribution(2016)
    assert year.capturable is False
    assert tiles.get_provider("s2cloudless").url == cloudless.tile_url(cloudless.NEWEST)
    for bad in ("s2cloudless~2017", "s2cloudless~../x"):
        with pytest.raises(KeyError):
            tiles.get_provider(bad)


def test_the_years_are_answered_from_the_app_newest_first(client):
    years = client.get("/api/satellite/cloudless/years").json()["years"]
    assert [entry["year"] for entry in years] == sorted(cloudless.YEARS, reverse=True)
    oldest = years[-1]
    assert oldest == {"year": 2016, "attribution": cloudless.attribution(2016), "licence": "CC BY 4.0", "free": True}
    assert not years[0]["free"]


def test_a_plate_keeps_its_cloudless_year_and_its_ground_presence():
    element = {"id": "map", "kind": "map", "box": [0, 0, 100, 100], "view": {"lat": 0, "lon": 0, "zoom": 3},
               "basemap": "s2cloudless", "year": 2016, "plain": {"presence": 0.4, "density": "low"}}
    spec = mapplates.PlateSpec.model_validate({"elements": [element]})
    assert spec.elements[0].year == 2016
    assert spec.elements[0].plain.presence == 0.4
    for bad in ({"year": 1990}, {"plain": {"presence": 0.1}}, {"plain": {"presence": 2}}):
        with pytest.raises(ValueError):
            mapplates.PlateSpec.model_validate({"elements": [{**element, **bad}]})
    # the year is the ground's, so a template keeps it as it keeps the ground
    assert mapplates.template_of({"elements": [element]})["elements"][0]["year"] == 2016
