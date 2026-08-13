"""Derived temporal rows: Claims, media metadata and rebuild semantics."""

import pytest

from azimut.engine import timeline
from azimut.sqlite_backend import SqliteCase, convert_json_to_sqlite
from azimut.workspace import CaseError


def test_a_dated_claim_keeps_raw_syntax_and_normalized_bounds():
    rows = timeline.project_entity(
        {
            "id": "e_claim",
            "type": "claim",
            "label": "A vehicle was present",
            "attrs": {
                "when": "2026-08~",
                "time_role": "observed",
                "confidence": "probable",
            },
            "provenance": {
                "by": "user",
                "at": "2026-08-11T10:00:00Z",
                "status": "confirmed",
            },
        }
    )

    assert [row.id for row in rows] == ["temporal:claim:e_claim"]
    assert rows[0].raw == "2026-08~"
    assert rows[0].earliest == "2026-08-01T00:00:00.000000Z"
    assert rows[0].latest == "2026-09-01T00:00:00.000000Z"
    assert rows[0].approximate is True
    assert rows[0].time_role == "observed"


def test_an_undated_claim_is_projected_for_the_undated_group():
    row = timeline.project_entity(
        {
            "id": "e_claim",
            "type": "claim",
            "attrs": {},
            "provenance": {"status": "suggested", "at": "2026-08-11T10:00:00Z"},
        }
    )[0]

    assert row.raw is None
    assert row.earliest is None
    assert row.sortable is False
    assert row.status == "suggested"


def test_a_local_media_time_is_known_but_not_invented_on_the_utc_axis():
    row = timeline.project_media(
        {"taken_at": "2021-04-24T14:52:29"},
        "e_media",
    )[0]

    assert row.raw == "2021-04-24T14:52:29"
    assert row.zone == "local"
    assert row.earliest is None
    assert row.sortable is False


def test_media_dates_keep_world_time_separate_from_case_activity():
    rows = timeline.project_media(
        {
            "taken_at": "2024-02-03T10:11:12Z",
            "added_at": "2026-08-11T10:00:00Z",
            "source": {
                "upload_date": "20240204",
                "imagery_date": "2024-02",
                "fetched_at": "2026-08-11T09:59:00+00:00",
            },
        },
        "e_media",
    )
    by_kind = {row.kind: row for row in rows}

    assert by_kind["captured"].category == "media"
    assert by_kind["published"].raw == "2024-02-04"
    assert by_kind["imagery"].category == "media"
    assert by_kind["collected"].category == "case_activity"
    assert by_kind["added"].category == "case_activity"


def test_old_malformed_time_stays_visible_without_blocking_a_rebuild():
    row = timeline.project_entity(
        {
            "id": "e_old",
            "type": "claim",
            "attrs": {"when": "late summer"},
            "provenance": {"at": "2026-08-11T10:00:00Z", "status": "confirmed"},
        }
    )[0]

    assert row.raw == "late summer"
    assert row.earliest is None
    assert row.parse_error


def test_large_projection_stays_bounded_and_pages_without_duplicates(tmp_path):
    store = SqliteCase.create(tmp_path / "case.db", name="Large timeline")
    for index in range(205):
        store.add_entity(
            "claim",
            f"Event {index:03d}",
            {"when": f"2026-{index % 12 + 1:02d}-{index % 28 + 1:02d}"},
            by="user",
        )

    labels = []
    cursor = None
    while True:
        page = store.timeline_page(
            categories=["statement"], limit=37, cursor=cursor, bucket="year"
        )
        labels.extend(item["label"] for item in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert len(labels) == 205
    assert len(set(labels)) == 205
    assert page["total"] == 205
    assert page["buckets"] == [
        {
            "start": "2026",
            "count": 205,
            "categories": {"statement": 205},
            "first": "2026-01-01T00:00:00.000000Z",
            "last": "2026-12-29T00:00:00.000000Z",
        }
    ]


def _lopsided_case(tmp_path):
    """230 rows in January and 40 in July: a page off the front never reaches July."""
    store = SqliteCase.create(tmp_path / "case.db", name="Lopsided timeline")
    for index in range(230):
        store.add_entity(
            "claim", f"Jan {index:03d}", {"when": f"2026-01-{index % 28 + 1:02d}"}, by="user"
        )
    for index in range(40):
        store.add_entity(
            "claim", f"Jul {index:03d}", {"when": f"2026-07-{index % 28 + 1:02d}"}, by="user"
        )
    return store


def test_a_spread_page_samples_the_whole_window_where_a_plain_one_takes_its_front(tmp_path):
    store = _lopsided_case(tmp_path)

    front = store.timeline_page(categories=["statement"], limit=100)
    spread = store.timeline_page(categories=["statement"], limit=100, spread=True)

    assert front["total"] == spread["total"] == 270
    assert {item["earliest"][:7] for item in front["items"]} == {"2026-01"}
    # 270 rows over a 100-row page is one row in three, so the sample keeps January's
    # share of the case rather than flattening it into July's.
    assert len(spread["items"]) == 90
    assert {item["earliest"][:7] for item in spread["items"]} == {"2026-01", "2026-07"}
    assert sum(item["earliest"][:7] == "2026-07" for item in spread["items"]) == 13


def test_spread_pages_partition_the_window_without_a_repeat_or_a_gap(tmp_path):
    store = _lopsided_case(tmp_path)

    labels = []
    pages = 0
    cursor = None
    while True:
        page = store.timeline_page(
            categories=["statement"], limit=100, cursor=cursor, spread=True
        )
        labels.extend(item["label"] for item in page["items"])
        pages += 1
        cursor = page["next_cursor"]
        if cursor is None:
            break

    assert pages == 3
    assert len(labels) == len(set(labels)) == 270


def test_a_window_that_fits_the_limit_is_served_whole_and_asks_for_nothing_more(tmp_path):
    store = _lopsided_case(tmp_path)

    page = store.timeline_page(
        categories=["statement"], limit=200, spread=True, since="2026-07"
    )

    # Under the limit there is nothing to sample, so the window arrives in one page.
    assert page["total"] == 40
    assert len(page["items"]) == 40
    assert page["next_cursor"] is None


def test_a_cursor_from_the_other_kind_of_read_is_refused(tmp_path):
    store = _lopsided_case(tmp_path)

    front = store.timeline_page(categories=["statement"], limit=100)
    spread = store.timeline_page(categories=["statement"], limit=100, spread=True)

    with pytest.raises(CaseError):
        store.timeline_page(
            categories=["statement"], limit=100, cursor=front["next_cursor"], spread=True
        )
    with pytest.raises(CaseError):
        store.timeline_page(categories=["statement"], limit=100, cursor=spread["next_cursor"])


def test_json_conversion_builds_the_projection_with_the_graph(tmp_path):
    db = tmp_path / "case.db"
    convert_json_to_sqlite(
        {
            "name": "Legacy",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-02T00:00:00Z",
            "folders": [],
            "links": [],
            "entities": [
                {
                    "id": "e_claim",
                    "type": "claim",
                    "label": "Existing observation",
                    "attrs": {"when": "2026-08"},
                    "provenance": {
                        "by": "user",
                        "at": "2026-08-11T10:00:00Z",
                        "status": "confirmed",
                    },
                }
            ],
        },
        db,
    )

    item = SqliteCase.open(db).timeline_page(categories=["statement"])["items"][0]
    assert item["owner_id"] == "e_claim"
    assert item["earliest"] == "2026-08-01T00:00:00.000000Z"
