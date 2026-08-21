"""A sheet built out of the proofs the case already holds, and kept level with them.

The `geoloc` template and this shape carry almost the same columns and run in opposite
directions, which is the confusion these tests exist to prevent. The template is
**incoming**: addresses pasted in, pressed, downloaded, turned into proofs. This is
**outgoing**: proofs the case already established, laid out as a table to read, filter
and export. One holds the text of URLs, the other holds links to entities.

What each test is really guarding:

- one row per proof, and three links on it, so every proof, media and place is reachable
  from the sheet and the sheet from each of them;
- an incomplete proof still gets its row — a proof nobody placed is information, not an
  error, and dropping it would let the build decide which proofs count;
- the coordinates come off the graph on every read, so the sheet never holds a stale
  copy of a place somebody moved;
- pressing refresh adds and never removes, because the notes on a row are the analyst's;
- a proof deleted afterwards leaves its row standing and says so in `In case`, which is
  the one thing the ordinary dead-link sweep cannot express.
"""

from azimut.engine import sheetfromcase as fromcase_engine

from test_sheet_bridge import add, make_case, post_sheet, read_sheet


def get_case_(case_id):
    from azimut.api.cases import get_case

    return get_case(case_id)


def link(case_id, from_id, to_id, type_):
    get_case_(case_id).add_link(from_id, to_id, type_, by="test")


def a_proof(client, case_id, label, *, media=None, place=None):
    """A proof, and the two edges the outgoing shape reads off it."""
    proof = add(client, case_id, "proof", label)["id"]
    if media:
        link(case_id, proof, media, "derived-from")
    if place:
        link(case_id, proof, place, "depicts")
    return proof


def build(client, case_id, title="My geolocations"):
    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": title, "shape": "proofs"},
    )
    assert made.status_code == 200, made.text
    return made.json()


COLUMNS = ["id", "Title", "Source media", "Place", "Coordinates", "In case", "Status", "Notes"]


# -- the shape ----------------------------------------------------------------


def test_one_row_per_proof_carrying_its_media_and_its_place(client):
    case_id = make_case(client)
    media = add(client, case_id, "media", "GX010234")["id"]
    place = add(client, case_id, "place", "Rooftop", lat=47.1, lon=37.5)["id"]
    proof = a_proof(client, case_id, "Rooftop shot", media=media, place=place)

    made = build(client, case_id)
    assert made["taken"] == 1 and made["total"] == 1

    sheet = read_sheet(client, case_id, made["id"])
    assert sheet["columns"] == COLUMNS
    assert sheet["rows"][0][1:4] == ["Rooftop shot", "GX010234", "Rooftop"]
    # Filled off the graph rather than copied in by hand, which is what keeps it true.
    assert sheet["rows"][0][4] == "47.10000, 37.50000"
    assert sheet["rows"][0][5] == "YES"
    # Every line is a proof that exists: `to do` on all of them would be a lie.
    assert sheet["rows"][0][6] == "done"

    key = sheet["rows"][0][0]
    assert sheet["meta"]["links"][key] == {
        "Title": proof,
        "Source media": media,
        "Place": place,
    }
    assert sheet["meta"]["built"][key] == proof
    assert sheet["meta"]["progress"] == "Status"


def test_the_three_case_columns_are_the_apps_and_the_two_work_columns_are_not(client):
    case_id = make_case(client)
    a_proof(client, case_id, "Rooftop shot")

    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    roles = sheet["meta"]["roles"]
    assert roles["Title"]["kind"] == "locked"
    assert roles["Source media"]["kind"] == "locked"
    assert roles["Place"]["kind"] == "locked"
    assert roles["Coordinates"] == {"kind": "computed", "of": "point", "from": "Place"}
    assert roles["In case"]["of"] == "in_case"
    assert roles["Status"]["kind"] == "state"
    # The analyst's own two carry no role the app writes through.
    assert "Notes" not in roles


def test_a_proof_with_no_place_still_gets_its_row(client):
    case_id = make_case(client)
    media = add(client, case_id, "media", "GX010234")["id"]
    a_proof(client, case_id, "Unplaced", media=media)

    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    assert sheet["rows"][0][1:5] == ["Unplaced", "GX010234", "", ""]
    key = sheet["rows"][0][0]
    assert "Place" not in sheet["meta"]["links"][key]


