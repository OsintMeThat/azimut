"""Sun and moon geometry for a point and a moment.

Pure computation. Nothing here reaches the network and nothing loads a data
file, so it answers offline and inside the frozen binaries — an ephemeris that
had to be downloaded on first use would break the local-first rule for a
question as ordinary as "when did the sun set".

Everything is vectorised over numpy arrays of instants. The Coordinates panel
asks for one day at ten-minute steps; the year scan behind a future Sky Clock
asks for hundreds of thousands of instants, and both go through the same code.

Accuracy, and why it is enough:

- Sun, Meeus chapter 25 (the short series): about 0.01°.
- Moon, mean elements plus the twelve longitude, five latitude and two distance
  perturbation terms of the classic truncation: about 0.03°.
- The moon's topocentric parallax, applied here, reaches 0.95° — thirty times
  the series error, and the term that actually decides a moonrise.
- One pixel of a 1080p frame at a 60° field of view spans 0.03°, and the moon's
  own disc spans 0.5°. Measurement dominates the ephemeris by a wide margin,
  which is why a heavier ephemeris would buy nothing here.

Two approximations are deliberate. Parallax is applied along the vertical as an
altitude-only correction, ignoring the up-to-11.5' tilt between the geodetic and
the geocentric vertical: that leaves under 0.01° in azimuth. And ΔT follows the
Espenak-Meeus polynomial fitted for 2005-2050, extrapolated outside it, which
costs a few seconds of ephemeris time — under 0.01° for the moon.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np

# Equatorial radius, the one the parallax of the moon is defined against.
EARTH_RADIUS_KM = 6378.14
AU_KM = 149597870.7

# Rise and set conventions. Both bodies are timed on their upper limb touching
# the apparent horizon, which is what almanacs publish. For the sun the whole
# thing is the familiar constant: 34' of refraction plus its 16' semidiameter.
# The moon's semidiameter follows its distance, so its threshold is computed
# per instant from the parallax (semidiameter = 0.2725 × parallax).
REFRACTION_DEG = -0.5667
SUN_HORIZON_DEG = -0.8333
MOON_SEMIDIAMETER_RATIO = 0.2725

# Sun-centre altitudes that define the ends of each twilight.
TWILIGHTS: dict[str, float] = {"civil": -6.0, "nautical": -12.0, "astronomical": -18.0}

# Elongation bands for the phase name, each centred on its exact moment.
_PHASE_NAMES = [
    (22.5, "new moon"),
    (67.5, "waxing crescent"),
    (112.5, "first quarter"),
    (157.5, "waxing gibbous"),
    (202.5, "full moon"),
    (247.5, "waning gibbous"),
    (292.5, "last quarter"),
    (337.5, "waning crescent"),
]

_J2000 = 2451545.0
_UNIX_EPOCH_JD = 2440587.5
# The classic lunar series is fitted to days counted from 1999-12-31 00:00 UT.
_MOON_EPOCH_OFFSET = 1.5


# -- time ----------------------------------------------------------------------


def _julian_day(times: Sequence[datetime] | np.ndarray) -> np.ndarray:
    """Julian days (UT) for aware datetimes, or for a numpy datetime64 array."""
    if isinstance(times, np.ndarray) and np.issubdtype(times.dtype, np.datetime64):
        micros = times.astype("datetime64[us]").astype("int64")
    else:
        micros = np.array(
            [
                int(
                    (
                        t.astimezone(UTC) - datetime(1970, 1, 1, tzinfo=UTC)
                    ).total_seconds()
                    * 1_000_000
                )
                for t in times
            ],
            dtype="int64",
        )
    return _UNIX_EPOCH_JD + micros / 86_400_000_000.0


def _to_datetime(jd: float) -> datetime:
    """Back to an aware UTC datetime, rounded to the second we display."""
    seconds = round((float(jd) - _UNIX_EPOCH_JD) * 86400.0)
    return datetime(1970, 1, 1, tzinfo=UTC) + timedelta(seconds=seconds)


def _delta_t(jd_ut: np.ndarray) -> np.ndarray:
    """TT − UT in seconds (Espenak-Meeus, fitted 2005-2050)."""
    t = (jd_ut - _J2000) / 365.25
    return 62.92 + 0.32217 * t + 0.005589 * t * t


def _centuries_tt(jd_ut: np.ndarray) -> np.ndarray:
    """Julian centuries of TT from J2000, the argument every series below wants."""
    return (jd_ut + _delta_t(jd_ut) / 86400.0 - _J2000) / 36525.0


def _gmst(jd_ut: np.ndarray) -> np.ndarray:
    """Greenwich mean sidereal time in degrees. Earth rotation runs on UT."""
    d = jd_ut - _J2000
    t = d / 36525.0
    theta = (
        280.46061837
        + 360.98564736629 * d
        + 0.000387933 * t * t
        - t * t * t / 38_710_000.0
    )
    return theta % 360.0


# -- ephemerides ---------------------------------------------------------------


def _sun_ecliptic(t: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Apparent geocentric longitude (deg), distance (AU), nutation argument."""
    mean_lon = 280.46646 + 36000.76983 * t + 0.0003032 * t * t
    anomaly = 357.52911 + 35999.05029 * t - 0.0001537 * t * t
    eccentricity = 0.016708634 - 0.000042037 * t - 0.0000001267 * t * t
    m = np.radians(anomaly)
    centre = (
        (1.914602 - 0.004817 * t - 0.000014 * t * t) * np.sin(m)
        + (0.019993 - 0.000101 * t) * np.sin(2 * m)
        + 0.000289 * np.sin(3 * m)
    )
    true_lon = mean_lon + centre
    true_anomaly = np.radians(anomaly + centre)
    distance = (
        1.000001018
        * (1 - eccentricity * eccentricity)
        / (1 + eccentricity * np.cos(true_anomaly))
    )
    # Ascending node of the moon's orbit: it drives both the nutation in
    # longitude applied here and the one in obliquity applied below.
    node = 125.04 - 1934.136 * t
    apparent_lon = true_lon - 0.00569 - 0.00478 * np.sin(np.radians(node))
    return apparent_lon % 360.0, distance, node


