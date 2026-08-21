"""One pass of a sheet into the case: every column's mode, and the edges between them.

What the six older roads could not do between them. Each of them promoted one thing —
rows, a column's words, a column of hours, a column of row names — and none could draw an
edge, because an edge needs *two* columns and they only ever saw one. A binder's line says
*this person, in that unit, with these sources*; the case used to get the nodes and lose
the sentence.

So these guard the two layers and the seam between them: the entities each mode makes,
the edges the vocabulary allows between the columns that made them, one scope for the
whole press, and all of it or none of it.
"""

from test_sheet_bridge import add, case_links, import_sheet, make_case, post_sheet, read_sheet


def entities(case_id, entity_type):
    from azimut.api.cases import get_case

    return [e for e in get_case(case_id).list_entities() if e.get("type") == entity_type]


def links_between(case_id, verb):
    return [link for link in case_links(case_id) if link["type"] == verb]


def roster(client, case_id, **roles):
    """Two people, their units, and the pages they rest on."""
    sheet = import_sheet(
        client,
        case_id,
        "Name,Unit,Source\n"
        "Ivanov,3rd Brigade,https://example.org/a\n"
        "Petrov,3rd Brigade,\n",
        title="Roster",
    )
    if roles:
        sheet["meta"] = {**sheet["meta"], "roles": roles}
    return sheet


def send(client, case_id, sheet, **asked):
    return post_sheet(
        client, case_id, sheet["id"], "promote", sheet,
        keys=[row[0] for row in sheet["rows"]],
        **asked,
    )


def preview(client, case_id, sheet, **asked):
    return post_sheet(
        client, case_id, sheet["id"], "promote/preview", sheet,
        keys=[row[0] for row in sheet["rows"]],
        **asked,
    )


# -- the two layers, in one press ---------------------------------------------


def test_a_pass_makes_the_subject_the_values_and_the_edge_between_them(client):
    """The whole point, in one press: two people, one unit, and each person a member of
    it — where before this took three screens and drew no edge at all."""
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        addresses="Source",
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    )
    assert answer.status_code == 200, answer.text

    assert sorted(e["label"] for e in entities(case_id, "person")) == ["Ivanov", "Petrov"]
    assert [e["label"] for e in entities(case_id, "organization")] == ["3rd Brigade"]
    # One bookmark for the one page, and the page is a bookmark and never a file.
    assert [e["attrs"]["url"] for e in entities(case_id, "bookmark")] == [
        "https://example.org/a"
    ]

    unit = entities(case_id, "organization")[0]["id"]
    members = {link["from"] for link in links_between(case_id, "member-of")}
    assert members == {e["id"] for e in entities(case_id, "person")}
    assert {link["to"] for link in links_between(case_id, "member-of")} == {unit}
    assert answer.json()["joins"] == [
        {"from": "Name", "to": "Unit", "verb": "member-of", "drawn": 2, "failed": []}
    ]


def test_the_plan_counts_both_layers_and_writes_nothing(client):
    case_id = make_case(client)
    sheet = roster(client, case_id)

    plan = preview(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    )
    assert plan.status_code == 200, plan.text
    read = plan.json()

    assert [layer["mode"] for layer in read["entities"]] == ["row", "value"]
    assert read["entities"][0]["counts"]["make"] == 2, "two people"
    assert read["entities"][1]["counts"]["make"] == 1, "and the one unit both are in"
    assert read["joins"] == [{
        "from": "Name", "to": "Unit", "verb": "member-of",
        "label": "is a member of", "ratable": True, "rows": 2, "blocked": [],
    }]
    assert entities(case_id, "person") == [] and entities(case_id, "organization") == []


def test_a_pair_the_vocabulary_has_no_verb_for_is_refused_at_the_door(client):
    """The witness case. A person and a point have no verb between them, so the pair is
    never offered — and asking for one anyway is refused before anything is written,
    rather than putting a latitude on a person as a field nothing shows."""
    case_id = make_case(client)
    sheet = import_sheet(
        client, case_id, "Name,Coordinates\nIvanov,\"48.5, 35.1\"\n", title="People"
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        point="Coordinates",
    )
    assert answer.status_code == 422
    assert "no way to put a person at a place" in answer.json()["detail"]
    assert entities(case_id, "person") == []


