"""Country/region lookup behind the Saved tree: continents and country names
(offline tables) and ``geo.locate_point`` (Nominatim behind a stub, never the
network)."""

from azimut.engine import continents, countries, geo


def _address(payload):
    """Stub reverse_geocode with one Nominatim address, whatever language it
    is asked for."""
    return lambda lat, lon, timeout=8, language=None: {
        "display_name": "x", "address": payload, "attribution": "x",
    }


def _by_language(native, english):
    """Stub reverse_geocode answering with a different address per language."""

    def fake(lat, lon, timeout=8, language=None):
        return {
            "display_name": "x",
            "address": english if language == "en" else native,
            "attribution": "x",
        }

    return fake


# -- continents: pure data, no network -------------------------------------------


def test_continent_for_maps_known_codes():
    assert continents.continent_for("ua") == "Europe"
    assert continents.continent_for("UA") == "Europe"
    assert continents.continent_for("cd") == "Africa"
    assert continents.continent_for("kh") == "Asia"
    assert continents.continent_for("br") == "South America"
    assert continents.continent_for("mx") == "North America"
    assert continents.continent_for("fj") == "Oceania"
    assert continents.continent_for("aq") == "Antarctica"


def test_continent_for_is_none_for_unknown_or_missing():
    assert continents.continent_for("zz") is None
    assert continents.continent_for("") is None
    assert continents.continent_for(None) is None


def test_every_continent_name_is_one_of_the_seven():
    assert set(continents.CONTINENTS.values()) == {
        "Africa", "Antarctica", "Asia", "Europe",
        "North America", "Oceania", "South America",
    }


def test_a_country_without_coordinates_falls_back_to_its_table_verdict():
    assert continents.continent_for("ru") == "Europe"
    assert continents.continent_for("tr") == "Asia"
    assert continents.continent_for("kz") == "Asia"
    assert continents.continent_for("ru", 55.0, None) == "Europe"


def test_the_caucasus_keeps_its_single_verdict_wherever_the_point_is():
    # Georgia, Armenia and Azerbaijan are Asia whole; coordinates change nothing
    assert continents.continent_for("ge", 42.3, 43.4) == "Asia"
    assert continents.continent_for("az", 41.7, 48.5) == "Asia"


def test_russia_splits_on_the_urals():
    assert continents.continent_for("ru", 55.75, 37.62) == "Europe"  # Moscow
    assert continents.continent_for("ru", 58.01, 56.25) == "Europe"  # Perm
    assert continents.continent_for("ru", 67.50, 64.00) == "Europe"  # Vorkuta
    assert continents.continent_for("ru", 56.84, 60.60) == "Asia"  # Yekaterinburg
    assert continents.continent_for("ru", 66.53, 66.60) == "Asia"  # Salekhard
    assert continents.continent_for("ru", 43.12, 131.89) == "Asia"  # Vladivostok


def test_russia_places_chukotka_past_the_antimeridian_in_asia():
    assert continents.continent_for("ru", 66.16, -179.50) == "Asia"


def test_kazakhstan_splits_on_the_ural_river():
    assert continents.continent_for("kz", 51.23, 51.37) == "Europe"  # Oral
    assert continents.continent_for("kz", 43.24, 76.89) == "Asia"  # Almaty


def test_turkey_splits_on_the_straits():
    assert continents.continent_for("tr", 41.04, 28.99) == "Europe"  # Beşiktaş
    assert continents.continent_for("tr", 40.41, 26.40) == "Europe"  # Gallipoli
    assert continents.continent_for("tr", 40.99, 29.03) == "Asia"  # Kadıköy
    assert continents.continent_for("tr", 38.42, 27.14) == "Asia"  # İzmir
    assert continents.continent_for("tr", 39.93, 32.86) == "Asia"  # Ankara


# -- English country names: pure data, no network --------------------------------


def test_country_name_for_maps_known_codes():
    assert countries.name_for("ru") == "Russia"
    assert countries.name_for("RU") == "Russia"
    assert countries.name_for(" de ") == "Germany"
    assert countries.name_for("cn") == "China"


def test_country_name_for_is_none_for_unknown_or_missing():
    assert countries.name_for("zz") is None
    assert countries.name_for("") is None
    assert countries.name_for(None) is None


def test_every_code_the_tree_can_place_has_an_english_name():
    # the tree groups on the continent table, so a code there with no name
    # would render a country branch in one language only
    missing = sorted(set(continents.CONTINENTS) - set(countries.COUNTRY_NAMES_EN))
    assert missing == []


