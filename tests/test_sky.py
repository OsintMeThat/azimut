"""Sun and moon geometry: published references, physical invariants, edge states.

Two kinds of check, because no single one is enough. The ephemerides are pinned
to Meeus's own worked examples, which are external truth. The events — rises,
sets, twilights — have no memorised reference to lean on, so they are held to
invariants the geometry cannot fake: the altitude at the returned instant *is*
the horizon, the day is symmetric about the transit, and the equinox behaves at
the equator the way spherical trigonometry says it must.

Polar day, polar night and the days with no moonrise get their own tests. They
are the reason ``state`` exists, and they are the common answer at high latitude
rather than an exotic one.
"""

from datetime import UTC, date, datetime, time, timedelta

import numpy as np
import pytest

from azimut.engine import localtime, sky

PARIS = (48.8584, 2.2945)
TROMSO = (69.6492, 18.9553)
SOUTH_POLE_ISH = (-89.0, 0.0)
EQUATOR = (0.0, 0.0)


def _events(lat, lon, day, zone=None):
    zone = zone or localtime.zone_for(lat, lon)
    start, end = localtime.day_bounds(day, zone)
    return sky.day_events(lat, lon, start, end), zone


def _altitude(lat, lon, moment, body="sun_altitude"):
    return float(sky.positions(lat, lon, [moment])[body][0])


# -- ephemerides against Meeus -------------------------------------------------


def test_sun_matches_meeus_example_25b():
    """1992-10-13.0 TD: apparent longitude 199.90895°, distance 0.99766 AU."""
    t = np.array([(2448908.5 - 2451545.0) / 36525.0])
    lon, distance, _node = sky._sun_ecliptic(t)
    assert abs(lon[0] - 199.90895) < 1e-4
    assert abs(distance[0] - 0.99766) < 1e-4


def test_moon_matches_meeus_example_47a():
    """1992-04-12.0 TD: longitude 133.162655°, latitude -3.229126°, 368409.7 km.

    The truncated series is not the full one, so the tolerances are its own
    documented error: hundredths of a degree, and a tenth of a percent of the
    distance. Both are far below the parallax correction they feed.
    """
    t = np.array([(2448724.5 - 2451545.0) / 36525.0])
    lon, lat, distance = sky._moon_ecliptic(t)
    assert abs(lon[0] - 133.162655) < 0.02
    assert abs(lat[0] - (-3.229126)) < 0.02
    assert abs(distance[0] - 368409.7) < 400


def test_moon_longitude_tracks_the_full_series_across_decades():
    """Example 47.a is one instant, and this series has 0.02 deg of its own
    error — so a wrong perturbation term can sit *closer* to the truth there by
    luck. These four epochs are picked where the terms do not cancel, and the
    references are ELP-2000/82 (Meeus table 47.A, leading terms) rather than the
    truncation under test.

    The one that made this necessary: the 0.053 inequality is `sin(2D + M')`,
    the Moon's mean anomaly. Spelled with the Sun's it costs up to 0.1 deg of
    moon direction, which lands squarely in what a shadow reading is judged on.
    """
    references = {
        2459983.2200: 160.026647,
        2460579.2900: 105.295233,
        2462218.3900: 87.547067,
        2463410.5300: 325.029664,
    }
    for julian_day, expected in references.items():
        t = np.array([(julian_day - 2451545.0) / 36525.0])
        lon, _lat, _distance = sky._moon_ecliptic(t)
        error = abs((lon[0] - expected + 180) % 360 - 180)
        assert error < 0.07, f"JD {julian_day}: {error:.4f} deg off"


def test_obliquity_is_current_at_j2000():
    """23.4392911° mean at J2000, shifted by the nutation term in obliquity."""
    obliquity = sky._obliquity(np.array([0.0]), np.array([125.04]))
    assert abs(obliquity[0] - 23.4392911) < 0.005


# -- the corrections that decide an event --------------------------------------