def test_a_join_the_registry_refuses_names_the_verbs_it_allows(client):
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "part-of"}],
    )
    assert answer.status_code == 422
    detail = answer.json()["detail"]
    assert "joins a person to a organization by" in detail
    assert "member-of" in detail and "part-of" not in detail.split("by")[1]
    assert entities(case_id, "person") == []


def test_a_cell_holding_three_values_draws_three_edges(client):
    """`meta.values` already holds a meaning per word, so the fan is free."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Name,Unit\nIvanov,\"3rd Brigade, 5th Regiment, HQ\"\n",
        title="Roster",
    )
    sheet["meta"] = {**sheet["meta"], "roles": {"Unit": {"kind": "choice", "multi": ","}}}

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    )
    assert answer.status_code == 200, answer.text
    assert len(entities(case_id, "organization")) == 3
    assert answer.json()["joins"][0]["drawn"] == 3
    assert {
        link["to"] for link in links_between(case_id, "member-of")
    } == {e["id"] for e in entities(case_id, "organization")}


def test_a_row_whose_end_is_ambiguous_keeps_its_entities_and_loses_its_edges(client):
    """A name is not an identity: two units spelled the same are offered, never picked.
    The row still becomes a person — losing that too would punish it twice."""
    case_id = make_case(client)
    add(client, case_id, "organization", "3rd Brigade")
    add(client, case_id, "organization", "3rd Brigade")
    sheet = roster(client, case_id)

    plan = preview(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    ).json()
    assert plan["joins"][0]["rows"] == 0
    assert [entry["reason"] for entry in plan["joins"][0]["blocked"]] == [
        "the case holds 2 of this name", "the case holds 2 of this name",
    ]

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    )
    assert answer.status_code == 200, answer.text
    assert len(entities(case_id, "person")) == 2, "the people are still made"
    assert len(entities(case_id, "organization")) == 2, "and no third unit was minted"
    assert links_between(case_id, "member-of") == []


def test_a_second_press_adds_neither_an_entity_nor_an_edge(client):
    case_id = make_case(client)
    sheet = roster(client, case_id)
    declaration = {
        "subject": {"column": "Name", "type": "person"},
        "values": [{"column": "Unit", "type": "organization"}],
        "addresses": "Source",
        "joins": [{"from": "Name", "to": "Unit", "verb": "member-of"}],
    }

    first = send(client, case_id, sheet, **declaration)
    assert first.status_code == 200, first.text
    before = len(case_links(case_id))

    again = send(
        client, case_id, read_sheet(client, case_id, sheet["id"]), **declaration
    )
    assert again.status_code == 200, again.text
    assert len(entities(case_id, "person")) == 2
    assert len(entities(case_id, "organization")) == 1
    assert len(entities(case_id, "bookmark")) == 1
    assert len(case_links(case_id)) == before


def test_the_confidence_of_the_pass_lands_on_the_ratable_edges_and_no_others(client):
    """`member-of` is a reading the analyst can be more or less sure of; the sheet's own
    `mentions` edges are not, and a confidence on those would be an opinion nobody
    holds."""
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
        confidence=2,
    )
    assert answer.status_code == 200, answer.text
    assert [link["confidence"] for link in links_between(case_id, "member-of")] == [2, 2]
    assert all(
        link.get("confidence") is None
        for link in case_links(case_id)
        if link["type"] == "mentions"
    )


def test_a_confidence_the_vocabulary_does_not_know_is_refused(client):
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        confidence=9,
    )
    assert answer.status_code == 422
    assert "not a confidence" in answer.json()["detail"]


# -- one scope, and one refusal per confusion ---------------------------------


def test_the_scope_is_the_ticked_rows_for_every_mode(client):
    """The older column promotion read the whole table whatever was ticked, so a pass
    whose halves disagreed about scope produced a count nobody could account for."""
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = post_sheet(
        client, case_id, sheet["id"], "promote", sheet,
        keys=[sheet["rows"][0][0]],
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    )
    assert answer.status_code == 200, answer.text
    assert [e["label"] for e in entities(case_id, "person")] == ["Ivanov"]
    assert answer.json()["joins"][0]["drawn"] == 1


def test_a_column_cannot_be_both_the_subject_and_a_column_of_values(client):
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Name", "type": "organization"}],
    )
    assert answer.status_code == 422
    assert "cannot both be the subject and a column of values" in answer.json()["detail"]


def test_a_join_needs_two_columns_that_designate_something(client):
    """A column left on `ignore` designates nothing, so there is no end to draw to."""
    case_id = make_case(client)
    sheet = roster(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person"},
        joins=[{"from": "Name", "to": "Source", "verb": "member-of"}],
    )
    assert answer.status_code == 422
    assert "between two columns that designate something" in answer.json()["detail"]


def test_addresses_and_statements_need_a_subject_to_be_about(client):
    case_id = make_case(client)
    sheet = roster(client, case_id)

    without = send(client, case_id, sheet, addresses="Source")
    assert without.status_code == 422
    assert "needs the column naming what they are about" in without.json()["detail"]

    dated = send(client, case_id, sheet, statement={"when_column": "Source"})
    assert dated.status_code == 422
    assert "needs the column naming what it is about" in dated.json()["detail"]


def test_no_mode_of_this_screen_creates_anything_that_owns_a_file(client):
    """The line between the two roads is the file, not the type. A `media`, a `capture`,
    a `proof` and a `post` hold bytes; this screen holds a cell, so it does not offer
    those types at all and an address becomes a bookmark."""
    from azimut.engine import sheetpromote

    offered = set(sheetpromote.promotable_types())
    assert offered.isdisjoint({"media", "capture", "proof", "post", "inspect-session"})

    case_id = make_case(client)
    sheet = roster(client, case_id)
    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "media"},
    )
    assert answer.status_code == 422
    assert "not a type a row can become" in answer.json()["detail"]


# -- all of it, or none of it -------------------------------------------------


def test_a_sheet_that_moved_under_the_analyst_leaves_the_case_untouched(client):
    """The primitive earning its place. The entities are written, the save is then refused
    because the file moved, and the way out of the batch takes the whole graph back —
    where the older roads had to hand their ids to a compensating undo."""
    case_id = make_case(client)
    sheet = roster(client, case_id)
    stale = {**sheet, "stamp": "0-0"}

    answer = send(
        client, case_id, stale,
        subject={"column": "Name", "type": "person"},
        values=[{"column": "Unit", "type": "organization"}],
        joins=[{"from": "Name", "to": "Unit", "verb": "member-of"}],
    )
    assert answer.status_code == 409, answer.text
    assert entities(case_id, "person") == []
    assert entities(case_id, "organization") == []
    assert links_between(case_id, "member-of") == []


# -- the modes that used to be their own screens ------------------------------


def test_a_point_column_joins_the_subject_by_the_verb_the_registry_gives(client):
    """A structure is *sited at* its ground, and the verb is read out of the registry
    rather than asked for. The place is deduplicated on the coordinates themselves."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Site,Coordinates\nBridge,\"48.5, 35.1\"\nQuay,\"48.5, 35.1\"\n",
        title="Sites",
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Site", "type": "structure"},
        point="Coordinates",
    )
    assert answer.status_code == 200, answer.text
    assert len(entities(case_id, "place")) == 1, "two rows on one point pin one place"
    assert len(links_between(case_id, "sited-at")) == 2


