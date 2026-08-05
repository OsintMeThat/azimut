"""Approximate places (ONTOLOGY §2): a radius, a footprint, and how they got there.

The rules under test come from Darwin Core, which settled this for biodiversity
records two decades ago: the radius is the smallest circle containing the whole
location, **zero is not a valid radius** because empty already means unknown, and
the source's own wording outlives every reinterpretation of it.

The other half is that none of it is required. A place saved the way Satellite has
always saved one stays valid and complete, and an absent radius is a state rather
than a gap to fill.
"""

import pytest

from azimut.engine import entities
from azimut.workspace import Case, CaseError


def _new_case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _place(client, cid, **attrs):
    res = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "place", "label": "Quay 4", "attrs": {"lat": 53.44, "lon": 14.55, **attrs}},
    )
    return res


def _patch(client, cid, eid, attrs):
    return client.patch(f"/api/cases/{cid}/entities/{eid}", json={"attrs": attrs})


# -- nothing is required ------------------------------------------------------


def test_a_place_without_precision_is_still_valid(client):
    """The rule the whole feature answers to: today's saved place is unchanged."""
    cid = _new_case(client, "Plain place")

    res = _place(client, cid)

    assert res.status_code == 200, res.text
    assert "radius_m" not in res.json()["attrs"]


def test_clearing_a_field_is_how_unknown_is_written(client):
    """Refusing an empty value would make "I do not know how precise this is"
    impossible to say, which is the state most places are actually in."""
    cid = _new_case(client, "Cleared radius")
    eid = _place(client, cid, radius_m=100).json()["id"]

    assert _patch(client, cid, eid, {"radius_m": None}).status_code == 200
    assert _patch(client, cid, eid, {"verbatim": ""}).status_code == 200


# -- the radius ---------------------------------------------------------------


def test_a_radius_records_the_smallest_enclosing_circle(client):
    cid = _new_case(client, "Approximate place")

    res = _place(
        client, cid,
        radius_m=500,
        verbatim="près du vieux port, côté nord",
        method="roofline matched against Esri imagery 2023-06",
    )

    assert res.status_code == 200, res.text
    attrs = res.json()["attrs"]
    assert attrs["radius_m"] == 500
    # the source's own wording, unaltered: the field people wish they had kept
    assert attrs["verbatim"] == "près du vieux port, côté nord"
    assert attrs["method"].startswith("roofline matched")
    # and the tool's own keys are untouched by any of it
    assert attrs["lat"] == 53.44


def test_zero_is_not_a_valid_radius(client):
    """Darwin Core's rule, and the reason for it: empty means *unknown*, where `0`
    would claim infinite precision. They are different states and both are needed."""
    cid = _new_case(client, "Zero radius")

    assert _place(client, cid, radius_m=0).status_code == 400
    assert _place(client, cid, radius_m=-50).status_code == 400


def test_a_radius_must_be_a_finite_number(client):
    cid = _new_case(client, "Odd radius")

    assert _place(client, cid, radius_m="500").status_code == 400
    # True is an int in Python, and `True` metres is not a radius
    assert _place(client, cid, radius_m=True).status_code == 400
    assert _place(client, cid, radius_m=entities.MAX_RADIUS_M + 1).status_code == 400


def test_an_infinite_radius_cannot_sneak_in_as_a_json_literal(client):
    """`json.dumps` refuses `inf`, so no ordinary client can send one — but
    `json.loads` *accepts* the non-standard `Infinity` literal, which is how it would
    actually arrive. Hence the finiteness check, tested through the real path."""
    cid = _new_case(client, "Infinite radius")

    res = client.post(
        f"/api/cases/{cid}/entities",
        content='{"type":"place","label":"Quay 4","attrs":{"radius_m":Infinity}}',
        headers={"content-type": "application/json"},
    )

    assert res.status_code == 400, res.text