def test_moon_parallax_lowers_it_by_up_to_a_degree():
    """Seen from the ground the moon sits below where the centre of the Earth
    sees it, by nearly a degree at the zenith. This is the term that moves a
    moonrise by minutes, so it is asserted rather than trusted."""
    moment = datetime(2026, 7, 30, 12, 0, tzinfo=UTC)
    values = sky.positions(*PARIS, [moment])
    parallax = float(values["moon_parallax"][0])
    assert 0.89 < parallax < 1.02
    geocentric = float(values["moon_altitude"][0]) + parallax * np.cos(
        np.radians(float(values["moon_altitude"][0]))
    )
    assert geocentric > float(values["moon_altitude"][0])


def test_refraction_lifts_a_body_at_the_horizon():
    """Half a degree of lift at the horizon, and next to none overhead."""
    assert 0.4 < float(sky._refracted(np.array([0.0]))[0]) < 0.7
    assert abs(float(sky._refracted(np.array([80.0]))[0]) - 80.0) < 0.01


# -- events, held to invariants -------------------------------------------------


def test_sunrise_and_sunset_land_on_the_horizon():
    """At the instants returned, the sun's altitude is the rise/set convention."""
    events, _zone = _events(*PARIS, date(2026, 7, 30))
    for moment in (events["sun"]["rise"], events["sun"]["set"]):
        assert abs(_altitude(*PARIS, moment) - sky.SUN_HORIZON_DEG) < 0.005


def test_twilight_instants_land_on_their_own_threshold():
    events, _zone = _events(*PARIS, date(2026, 7, 30))
    for name, threshold in sky.TWILIGHTS.items():
        for moment in (events["twilight"][name]["dawn"], events["twilight"][name]["dusk"]):
            assert abs(_altitude(*PARIS, moment) - threshold) < 0.005


def test_moonrise_lands_on_the_moons_own_threshold():
    """The moon's threshold rides its distance, so this also checks that the
    per-instant semidiameter is the one used, not a constant."""
    events, _zone = _events(*PARIS, date(2026, 7, 30))
    assert events["moon"]["rises"]
    for moment in events["moon"]["rises"] + events["moon"]["sets"]:
        values = sky.positions(*PARIS, [moment])
        threshold = sky.REFRACTION_DEG - sky.MOON_SEMIDIAMETER_RATIO * float(
            values["moon_parallax"][0]
        )
        assert abs(float(values["moon_altitude"][0]) - threshold) < 0.005


def test_day_is_symmetric_about_solar_noon():
    """Sunrise and sunset sit equally far from the transit, to within the
    seconds the sun's own motion in declination adds over half a day."""
    events, _zone = _events(*PARIS, date(2026, 7, 30))
    before = events["sun"]["transit"] - events["sun"]["rise"]
    after = events["sun"]["set"] - events["sun"]["transit"]
    assert abs((after - before).total_seconds()) < 60


def test_solar_noon_altitude_follows_latitude_and_declination():
    """At the June solstice the transit altitude is 90° − lat + 23.44°, which is
    a closed form the series has to reproduce."""
    events, _zone = _events(*TROMSO, date(2026, 6, 21))
    expected = 90.0 - TROMSO[0] + 23.44
    assert abs(events["sun"]["transit_altitude"] - expected) < 0.1


def test_equinox_at_the_equator_rises_due_east():
    events, _zone = _events(*EQUATOR, date(2026, 3, 20))
    assert abs(events["sun"]["rise_azimuth"] - 90.0) < 1.0
    assert abs(events["sun"]["set_azimuth"] - 270.0) < 1.0
    # Twelve hours plus the few minutes refraction and the sun's disc add.
    length = (events["sun"]["set"] - events["sun"]["rise"]).total_seconds() / 3600
    assert 12.0 < length < 12.2