def test_a_point_column_is_an_end_a_join_can_reach(client):
    """A point is an end like any other column's, which is the one case the sidecar cannot
    answer for: a cell holds coordinates, not the entity they became. So the row promotion
    hands back the place it filed, and a *second* column can be joined to it.

    Here the guard post stands on the ground the bridge was located on, and the analyst
    said so once for the whole column."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Site,Annex,Coordinates\nBridge,Guard post,\"48.5, 35.1\"\n",
        title="Sites",
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Site", "type": "structure"},
        values=[{"column": "Annex", "type": "structure"}],
        point="Coordinates",
        joins=[{"from": "Annex", "to": "Coordinates", "verb": "sited-at"}],
    )
    assert answer.status_code == 200, answer.text
    assert len(entities(case_id, "place")) == 1
    assert answer.json()["joins"][0]["drawn"] == 1

    place = entities(case_id, "place")[0]["id"]
    sited = {link["from"] for link in links_between(case_id, "sited-at")}
    assert sited == {e["id"] for e in entities(case_id, "structure")}
    assert {link["to"] for link in links_between(case_id, "sited-at")} == {place}


def test_a_column_the_registry_cannot_join_to_a_point_is_refused(client):
    """The other half of the same rule: the vocabulary puts a structure on the ground and
    a unit nowhere, so the pair is not offered and asking anyway is refused at the door."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Site,Unit,Coordinates\nBridge,3rd Brigade,\"48.5, 35.1\"\n",
        title="Sites",
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Site", "type": "structure"},
        values=[{"column": "Unit", "type": "organization"}],
        point="Coordinates",
        joins=[{"from": "Unit", "to": "Coordinates", "verb": "sited-at"}],
    )
    assert answer.status_code == 422
    assert "joins a organization to a place by nothing" in answer.json()["detail"]
    assert entities(case_id, "structure") == []


