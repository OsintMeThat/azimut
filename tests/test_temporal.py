"""The deliberately small temporal syntax accepted by Azimut.

The contract borrows reduced dates, intervals and qualifiers from EDTF, and exact
timestamps from ISO 8601.  It does not claim full EDTF support: accepting a form in
this file means the parser can derive honest search bounds from it.
"""

import pytest

from azimut.engine.temporal import TemporalError, parse_temporal


@pytest.mark.parametrize(
    ("raw", "earliest", "latest", "precision", "zone"),
    [
        ("2026", "2026-01-01T00:00:00.000000Z", "2027-01-01T00:00:00.000000Z", "year", "date-only"),
        ("2026-08", "2026-08-01T00:00:00.000000Z", "2026-09-01T00:00:00.000000Z", "month", "date-only"),
        ("2024-02-29", "2024-02-29T00:00:00.000000Z", "2024-03-01T00:00:00.000000Z", "day", "date-only"),
        (
            "2026-08-11T16:40:00Z",
            "2026-08-11T16:40:00.000000Z",
            "2026-08-11T16:40:01.000000Z",
            "second",
            "utc",
        ),
        (
            "2026-08-11T18:40:00+02:00",
            "2026-08-11T16:40:00.000000Z",
            "2026-08-11T16:40:01.000000Z",
            "second",
            "offset",
        ),
        (
            "2026-08-11T16:40:00.123Z",
            "2026-08-11T16:40:00.123000Z",
            "2026-08-11T16:40:00.124000Z",
            "subsecond",
            "utc",
        ),
    ],
)
def test_a_supported_value_has_exclusive_search_bounds(
    raw, earliest, latest, precision, zone
):
    value = parse_temporal(raw)

    assert value.raw == raw
    assert value.shape == "instant"
    assert value.earliest == earliest
    assert value.latest == latest
    assert value.precision == precision
    assert value.zone == zone
    assert value.sortable is True
    assert value.uncertain is False
    assert value.approximate is False
    assert value.start.raw == raw
    assert value.end is None


def test_a_local_time_is_kept_without_being_falsely_put_on_the_utc_axis():
    value = parse_temporal("2026-08-11T18:40:00")

    assert value.raw == "2026-08-11T18:40:00"
    assert value.precision == "second"
    assert value.zone == "local"
    assert value.sortable is False
    assert value.earliest is None
    assert value.latest is None


@pytest.mark.parametrize(
    ("raw", "uncertain", "approximate"),
    [
        ("2026-08~", False, True),
        ("2026-08?", True, False),
        ("2026-08%", True, True),
    ],
)
def test_edtf_qualifiers_are_retained_without_inventing_wider_bounds(
    raw, uncertain, approximate
):
    value = parse_temporal(raw)

    assert value.raw == raw
    assert value.earliest == "2026-08-01T00:00:00.000000Z"
    assert value.latest == "2026-09-01T00:00:00.000000Z"
    assert value.uncertain is uncertain
    assert value.approximate is approximate
    assert value.start.uncertain is uncertain
    assert value.start.approximate is approximate


def test_a_date_interval_uses_the_lower_start_and_exclusive_upper_end():
    value = parse_temporal("2026-08/2026-10")

    assert value.shape == "interval"
    assert value.earliest == "2026-08-01T00:00:00.000000Z"
    assert value.latest == "2026-11-01T00:00:00.000000Z"
    assert value.precision == "month"
    assert value.zone == "date-only"
    assert value.sortable is True
    assert value.start.raw == "2026-08"
    assert value.end is not None
    assert value.end.raw == "2026-10"


def test_an_interval_keeps_each_ends_qualifier_and_reports_mixed_precision():
    value = parse_temporal("2026~/2027-02?")

    assert value.precision == "mixed"
    assert value.approximate is True
    assert value.uncertain is True
    assert value.start.approximate is True
    assert value.start.uncertain is False
    assert value.end is not None
    assert value.end.approximate is False
    assert value.end.uncertain is True


def test_a_timestamp_interval_uses_exact_zoned_bounds():
    value = parse_temporal(
        "2026-08-11T18:15:00+02:00/2026-08-11T19:40:00+02:00"
    )

    assert value.shape == "interval"
    assert value.earliest == "2026-08-11T16:15:00.000000Z"
    assert value.latest == "2026-08-11T17:40:00.000000Z"
    assert value.precision == "second"
    assert value.zone == "offset"
    assert value.sortable is True


@pytest.mark.parametrize(
    "raw",
    [
        "",
        " 2026",
        "2026 ",
        "0000",
        "20260",
        "2026-8",
        "2026-13",
        "2026-08-1",
        "2026-02-29",
        "2026-08-11T18:40",
        "2026-08-11T24:00:00Z",
        "2026-08-11T18:40:60Z",
        "2026-08-11T18:40:00z",
        "2026-08-11T18:40:00+02",
        "2026-08-11T18:40:00+14:01",
        "2026-08-11T18:40:00+14:30",
        "2026-08-11T18:40:00+15:00",
        "2026-08-11T18:40:00.1234567Z",
        "2026-08-11T18:40:00Z~",
        "2026-08-11T18:40:00Z?",
        "2026/",
        "/2026",
        "../2026",
        "2026/..",
        "2026/2025",
        "2026-08-11T18:00:00/2026-08-11T19:00:00",
        "2026-08-11/2026-08-11T19:00:00Z",
        "2026-08-11T19:00:00Z/2026-08-11T18:00:00Z",
        "2026-21",
        "-0044",
        "202X",
        "[2025,2026]",
    ],
)
def test_unsupported_or_ambiguous_forms_are_refused(raw):
    with pytest.raises(TemporalError):
        parse_temporal(raw)


@pytest.mark.parametrize("raw", [None, 2026, True, [], {}])
def test_a_temporal_value_is_always_text(raw):
    with pytest.raises(TemporalError):
        parse_temporal(raw)