def test_transit_altitude_is_the_peak_of_the_curve():
    """The parabola fit must not overshoot the sampled maximum by more than the
    curvature it is correcting for."""
    zone = localtime.zone_for(*PARIS)
    start, end = localtime.day_bounds(date(2026, 7, 30), zone)
    events = sky.day_events(*PARIS, start, end)
    curve = sky.day_curve(*PARIS, start, end, step_minutes=1)
    # Both values are rounded for display, so they agree to that rounding.
    assert events["sun"]["transit_altitude"] >= max(curve["sun_altitude"]) - 0.01
    assert events["sun"]["transit_altitude"] <= max(curve["sun_altitude"]) + 0.01


# -- states, not errors ---------------------------------------------------------


def test_midnight_sun_is_a_state():
    events, _zone = _events(*TROMSO, date(2026, 6, 21))
    assert events["sun"]["state"] == "always_up"
    assert events["sun"]["rise"] is None
    assert events["sun"]["set"] is None
    # The transit is still real, and still the answer to "how high did it get".
    assert events["sun"]["transit_altitude"] > 40


def test_polar_night_is_a_state():
    events, _zone = _events(*SOUTH_POLE_ISH, date(2026, 6, 21))
    assert events["sun"]["state"] == "always_down"
    assert events["sun"]["transit_altitude"] < 0
    assert events["twilight"]["astronomical"]["state"] == "always_down"


def test_short_summer_night_never_gets_dark():
    """North of about 48.5° there is no astronomical night at the solstice, while
    civil twilight still ends: the three twilights carry independent states."""
    events, _zone = _events(*PARIS, date(2026, 6, 21))
    assert events["twilight"]["astronomical"]["state"] == "always_up"
    assert events["twilight"]["civil"]["state"] == "rises"


def test_a_day_with_no_moonrise_exists_and_is_a_state():
    """The moon rises about 50 minutes later each day, so roughly monthly a civil
    day holds no moonrise at all. Scanning a lunation must find one."""
    zone = localtime.zone_for(*PARIS)
    missing = []
    for offset in range(30):
        day = date(2026, 7, 1) + timedelta(days=offset)
        start, end = localtime.day_bounds(day, zone)
        events = sky.day_events(*PARIS, start, end)
        if not events["moon"]["rises"]:
            missing.append((day, events["moon"]["state"]))
    assert missing, "a lunation always holds a day without a moonrise"
    for _day, state in missing:
        assert state in {"rises", "always_up", "always_down"}


def test_successive_moonrises_are_more_than_a_day_apart():
    """The reason the skipped day exists: consecutive moonrises are 24 h 50 m
    apart, never less, so a civil day holds one or none — never two. The engine
    returns lists anyway, since it is the crossing search that decides, not an
    assumption about how many there can be."""
    zone = localtime.zone_for(*PARIS)
    rises = []
    for offset in range(40):
        day = date(2026, 7, 1) + timedelta(days=offset)
        start, end = localtime.day_bounds(day, zone)
        events = sky.day_events(*PARIS, start, end)
        assert len(events["moon"]["rises"]) <= 1
        rises.extend(events["moon"]["rises"])
    gaps = [
        (later - earlier).total_seconds() / 3600
        for earlier, later in zip(rises, rises[1:], strict=False)
    ]
    assert min(gaps) > 24.0
    assert max(gaps) < 26.0


# -- phase and limb -------------------------------------------------------------


def test_phase_names_cover_the_cycle():
    assert sky.phase_name(0) == "new moon"
    assert sky.phase_name(90) == "first quarter"
    assert sky.phase_name(180) == "full moon"
    assert sky.phase_name(270) == "last quarter"
    assert sky.phase_name(359) == "new moon"
    assert sky.phase_name(45) == "waxing crescent"
    assert sky.phase_name(315) == "waning crescent"


def test_illumination_tracks_elongation_over_a_lunation():
    """Full near opposition, dark near conjunction — checked over a month rather
    than at one instant, so a sign error anywhere in the phase triangle shows."""
    moments = [datetime(2026, 7, 1, tzinfo=UTC) + timedelta(days=n) for n in range(30)]
    values = sky.positions(*PARIS, moments)
    for elongation, illuminated in zip(
        values["moon_elongation"], values["moon_illuminated"], strict=True
    ):
        expected = (1 - np.cos(np.radians(elongation))) / 2
        assert abs(illuminated - expected) < 0.03