def test_a_column_of_hours_rides_along_as_a_statement(client):
    """The engine was already general and what was missing was the screen. So the mode is
    a passthrough, and what it proves is that the statement sees the subject the *same
    press* promoted."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Subject,Local time,Note hour\nFirst impact,01:57,the author gave me this time\n",
        title="Timeline",
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Subject", "type": "structure"},
        statement={
            "when_column": "Local time",
            "method_column": "Note hour",
            "day": "2026-01-03",
        },
    )
    assert answer.status_code == 200, answer.text
    claims = entities(case_id, "claim")
    assert len(claims) == 1
    assert claims[0]["attrs"]["when"].startswith("2026-01-03T01:57")
    subject = entities(case_id, "structure")[0]["id"]
    assert [link["to"] for link in links_between(case_id, "about")] == [subject]


def test_an_orbat_draws_its_edges_in_the_press_that_makes_its_units(client):
    """What the threading of the sidecar buys. Row-to-row edges read what a row points at,
    so this used to need two presses: promote the units, then draw the edges. In one pass
    the modes run in dependency order and the edge layer sees what the subject layer just
    wrote, so an order of battle lands in one press."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Unit,Links\n3rd Brigade,\n1st Coy,3rd Brigade\n2nd Coy,3rd Brigade\n",
        title="ORBAT",
    )
    sheet["meta"] = {**sheet["meta"], "roles": {"Links": {"kind": "row", "of": "Unit"}}}

    answer = send(
        client, case_id, sheet,
        subject={"column": "Unit", "type": "organization"},
        row_edges=[{"column": "Links", "verb": "part-of"}],
    )
    assert answer.status_code == 200, answer.text
    assert len(entities(case_id, "organization")) == 3
    brigade = next(e for e in entities(case_id, "organization") if e["label"] == "3rd Brigade")
    assert {link["to"] for link in links_between(case_id, "part-of")} == {brigade["id"]}
    assert len(links_between(case_id, "part-of")) == 2


def test_only_the_columns_mapped_onto_a_field_travel(client):
    """A worklist's private notes have no business in the case's record of a subject, so a
    column travels only where the analyst mapped it onto a declared field."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Name,Role,Private note\nIvanov,driver,do not call before Monday\n",
        title="People",
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Name", "type": "person", "fields": {"Role": "role"}},
    )
    assert answer.status_code == 200, answer.text
    attrs = entities(case_id, "person")[0]["attrs"]
    assert attrs["role"] == "driver"
    assert "do not call before Monday" not in str(attrs)


def test_the_grouped_case_stays_one_entity_with_a_point_per_row(client):
    """Two lines of one cross-border event are one thing with two places, which row by row
    is a twin nobody maintains. The mode is a case in this screen and its engine is
    untouched — what is tested here is that the pass hands it through."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Site,Coordinates\nThe crossing,\"48.5, 35.1\"\nThe crossing,\"48.6, 35.2\"\n",
        title="Crossing",
    )

    answer = send(
        client, case_id, sheet,
        subject={"column": "Site", "type": "structure", "group": True},
        point="Coordinates",
    )
    assert answer.status_code == 200, answer.text
    assert len(entities(case_id, "structure")) == 1, "one subject"
    assert len(entities(case_id, "place")) == 2, "and a place per row"
    assert len(links_between(case_id, "sited-at")) == 2