def _moon_ecliptic(t: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Geocentric ecliptic longitude, latitude (deg) and distance (km)."""
    d = t * 36525.0 + _MOON_EPOCH_OFFSET

    node = 125.1228 - 0.0529538083 * d
    inclination = 5.1454
    perigee = 318.0634 + 0.1643573223 * d
    axis = 60.2666  # Earth radii
    eccentricity = 0.054900
    anomaly = 115.3654 + 13.0649929509 * d

    sun_perihelion = 282.9404 + 4.70935e-5 * d
    sun_anomaly = 356.0470 + 0.9856002585 * d

    # Kepler, twice round: the eccentricity is small enough that a seed plus one
    # Newton step lands well inside the series' own error.
    m = np.radians(anomaly)
    ecc_anomaly = anomaly + np.degrees(
        eccentricity * np.sin(m) * (1 + eccentricity * np.cos(m))
    )
    e0 = np.radians(ecc_anomaly)
    ecc_anomaly = ecc_anomaly - (
        ecc_anomaly - np.degrees(eccentricity * np.sin(e0)) - anomaly
    ) / (1 - eccentricity * np.cos(e0))
    e1 = np.radians(ecc_anomaly)

    x = axis * (np.cos(e1) - eccentricity)
    y = axis * np.sqrt(1 - eccentricity * eccentricity) * np.sin(e1)
    radius = np.hypot(x, y)
    true_anomaly = np.degrees(np.arctan2(y, x))

    arg = np.radians(true_anomaly + perigee)
    node_r = np.radians(node)
    inc_r = np.radians(inclination)
    xe = radius * (np.cos(node_r) * np.cos(arg) - np.sin(node_r) * np.sin(arg) * np.cos(inc_r))
    ye = radius * (np.sin(node_r) * np.cos(arg) + np.cos(node_r) * np.sin(arg) * np.cos(inc_r))
    ze = radius * np.sin(arg) * np.sin(inc_r)

    lon = np.degrees(np.arctan2(ye, xe))
    lat = np.degrees(np.arctan2(ze, np.hypot(xe, ye)))

    # Perturbations, in the order of their size. The named ones are the classical
    # inequalities: evection, variation, the yearly equation, the parallactic.
    sun_lon = sun_anomaly + sun_perihelion
    moon_lon = anomaly + perigee + node
    elong = np.radians(moon_lon - sun_lon)  # D
    argl = np.radians(moon_lon - node)  # F
    ms = np.radians(sun_anomaly)
    mm = np.radians(anomaly)

    lon = (
        lon
        - 1.274 * np.sin(mm - 2 * elong)  # evection
        + 0.658 * np.sin(2 * elong)  # variation
        - 0.186 * np.sin(ms)  # yearly equation
        - 0.059 * np.sin(2 * mm - 2 * elong)
        - 0.057 * np.sin(mm - 2 * elong + ms)
        + 0.053 * np.sin(2 * elong + mm)
        + 0.046 * np.sin(2 * elong - ms)
        + 0.041 * np.sin(mm - ms)
        - 0.035 * np.sin(elong)  # parallactic
        - 0.031 * np.sin(mm + ms)
        - 0.015 * np.sin(2 * argl - 2 * elong)
        + 0.011 * np.sin(mm - 4 * elong)
    )
    lat = (
        lat
        - 0.173 * np.sin(argl - 2 * elong)
        - 0.055 * np.sin(mm - argl - 2 * elong)
        - 0.046 * np.sin(mm + argl - 2 * elong)
        + 0.033 * np.sin(argl + 2 * elong)
        + 0.017 * np.sin(2 * mm + argl)
    )
    radius = radius - 0.58 * np.cos(mm - 2 * elong) - 0.46 * np.cos(2 * elong)

    return lon % 360.0, lat, radius * EARTH_RADIUS_KM


def _obliquity(t: np.ndarray, node: np.ndarray) -> np.ndarray:
    """True obliquity of the ecliptic in degrees (Meeus 22.2, plus nutation)."""
    mean = (
        23.4392911
        - 0.0130041667 * t
        - 1.6666667e-7 * t * t
        + 5.0277778e-7 * t * t * t
    )
    return mean + 0.00256 * np.cos(np.radians(node))


def _to_equatorial(
    lon: np.ndarray, lat: np.ndarray, obliquity: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """Ecliptic to right ascension and declination, both in degrees."""
    lon_r = np.radians(lon)
    lat_r = np.radians(lat)
    eps = np.radians(obliquity)
    ra = np.degrees(
        np.arctan2(
            np.sin(lon_r) * np.cos(eps) - np.tan(lat_r) * np.sin(eps), np.cos(lon_r)
        )
    )
    dec = np.degrees(
        np.arcsin(np.sin(lat_r) * np.cos(eps) + np.cos(lat_r) * np.sin(eps) * np.sin(lon_r))
    )
    return ra % 360.0, dec


def _to_horizontal(
    hour_angle: np.ndarray, dec: np.ndarray, latitude: float
) -> tuple[np.ndarray, np.ndarray]:
    """Hour angle and declination to azimuth from north, and true altitude."""
    h = np.radians(hour_angle)
    d = np.radians(dec)
    phi = np.radians(latitude)
    altitude = np.degrees(
        np.arcsin(np.sin(phi) * np.sin(d) + np.cos(phi) * np.cos(d) * np.cos(h))
    )
    # Meeus measures azimuth from the south, westward; turn it to the compass.
    azimuth = np.degrees(
        np.arctan2(np.sin(h), np.cos(h) * np.sin(phi) - np.tan(d) * np.cos(phi))
    )
    return (azimuth + 180.0) % 360.0, altitude


def _refracted(altitude: np.ndarray) -> np.ndarray:
    """Apparent altitude: what an observer sees, given standard refraction.

    Bennett's formula, which the atmosphere only ever loosely obeys. Below the
    horizon it is held at the horizon's own value rather than diverging.
    """
    h = np.maximum(altitude, -1.0)
    minutes = 1.02 / np.tan(np.radians(h + 10.3 / (h + 5.11)))
    return altitude + minutes / 60.0


# -- positions -----------------------------------------------------------------


def _positions(lat: float, lon: float, jd_ut: np.ndarray) -> dict[str, np.ndarray]:
    t = _centuries_tt(jd_ut)
    sun_lon, sun_dist_au, node = _sun_ecliptic(t)
    moon_lon, moon_lat, moon_dist_km = _moon_ecliptic(t)
    obliquity = _obliquity(t, node)

    sun_ra, sun_dec = _to_equatorial(sun_lon, np.zeros_like(sun_lon), obliquity)
    moon_ra, moon_dec = _to_equatorial(moon_lon, moon_lat, obliquity)

    sidereal = (_gmst(jd_ut) + lon) % 360.0
    sun_ha = sidereal - sun_ra
    moon_ha = sidereal - moon_ra

    sun_az, sun_alt = _to_horizontal(sun_ha, sun_dec, lat)
    moon_az, moon_alt_geocentric = _to_horizontal(moon_ha, moon_dec, lat)

    # The correction that matters: the moon seen from the ground sits up to 0.95°
    # lower than the moon seen from the centre of the Earth.
    parallax = np.degrees(np.arcsin(EARTH_RADIUS_KM / moon_dist_km))
    moon_alt = moon_alt_geocentric - parallax * np.cos(np.radians(moon_alt_geocentric))

    # Phase: elongation first, then the phase angle from the triangle
    # sun-earth-moon, which gives the illuminated fraction.
    delta_ra = np.radians(sun_ra - moon_ra)
    sd = np.radians(sun_dec)
    md = np.radians(moon_dec)
    cos_elong = np.sin(sd) * np.sin(md) + np.cos(sd) * np.cos(md) * np.cos(delta_ra)
    elongation = np.arccos(np.clip(cos_elong, -1.0, 1.0))
    sun_dist_km = sun_dist_au * AU_KM
    phase_angle = np.arctan2(
        sun_dist_km * np.sin(elongation), moon_dist_km - sun_dist_km * cos_elong
    )
    illuminated = (1 + np.cos(phase_angle)) / 2

    # Position angle of the bright limb, from the celestial north pole; then the
    # same angle referred to the observer's vertical, which is the one a photo
    # shows. The difference is the parallactic angle.
    limb_pa = np.degrees(
        np.arctan2(
            np.cos(sd) * np.sin(delta_ra),
            np.sin(sd) * np.cos(md) - np.cos(sd) * np.sin(md) * np.cos(delta_ra),
        )
    )
    phi = np.radians(lat)
    mh = np.radians(moon_ha)
    parallactic = np.degrees(
        np.arctan2(np.sin(mh), np.tan(phi) * np.cos(md) - np.sin(md) * np.cos(mh))
    )

    return {
        "sun_azimuth": sun_az,
        "sun_altitude": sun_alt,
        "sun_apparent_altitude": _refracted(sun_alt),
        "sun_distance_km": sun_dist_km,
        "moon_azimuth": moon_az,
        "moon_altitude": moon_alt,
        "moon_apparent_altitude": _refracted(moon_alt),
        "moon_distance_km": moon_dist_km,
        "moon_parallax": parallax,
        "moon_illuminated": illuminated,
        "moon_phase_angle": np.degrees(phase_angle),
        "moon_elongation": (moon_lon - sun_lon) % 360.0,
        "moon_limb_angle": limb_pa % 360.0,
        "moon_limb_from_vertical": (limb_pa - parallactic) % 360.0,
    }


def positions(
    lat: float, lon: float, times: Sequence[datetime] | np.ndarray
) -> dict[str, np.ndarray]:
    """Sun and moon geometry at each instant, as arrays parallel to ``times``."""
    return _positions(lat, lon, _julian_day(times))


def phase_name(elongation: float) -> str:
    """Name the phase from the moon's elongation in longitude, in degrees."""
    value = elongation % 360.0
    for limit, name in _PHASE_NAMES:
        if value < limit:
            return name
    return "new moon"


def position_at(lat: float, lon: float, when: datetime) -> dict[str, Any]:
    """One instant, as plain floats, with the phase named."""
    values = positions(lat, lon, [when])
    out: dict[str, Any] = {key: float(arr[0]) for key, arr in values.items()}
    out["moon_phase"] = phase_name(out["moon_elongation"])
    out["moon_waxing"] = out["moon_elongation"] < 180.0
    return out


# -- events --------------------------------------------------------------------


def _grid(start: datetime, end: datetime, step_seconds: int) -> np.ndarray:
    span = int((end - start).total_seconds())
    steps = span // step_seconds
    offsets = np.arange(steps + 1, dtype="float64") * step_seconds
    return _julian_day([start])[0] + offsets / 86400.0


def _crossings(
    jd: np.ndarray, value: np.ndarray, refine: Any
) -> tuple[list[float], list[float]]:
    """Instants where ``value`` changes sign, split into rising and falling.

    ``value`` is altitude minus the threshold on a one-minute grid, where the
    curve is near enough to a line that a linear guess lands within a second;
    ``refine`` then re-evaluates the real function to place it exactly.
    """
    rising: list[float] = []
    falling: list[float] = []
    sign = np.sign(value)
    # A sample landing exactly on the threshold would otherwise swallow a
    # crossing; nudge it to the side the previous sample came from.
    for index in np.nonzero(sign == 0)[0]:
        sign[index] = sign[index - 1] if index > 0 else 1.0
    changes = np.nonzero(sign[:-1] != sign[1:])[0]
    for index in changes:
        moment = refine(jd[index], jd[index + 1])
        if sign[index] < 0:
            rising.append(moment)
        else:
            falling.append(moment)
    return rising, falling


def _secant(fn: Any, low: float, high: float, iterations: int = 4) -> float:
    """Place a crossing of ``fn`` bracketed by ``low``/``high`` to the second.

    False position, returning the last interpolated root rather than the middle
    of the surviving bracket: on a curve this straight one side of the bracket
    never moves, so its midpoint would sit a good ten seconds off.
    """
    f_low = fn(low)
    f_high = fn(high)
    estimate = (low + high) / 2
    for _ in range(iterations):
        if f_high == f_low:
            break
        estimate = low + (high - low) * f_low / (f_low - f_high)
        estimate = min(max(estimate, low), high)
        f_estimate = fn(estimate)
        if f_estimate == 0:
            break
        if (f_estimate < 0) == (f_low < 0):
            low, f_low = estimate, f_estimate
        else:
            high, f_high = estimate, f_estimate
    return estimate


def _extremum(jd: np.ndarray, altitude: np.ndarray) -> tuple[float, float] | None:
    """The interior peak of an altitude curve, sharpened by a parabola fit."""
    index = int(np.argmax(altitude))
    if index == 0 or index == len(altitude) - 1:
        return None
    before, peak, after = altitude[index - 1 : index + 2]
    denominator = before - 2 * peak + after
    shift = 0.0 if denominator == 0 else 0.5 * (before - after) / denominator
    step = jd[index + 1] - jd[index]
    top = peak - 0.25 * (before - after) * shift
    return float(jd[index] + shift * step), float(top)


def _state(rises: list[float], sets: list[float], above: bool) -> str:
    if rises or sets:
        return "rises"
    return "always_up" if above else "always_down"


def _before(moments: list[float], anchor: float) -> float | None:
    """The latest of ``moments`` at or before the anchor."""
    earlier = [m for m in moments if m <= anchor]
    return max(earlier) if earlier else None


def _after(moments: list[float], anchor: float) -> float | None:
    """The earliest of ``moments`` at or after the anchor."""
    later = [m for m in moments if m >= anchor]
    return min(later) if later else None


# How far past the civil day the search runs. A sunset or the end of a twilight
# belongs to the evening of its date even when it falls after local midnight,
# which is routine in summer at high latitude and for astronomical twilight in
# temperate ones. Eight hours covers both ends.
_EVENING_MARGIN = timedelta(hours=8)


def day_events(
    lat: float, lon: float, start: datetime, end: datetime
) -> dict[str, Any]:
    """Rises, sets, transits and twilights for one local day of UTC instants.

    ``start`` and ``end`` bound the local day the caller cares about; a day is
    a civil notion, so working out those two instants belongs to the caller (see
    ``engine.localtime``) and this stays pure geometry.

    Solar events are paired around that day's culmination, the way an almanac
    pairs them: the morning event is the last one before the sun's transit, the
    evening event the first one after it. Picking "first and last inside the civil
    day" instead would report this evening's dusk as tomorrow's and, once past
    midnight, hand back yesterday's. Lunar events have no such anchor, so they
    are simply the ones falling on the date, as a list.

    Polar day and night, and the days on which the moon does not rise, come back
    as a ``state`` on the body rather than as a missing value or an error: they
    are answers, and at high latitude they are the usual answer.
    """
    # One grid, wide enough for the evening overflow; the state of the day is
    # then read from the civil-day slice of it alone, so a day inside the polar
    # day is never called "rises" because a neighbouring day has a sunrise.
    jd = _grid(start - _EVENING_MARGIN, end + _EVENING_MARGIN, 60)
    day_start = _julian_day([start])[0]
    day_end = _julian_day([end])[0]
    inside = (jd >= day_start) & (jd <= day_end)

    values = _positions(lat, lon, jd)
    sun_alt = values["sun_altitude"]
    moon_alt = values["moon_altitude"]
    # The moon's threshold rides its distance, so it is an array, not a constant.
    moon_horizon = REFRACTION_DEG - MOON_SEMIDIAMETER_RATIO * values["moon_parallax"]

    def sun_offset(threshold: float) -> Any:
        return lambda point: float(
            _positions(lat, lon, np.array([point]))["sun_altitude"][0] - threshold
        )

    def moon_offset(point: float) -> float:
        one = _positions(lat, lon, np.array([point]))
        limit = REFRACTION_DEG - MOON_SEMIDIAMETER_RATIO * float(one["moon_parallax"][0])
        return float(one["moon_altitude"][0] - limit)

    def azimuth_at(moment: float, body: str) -> float:
        return float(_positions(lat, lon, np.array([moment]))[body][0])

    def within_day(moments: list[float]) -> list[float]:
        return [m for m in moments if day_start <= m <= day_end]

    transit = _extremum(jd[inside], sun_alt[inside])
    anchor = transit[0] if transit else (day_start + day_end) / 2

    def solar_pair(threshold: float) -> tuple[float | None, float | None, str]:
        fn = sun_offset(threshold)
        rising, falling = _crossings(
            jd, sun_alt - threshold, lambda low, high: _secant(fn, low, high)
        )
        state = _state(
            within_day(rising),
            within_day(falling),
            bool(sun_alt[inside][0] > threshold),
        )
        if state != "rises":
            return None, None, state
        return _before(rising, anchor), _after(falling, anchor), state

    rise, set_, sun_state = solar_pair(SUN_HORIZON_DEG)
    sun: dict[str, Any] = {
        "rise": _to_datetime(rise) if rise else None,
        "rise_azimuth": round(azimuth_at(rise, "sun_azimuth"), 1) if rise else None,
        "set": _to_datetime(set_) if set_ else None,
        "set_azimuth": round(azimuth_at(set_, "sun_azimuth"), 1) if set_ else None,
        "transit": _to_datetime(transit[0]) if transit else None,
        "transit_altitude": round(transit[1], 2) if transit else None,
        "state": sun_state,
    }

    twilight: dict[str, Any] = {}
    for name, threshold in TWILIGHTS.items():
        dawn, dusk, state = solar_pair(threshold)
        twilight[name] = {
            "dawn": _to_datetime(dawn) if dawn else None,
            "dusk": _to_datetime(dusk) if dusk else None,
            "state": state,
        }

    moon_rises, moon_sets = _crossings(
        jd, moon_alt - moon_horizon, lambda low, high: _secant(moon_offset, low, high)
    )
    moon_rises = within_day(moon_rises)
    moon_sets = within_day(moon_sets)
    moon_transit = _extremum(jd[inside], moon_alt[inside])
    moon: dict[str, Any] = {
        # Whether a date holds one event, two or none is what the crossing search
        # finds, not something assumed here, so these stay lists.
        "rises": [_to_datetime(m) for m in moon_rises],
        "rise_azimuths": [round(azimuth_at(m, "moon_azimuth"), 1) for m in moon_rises],
        "sets": [_to_datetime(m) for m in moon_sets],
        "set_azimuths": [round(azimuth_at(m, "moon_azimuth"), 1) for m in moon_sets],
        "transit": _to_datetime(moon_transit[0]) if moon_transit else None,
        "transit_altitude": round(moon_transit[1], 2) if moon_transit else None,
        "state": _state(
            moon_rises, moon_sets, bool(moon_alt[inside][0] > moon_horizon[inside][0])
        ),
    }
    return {"sun": sun, "twilight": twilight, "moon": moon}


def daylight_spans(
    lat: float,
    lon: float,
    start: datetime,
    end: datetime,
    threshold: float = SUN_HORIZON_DEG,
    step_minutes: int = 1,
) -> list[dict[str, datetime]]:
    """The stretches of a window during which the sun stands above ``threshold``.

    ``day_events`` above answers *when did the sun rise on this date*, which is an
    almanac's question and is paired around one culmination. This answers a different
    one: *over these days, when was it light* — a run of spans clipped to the window,
    for a chronology that needs to place a timestamp against the daylight at the spot
    it claims.

    A span open at either edge is clipped to the window rather than reaching outside
    it, and a window with no crossing at all is one span or none: polar day and polar
    night are answers here too, and the caller cannot tell them apart from a missing
    computation unless the whole window comes back covered or empty.
    """
    if end <= start:
        return []
    jd = _grid(start, end, max(1, step_minutes) * 60)
    altitude = _positions(lat, lon, jd)["sun_altitude"]

    def offset(point: float) -> float:
        return float(_positions(lat, lon, np.array([point]))["sun_altitude"][0] - threshold)

    rising, falling = _crossings(
        jd, altitude - threshold, lambda low, high: _secant(offset, low, high)
    )
    first = _julian_day([start])[0]
    last = _julian_day([end])[0]
    edges = sorted(
        [(point, True) for point in rising] + [(point, False) for point in falling]
    )
    spans: list[dict[str, datetime]] = []
    # Where the window opens decides whether the first edge closes a span or opens
    # one: a window starting at noon is inside daylight before anything crosses.
    open_at: float | None = first if bool(altitude[0] > threshold) else None
    for point, is_rise in edges:
        if is_rise:
            if open_at is None:
                open_at = point
        elif open_at is not None:
            spans.append({"from": _to_datetime(open_at), "to": _to_datetime(point)})
            open_at = None
    if open_at is not None:
        spans.append({"from": _to_datetime(open_at), "to": _to_datetime(last)})
    return spans


def day_curve(
    lat: float, lon: float, start: datetime, end: datetime, step_minutes: int = 10
) -> dict[str, Any]:
    """Sampled altitude and azimuth tracks, for the chart of a day."""
    jd = _grid(start, end, step_minutes * 60)
    values = _positions(lat, lon, jd)
    return {
        "times": [_to_datetime(point) for point in jd],
        "sun_altitude": [round(v, 3) for v in values["sun_altitude"].tolist()],
        "sun_azimuth": [round(v, 2) for v in values["sun_azimuth"].tolist()],
        "moon_altitude": [round(v, 3) for v in values["moon_altitude"].tolist()],
        "moon_azimuth": [round(v, 2) for v in values["moon_azimuth"].tolist()],
        "moon_illuminated": [round(v, 4) for v in values["moon_illuminated"].tolist()],
    }