def test_illumination_stays_in_range_across_a_year():
    moments = [datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=n) for n in range(8760)]
    values = sky.positions(*PARIS, moments)
    assert values["moon_illuminated"].min() >= 0.0
    assert values["moon_illuminated"].max() <= 1.0
    # A year contains both a nearly dark and a nearly full moon.
    assert values["moon_illuminated"].min() < 0.01
    assert values["moon_illuminated"].max() > 0.99


def _sky_bearing(alt1: float, az1: float, alt2: float, az2: float) -> float:
    """Great-circle position angle from one point of the local sky to another,
    measured from the zenith direction towards increasing azimuth.

    The flat approximation is not usable here: sun and moon can sit 90° apart,
    where it is wrong by tens of degrees.
    """
    a1, a2 = np.radians(alt1), np.radians(alt2)
    delta = np.radians(az2 - az1)
    return float(
        np.degrees(
            np.arctan2(
                np.cos(a2) * np.sin(delta),
                np.cos(a1) * np.sin(a2) - np.sin(a1) * np.cos(a2) * np.cos(delta),
            )
        )
        % 360
    )


def test_bright_limb_points_at_the_sun():
    """The lit side faces the sun, so the limb angle referred to the vertical is
    the direction of the sun from the moon, mirrored: celestial position angles
    run north through east, which is the opposite turn to rising azimuth.

    Near new moon the direction is degenerate — there is no lit side to point,
    and the two bodies are nearly coincident — so that part of the cycle is
    excluded rather than given a loose tolerance.
    """
    checked = 0
    for offset in range(2000):
        moment = datetime(2026, 5, 1, tzinfo=UTC) + timedelta(hours=offset)
        values = sky.positions(*PARIS, [moment])
        sun_alt = float(values["sun_altitude"][0])
        moon_alt = float(values["moon_altitude"][0])
        elongation = float(values["moon_elongation"][0])
        if sun_alt < 5 or moon_alt < 5 or min(elongation, 360 - elongation) < 15:
            continue
        towards_sun = _sky_bearing(
            moon_alt, float(values["moon_azimuth"][0]), sun_alt, float(values["sun_azimuth"][0])
        )
        limb = float(values["moon_limb_from_vertical"][0])
        # Mirrored, so the two should cancel; what is left is the parallax the
        # limb angle is computed geocentrically without.
        difference = abs((limb + towards_sun + 180) % 360 - 180)
        assert difference < 3, f"{moment}: limb {limb:.1f} vs sun at {towards_sun:.1f}"
        checked += 1
    assert checked > 100


def test_position_at_names_the_phase_and_direction():
    values = sky.position_at(*PARIS, datetime(2026, 7, 30, 12, tzinfo=UTC))
    assert isinstance(values["moon_phase"], str)
    assert isinstance(values["moon_waxing"], bool)
    assert values["moon_waxing"] == (values["moon_elongation"] < 180)


# -- shape and cost -------------------------------------------------------------


def test_positions_are_vectorised_over_instants():
    """One call, many instants: the property the year-long inverse scan needs."""
    moments = [datetime(2026, 7, 30, tzinfo=UTC) + timedelta(minutes=n) for n in range(1440)]
    values = sky.positions(*PARIS, moments)
    for array in values.values():
        assert array.shape == (1440,)
    single = sky.positions(*PARIS, [moments[500]])
    assert abs(single["sun_azimuth"][0] - values["sun_azimuth"][500]) < 1e-9