def test_the_rungs_are_served_with_the_field(client):
    """Metres are the right thing to store and the wrong thing to ask for, so the
    ladder ships with the registry — one source for the picker and the validator."""
    rows = {row["type"]: row for row in client.get("/api/cases/entity-types").json()}
    radius = next(a for a in rows["place"]["attrs"] if a["key"] == "radius_m")

    assert [rung["value"] for rung in radius["rungs"]] == [25, 100, 500, 2000, 10000]
    assert radius["minimum"] == 1
    assert radius["maximum"] == entities.MAX_RADIUS_M
    # every rung is a value the API would accept
    for rung in radius["rungs"]:
        assert radius["minimum"] <= rung["value"] <= radius["maximum"]


def test_the_ladder_is_not_derived_from_plus_code_lengths():
    """Why the rungs are the input rather than the output: valid Plus Code lengths
    jump from 8 (~280 m cells) straight to 6 (~5.6 km), and 300 m to 5 km is exactly
    the band a live geolocation lives in. Two rungs sit inside that hole."""
    values = [value for _, value in entities.PRECISION_RUNGS]

    assert sorted(values) == values, "coarsest reading last"
    assert [v for v in values if 280 < v < 5600] == [500, 2000]


# -- the footprint ------------------------------------------------------------


def test_a_footprint_holds_a_polygon_when_a_circle_is_the_wrong_shape(client):
    cid = _new_case(client, "Footprint place")
    ring = [[14.55, 53.44], [14.56, 53.44], [14.56, 53.45], [14.55, 53.44]]

    res = _place(client, cid, footprint={"type": "Polygon", "coordinates": [ring]})

    assert res.status_code == 200, res.text
    assert res.json()["attrs"]["footprint"]["type"] == "Polygon"


def test_a_footprint_must_be_an_area(client):
    """A point is what lat/lon plus a radius already says, so a footprint that is
    not an area carries no information the place did not have."""
    cid = _new_case(client, "Not an area")

    assert _place(
        client, cid, footprint={"type": "Point", "coordinates": [14.55, 53.44]}
    ).status_code == 400
    assert _place(
        client, cid,
        footprint={"type": "LineString", "coordinates": [[14.55, 53.44], [14.56, 53.45]]},
    ).status_code == 400
    assert _place(
        client, cid, footprint={"type": "Polygon", "coordinates": [[[14.55, 53.44]]]}
    ).status_code == 400


def test_a_footprint_is_refused_off_the_globe_or_malformed(client):
    cid = _new_case(client, "Bad footprint")

    def post(footprint):
        return _place(client, cid, footprint=footprint).status_code

    assert post("POLYGON((0 0))") == 400
    assert post({"type": "Polygon"}) == 400
    assert post({"type": "Polygon", "coordinates": []}) == 400
    # lon then lat, and both on the globe
    assert post({"type": "Polygon", "coordinates": [[[200, 0], [1, 1], [2, 2], [200, 0]]]}) == 400
    assert post({"type": "Polygon", "coordinates": [[[0, 91], [1, 1], [2, 2], [0, 91]]]}) == 400
    assert post({"type": "Polygon", "coordinates": [[[0], [1, 1], [2, 2], [0]]]}) == 400


def test_a_footprint_is_bounded_in_size_and_depth(client):
    """Validate at the edge: past a few thousand vertices this is a payload rather
    than a shape, and nesting must not be a way around the count."""
    cid = _new_case(client, "Huge footprint")
    huge = [[0.001 * i, 0.001 * i] for i in range(entities.MAX_FOOTPRINT_POINTS + 2)]

    assert _place(client, cid, footprint={"type": "Polygon", "coordinates": [huge]}).status_code == 400

    deep = {"type": "Polygon", "coordinates": [[[[[[[0, 0]]]]]]]}
    assert _place(client, cid, footprint=deep).status_code == 400


# -- what validation does and does not reach ----------------------------------


