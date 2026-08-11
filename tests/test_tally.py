"""Adding up what the case's statements say (ONTOLOGY §2, "Counting a model").

The Board lists one statement per row; this is the same narrowing added up, grouped
by what each statement is ``about``. Every test here holds one of the four rules that
make the number honest: a ruled-out statement is outside every sum, an absent count is
not one, nothing is totalled across subjects, and the words are observations rather
than objects.
"""

from azimut.engine import tally as tally_engine
from azimut.workspace import Case


def _case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _entity(client, cid, type_, label, attrs=None):
    res = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": type_, "label": label, "attrs": attrs or {}},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _link(client, cid, from_id, to_id, type_):
    res = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": from_id, "to_id": to_id, "type": type_},
    )
    assert res.status_code == 200, res.text
    return res.json()


def _claim_about(client, cid, subject_id, label, attrs):
    claim = _entity(client, cid, "claim", label, attrs)
    _link(client, cid, claim["id"], subject_id, "about")
    return claim


def _tally(client, cid, **params):
    res = client.get(f"/api/cases/{cid}/catalog/tally", params=params)
    assert res.status_code == 200, res.text
    return res.json()


def _row(body, entity_id):
    return next(row for row in body["rows"] if row["id"] == entity_id)


def _condition(row, value):
    return next(bucket for bucket in row["conditions"] if bucket["value"] == value)


# -- what a row says ----------------------------------------------------------


def test_statements_about_one_subject_add_up_per_condition(client):
    cid = _case(client, "Adding up")
    model = _entity(client, cid, "equipment-type", "T-72B3", {"category": "tank"})
    _claim_about(client, cid, model["id"], "Two burnt out", {"count": 2, "condition": "destroyed"})
    _claim_about(client, cid, model["id"], "Three more", {"count": 3, "condition": "destroyed"})
    _claim_about(client, cid, model["id"], "One hit", {"count": 1, "condition": "damaged"})

    body = _tally(client, cid)
    row = _row(body, model["id"])

    assert row["label"] == "T-72B3"
    assert row["type"] == "equipment-type"
    assert row["total"] == 6
    assert row["statements"] == 3
    assert row["counted"] == 3
    assert _condition(row, "destroyed") == {
        "value": "destroyed", "total": 5, "statements": 2, "counted": 2,
    }
    assert _condition(row, "damaged")["total"] == 1


def test_the_biggest_number_reads_first(client):
    cid = _case(client, "Ordering")
    few = _entity(client, cid, "equipment-type", "BMP-2")
    many = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, few["id"], "One", {"count": 1, "condition": "destroyed"})
    _claim_about(client, cid, many["id"], "Nine", {"count": 9, "condition": "destroyed"})

    assert [row["label"] for row in _tally(client, cid)["rows"]] == ["T-72B3", "BMP-2"]


def test_the_reading_is_not_only_for_models(client):
    """``about`` reaches every subject family, so the addition does too."""
    cid = _case(client, "Any subject")
    person = _entity(client, cid, "person", "The driver")
    _claim_about(client, cid, person["id"], "Seen twice", {"count": 2})

    row = _row(_tally(client, cid), person["id"])

    assert row["type"] == "person"
    assert row["total"] == 2


# -- a statement ruled out is outside every sum -------------------------------


def test_a_ruled_out_statement_is_counted_apart_and_never_summed(client):
    cid = _case(client, "Ruled out")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(
        client, cid, model["id"], "Held", {"count": 2, "condition": "destroyed", "confidence": "probable"},
    )
    _claim_about(
        client, cid, model["id"], "Dead", {"count": 5, "condition": "destroyed", "confidence": "refuted"},
    )

    row = _row(_tally(client, cid), model["id"])

    assert row["total"] == 2
    assert row["statements"] == 1
    assert row["refuted"] == 1
    assert _condition(row, "destroyed")["statements"] == 1
    assert [level["value"] for level in row["confidence"]] == ["probable"]


def test_a_subject_holding_only_ruled_out_statements_still_has_a_row(client):
    """Eliminating a candidate is work the case keeps, so it is reported, not dropped."""
    cid = _case(client, "All eliminated")
    model = _entity(client, cid, "equipment-type", "T-90M")
    _claim_about(client, cid, model["id"], "No", {"count": 4, "confidence": "refuted"})

    row = _row(_tally(client, cid), model["id"])

    assert row["refuted"] == 1
    assert row["total"] == 0
    assert row["statements"] == 0
    assert row["conditions"] == []


# -- an absent count is not one ----------------------------------------------


def test_a_statement_without_a_count_is_seen_and_not_counted(client):
    cid = _case(client, "Seen")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Two", {"count": 2, "condition": "destroyed"})
    _claim_about(client, cid, model["id"], "Some", {"condition": "destroyed"})

    row = _row(_tally(client, cid), model["id"])

    assert row["total"] == 2
    assert row["statements"] == 2
    assert row["counted"] == 1
    assert _condition(row, "destroyed") == {
        "value": "destroyed", "total": 2, "statements": 2, "counted": 1,
    }


