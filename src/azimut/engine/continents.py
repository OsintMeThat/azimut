"""ISO 3166-1 alpha-2 → continent, as a static table.

The continent of a saved item is never stored: it is derived from the country
code every time the saved index is read. That way correcting or extending this
table repairs every existing case at once — no migration, no re-geocoding, no
network.

The table gives one verdict per country, which is wrong for the countries that
straddle two continents: a capture in Vladivostok is not Europe. So for those
few, the point's own coordinates decide, and the table verdict is only the
fallback for a row that has none. The boundaries below are the geographic ones
(the Urals, the Ural river, the Bosphorus) traced coarsely — close enough to
file a point in the right branch of a panel, not a border survey. Countries the
UN geoscheme splits on political rather than geographic grounds (Egypt's Sinai,
Indonesian Papua, the Spanish and Portuguese Atlantic islands) keep their single
verdict.
"""

from __future__ import annotations

from bisect import bisect_left

AFRICA = "Africa"
ANTARCTICA = "Antarctica"
ASIA = "Asia"
EUROPE = "Europe"
NORTH_AMERICA = "North America"
OCEANIA = "Oceania"
SOUTH_AMERICA = "South America"

_BY_CONTINENT: dict[str, str] = {
    AFRICA: (
        "ao bf bi bj bw cd cf cg ci cm cv dj dz eg eh er et ga gh gm gn gq gw ke km "
        "ls lr ly ma mg ml mr mu mw mz na ne ng re rw sc sd sh sl sn so ss st sz td "
        "tg tn tz ug yt za zm zw"
    ),
    ANTARCTICA: "aq bv gs hm tf",
    ASIA: (
        "ae af am az bd bh bn bt cc cn cx cy ge hk id il in io iq ir jo jp kg kh kp "
        "kr kw kz la lb lk mm mn mo mv my np om ph pk ps qa sa sg sy th tj tl tm tr "
        "tw uz vn ye"
    ),
    EUROPE: (
        "ad al at ax ba be bg by ch cz de dk ee es fi fo fr gb gg gi gr hr hu ie im "
        "is it je li lt lu lv mc md me mk mt nl no pl pt ro rs ru se si sj sk sm ua "
        "va"
    ),
    NORTH_AMERICA: (
        "ag ai aw bb bl bm bq bs bz ca cr cu cw dm do gd gl gp gt hn ht jm kn ky lc "
        "mf mq ms mx ni pa pm pr sv sx tc tt us vc vg vi"
    ),
    OCEANIA: (
        "as au ck fj fm gu ki mh mp nc nf nr nu nz pf pg pn pw sb tk to tv um vu wf "
        "ws"
    ),
    SOUTH_AMERICA: "ar bo br cl co ec fk gf gy pe py sr uy ve",
}

CONTINENTS: dict[str, str] = {
    code: continent
    for continent, codes in _BY_CONTINENT.items()
    for code in codes.split()
}


# The Ural crest as longitudes read off a few latitudes, south to north: the
# divide is not a meridian, it leans east as it climbs (Yekaterinburg sits just
# inside Asia, Vorkuta stays in Europe six degrees further east).
_URAL_CREST: list[tuple[float, float]] = [
    (50.0, 61.5), (52.0, 60.0), (58.0, 59.5), (62.0, 60.0),
    (65.0, 62.5), (67.5, 65.5), (71.0, 68.0),
]


def _crest_lon(lat: float) -> float:
    """The dividing longitude at this latitude, interpolated along the crest."""
    lats = [point[0] for point in _URAL_CREST]
    i = bisect_left(lats, lat)
    if i == 0:
        return _URAL_CREST[0][1]
    if i == len(_URAL_CREST):
        return _URAL_CREST[-1][1]
    (lat0, lon0), (lat1, lon1) = _URAL_CREST[i - 1], _URAL_CREST[i]
    return lon0 + (lon1 - lon0) * (lat - lat0) / (lat1 - lat0)


def _split_ru(lat: float, lon: float) -> str:
    # Chukotka reaches past the antimeridian and comes back as a negative
    # longitude; unwrap it before comparing, or the far east reads as Europe
    if lon < -30.0:
        lon += 360.0
    return EUROPE if lon < _crest_lon(lat) else ASIA


def _split_kz(lat: float, lon: float) -> str:
    # west of the Ural river, so the two western provinces
    return EUROPE if lon < 51.5 else ASIA


def _split_tr(lat: float, lon: float) -> str:
    # East Thrace: the Bosphorus splits Istanbul, and the Dardanelles cut the
    # Gallipoli peninsula and Imbros off the Anatolian coast further south
    if lat > 40.7 and lon < 29.0:
        return EUROPE
    if lat > 40.0 and lon < 26.9:
        return EUROPE
    return ASIA


_SPLIT = {"ru": _split_ru, "kz": _split_kz, "tr": _split_tr}


def continent_for(
    code: str | None, lat: float | None = None, lon: float | None = None
) -> str | None:
    """The continent of an ISO 3166-1 alpha-2 code, or None if it isn't one.

    For a country that spans two continents the coordinates decide, when the
    point has them; otherwise the country's own verdict stands.
    """
    if not code:
        return None
    code = code.strip().lower()
    split = _SPLIT.get(code)
    if split is not None and lat is not None and lon is not None:
        return split(float(lat), float(lon))
    return CONTINENTS.get(code)