def test_a_tools_own_keys_are_never_judged():
    """Only declared fields are checked. `notes`, `geo`, `plus_code` and the rest
    belong to the save that made the point, so this stays additive: no write that
    worked yesterday can start failing."""
    entities.check_attrs("place", {"notes": 42, "geo": {"state": "ok"}, "zoom": "seventeen"})


def test_an_undeclared_type_is_not_judged_either():
    entities.check_attrs("cuneiform-tablet", {"radius_m": 0})


def test_a_declared_url_must_be_http(client):
    """A declared url is rendered as a link, so the scheme is checked at the edge
    rather than trusted."""
    cid = _new_case(client, "Account url")

    def account(url):
        return client.post(
            f"/api/cases/{cid}/entities",
            json={"type": "account", "label": "@x", "attrs": {"url": url}},
        ).status_code

    assert account("https://example.org/x") == 200
    assert account("javascript:alert(1)") == 400
    assert account("ftp://example.org/x") == 400


def test_the_engine_raises_rather_than_returning_a_verdict():
    with pytest.raises(CaseError, match="at least 1"):
        entities.check_attrs("place", {"radius_m": 0})


def test_every_editor_kind_is_used_by_some_field():
    """A kind nothing declares is an editor no screen can reach. `date` is absent on
    purpose until the claim node's EDTF needs it."""
    used = {attr.kind for entry in entities.ENTITY_TYPES for attr in entry.attrs}

    assert used == set(entities.ATTR_KINDS)


# -- the update path ----------------------------------------------------------


def test_precision_can_be_added_to_a_place_that_already_exists(client):
    """The real workflow: a point is saved precisely, then the analyst admits it is
    a guess. A partial patch must not disturb the geometry the tool wrote."""
    cid = _new_case(client, "Later admission")
    eid = _place(client, cid).json()["id"]

    res = _patch(client, cid, eid, {"radius_m": 2000, "method": "caption only"})

    assert res.status_code == 200, res.text
    attrs = Case.open(cid).get_entity(eid)["attrs"]
    assert attrs["radius_m"] == 2000
    assert attrs["lat"] == 53.44 and attrs["lon"] == 14.55


def test_a_bad_patch_is_a_bad_request_not_a_missing_entity(client):
    cid = _new_case(client, "Bad patch")
    eid = _place(client, cid).json()["id"]

    assert _patch(client, cid, eid, {"radius_m": 0}).status_code == 400
    assert _patch(client, cid, "e_ghost", {"radius_m": 100}).status_code == 404


# -- reaching the map ---------------------------------------------------------


def test_the_saved_index_carries_the_precision_to_the_map(client):
    """The point of storing it: the overlay draws the circle, and it reads the saved
    index rather than fetching each place. So precision that never reaches this row
    is precision no analyst ever sees."""
    cid = _new_case(client, "Index precision")
    eid = _place(client, cid).json()["id"]
    _patch(client, cid, eid, {"radius_m": 2000})

    row = next(
        r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["id"] == eid
    )

    assert row["radius_m"] == 2000
    assert row["footprint"] is None


def test_a_footprint_reaches_the_index_whole(client):
    """A traced shape says more than the circle around it, so the overlay gets the
    geometry itself and not a bounding radius computed here."""
    cid = _new_case(client, "Index footprint")
    ring = [[14.55, 53.44], [14.56, 53.44], [14.56, 53.45], [14.55, 53.44]]
    eid = _place(client, cid, footprint={"type": "Polygon", "coordinates": [ring]}).json()["id"]

    row = next(
        r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["id"] == eid
    )

    assert row["footprint"] == {"type": "Polygon", "coordinates": [ring]}


def test_a_place_with_no_precision_states_none_in_the_index(client):
    """Absent is a state and travels as one: the overlay draws a plain pin for it,
    which is how every place saved before this feature must keep rendering."""
    cid = _new_case(client, "Index plain")
    eid = _place(client, cid).json()["id"]

    row = next(
        r for r in client.get(f"/api/cases/{cid}/satellite/index").json() if r["id"] == eid
    )

    assert row["radius_m"] is None and row["footprint"] is None
