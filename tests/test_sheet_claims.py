"""A column of hours, as dated statements about what the same press promoted.

The binders hold a reasoning about a time and not a time: an established hour, an
estimated one, the note saying how it was worked out, and — the shape nobody else has —
ten videos carrying an offset against one shot that has yet to be dated. Copied into a
`when` field that is one number and three lost columns, which is why the mode files a
Claim.

The engine is `engine/sheetclaims.py` and it was already general. What was missing was a
screen saying the hours promote here, and these run through the one that now does: the
subject column and the hours column are declared together, and the statement sees the
subject the same press just made.
"""

from test_sheet_bridge import (
    add,
    case_entities,
    case_links,
    import_sheet,
    make_case,
    post_sheet,
    read_sheet,
)


def timeline(client, case_id):
    """A timeline binder's shape: an established hour, an estimated one, the note saying
    how it was worked out, and the page it rests on."""
    return import_sheet(
        client,
        case_id,
        "Subject,Local time,Est. time,Note hour,Video\n"
        "First impact,01:57,,the author gave me this time,https://example.org/a\n"
        "Second impact,,02:05,between 02:00 and 02:10,\n"
        "Third impact,,,no idea,\n",
        title="Timeline",
    )


def date_rows(client, case_id, sheet, tail="promote", keys=None, **asked):
    """The binder's whole declaration: what a row is, and what its hours state about it."""
    return post_sheet(
        client, case_id, sheet["id"], tail, sheet,
        keys=[row[0] for row in sheet["rows"]] if keys is None else keys,
        subject={"column": "Subject", "type": "structure"},
        statement={
            "when_column": "Local time",
            "estimate_column": "Est. time",
            "method_column": "Note hour",
            "link_column": "Video",
            "day": "2026-01-03",
            **asked,
        },
    )


def statements(answer):
    """The statement layer of a pass, with its decisions under the key that layer used:
    the plan calls them `rows` and the press calls them `plan`."""
    layer = next(
        entry for entry in answer.json()["entities"] if entry["mode"] == "statement"
    )
    return {**layer, "rows": layer.get("rows") or layer.get("plan") or []}


# -- an hour, and the reasoning behind it --------------------------------------


def test_a_column_of_hours_becomes_statements_and_not_a_field(client):
    """A Claim carries what it is about, when it applies and what it rests on. A `when`
    field would carry the first of those."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)

    answer = date_rows(client, case_id, sheet, zone="Z")
    assert answer.status_code == 200, answer.text
    assert statements(answer)["counts"]["make"] == 2

    claims = {e["label"]: e for e in case_entities(case_id, "claim")}
    established = claims["First impact at 01:57"]
    assert established["attrs"]["when"] == "2026-01-03T01:57:00Z"
    assert established["attrs"]["confidence"] == "probable"
    assert established["attrs"]["time_role"] == "occurred"
    assert "the author gave me this time" in established["attrs"]["method"]
    # It is about the subject the row points at, and it cites the page the row rests on.
    edges = {(link["type"], link["from"]) for link in case_links(case_id)}
    assert ("about", established["id"]) in edges
    assert ("cites", established["id"]) in edges


def test_the_plan_sees_the_subject_the_same_press_is_about_to_make(client):
    """The screen declares both in one pass, so a plan reading only the sidecar on disk
    would report every row "not in the case yet" and then the press would file all of
    them. A plan the press contradicts is worse than no plan."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)

    plan = date_rows(client, case_id, sheet, tail="promote/preview", zone="Z")
    assert plan.status_code == 200, plan.text
    said = statements(plan)
    assert said["counts"]["make"] == 2
    assert said["rows"][0]["subject_label"] == "First impact"
    assert case_entities(case_id, "claim") == []

    answer = date_rows(client, case_id, sheet, zone="Z")
    assert answer.status_code == 200, answer.text
    assert statements(answer)["counts"] == said["counts"], "the press does what it said"


def test_an_estimate_is_recorded_one_rung_below_an_established_hour(client):
    """The binders kept two columns because the difference matters, and a promotion that
    filed both at one confidence would be the one that threw it away."""
    case_id = make_case(client)
    assert date_rows(client, case_id, timeline(client, case_id), zone="Z").status_code == 200

    estimated = next(
        e for e in case_entities(case_id, "claim") if e["label"].startswith("Second impact")
    )
    assert estimated["attrs"]["confidence"] == "possible"
    assert "estimated in 'Est. time'" in estimated["attrs"]["method"]