def test_a_proof_with_no_media_still_gets_its_row(client):
    case_id = make_case(client)
    place = add(client, case_id, "place", "Rooftop", lat=47.1, lon=37.5)["id"]
    a_proof(client, case_id, "Sourceless", place=place)

    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    assert sheet["rows"][0][1:5] == ["Sourceless", "", "Rooftop", "47.10000, 37.50000"]
    key = sheet["rows"][0][0]
    assert "Source media" not in sheet["meta"]["links"][key]


def test_a_proof_on_several_medias_takes_one_and_the_same_one_twice(client):
    case_id = make_case(client)
    proof = add(client, case_id, "proof", "Many sources")["id"]
    # Filed in an order that is not the label order, so a build reading insertion order
    # would answer differently from one reading the labels.
    for label in ("zulu.mp4", "alpha.mp4", "mike.mp4"):
        link(case_id, proof, add(client, case_id, "media", label)["id"], "derived-from")

    first = read_sheet(client, case_id, build(client, case_id, "One")["id"])
    second = read_sheet(client, case_id, build(client, case_id, "Two")["id"])
    assert first["rows"][0][2] == "alpha.mp4"
    assert second["rows"][0][2] == "alpha.mp4"


def test_rows_are_ordered_by_the_proofs_label(client):
    case_id = make_case(client)
    for label in ("Zulu", "Alpha", "Mike"):
        a_proof(client, case_id, label)

    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    assert [row[1] for row in sheet["rows"]] == ["Alpha", "Mike", "Zulu"]


def test_the_sheet_mentions_the_proof_the_media_and_the_place(client):
    case_id = make_case(client)
    media = add(client, case_id, "media", "GX010234")["id"]
    place = add(client, case_id, "place", "Rooftop", lat=47.1, lon=37.5)["id"]
    proof = a_proof(client, case_id, "Rooftop shot", media=media, place=place)

    sheet_id = build(client, case_id)["id"]
    mentioned = {
        str(edge["to"])
        for edge in get_case_(case_id).list_links()
        if edge["type"] == "mentions" and str(edge["from"]) == sheet_id
    }
    assert mentioned == {proof, media, place}


def test_the_generic_shape_is_untouched(client):
    case_id = make_case(client)
    add(client, case_id, "person", "Ivanov", role="driver")

    made = client.post(
        f"/api/cases/{case_id}/sheets/from-case",
        json={"title": "People", "type": "person", "fields": ["role"]},
    )
    assert made.status_code == 200, made.text
    sheet = read_sheet(client, case_id, made.json()["id"])
    assert sheet["columns"] == ["id", "Name", "Role", "Status", "Notes"]


def test_a_generic_build_still_needs_a_type(client):
    case_id = make_case(client)
    refused = client.post(f"/api/cases/{case_id}/sheets/from-case", json={"title": "Nothing"})
    assert refused.status_code == 422


# -- kept level with the case -------------------------------------------------


def test_refresh_files_the_proofs_added_since_the_build(client):
    case_id = make_case(client)
    a_proof(client, case_id, "Alpha")
    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    a_proof(client, case_id, "Bravo")

    answer = post_sheet(client, case_id, sheet["id"], "refresh", sheet)
    assert answer.status_code == 200, answer.text
    assert answer.json()["added"] == 1
    assert answer.json()["gone"] == 0

    fresh = read_sheet(client, case_id, sheet["id"])
    # Appended rather than re-sorted: inserting in place reshuffles a table somebody is
    # working down, and the sheet's own sort is where order is decided.
    assert [row[1] for row in fresh["rows"]] == ["Alpha", "Bravo"]


def test_refresh_leaves_the_analysts_own_columns_alone(client):
    case_id = make_case(client)
    a_proof(client, case_id, "Alpha")
    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    sheet["rows"][0][6] = "in progress"
    sheet["rows"][0][7] = "waiting on the second angle"
    saved = post_sheet(client, case_id, sheet["id"], "refresh", sheet)
    assert saved.status_code == 200, saved.text

    fresh = read_sheet(client, case_id, sheet["id"])
    assert fresh["rows"][0][6] == "in progress"
    assert fresh["rows"][0][7] == "waiting on the second angle"


def test_refresh_restates_a_proof_renamed_since_without_filing_a_second_row(client):
    case_id = make_case(client)
    proof = a_proof(client, case_id, "Alpha")
    sheet = read_sheet(client, case_id, build(client, case_id)["id"])

    client.patch(f"/api/cases/{case_id}/entities/{proof}", json={"label": "Alpha, revised"})
    answer = post_sheet(client, case_id, sheet["id"], "refresh", sheet)
    assert answer.status_code == 200, answer.text
    assert answer.json()["added"] == 0

    fresh = read_sheet(client, case_id, sheet["id"])
    assert len(fresh["rows"]) == 1
    assert fresh["rows"][0][1] == "Alpha, revised"