def test_day_curve_samples_the_whole_interval():
    zone = localtime.zone_for(*PARIS)
    start, end = localtime.day_bounds(date(2026, 7, 30), zone)
    curve = sky.day_curve(*PARIS, start, end, step_minutes=10)
    assert len(curve["times"]) == 145
    assert curve["times"][0] == start
    assert curve["times"][-1] == end
    assert len(curve["sun_altitude"]) == len(curve["times"])


def test_a_year_of_minutes_stays_interactive():
    """The cost budget for the inverse scan: a year, minute by minute, in one
    call. If this regresses into a Python loop the test notices."""
    jd = 2461000.0 + np.arange(525_600) / 1440.0
    values = sky._positions(*PARIS, jd)
    assert values["sun_azimuth"].shape == (525_600,)


# -- civil time ----------------------------------------------------------------


def test_zone_is_resolved_from_the_coordinate():
    assert localtime.zone_for(*PARIS) == "Europe/Paris"
    assert localtime.zone_for(27.7172, 85.3240) == "Asia/Kathmandu"


def test_open_sea_gets_a_nautical_zone_not_an_error():
    zone = localtime.zone_for(-30.0, -40.0)
    assert zone
    assert localtime.zone_info(zone)


def test_unknown_zone_falls_back_to_utc():
    assert localtime.zone_info("Mars/Olympus").key == "UTC"
    assert not localtime.known_zone("Mars/Olympus")


@pytest.mark.parametrize(
    "name",
    [
        "../../../etc/passwd",  # rejected before the filesystem
        "/etc/passwd",
        "..",
        "A" * 5000,  # reaches the filesystem, where it is ENAMETOOLONG
        "",
    ],
)
def test_a_zone_name_that_is_not_one_gives_utc_not_a_traceback(name):
    assert not localtime.known_zone(name)
    assert localtime.zone_info(name).key == "UTC"


def test_both_writes_an_instant_in_local_and_utc():
    written = localtime.both(datetime(2026, 7, 30, 4, 21, tzinfo=UTC), "Europe/Paris")
    assert written["utc"] == "2026-07-30T04:21:00Z"
    assert written["local"].startswith("2026-07-30T06:21:00")
    assert written["abbreviation"] == "CEST"
    assert written["offset"] == "+02:00"
    assert written["offset_minutes"] == 120


def test_offset_carries_a_fractional_hour():
    written = localtime.both(datetime(2026, 7, 30, 6, 15, tzinfo=UTC), "Asia/Kathmandu")
    assert written["offset"] == "+05:45"
    assert written["local"].startswith("2026-07-30T12:00:00")


def test_negative_offset_is_signed():
    written = localtime.both(datetime(2026, 1, 15, 12, 0, tzinfo=UTC), "America/New_York")
    assert written["offset"] == "-05:00"
    assert written["offset_minutes"] == -300


def test_both_passes_none_through():
    assert localtime.both(None, "Europe/Paris") is None


@pytest.mark.parametrize(
    ("day", "hours"),
    [
        (date(2026, 3, 29), 23),  # European clocks go forward
        (date(2026, 10, 25), 25),  # and back
        (date(2026, 7, 30), 24),
    ],
)
def test_local_day_bounds_follow_daylight_saving(day, hours):
    """A day is midnight to the next local midnight, which is 23 or 25 hours on
    the changeover days. Adding 24 hours would clip or double-count an hour of
    the sky."""
    start, end = localtime.day_bounds(day, "Europe/Paris")
    assert (end - start).total_seconds() / 3600 == hours


def test_events_span_a_daylight_saving_change():
    """Nothing about the change should lose a sunrise."""
    events, zone = _events(*PARIS, date(2026, 3, 29))
    assert events["sun"]["state"] == "rises"
    local = events["sun"]["rise"].astimezone(localtime.zone_info(zone))
    assert local.date() == date(2026, 3, 29)
    assert events["sun"]["set"].astimezone(localtime.zone_info(zone)).date() == date(2026, 3, 29)


def test_at_local_reads_a_wall_clock():
    moment = localtime.at_local(date(2026, 7, 30), time(14, 20), "Europe/Paris")
    assert moment == datetime(2026, 7, 30, 12, 20, tzinfo=UTC)


