"""The credit Copernicus data carries: the notice, its year, and older wordings read anew."""

import pytest

from azimut.engine import cloudless, copernicus_credit
from azimut.engine.copernicus_credit import normalise_attribution

NOTICE = "Contains modified Copernicus Sentinel data"


def test_sentinel_data_is_credited_as_modified_with_its_year():
    # the legal notice's words for adapted Sentinel data, which every picture here is
    assert copernicus_credit.sentinel("2026-05-12") == f"{NOTICE} 2026"
    # a window inside one year names it once
    assert copernicus_credit.sentinel("2026-05-01", "2026-05-31") == f"{NOTICE} 2026"


def test_a_window_across_new_year_names_both_years():
    assert copernicus_credit.sentinel("2025-12-20", "2026-01-10") == f"{NOTICE} 2025-2026"
    assert copernicus_credit.sentinel("2019-06-01", "2022-06-01", "2020-01-01") == f"{NOTICE} 2019-2022"


def test_an_unknown_date_says_no_year_rather_than_a_wrong_one():
    assert copernicus_credit.sentinel() == NOTICE
    assert copernicus_credit.sentinel(None, "") == NOTICE
    assert copernicus_credit.sentinel("not a date") == NOTICE


def test_the_year_is_read_off_every_shape_a_day_is_kept_in():
    for day in ("2024-03-12", "2024-03-12~", "~2024-03", "2024", "2024-03-12T10:41:00Z"):
        assert copernicus_credit.data_years(day) == "2024", day
    # a provider id names its window or its pass wherever they stand
    assert copernicus_credit.data_years("sentinel2~SWIR~2025-12-20~2026-01-10~CC20") == "2025-2026"
    assert copernicus_credit.data_years("sentinel1~2026-05-14~054210") == "2026"
    # a layer whose name holds digits is not a year
    assert copernicus_credit.data_years("sentinel2~LAYER_2020") == ""
    # a sidecar may hold anything
    assert copernicus_credit.data_years(20240312) == ""  # type: ignore[arg-type]


def test_service_information_has_its_own_notice():
    assert copernicus_credit.service("2025-08-01") == "Contains modified Copernicus Service information 2025"
    assert copernicus_credit.service(None) == "Contains modified Copernicus Service information"


@pytest.mark.parametrize("legacy", [
    "© Copernicus Sentinel data / Sentinel Hub",  # the tile layers' and captures' credit
    "Copernicus Sentinel data / Sentinel Hub",  # Detect's evidence foot
    "© Copernicus Sentinel data",  # a Copernicus Browser screenshot
    "Copernicus Sentinel data",
])
def test_the_older_wordings_read_as_the_notice(legacy):
    assert normalise_attribution(legacy, "2026-05-12") == f"{NOTICE} 2026"
    assert normalise_attribution(legacy, None) == NOTICE


DEM = (
    "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
    "provided under COPERNICUS by the European Union and ESA; all rights reserved"
)


def test_the_dem_notice_is_the_licence_s_word_for_word():
    # COP-DEM-GLO-30-F licence, Article 6(b), for adapted data
    assert copernicus_credit.DEM == DEM
    assert copernicus_credit.RELIEF_PUBLISHED == f"© Mapterhorn, {DEM}"


def test_only_the_copernicus_parts_of_a_composed_line_change():
    tilted = ("© Copernicus Sentinel data / Sentinel Hub · Relief © Mapterhorn · Far ground Esri, Vantor, "
              "Earthstar Geographics, and the GIS User Community")
    assert normalise_attribution(tilted, "2023-08-08") == (
        f"{NOTICE} 2023 · Relief © Mapterhorn, {DEM} · Far ground Esri, Vantor, Earthstar Geographics, and the "
        "GIS User Community"
    )


def test_a_bare_relief_credit_takes_the_dem_s_notice_once():
    # a tilted capture or a Horizon picture filed before the notice was written
    assert normalise_attribution("Esri · Relief © Mapterhorn", None) == f"Esri · Relief © Mapterhorn, {DEM}"
    assert normalise_attribution(f"© Mapterhorn, {DEM} · 30 m relief", None) == f"© Mapterhorn, {DEM} · 30 m relief"


def test_the_notice_written_without_a_year_takes_the_day_s():
    assert normalise_attribution(f"{NOTICE} · Esri", "2026-02-01") == f"{NOTICE} 2026 · Esri"
    assert normalise_attribution(NOTICE, None) == NOTICE


@pytest.mark.parametrize("credit", [
    f"{NOTICE} 2024",
    f"{NOTICE} 2023-2024",
    "Copernicus Sentinel data 2024",  # the unmodified form, with its year: somebody's right wording
    cloudless.attribution(2016),
    cloudless.attribution(2025),
    "Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    "Map data ©2026 Google",
    "© Mapbox © OpenStreetMap",
    "© OpenStreetMap contributors",
    copernicus_credit.RELIEF_PUBLISHED,
    "Contains modified Copernicus Service information 2025",
    "",
])
def test_every_other_credit_is_left_exactly_as_it_was(credit):
    assert normalise_attribution(credit, "2026-05-12") == credit


def test_the_frontend_writes_the_same_words():
    """The app's other side words the notices itself (lib/copernicusCredit.js); they cannot drift."""
    from pathlib import Path

    source = Path("frontend/src/lib/copernicusCredit.js").read_text(encoding="utf-8")
    for words in (copernicus_credit.SENTINEL, copernicus_credit.DEM, copernicus_credit.RELIEF):
        assert f"'{words}'" in source, words


def test_reading_twice_changes_nothing_more():
    once = normalise_attribution("© Copernicus Sentinel data / Sentinel Hub · Relief © Mapterhorn", "2026-05-12")
    assert normalise_attribution(once, "2026-05-12") == once
    assert normalise_attribution(once, "2020-01-01") == once


def test_a_missing_credit_reads_as_none():
    assert normalise_attribution(None, "2026-05-12") == ""  # type: ignore[arg-type]