def test_a_column_of_words_becomes_one_entity_per_word_and_not_per_row(client):
    """The grain of the value mode is the word. A tracker's four hundred rows hold forty
    pieces of kit, and a mode working on rows would file `Buk-M2E, ZU23-2` as one thing
    called exactly that."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Unit,Kit\n1st Bty,\"Buk-M2E, ZU23-2\"\n2nd Bty,\"Buk-M2E, S-125\"\n",
        title="Tracker",
    )
    sheet["meta"] = {**sheet["meta"], "roles": {"Kit": {"kind": "choice", "multi": ", "}}}

    answer = send(
        client, case_id, sheet, values=[{"column": "Kit", "type": "equipment-type"}]
    )
    assert answer.status_code == 200, answer.text
    assert answer.json()["entities"][0]["counts"]["make"] == 3

    kit = sorted(e["label"] for e in entities(case_id, "equipment-type"))
    assert kit == ["Buk-M2E", "S-125", "ZU23-2"]
    # What a word means is kept per column, because a cell holding three values cannot
    # hold three links — and it is what makes the sheet mention all three.
    meant = read_sheet(client, case_id, sheet["id"])["meta"]["values"]["Kit"]
    assert set(meant) == {"Buk-M2E", "ZU23-2", "S-125"}
    mentioned = {link["to"] for link in case_links(case_id) if link["type"] == "mentions"}
    assert mentioned == set(meant.values())


def test_a_single_valued_column_also_points_its_rows_at_what_it_made(client):
    """Which is what the computed natures read: a link is per row, and a column with no
    separator has exactly one answer per cell to give them."""
    case_id = make_case(client)
    sheet = import_sheet(
        client, case_id, "Unit,Parent\n1st Coy,3rd Brigade\n2nd Coy,3rd Brigade\n"
    )

    answer = send(client, case_id, sheet, values=[{"column": "Parent", "type": "organization"}])
    assert answer.status_code == 200, answer.text
    saved = read_sheet(client, case_id, sheet["id"])
    made = entities(case_id, "organization")[0]["id"]
    assert [cells.get("Parent") for cells in saved["meta"]["links"].values()] == [made, made]


def test_a_word_the_case_holds_twice_is_offered_and_never_picked(client):
    """A name is not an identity, and the rule does not weaken because there are forty of
    them instead of one. The plan offers both and leaves the row alone."""
    case_id = make_case(client)
    add(client, case_id, "organization", "HQ")
    add(client, case_id, "organization", "HQ")
    sheet = import_sheet(client, case_id, "Unit,Parent\n1st Coy,HQ\n")

    plan = preview(client, case_id, sheet, values=[{"column": "Parent", "type": "organization"}])
    assert plan.status_code == 200, plan.text
    said = plan.json()["entities"][0]["rows"][0]
    assert said["action"] == "skip"
    assert len(said["candidates"]) == 2
    assert "holds 2" in said["reason"]


def test_a_word_attached_to_what_the_case_holds_is_never_recreated(client):
    """The half of the old *link these cells* screen that survives: the analyst answers
    the plan's question, and the answer is read on the next look."""
    case_id = make_case(client)
    held = add(client, case_id, "organization", "HQ")
    sheet = import_sheet(client, case_id, "Unit,Parent\n1st Coy,HQ\n")

    answer = send(
        client, case_id, sheet,
        values=[{"column": "Parent", "type": "organization", "attach": {"HQ": held["id"]}}],
    )
    assert answer.status_code == 200, answer.text
    assert [e["id"] for e in entities(case_id, "organization")] == [held["id"]]
    assert read_sheet(client, case_id, sheet["id"])["meta"]["values"]["Parent"] == {
        "HQ": held["id"]
    }


def test_a_place_is_made_from_coordinates_and_never_from_a_column_of_words(client):
    """A place is its coordinates, and a word has none. Which is why the type is absent
    from the value mode's own list rather than refused after it was picked."""
    case_id = make_case(client)
    sheet = import_sheet(client, case_id, "Unit,Parent\n1st Coy,HQ\n")

    answer = preview(client, case_id, sheet, values=[{"column": "Parent", "type": "place"}])
    assert answer.status_code == 422
    assert "coordinates" in answer.json()["detail"]