def test_an_unstated_condition_is_its_own_bucket_and_reads_last(client):
    cid = _case(client, "Unstated")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Plain", {"count": 1})
    _claim_about(client, cid, model["id"], "Wrecked", {"count": 1, "condition": "destroyed"})

    row = _row(_tally(client, cid), model["id"])

    assert [bucket["value"] for bucket in row["conditions"]] == ["destroyed", ""]


def test_a_count_that_is_not_a_whole_number_is_read_as_no_count(client):
    """The field is validated on the way in, so a value past it is not one to guess at."""
    assert tally_engine._whole(3) == 3
    assert tally_engine._whole("3") == 3
    assert tally_engine._whole(3.0) == 3
    assert tally_engine._whole(2.5) is None
    assert tally_engine._whole(0) is None
    assert tally_engine._whole(-1) is None
    assert tally_engine._whole(True) is None
    assert tally_engine._whole(None) is None
    assert tally_engine._whole("") is None
    assert tally_engine._whole("two") is None


def test_a_count_that_is_not_finite_is_read_as_no_count(client):
    """A case written somewhere else must not take the reading down with it.

    The validator refuses both spellings, so these only arrive from an import or a
    database edited by hand — and there the answer is *not counted*, not a failure
    that costs the analyst every other number on the screen.
    """
    for value in ("inf", "-inf", "nan", "1e400", float("inf"), float("nan")):
        assert tally_engine._whole(value) is None


# -- nothing is totalled across subjects --------------------------------------


def test_one_statement_about_two_subjects_lands_in_both_rows(client):
    """And there is no grand total, which is exactly why: it would spend it twice."""
    cid = _case(client, "Two subjects")
    first = _entity(client, cid, "equipment-type", "T-72B3")
    second = _entity(client, cid, "equipment-type", "BMP-2")
    claim = _entity(client, cid, "claim", "Both", {"count": 2, "condition": "destroyed"})
    _link(client, cid, claim["id"], first["id"], "about")
    _link(client, cid, claim["id"], second["id"], "about")

    body = _tally(client, cid)

    assert _row(body, first["id"])["total"] == 2
    assert _row(body, second["id"])["total"] == 2
    assert body["read"] == 1
    assert "total" not in body


def test_a_statement_about_nothing_is_reported_rather_than_ignored(client):
    cid = _case(client, "About nothing")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Counted", {"count": 2})
    _entity(client, cid, "claim", "Floating", {"count": 9})

    body = _tally(client, cid)

    assert body["unattributed"] == 1
    assert body["read"] == 2
    assert [row["id"] for row in body["rows"]] == [model["id"]]


def test_only_about_groups_a_statement(client):
    """``at`` and ``cites`` say where and on what, never what it counts."""
    cid = _case(client, "Other connectors")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    place = _entity(client, cid, "place", "Crossroads", {"lat": 50.4, "lon": 30.5})
    claim = _entity(client, cid, "claim", "Two there", {"count": 2, "condition": "destroyed"})
    _link(client, cid, claim["id"], model["id"], "about")
    _link(client, cid, claim["id"], place["id"], "at")

    body = _tally(client, cid)

    assert [row["id"] for row in body["rows"]] == [model["id"]]


# -- it answers the narrowing the analyst set ---------------------------------


def test_the_filters_are_the_ones_the_board_already_sets(client):
    cid = _case(client, "Narrowed")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(
        client, cid, model["id"], "Sure", {"count": 2, "condition": "destroyed", "confidence": "certain"},
    )
    _claim_about(
        client, cid, model["id"], "Maybe", {"count": 7, "condition": "destroyed", "confidence": "possible"},
    )

    whole = _tally(client, cid)
    narrowed = _tally(client, cid, attr="confidence", value="certain")

    assert _row(whole, model["id"])["total"] == 9
    assert _row(narrowed, model["id"])["total"] == 2
    assert narrowed["read"] == 1


def test_a_type_chip_narrows_the_reading_and_never_widens_it(client):
    cid = _case(client, "Type chip")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Two", {"count": 2})

    assert _tally(client, cid, type="claim")["rows"]
    assert _tally(client, cid, type="claim,media")["read"] == 1
    empty = _tally(client, cid, type="media")
    assert empty["rows"] == []
    assert empty["read"] == 0
    assert empty["matched"] == 0


def test_a_case_with_no_statement_answers_with_nothing(client):
    cid = _case(client, "Quiet")
    _entity(client, cid, "equipment-type", "T-72B3")

    body = _tally(client, cid)

    assert body == {
        "rows": [], "read": 0, "matched": 0, "truncated": False, "unattributed": 0,
    }


# -- whether adding up would draw anything ------------------------------------


def _countable(client, cid):
    return client.get(f"/api/cases/{cid}/catalog/summary").json()["countable"]


def test_a_statement_counting_something_about_a_subject_is_countable(client):
    cid = _case(client, "Countable")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    assert _countable(client, cid) == 0

    _claim_about(client, cid, model["id"], "Two", {"count": 2, "condition": "destroyed"})

    assert _countable(client, cid) == 1