def test_refresh_never_removes_a_row_and_says_the_proof_is_gone(client):
    case_id = make_case(client)
    kept = a_proof(client, case_id, "Alpha")
    dropped = a_proof(client, case_id, "Bravo")
    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    sheet_id = sheet["id"]
    sheet["rows"][1][7] = "worth keeping"
    assert post_sheet(client, case_id, sheet_id, "refresh", sheet).status_code == 200

    client.delete(f"/api/cases/{case_id}/entities/{dropped}")

    fresh = read_sheet(client, case_id, sheet_id)
    assert len(fresh["rows"]) == 2
    # The row keeps its text and the note nobody else wrote.
    assert fresh["rows"][1][1] == "Bravo"
    assert fresh["rows"][1][7] == "worth keeping"
    # The link is swept, as it is on every sheet — and `built` is what survives to answer.
    assert fresh["rows"][0][5] == "YES"
    assert fresh["rows"][1][5] == "NO"
    assert "Title" not in fresh["meta"]["links"].get(fresh["rows"][1][0], {})
    assert fresh["meta"]["built"][fresh["rows"][1][0]] == dropped
    assert fresh["meta"]["built"][fresh["rows"][0][0]] == kept

    answer = post_sheet(client, case_id, sheet_id, "refresh", fresh)
    assert answer.json()["gone"] == 1
    assert answer.json()["added"] == 0


def test_a_row_nobody_built_is_left_out_of_the_in_case_column(client):
    case_id = make_case(client)
    a_proof(client, case_id, "Alpha")
    sheet = read_sheet(client, case_id, build(client, case_id)["id"])
    # A line the analyst adds for a place not yet proven: it arrives as work to do, and
    # the question `In case` asks does not apply to it.
    sheet["rows"].append(["", "A place still to prove", "", "", "", "", "to do", ""])
    saved = client.put(
        f"/api/cases/{case_id}/sheets/{sheet['id']}",
        json={k: sheet[k] for k in ("columns", "rows", "meta", "stamp")},
    )
    assert saved.status_code == 200, saved.text

    fresh = read_sheet(client, case_id, sheet["id"])
    assert fresh["rows"][1][5] == ""
    assert fresh["rows"][1][6] == "to do"


def test_the_coordinates_follow_a_place_that_moves(client):
    case_id = make_case(client)
    place = add(client, case_id, "place", "Rooftop", lat=47.1, lon=37.5)["id"]
    a_proof(client, case_id, "Rooftop shot", place=place)
    sheet_id = build(client, case_id)["id"]

    client.patch(
        f"/api/cases/{case_id}/entities/{place}",
        json={"attrs": {"lat": 48.9, "lon": 24.7}},
    )
    fresh = read_sheet(client, case_id, sheet_id)
    assert fresh["rows"][0][4] == "48.90000, 24.70000"


def test_the_build_is_bounded(client):
    assert fromcase_engine.MAX_FROM_CASE == 2_000


def test_refresh_is_refused_on_a_sheet_that_was_not_built_this_way(client):
    case_id = make_case(client)
    a_proof(client, case_id, "Alpha")
    # A binder that happens to hold a column called Title. Nothing stops that, and pouring
    # every proof in the case into it would file rows of empty cells nobody asked for.
    made = client.post(
        f"/api/cases/{case_id}/sheets/import",
        json={"title": "Imported", "text": "Title,Notes\nSomething,\n"},
    ).json()
    sheet = read_sheet(client, case_id, made["id"])

    refused = post_sheet(client, case_id, sheet["id"], "refresh", sheet)
    assert refused.status_code == 422
    assert "not built out of the case" in refused.text


def test_two_sheets_built_the_same_way_are_told_apart(client):
    """The name is the filename, suffix and all.

    `target` steps a taken name to `-2` rather than refusing it, and the label used to keep
    the name that was asked for — so building this shape twice left two rows reading `My
    geolocations` in the list, backed by two different files, with nothing on screen to
    say which was which.
    """
    case_id = make_case(client)
    a_proof(client, case_id, "Alpha")

    build(client, case_id)
    build(client, case_id)
    build(client, case_id)

    listed = client.get(f"/api/cases/{case_id}/sheets").json()["sheets"]
    assert [entry["title"] for entry in listed] == [
        "My geolocations",
        "My geolocations-2",
        "My geolocations-3",
    ]
    # And each one is its own file, which is what the names now say.
    assert len({entry["path"] for entry in listed}) == 3