def test_a_group_keeps_the_first_answer_and_says_which_field_disagreed(client):
    """Rows grouped on purpose differ in the detail — that is why there are two of them —
    so refusing the group over it would refuse the shape it exists for."""
    case_id = make_case(client)
    sheet = import_sheet(
        client, case_id, "Title,Kind\nBridge strike,road bridge\nBridge strike,rail bridge\n"
    )

    plan = preview(
        client, case_id, sheet,
        subject={
            "column": "Title", "type": "structure", "fields": {"Kind": "kind"}, "group": True,
        },
    )
    assert plan.status_code == 200, plan.text
    said = plan.json()["entities"][0]["rows"]
    assert len(said) == 1 and said[0]["rows"] == 2
    assert said[0]["attrs"]["kind"] == "road bridge"
    assert said[0]["conflicts"] == ["Kind"]


def test_the_plan_of_an_orbat_draws_the_edges_the_press_will_draw(client):
    """The row-edges layer reads what a row points at, so a plan reading only the sidecar
    on disk would report both edges without an end and then the press would draw them. A
    plan the press contradicts is worse than no plan."""
    case_id = make_case(client)
    sheet = import_sheet(
        client,
        case_id,
        "Unit,Links\n3rd Brigade,\n1st Coy,3rd Brigade\n2nd Coy,3rd Brigade\n",
        title="ORBAT",
    )
    sheet["meta"] = {**sheet["meta"], "roles": {"Links": {"kind": "row", "of": "Unit"}}}
    declaration = {
        "subject": {"column": "Unit", "type": "organization"},
        "row_edges": [{"column": "Links", "verb": "part-of"}],
    }

    plan = preview(client, case_id, sheet, **declaration)
    assert plan.status_code == 200, plan.text
    edges = next(layer for layer in plan.json()["entities"] if layer["mode"] == "row-edges")
    assert edges["counts"]["make"] == 2
    assert entities(case_id, "organization") == []

    answer = send(client, case_id, sheet, **declaration)
    assert answer.status_code == 200, answer.text
    assert len(links_between(case_id, "part-of")) == 2


def test_a_row_naming_a_unit_nobody_promoted_is_said_rather_than_invented(client):
    """There is no honest way to invent the entity a name refers to at the moment an edge
    is being drawn to it — so the row that named it keeps its own entity and says why the
    edge is missing."""
    case_id = make_case(client)
    sheet = import_sheet(client, case_id, "Unit,Links\n3rd Brigade,\n1st Coy,3rd Brigade\n")
    sheet["meta"] = {**sheet["meta"], "roles": {"Links": {"kind": "row", "of": "Unit"}}}

    plan = post_sheet(
        client, case_id, sheet["id"], "promote/preview", sheet,
        keys=[sheet["rows"][1][0]],
        subject={"column": "Unit", "type": "organization"},
        row_edges=[{"column": "Links", "verb": "part-of"}],
    )
    assert plan.status_code == 200, plan.text
    edges = next(layer for layer in plan.json()["entities"] if layer["mode"] == "row-edges")
    assert [row["action"] for row in edges["rows"]] == ["skip"]
    assert "not in the case yet" in edges["rows"][0]["reason"]


def test_a_name_reaching_no_row_is_reported_and_a_verb_outside_the_two_is_refused(client):
    """A column of row names is not a column of words: it names *rows*, and a spelling
    that reaches none of them is a broken reference and not a new entity."""
    case_id = make_case(client)
    sheet = import_sheet(
        client, case_id, "Unit,Links\n3rd Brigade,\n1st Coy,3rd Bde\n", title="ORBAT"
    )
    sheet["meta"] = {**sheet["meta"], "roles": {"Links": {"kind": "row", "of": "Unit"}}}

    plan = preview(
        client, case_id, sheet,
        subject={"column": "Unit", "type": "organization"},
        row_edges=[{"column": "Links", "verb": "part-of"}],
    )
    assert plan.status_code == 200, plan.text
    edges = next(layer for layer in plan.json()["entities"] if layer["mode"] == "row-edges")
    broken = [row for row in edges["rows"] if row["action"] == "error"]
    assert broken and "no single row is called '3rd Bde'" in broken[0]["reason"]

    refused = preview(
        client, case_id, sheet,
        subject={"column": "Unit", "type": "organization"},
        row_edges=[{"column": "Links", "verb": "owns"}],
    )
    assert refused.status_code == 422


# -- a place, which is the one entity that is a number -------------------------