def test_a_note_saying_between_two_hours_becomes_an_interval(client):
    """`between 02:00 and 02:10` is a more careful statement than a point, so it beats
    one. A range of hours carries its zone because the profile can only give honest
    bounds for one that has it — asked in those words rather than reported as a parse
    failure the analyst cannot act on."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)

    without = date_rows(
        client, case_id, sheet, tail="promote/preview", keys=[sheet["rows"][1][0]],
        link_column="",
    )
    assert without.status_code == 200, without.text
    assert statements(without)["rows"][0]["reason"] == (
        "a range of hours needs the time zone this column is written in"
    )

    assert date_rows(client, case_id, sheet, zone="Z").status_code == 200
    estimated = next(
        e for e in case_entities(case_id, "claim") if e["label"].startswith("Second impact")
    )
    assert estimated["attrs"]["when"] == "2026-01-03T02:00:00Z/2026-01-03T02:10:00Z"


def test_a_row_with_no_readable_hour_is_left_alone_and_says_so(client):
    case_id = make_case(client)
    plan = date_rows(client, case_id, timeline(client, case_id), tail="promote/preview")
    assert plan.status_code == 200, plan.text
    third = statements(plan)["rows"][2]
    assert third["action"] == "skip" and third["reason"] == "no time in these columns"


def test_a_bare_clock_with_no_day_is_refused_rather_than_dated_to_today(client):
    """The date is genuinely not in the file, and inventing one would invent evidence."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    plan = date_rows(
        client, case_id, sheet, tail="promote/preview", keys=[sheet["rows"][0][0]], day="",
    )
    assert plan.status_code == 200, plan.text
    said = statements(plan)["rows"][0]
    assert said["action"] == "skip" and "not a time this can date" in said["reason"]


def test_an_hour_stays_local_unless_the_column_says_otherwise(client):
    """A column called `Local time` stamped `Z` moves the evidence by however far away
    the event happened."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    assert date_rows(client, case_id, sheet).status_code == 200
    local = next(e for e in case_entities(case_id, "claim") if e["label"].startswith("First"))
    assert local["attrs"]["when"] == "2026-01-03T01:57:00", "no zone means local, not UTC"

    again = read_sheet(client, case_id, sheet["id"])
    assert date_rows(client, case_id, again, zone="Z").status_code == 200
    utc = next(e for e in case_entities(case_id, "claim") if e["label"].startswith("First"))
    assert utc["attrs"]["when"] == "2026-01-03T01:57:00Z"


def test_dating_the_same_rows_twice_updates_the_statement(client):
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    assert date_rows(client, case_id, sheet, zone="Z").status_code == 200

    answer = date_rows(client, case_id, read_sheet(client, case_id, sheet["id"]), zone="Z")
    assert answer.status_code == 200, answer.text
    counts = statements(answer)["counts"]
    assert (counts["make"], counts["update"]) == (0, 2)
    assert len(case_entities(case_id, "claim")) == 2


def test_a_row_left_out_of_the_subject_layer_is_not_dated_either(client):
    """A Claim is a statement about something the case holds. A row the analyst took out
    of the plan is a row nothing was promoted for, so there is nothing honest to make a
    statement about — and the second half of the pass has to see the first half's
    decisions, not only its intentions."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    left_out = sheet["rows"][0][0]

    answer = post_sheet(
        client, case_id, sheet["id"], "promote", sheet,
        keys=[row[0] for row in sheet["rows"]],
        subject={"column": "Subject", "type": "structure", "skip": [left_out]},
        statement={"when_column": "Local time", "day": "2026-01-03"},
    )
    assert answer.status_code == 200, answer.text
    said = statements(answer)["rows"][0]
    assert said["key"] == left_out
    assert "not in the case yet" in said["reason"]
    assert case_entities(case_id, "claim") == []


def test_asking_for_both_a_column_of_times_and_an_anchor_is_refused(client):
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    answer = date_rows(
        client, case_id, sheet, tail="promote/preview", keys=[],
        offset_column="Local time",
    )
    assert answer.status_code == 422
    assert "either from a column of times or from an anchor" in answer.json()["detail"]


def test_a_day_written_the_binders_way_is_read_rather_than_pasted(client):
    """The API takes a day from anywhere, and `03/01/2026` pasted straight into a
    timestamp would be refused as one — with a message about the timestamp. Day-first,
    like every other date this app reads; the picker's own ISO is unambiguous either
    way."""
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    plan = date_rows(
        client, case_id, sheet, tail="promote/preview", keys=[sheet["rows"][0][0]],
        day="03/01/2026",
    )
    assert plan.status_code == 200, plan.text
    assert statements(plan)["rows"][0]["when"] == "2026-01-03T01:57:00"

    refused = date_rows(client, case_id, sheet, tail="promote/preview", keys=[], day="not a day")
    assert refused.status_code == 422


# -- an offset from an anchor --------------------------------------------------


