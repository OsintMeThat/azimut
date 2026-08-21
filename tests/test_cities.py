"""The bundled city gazetteer: what the search bar can answer offline."""

import gzip

import pytest

from azimut.engine import cities


@pytest.fixture(autouse=True)
def fresh_gazetteer():
    """Each test starts before the lazy load, and leaves nothing loaded behind."""
    cities._reset()
    yield
    cities._reset()


def _names(query, limit=8):
    return [city["name"] for city in cities.search(query, limit)]


def test_the_data_file_ships_with_the_package():
    # collect_data_files("azimut") puts it in the binaries and hatchling puts it
    # in the wheel — but only if it is committed beside the module.
    assert cities.DATA.exists(), "run scripts/build_cities.py"
    text = gzip.decompress(cities.DATA.read_bytes()).decode("utf-8")
    header, columns, first = text.splitlines()[:3]
    assert "GeoNames" in header and "CC BY 4.0" in header
    assert columns.split("\t") == ["# name", "ascii", "country", "region", "lat", "lon", "population"]
    assert len(first.split("\t")) == 7
    # biggest first: the row order *is* the ranking, so nothing re-sorts on read
    populations = [int(line.split("\t")[6]) for line in text.splitlines()[2:102]]
    assert populations == sorted(populations, reverse=True)


def test_a_prefix_finds_the_city():
    found = cities.search("krama", 5)
    assert found[0]["name"] == "Kramatorsk"
    assert found[0]["country"] == "ua"
    assert found[0]["country_name"] == "Ukraine"
    assert found[0]["region"] == "Donetsk"
    assert found[0]["lat"] == pytest.approx(48.73, abs=0.05)
    assert found[0]["lon"] == pytest.approx(37.57, abs=0.05)


def test_four_letters_are_enough():
    # the whole point of shipping the file: no pause, no network, four letters
    assert "Kyiv" in _names("kyiv")
    assert "Mariupol" in _names("mari")
    assert "Aleppo" in _names("alep")


def test_the_biggest_match_leads():
    # three Springfields and a Paris, Texas — population decides, not the file order
    assert _names("springfield")[0] == "Springfield"
    paris = cities.search("paris", 3)
    assert paris[0]["country"] == "fr"
    assert paris[0]["population"] > paris[1]["population"]


def test_an_exact_name_beats_a_longer_one_that_starts_the_same():
    # "York" the city outranks York University Heights, which has more people
    assert _names("york")[0] == "York"


def test_a_later_word_is_searchable_but_ranks_below_a_leading_one():
    found = _names("york", 20)
    assert "New York City" in found
    assert found.index("York") < found.index("New York City")


def test_accents_and_punctuation_do_not_have_to_be_typed():
    assert "Saint-Étienne" in _names("saint etie")
    assert "Saint-Étienne" in _names("saint-étienne")
    assert "Malmö" in _names("malmo")


def test_multi_word_names_match_across_the_space():
    assert "New York City" in _names("new yo")
    assert "Los Angeles" in _names("los ang")


def test_limit_is_honored_and_a_blank_query_finds_nothing():
    assert len(cities.search("s", 3)) == 3
    assert cities.search("", 5) == []
    assert cities.search("   ", 5) == []
    assert cities.search("paris", 0) == []


def test_nothing_matches_gibberish():
    assert cities.search("zzzqx nowhere", 5) == []


def test_a_missing_data_file_is_not_fatal(monkeypatch, tmp_path):
    # a broken install loses suggestions, not the search bar: the geocoder layer
    # still answers, so this must degrade quietly rather than raise
    monkeypatch.setattr(cities, "DATA", tmp_path / "absent.tsv.gz")
    assert cities.search("paris", 5) == []


def test_the_gazetteer_never_reaches_the_network():
    # the module that answers on a keystroke must have no way to make a request
    source = (cities.__file__ and open(cities.__file__, encoding="utf-8").read()) or ""
    assert "httpx" not in source and "urllib" not in source
