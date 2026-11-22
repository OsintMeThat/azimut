"""A note's credits name each source once, and never leave a rights holder out."""

from azimut.engine.noteannexes import _merged

NOTICE = ("Mapterhorn (mapterhorn.com/attribution), produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 "
          "and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; "
          "all rights reserved")


def test_a_credit_another_already_says_whole_goes_and_every_other_stays():
    # The credits a published article carried: the relief's notice twice, Apple Maps twice.
    found = ["Esri, Maxar, Earthstar Geographics, and the GIS User Community", f"© {NOTICE}", "30 m relief",
             f"Relief © {NOTICE}", "© Apple Maps", "OpenFreeMap © OpenMapTiles", "Data © OpenStreetMap contributors",
             "Esri, Vantor, Earthstar Geographics, and the GIS User Community", "Apple Maps",
             "Data from TomTom, © OpenStreetMap and other data providers"]
    assert _merged(found) == [
        "Esri, Maxar, Earthstar Geographics, and the GIS User Community", "30 m relief", f"Relief © {NOTICE}",
        "© Apple Maps", "OpenFreeMap © OpenMapTiles", "Data © OpenStreetMap contributors",
        "Esri, Vantor, Earthstar Geographics, and the GIS User Community",
        "Data from TomTom, © OpenStreetMap and other data providers"]


def test_the_same_words_keep_the_first_and_a_longer_credit_wins_over_a_part_of_it():
    assert _merged(["Apple Maps", "© apple maps.", "Esri"]) == ["Apple Maps", "Esri"]
    assert _merged(["Esri", "Esri, Maxar"]) == ["Esri, Maxar"]
    # two that each say something the other does not both stay
    assert _merged(["Data © OpenStreetMap contributors", "Data from TomTom, © OpenStreetMap"]) == [
        "Data © OpenStreetMap contributors", "Data from TomTom, © OpenStreetMap"]
    assert _merged([]) == []