# -- locate_point ------------------------------------------------------------------


def test_locate_point_reports_country_and_region(monkeypatch):
    monkeypatch.setattr(
        geo, "reverse_geocode",
        _address({"country_code": "UA", "country": "Ukraine", "state": "Donetsk Oblast"}),
    )

    assert geo.locate_point(48.0159, 37.8029) == {
        "state": "ok",
        "country_code": "ua",  # lowercased, whatever Nominatim sent
        "country": "Ukraine",
        "region": "Donetsk Oblast",
    }


def test_locate_point_without_a_region_is_still_ok(monkeypatch):
    monkeypatch.setattr(geo, "reverse_geocode", _address({"country_code": "mc", "country": "Monaco"}))

    assert geo.locate_point(43.73, 7.42) == {
        "state": "ok", "country_code": "mc", "country": "Monaco",
    }


def test_region_falls_back_through_the_admin_spellings(monkeypatch):
    for key, name in (("state", "A"), ("region", "B"), ("province", "C"), ("county", "D")):
        monkeypatch.setattr(
            geo, "reverse_geocode", _address({"country_code": "fr", "country": "France", key: name})
        )
        assert geo.locate_point(48.8, 2.3)["region"] == name


def test_region_prefers_state_over_the_later_spellings(monkeypatch):
    monkeypatch.setattr(
        geo, "reverse_geocode",
        _address({"country_code": "fr", "country": "France", "county": "Paris", "state": "Ile-de-France"}),
    )
    assert geo.locate_point(48.8, 2.3)["region"] == "Ile-de-France"


def test_a_point_in_no_country_is_nocountry(monkeypatch):
    # open sea: Nominatim answers, the answer just has no country in it
    monkeypatch.setattr(geo, "reverse_geocode", _address({}))
    assert geo.locate_point(0.0, -30.0) == {"state": "nocountry"}


def test_a_lookup_that_does_not_answer_is_failed(monkeypatch):
    monkeypatch.setattr(geo, "reverse_geocode", lambda lat, lon, timeout=8: None)
    assert geo.locate_point(48.8, 2.3) == {"state": "failed"}


def test_region_en_is_filed_beside_the_native_region(monkeypatch):
    monkeypatch.setattr(
        geo, "reverse_geocode",
        _by_language(
            {"country_code": "ru", "country": "Россия", "state": "Московская область"},
            {"country_code": "ru", "country": "Russia", "state": "Moscow Oblast"},
        ),
    )

    assert geo.locate_point(55.7, 37.6) == {
        "state": "ok",
        "country_code": "ru",
        "country": "Россия",  # the native answer stays the authority
        "region": "Московская область",
        "region_en": "Moscow Oblast",
    }


def test_region_en_is_dropped_when_it_matches_the_native_region(monkeypatch):
    monkeypatch.setattr(
        geo, "reverse_geocode",
        _address({"country_code": "fr", "country": "France", "state": "Normandie"}),
    )
    assert "region_en" not in geo.locate_point(49.1, 0.1)


def test_a_failed_english_lookup_still_files_the_native_verdict(monkeypatch):
    def fake(lat, lon, timeout=8, language=None):
        if language == "en":
            raise OSError("network down")
        return {"display_name": "x", "attribution": "x", "address": {
            "country_code": "ua", "country": "Україна", "state": "Донецька область",
        }}

    monkeypatch.setattr(geo, "reverse_geocode", fake)

    assert geo.locate_point(48.0, 37.8) == {
        "state": "ok",
        "country_code": "ua",
        "country": "Україна",
        "region": "Донецька область",
    }


def test_no_english_lookup_when_there_is_no_region(monkeypatch):
    # a second request buys nothing here: the country name is offline data
    asked = []

    def fake(lat, lon, timeout=8, language=None):
        asked.append(language)
        return {"display_name": "x", "attribution": "x",
                "address": {"country_code": "mc", "country": "Monaco"}}

    monkeypatch.setattr(geo, "reverse_geocode", fake)
    geo.locate_point(43.73, 7.42)
    assert asked == [None]


def test_locate_point_never_raises(monkeypatch):
    def boom(lat, lon, timeout=8):
        raise OSError("network down")

    monkeypatch.setattr(geo, "reverse_geocode", boom)
    assert geo.locate_point(48.8, 2.3) == {"state": "failed"}