def test_a_statement_with_no_number_draws_no_line_and_is_not_counted(client):
    """*Seen, not counted* is an answer, and it is not a row of a total."""
    cid = _case(client, "No number")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Seen", {"condition": "destroyed"})

    assert _countable(client, cid) == 0


def test_a_statement_about_nothing_draws_no_line_either(client):
    cid = _case(client, "About nothing")
    _entity(client, cid, "claim", "Floating", {"count": 9})

    assert _countable(client, cid) == 0


def test_a_count_that_is_not_a_number_never_reaches_the_case(client):
    """So the only shapes the reading meets are a number or nothing at all."""
    cid = _case(client, "Not a number")
    refused = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "claim", "label": "Words", "attrs": {"count": "a few"}},
    )

    assert refused.status_code == 400
    assert "must be a number" in refused.text
    assert _countable(client, cid) == 0


def test_only_about_makes_a_statement_countable(client):
    cid = _case(client, "At only")
    place = _entity(client, cid, "place", "Crossroads", {"lat": 50.4, "lon": 30.5})
    claim = _entity(client, cid, "claim", "Two there", {"count": 2})
    _link(client, cid, claim["id"], place["id"], "at")

    assert _countable(client, cid) == 0


# -- one subject, read where that subject is ----------------------------------


def _subject_tally(client, cid, entity_id):
    res = client.get(f"/api/cases/{cid}/entities/{entity_id}/tally")
    assert res.status_code == 200, res.text
    return res.json()


def test_a_subject_adds_up_the_statements_pointing_at_it(client):
    cid = _case(client, "One subject")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Two", {"count": 2, "condition": "destroyed"})
    _claim_about(client, cid, model["id"], "One", {"count": 1, "condition": "damaged"})
    _claim_about(client, cid, model["id"], "Seen", {"condition": "destroyed"})
    _claim_about(client, cid, model["id"], "No", {"count": 9, "confidence": "refuted"})

    row = _subject_tally(client, cid, model["id"])

    assert row["label"] == "T-72B3"
    assert row["total"] == 3
    assert row["statements"] == 3
    assert row["counted"] == 2
    assert row["refuted"] == 1
    assert _condition(row, "destroyed") == {
        "value": "destroyed", "total": 2, "statements": 2, "counted": 1,
    }
    assert row["read"] == 4


def test_the_panel_and_the_board_cannot_drift(client):
    """One implementation of *what may enter a sum*, or the case holds two totals."""
    cid = _case(client, "Same rules")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(client, cid, model["id"], "Two", {"count": 2, "condition": "destroyed"})
    _claim_about(client, cid, model["id"], "Dead", {"count": 5, "confidence": "refuted"})
    _claim_about(client, cid, model["id"], "Seen", {"condition": "destroyed"})

    board = _row(_tally(client, cid), model["id"])
    panel = _subject_tally(client, cid, model["id"])

    for key in ("total", "statements", "counted", "refuted", "conditions", "confidence"):
        assert panel[key] == board[key], key


def test_the_panel_ignores_a_narrowing_set_on_another_screen(client):
    """It is a fact about the row, so it answers over the whole case."""
    cid = _case(client, "Unnarrowed")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    _claim_about(
        client, cid, model["id"], "Sure", {"count": 2, "confidence": "certain"},
    )
    _claim_about(
        client, cid, model["id"], "Maybe", {"count": 7, "confidence": "possible"},
    )

    assert _subject_tally(client, cid, model["id"])["total"] == 9


def test_only_about_counts_toward_a_subject(client):
    """A place reached by ``at`` and a source reached by ``cites`` say no numbers."""
    cid = _case(client, "Not about")
    place = _entity(client, cid, "place", "Crossroads", {"lat": 50.4, "lon": 30.5})
    claim = _entity(client, cid, "claim", "Two there", {"count": 2, "condition": "destroyed"})
    _link(client, cid, claim["id"], place["id"], "at")

    assert client.get(f"/api/cases/{cid}/entities/{place['id']}/tally").status_code == 404


def test_an_entity_no_statement_is_about_answers_404(client):
    cid = _case(client, "Nothing stated")
    model = _entity(client, cid, "equipment-type", "T-72B3")

    assert client.get(f"/api/cases/{cid}/entities/{model['id']}/tally").status_code == 404
    assert client.get(f"/api/cases/{cid}/entities/e_missing/tally").status_code == 404


def test_the_cut_is_reported_rather_than_applied_quietly(client):
    cid = _case(client, "Cut")
    model = _entity(client, cid, "equipment-type", "T-72B3")
    for index in range(3):
        _claim_about(client, cid, model["id"], f"Statement {index}", {"count": 1})

    body = tally_engine.tally(Case.open(cid), limit=2)

    assert body["read"] == 2
    assert body["matched"] == 3
    assert body["truncated"] is True
    assert _row(body, model["id"])["total"] == 2