def synchro(client, case_id, at="2026-01-03T01:57:00Z"):
    """Three videos lined up on one shot, the way a timeline binder holds them."""
    sheet = import_sheet(
        client,
        case_id,
        "Subject,start synchro\nVideo A,-00:01:50\nVideo B,00:04:04\nVideo C,\n",
        title="Synchro",
    )
    sheet["meta"]["roles"] = {"start synchro": {"kind": "offset", "anchor": "IGLA launch"}}
    sheet["meta"]["anchors"] = {"IGLA launch": {"at": at}}
    return sheet


def anchor_rows(client, case_id, sheet, tail="promote"):
    return post_sheet(
        client, case_id, sheet["id"], tail, sheet,
        keys=[row[0] for row in sheet["rows"]],
        subject={"column": "Subject", "type": "structure"},
        statement={"offset_column": "start synchro"},
    )


def test_a_dated_anchor_gives_every_offset_an_absolute_time(client):
    """Nobody else does this. Ten videos carry an offset against one shot; the moment the
    shot is dated, every one of them has a time to the second."""
    case_id = make_case(client)
    answer = anchor_rows(client, case_id, synchro(client, case_id))
    assert answer.status_code == 200, answer.text
    assert statements(answer)["counts"]["make"] == 2

    when = {e["label"]: e["attrs"]["when"] for e in case_entities(case_id, "claim")}
    assert when["Video A at -00:01:50"] == "2026-01-03T01:55:10Z"
    assert when["Video B at 00:04:04"] == "2026-01-03T02:01:04Z"


def test_an_inferred_time_is_a_statement_naming_its_anchor_and_never_a_cell(client):
    """The ontology's own rule: an inference is a Claim. A timestamp written back into a
    `when` cell would present a deduction as an observation."""
    case_id = make_case(client)
    sheet = synchro(client, case_id)
    assert anchor_rows(client, case_id, sheet).status_code == 200

    made = next(e for e in case_entities(case_id, "claim") if e["label"].startswith("Video A"))
    assert made["attrs"]["confidence"] == "probable"
    assert "IGLA launch" in made["attrs"]["method"]
    # And the cell still holds exactly what the analyst typed.
    saved = read_sheet(client, case_id, sheet["id"])
    assert saved["rows"][0][saved["columns"].index("start synchro")] == "-00:01:50"


def test_an_undated_anchor_dates_nothing_and_says_why(client):
    """Relative order is usable before that, which is why an undated anchor is a normal
    state rather than an error."""
    case_id = make_case(client)
    plan = anchor_rows(
        client, case_id, synchro(client, case_id, at=""), tail="promote/preview"
    )
    assert plan.status_code == 200, plan.text
    assert statements(plan)["rows"][0]["reason"] == "'IGLA launch' has no time yet"


# -- what a statement rests on -------------------------------------------------


def test_a_dated_statement_rests_on_the_pieces_its_row_carries(client):
    """A URL is where the claim was published; an attached screenshot is the proof of the
    hour somebody pasted into a tab. A statement rests on both."""
    case_id = make_case(client)
    shot = add(client, case_id, "media", "message.png")
    sheet = import_sheet(client, case_id, "Subject,Local time\nFirst impact,01:57\n")
    key = sheet["rows"][0][0]
    sheet["meta"]["attachments"] = {key: [shot["id"]]}

    answer = post_sheet(
        client, case_id, sheet["id"], "promote", sheet,
        keys=[key],
        subject={"column": "Subject", "type": "structure"},
        statement={"when_column": "Local time", "day": "2026-01-03"},
    )
    assert answer.status_code == 200, answer.text
    claim = case_entities(case_id, "claim")[0]["id"]
    cites = {link["to"] for link in case_links(case_id) if link["type"] == "cites"}
    assert shot["id"] in cites and claim


def test_a_citation_added_by_hand_survives_the_next_press(client):
    """A press restates what the sheet says, not what the Claim knows.

    The row's own connectors are the sheet's to reconcile — repointing a row must move
    them rather than leave the statement pointing both ways. A source the analyst added
    in the Claim's own panel is a different claim about the same statement, and nothing
    holds a removed edge: re-filing one is a new id, a new date and a new author. So the
    press restates its own and leaves theirs standing.
    """
    case_id = make_case(client)
    sheet = timeline(client, case_id)
    assert date_rows(client, case_id, sheet).status_code == 200
    claim = case_entities(case_id, "claim")[0]
    mine = add(client, case_id, "media", "screenshot.png")
    stated = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": claim["id"], "to_id": mine["id"], "type": "cites"},
    )
    assert stated.status_code == 200, stated.text

    again = date_rows(client, case_id, read_sheet(client, case_id, sheet["id"]))
    assert again.status_code == 200, again.text

    cites = [
        link
        for link in case_links(case_id)
        if link["type"] == "cites" and link["from"] == claim["id"]
    ]
    assert mine["id"] in {link["to"] for link in cites}
    assert {link["provenance"]["by"] for link in cites} == {"sheet", "user"}