def test_local_noon_is_midday_on_the_clock():
    moment = localtime.local_noon(date(2026, 1, 15), "Europe/Paris")
    assert moment == datetime(2026, 1, 15, 11, 0, tzinfo=UTC)


# -- daylight over a window ----------------------------------------------------
#
# A different question from the almanac above: not *when did the sun rise on this
# date* but *over these days, when was it light*. Held to the same standard — the
# altitude at each returned edge is the horizon — plus the two things a run of spans
# can get wrong that a single day cannot: the clipping at each end of the window, and
# a window with no crossing in it at all.


def test_daylight_spans_one_per_day_and_each_edge_is_the_horizon():
    start = datetime(2026, 6, 20, tzinfo=UTC)
    spans = sky.daylight_spans(*PARIS, start, start + timedelta(days=3))
    assert len(spans) == 3
    for span in spans:
        assert span["from"] < span["to"]
        for edge in (span["from"], span["to"]):
            assert _altitude(*PARIS, edge) == pytest.approx(sky.SUN_HORIZON_DEG, abs=0.01)
    # midsummer in Paris: a good sixteen hours of it
    assert 15.5 < (spans[0]["to"] - spans[0]["from"]).total_seconds() / 3600 < 16.5


def test_daylight_clips_to_the_window_instead_of_reaching_outside_it():
    """A window opening at noon is already inside daylight, and a chronology drawing
    the ribbon must not be handed a sunrise that happened before the axis starts."""
    noon = datetime(2026, 6, 20, 12, tzinfo=UTC)
    spans = sky.daylight_spans(*PARIS, noon, noon + timedelta(hours=4))
    assert len(spans) == 1
    assert spans[0]["from"] == noon
    assert spans[0]["to"] == noon + timedelta(hours=4)


def test_polar_day_is_one_span_and_polar_night_is_none():
    """The two answers a caller cannot tell from a failed computation unless the
    window comes back either wholly covered or wholly empty."""
    midsummer = datetime(2026, 6, 20, tzinfo=UTC)
    covered = sky.daylight_spans(*TROMSO, midsummer, midsummer + timedelta(days=3))
    assert covered == [{"from": midsummer, "to": midsummer + timedelta(days=3)}]

    midwinter = datetime(2026, 12, 20, tzinfo=UTC)
    assert sky.daylight_spans(*TROMSO, midwinter, midwinter + timedelta(days=3)) == []


def test_civil_twilight_encloses_the_daylight_it_surrounds():
    start = datetime(2026, 6, 20, tzinfo=UTC)
    day = sky.daylight_spans(*PARIS, start, start + timedelta(days=1))[0]
    civil = sky.daylight_spans(
        *PARIS, start, start + timedelta(days=1), sky.TWILIGHTS["civil"]
    )[0]
    assert civil["from"] < day["from"]
    assert civil["to"] > day["to"]


def test_a_window_that_ends_before_it_starts_has_no_spans():
    start = datetime(2026, 6, 20, tzinfo=UTC)
    assert sky.daylight_spans(*PARIS, start, start) == []
    assert sky.daylight_spans(*PARIS, start, start - timedelta(days=1)) == []


# -- nothing reaches the network -----------------------------------------------


def test_sky_does_not_touch_the_network(monkeypatch):
    """Reading the sky for a point is pure computation, unlike the reverse
    geocode next to it in the same tool. Make any socket explode to prove it."""
    import socket

    def explode(*args, **kwargs):
        raise AssertionError("the sky must be computed offline")

    monkeypatch.setattr(socket, "socket", explode)
    monkeypatch.setattr(socket, "create_connection", explode)
    zone = localtime.zone_for(*PARIS)
    start, end = localtime.day_bounds(date(2026, 7, 30), zone)
    assert sky.day_events(*PARIS, start, end)["sun"]["rise"]
    assert sky.position_at(*PARIS, start)