def index_of_points(client, case_id):
    """A geolocation index: a title, a country and the point that is the whole subject."""
    return import_sheet(
        client,
        case_id,
        "Title,Country,Coordinates\n"
        "Quai sud,A,\"48.85, 2.35\"\n"
        "Pont nord,B,\"48.90, 2.40\"\n",
        title="Index",
    )


def test_a_column_of_coordinates_promoted_as_places_is_its_own_point(client):
    """The shape a geolocation index actually has. The point *is* the entity, so asking
    which column holds the coordinates once the coordinates column is the subject is a
    question with one possible answer — and refusing the pass over it was refusing the
    ordinary case."""
    case_id = make_case(client)
    sheet = index_of_points(client, case_id)

    answer = send(client, case_id, sheet, subject={"column": "Coordinates", "type": "place"})
    assert answer.status_code == 200, answer.text
    points = sorted(
        (e["attrs"]["lat"], e["attrs"]["lon"]) for e in entities(case_id, "place")
    )
    assert points == [(48.85, 2.35), (48.9, 2.4)]


def test_a_place_is_named_by_the_column_that_is_its_subject(client):
    """And that is how a point gets a name rather than a label reading `48.85, 2.35`: the
    name column is the subject, the coordinates column is the point."""
    case_id = make_case(client)
    sheet = index_of_points(client, case_id)

    answer = send(
        client, case_id, sheet,
        subject={"column": "Title", "type": "place"},
        point="Coordinates",
    )
    assert answer.status_code == 200, answer.text
    named = {e["label"]: (e["attrs"]["lat"], e["attrs"]["lon"]) for e in entities(case_id, "place")}
    assert named == {"Quai sud": (48.85, 2.35), "Pont nord": (48.9, 2.4)}


def test_a_press_reads_the_graph_a_fixed_number_of_times_whatever_the_row_count(client, monkeypatch):
    """A walk of the whole catalog per row, inside the lock that holds every other writer.

    `_place` built its own index of the places the case holds, and it was called once per
    decision — so five hundred rows over twenty thousand entities materialised ten million
    rows while the job worker waited on `busy_timeout` and then failed. The module states the
    opposite rule everywhere else (`_labels_held` is commented "read once rather than once a
    row"); this was the exception, and it was the one in the loop.
    """
    from azimut.api.cases import get_case
    from azimut.workspace import Case

    case_id = make_case(client)
    rows = "".join(f'Point {n},"48.{80 + n}, 2.35"\n' for n in range(12))
    sheet = import_sheet(client, case_id, f"Title,Coordinates\n{rows}", title="Index")
    subject = {"column": "Title", "type": "structure"}

    walks: list[int] = []
    counting = {"on": True}
    real = Case.list_entities

    def counted(self, *args, **kwargs):
        if counting["on"]:
            walks.append(1)
        return real(self, *args, **kwargs)

    monkeypatch.setattr(Case, "list_entities", counted)
    answer = send(client, case_id, sheet, subject=subject, point="Coordinates")
    assert answer.status_code == 200, answer.text
    counting["on"] = False

    # Two: the labels the case already holds, and the places it already holds. Never a
    # third per row — the twelve rows above would have been fourteen walks.
    assert len(walks) <= 3, walks
    assert len(entities(case_id, "place")) == 12
    assert len(links_between(case_id, "sited-at")) == 12

    # And the deduplication the walk used to give is still there, including between two
    # rows of the same press: the index is added to as places are minted.
    same = import_sheet(
        client, case_id, 'Title,Coordinates\nOne,"48.99, 2.99"\nTwo,"48.99, 2.99"\n', title="Twice"
    )
    assert send(client, case_id, same, subject=subject, point="Coordinates").status_code == 200
    at_one_point = [
        e for e in get_case(case_id).list_entities()
        if e.get("type") == "place" and e["attrs"].get("lat") == 48.99
    ]
    assert len(at_one_point) == 1, "two rows at one point are one place"


def test_a_place_whose_subject_column_holds_names_still_asks_for_the_point(client):
    """The door keeps the one refusal worth keeping: a column of names is not a column of
    coordinates, and 468 rows each saying so is not an answer."""
    case_id = make_case(client)
    sheet = index_of_points(client, case_id)

    answer = send(client, case_id, sheet, subject={"column": "Title", "type": "place"})
    assert answer.status_code == 422
    assert "a place needs the column holding its coordinates" in answer.json()["detail"]
    assert entities(case_id, "place") == []
