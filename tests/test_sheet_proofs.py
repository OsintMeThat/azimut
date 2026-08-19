"""A geolocation index into proofs: the one road out of a sheet that fetches bytes.

Every other road from a sheet reads what the analyst typed. This one downloads what two
of the columns point at, so what these guard is the pair of promises that separates it
from the pass: **the plan touches the network never**, and **the press is atomic per row**
— a dead link on line 12 costs line 12 and nothing else.

The downloads are stubbed, deliberately and everywhere: what is under test is which rows
become what, not yt-dlp. The one thing the stub is faithful about is the three shapes
`download_url` really answers with — a held file, a login wall, a post with several
attachments — because each of those is a different word beside a row.
"""

import json
import random
import zlib

from jobwait import job_result
from PIL import Image

from test_sheet_bridge import (
    add,
    case_entities,
    case_links,
    import_sheet,
    make_case,
    read_sheet,
)

INDEX = (
    "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
    "Bridge strike,https://ex.org/clip,https://ex.org/pic,48.8566 2.3522,done,south bank\n"
)


def geoloc(client, case_id, text=INDEX, title="Geolocations"):
    """A geolocation index at the template's own schema, roles and all."""
    sheet = import_sheet(client, case_id, text, title=title)
    sheet["meta"] = {
        **sheet["meta"],
        "roles": {
            "Source media": {"kind": "url"},
            "Geolocation proof": {"kind": "url"},
            "Coordinates": {"kind": "latlon"},
            "Status": {"kind": "state"},
        },
    }
    return sheet


DECLARED = {
    "title": "Title",
    "source": "Source media",
    "proof": "Geolocation proof",
    "point": "Coordinates",
    "note": "Notes",
    "status": "Status",
}


def build_body(sheet, **asked):
    return {
        "columns": sheet["columns"],
        "rows": sheet["rows"],
        "keys": [row[0] for row in sheet["rows"]],
        **DECLARED,
        **asked,
    }


def plan(client, case_id, sheet, **asked):
    return client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/proofs/preview",
        json=build_body(sheet, **asked),
    )


def press(client, case_id, sheet, **asked):
    """Start the build and poll the job to its end, as the grid does."""
    started = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/proofs", json=build_body(sheet, **asked)
    )
    assert started.status_code == 200, started.text
    return job_result(client, started.json()["job_id"])


def actions(answer):
    return {row["key"]: row["action"] for row in answer["rows"]}


def reasons(answer):
    return {row["key"]: row["reason"] for row in answer["rows"]}


# -- the plan, which downloads nothing ----------------------------------------


def test_the_plan_answers_the_six_readings_of_a_row_without_fetching_anything(
    client, monkeypatch
):
    """The table of what a row becomes, all six lines of it, in one plan.

    The stub is a tripwire: a plan that reached the network would call it and the test
    would say so. Reading a binder must never be an act that leaves the machine.
    """
    from azimut.engine import media as media_engine

    def refuse(*args, **kwargs):
        raise AssertionError("a plan must not download anything")

    monkeypatch.setattr(media_engine, "download_url", refuse)

    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Full,https://ex.org/clip,https://ex.org/pic,48.85 2.35,done,\n"
        "Footage,https://ex.org/two,,48.86 2.36,done,\n"
        "Point,,,48.87 2.37,done,\n"
        "No source,,https://ex.org/pic2,48.88 2.38,done,\n"
        "No point,https://ex.org/three,https://ex.org/pic3,,done,\n"
        ",https://ex.org/four,https://ex.org/pic4,48.89 2.39,done,\n",
    )
    answer = plan(client, case_id, sheet)
    assert answer.status_code == 200, answer.text
    said = answer.json()

    keys = [row[0] for row in sheet["rows"]]
    assert [row["action"] for row in said["rows"]] == [
        "make", "make", "make", "error", "error", "error",
    ]
    assert [row["writes"] for row in said["rows"][:3]] == [
        "a proof, its two files and its point",
        "the footage, posed on its point",
        "a place",
    ]
    told = reasons(said)
    assert told[keys[3]] == "a proof needs the footage it was read from"
    assert told[keys[4]] == "a geolocation needs a point"
    assert told[keys[5]] == "a proof needs a name"
    assert said["counts"] == {"make": 3, "join": 0, "update": 0, "skip": 0, "error": 3}


def test_a_row_ruled_out_is_left_out_and_the_plan_says_so(client):
    """A status filter that hid rows silently would be the app deciding which lines of a
    binder count. It says how many and which word, and the press can be told otherwise."""
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Kept,,,48.85 2.35,in progress,\n"
        "Dropped,,,48.86 2.36,ruled out,\n",
    )
    said = plan(client, case_id, sheet).json()
    assert [row["action"] for row in said["rows"]] == ["make", "skip"]
    assert "ruled out" in said["rows"][1]["reason"]

    # And the analyst can hand them back, which is the whole point of saying it out loud.
    kept = plan(client, case_id, sheet, skip_states=[]).json()
    assert [row["action"] for row in kept["rows"]] == ["make", "make"]


def test_an_unreadable_or_impossible_position_is_a_refusal_not_a_guess(client):
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Prose,,,somewhere near the bridge,,\n"
        "Transposed,,,148.85 2.35,,\n"
        "Blank,,,,,\n",
    )
    said = plan(client, case_id, sheet).json()
    assert [row["action"] for row in said["rows"]] == ["error", "error", "skip"]
    told = [row["reason"] for row in said["rows"]]
    assert "is not a position Azimut can read" in told[0]
    assert "is not a position on the earth" in told[1]
    assert told[2] == "nothing to build from"


def test_two_rows_under_one_title_are_two_geolocations_over_one_file(client):
    """A proof's name is its filename, so the second row would overwrite the first. The
    single-post import refuses a name already taken; this refuses it for the same reason,
    row by row, rather than inventing a suffix nobody asked for."""
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Same name,https://ex.org/a,https://ex.org/b,48.85 2.35,,\n"
        "Same name,https://ex.org/c,https://ex.org/d,48.86 2.36,,\n",
    )
    said = plan(client, case_id, sheet).json()
    assert [row["action"] for row in said["rows"]] == ["make", "error"]
    assert "already" in said["rows"][1]["reason"]


def test_a_hundred_and_one_rows_are_refused_at_the_door_with_what_is_left(client):
    """A cap that only refuses reads as a breakdown. This one names the remainder, so it
    reads as the queue it is."""
    case_id = make_case(client)
    rows = "".join(
        f"Row {n},https://ex.org/{n},,48.{n:03d} 2.35,,\n" for n in range(101)
    )
    sheet = geoloc(
        client, case_id, "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n" + rows
    )
    answer = plan(client, case_id, sheet)
    assert answer.status_code == 422
    detail = answer.json()["detail"]
    assert "100 rows a press" in detail and "other 1" in detail

    # And far past it, so the sentence is the engine's and not the model's "list too long".
    many = plan(client, case_id, sheet, keys=[f"r{n}" for n in range(400)])
    assert many.status_code == 422
    assert "other 300" in many.json()["detail"]


def test_the_door_refuses_a_declaration_that_names_one_column_twice(client):
    case_id = make_case(client)
    sheet = geoloc(client, case_id)
    answer = plan(client, case_id, sheet, note="Title")
    assert answer.status_code == 422
    assert "only be one thing" in answer.json()["detail"]


# -- the press, row by row ----------------------------------------------------


def stub_downloads(monkeypatch, *, missing=(), gated=(), several=None, before=None):
    """Stand in for yt-dlp, in the shapes it really answers with.

    Answers with a held file by default; ``gated`` walls a URL until cookies are sent,
    ``missing`` makes it unreachable, and ``several`` maps a URL to the attachments a post
    carries — the picker's own items, each with its `kind`, answered until an ``index``
    picks one. ``before`` runs on each call, which is what lets a test cancel a press while
    a row is on the network. The list it returns is every call, with the index and the kind
    it asked for, so a test can prove which attachment a slot went for.
    """
    from azimut.engine import media as media_engine

    several = several or {}
    calls = []

    def download(
        case, url, progress_hook=None, *, index=None, title=None, cookies=None, stage=None,
        wants="",
    ):
        calls.append({"url": url, "cookies": bool(cookies), "index": index, "wants": wants})
        if before is not None:
            before(url)
        if url in gated and not cookies:
            return {"needs_auth": True}
        if url in several and index is None:
            return {"multi": True, "items": several[url]}
        if url in missing:
            raise RuntimeError("that address could not be reached")
        url = f"{url}#{index}" if index is not None else url
        path = stage / (url.rsplit("/", 1)[-1].replace("#", "-") + ".png")
        # A different *picture* per address, not just different bytes. The library dedupes
        # on sha256 and enrichment draws `same-image-as` between two pictures that look
        # alike, so two flat rectangles would come back joined and the test would be about
        # the deduplication rather than about the build.
        noise = random.Random(zlib.crc32(url.encode()))
        picture = Image.new("RGB", (32, 32))
        picture.putdata([
            (noise.randrange(256), noise.randrange(256), noise.randrange(256))
            for _ in range(32 * 32)
        ])
        picture.save(path)
        return {"staged": media_engine.stage_descriptor(path, {"type": "test", "url": url})}

    monkeypatch.setattr(media_engine, "download_url", download)
    return calls


def edges(case_id):
    """Every edge in the case as `from-type verb to-type`, which is what the constellation
    is actually a claim about."""
    from azimut.api.cases import get_case

    case = get_case(case_id)
    named = {entity["id"]: entity for entity in case.list_entities()}
    return sorted(
        f"{named[link['from']]['type']} {link['type']} {named[link['to']]['type']}"
        for link in case_links(case_id)
        if link["from"] in named and link["to"] in named
    )


def test_a_full_row_writes_the_whole_constellation(client, monkeypatch):
    """The five edges an import writes by hand, written by a row of a binder instead.

    `derived-from` is honest here and only here: the app fetched the file and composed the
    proof, so it observed the derivation. A pass that merely read two addresses could not
    state it.
    """
    stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(client, case_id)

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 1, "restated": 0, "failed": 0}

    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["Bridge strike"]
    assert len(case_entities(case_id, "media")) == 2
    assert len(case_entities(case_id, "place")) == 1
    assert edges(case_id) == [
        "media depicts place",
        "media depicts place",
        "media derived-from media",
        "proof depicts place",
        "proof derived-from media",
    ]
    # And the row says what it made, which is what the grid logs beside it.
    made = result["rows"][0]["made"]
    assert set(made) == {"source", "panel", "proof", "place"}

    # The sidecar the browser writes back points each cell at what that cell produced, so
    # the built row carries chips rather than four addresses nobody can follow.
    key = sheet["rows"][0][0]
    assert set(result["links"][key]) == {
        "Title", "Source media", "Geolocation proof", "Coordinates",
    }
    assert result["links"][key]["Title"] == made["proof"]

    # And the row's note is carried onto the proof it named, which is the only thing the
    # Notes column is for on this road.
    from azimut.api.cases import get_case

    proof = case_entities(case_id, "proof")[0]
    spec = json.loads(
        get_case(case_id).resolve_inside(proof["attrs"]["spec"]).read_text(encoding="utf-8")
    )
    assert spec["panels"][0]["caption"] == "south bank"
    assert spec["pov"] is False
    assert spec["source"] == "https://ex.org/clip"


def test_pov_moves_the_two_files_onto_the_ground_instead_of_showing_it(client, monkeypatch):
    """`located-at` says the camera was there and `depicts` says the frame shows it. The
    proof itself never takes the first: it was composed, never recorded anywhere."""
    stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(client, case_id)

    press(client, case_id, sheet, pov=True)
    assert edges(case_id) == [
        "media derived-from media",
        "media located-at place",
        "media located-at place",
        "proof depicts place",
        "proof derived-from media",
    ]


def test_a_row_of_footage_alone_puts_the_media_on_its_point(client, monkeypatch):
    """The middle line of the table: no published picture, so no proof — but the footage
    and the ground it was filmed on are worth having on their own."""
    stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Clip,https://ex.org/clip,,48.85 2.35,,\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"]["built"] == 1
    assert not case_entities(case_id, "proof")
    assert len(case_entities(case_id, "media")) == 1
    assert edges(case_id) == ["media depicts place"]


def test_a_row_of_coordinates_alone_pins_a_place_and_fetches_nothing(client, monkeypatch):
    calls = stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Just a point,,,48.85 2.35,,\n",
    )

    result = press(client, case_id, sheet)
    assert calls == []
    assert result["counts"]["built"] == 1
    assert len(case_entities(case_id, "place")) == 1


def test_two_rows_on_the_same_point_pin_one_place(client, monkeypatch):
    """A place is the one entity in this app whose identity is a number. Two rows about
    the same spot are one pin, or the map grows unreadable a row at a time."""
    stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "One,https://ex.org/a,https://ex.org/b,48.8566 2.3522,,\n"
        "Two,https://ex.org/c,https://ex.org/d,48.8566 2.3522,,\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"]["built"] == 2
    assert len(case_entities(case_id, "place")) == 1
    assert len(case_entities(case_id, "proof")) == 2


def test_a_row_whose_source_cannot_be_reached_writes_nothing_and_stops_nobody(
    client, monkeypatch
):
    """Atomic per row, which is the opposite of the pass and for the opposite reason:
    failing at row 2 is no reason to hand back rows 1 and 3."""
    stub_downloads(monkeypatch, missing={"https://ex.org/dead"})
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "First,https://ex.org/a,https://ex.org/b,48.85 2.35,,\n"
        "Broken,https://ex.org/dead,https://ex.org/c,48.86 2.36,,\n"
        "Third,https://ex.org/d,https://ex.org/e,48.87 2.37,,\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 2, "restated": 0, "failed": 1}
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["First", "Third"]
    # The broken row left nothing of itself, not even the picture it did reach.
    assert len(case_entities(case_id, "media")) == 4
    failed = next(row for row in result["rows"] if row["outcome"] == "failed")
    assert "could not be reached" in failed["reason"]
    assert failed["made"] == {}


def test_a_row_behind_a_login_says_what_to_do_and_the_next_press_walks_through(
    client, monkeypatch
):
    """A hundred login prompts being impossible, the wall is a word beside the row — and
    the word says which of the two things it is, because a stored session has already been
    tried by the time a row still comes back walled."""
    calls = stub_downloads(monkeypatch, gated={"https://ex.org/gated"})
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Open,https://ex.org/a,https://ex.org/b,48.85 2.35,,\n"
        "Walled,https://ex.org/gated,https://ex.org/c,48.86 2.36,,\n",
    )

    first = press(client, case_id, sheet)
    assert first["counts"] == {"built": 1, "restated": 0, "failed": 1}
    walled = next(row for row in first["rows"] if row["outcome"] == "failed")
    assert walled["reason"] == "needs a login: pick your browser in Settings → Downloads"
    assert not any(call["cookies"] for call in calls)

    # Named once, it is used without being asked for again — no checkbox, no second press
    # to arm it. The rows already built are not fetched a second time.
    client.put(
        "/api/settings/prefs", json={"download_cookies": {"source": "browser", "browser": "firefox"}}
    )
    calls.clear()
    second = press(client, case_id, sheet)
    assert second["counts"]["built"] == 1
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["Open", "Walled"]
    assert {call["url"] for call in calls} == {"https://ex.org/gated", "https://ex.org/c"}
    assert any(call["cookies"] for call in calls), "the stored session was used on its own"


def test_a_post_of_several_attachments_is_answered_by_what_the_slot_holds(
    client, monkeypatch
):
    """The ordinary shape of the thing this road is for, not an exception.

    A published geolocation is a picture and the post carries the footage beside it, so a
    picker would fire on nearly every row — and a hundred rows cannot each raise one. The
    slot's own kind is the answer: the panel takes the pictures, the source takes the clip.
    """
    calls = stub_downloads(
        monkeypatch,
        several={
            "https://ex.org/album": [
                {"index": 1, "kind": "video", "title": "the clip"},
                {"index": 2, "kind": "image", "title": "the proof"},
            ]
        },
    )
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Album,https://ex.org/clip,https://ex.org/album,48.85 2.35,,\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 1, "restated": 0, "failed": 0}
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["Album"]
    # Asked twice: once to see what the post holds, once for the picture in it. The clip
    # beside it is the footage, and the footage has a column of its own.
    picks = [call for call in calls if call["url"] == "https://ex.org/album"]
    assert [call["index"] for call in picks] == [None, 2]
    assert {call["wants"] for call in picks} == {"image"}


def test_a_post_publishing_several_pictures_is_one_proof_of_several_panels(
    client, monkeypatch
):
    """A published geolocation is often a set — the overhead, the ground shot, the match —
    and keeping the first of three keeps a third of what was published.

    They become the panels of one composition, which is what a proof already is. And the
    set has no render: laying panels out is the composer's canvas, in the browser, so a
    second renderer here would drift from it. It is filed without an export, borrowing the
    first picture's thumbnail so it still draws in the graph.
    """
    import json

    from azimut.api.cases import get_case

    stub_downloads(
        monkeypatch,
        several={
            "https://ex.org/set": [
                {"index": 1, "kind": "image", "title": "overhead"},
                {"index": 2, "kind": "image", "title": "ground"},
                {"index": 3, "kind": "image", "title": "match"},
            ]
        },
    )
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Published set,https://ex.org/clip,https://ex.org/set,48.85 2.35,,south bank\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 1, "restated": 0, "failed": 0}
    proofs_held = case_entities(case_id, "proof")
    assert [entity["label"] for entity in proofs_held] == ["Published set"]
    # Three pictures and the footage, and the proof composes the three.
    assert len(case_entities(case_id, "media")) == 4

    case = get_case(case_id)
    spec = json.loads(case.resolve_inside(proofs_held[0]["attrs"]["spec"]).read_text("utf-8"))
    assert len(spec["panels"]) == 3
    # The note is one sentence about the proof, not a caption per picture.
    assert [panel["caption"] for panel in spec["panels"]] == ["south bank", "", ""]

    attrs = proofs_held[0]["attrs"]
    assert "path" not in attrs, "a set has no render, so it has no export to point at"
    assert attrs.get("thumb"), "and it borrows the first picture's, so it is not a blank node"

    # The proof rests on all three, which is what makes the point reach them.
    from test_sheet_bridge import case_links

    named = {entity["id"]: entity for entity in case.list_entities()}
    chain = [
        link for link in case_links(case_id)
        if link["type"] == "derived-from" and named[link["from"]]["type"] == "proof"
    ]
    assert len(chain) == 3


def test_a_post_holding_nothing_of_the_kind_is_a_row_to_do_by_hand(client, monkeypatch):
    """Where the rule stops being one a rule can make. A post of four videos has no
    published picture in it, and guessing which frame is the proof is not the app's call."""
    stub_downloads(
        monkeypatch,
        several={
            "https://ex.org/album": [
                {"index": 1, "kind": "video", "title": "one"},
                {"index": 2, "kind": "video", "title": "two"},
            ]
        },
    )
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Album,https://ex.org/clip,https://ex.org/album,48.85 2.35,,\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"]["failed"] == 1
    assert result["rows"][0]["reason"] == (
        "that post holds 2 files and no image, so pick one by hand"
    )
    assert not case_entities(case_id, "proof")


def test_the_footage_slot_takes_a_still_rather_than_refusing_the_row(client, monkeypatch):
    """The footage is only *usually* a video. A photograph taken on the spot is material
    too, so a preference is not a reason to lose the row — where a proof composed of no
    picture really is nothing to compose."""
    calls = stub_downloads(
        monkeypatch,
        several={
            "https://ex.org/stills": [
                {"index": 1, "kind": "image", "title": "on the spot"},
                {"index": 2, "kind": "image", "title": "and again"},
            ]
        },
    )
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Stills,https://ex.org/stills,,48.85 2.35,,\n",
    )

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 1, "restated": 0, "failed": 0}
    assert len(case_entities(case_id, "media")) == 1
    assert [call["index"] for call in calls] == [None, 1]


def test_a_second_press_refreshes_the_point_and_the_note_and_downloads_nothing(
    client, monkeypatch
):
    """What makes a build safe to press twice, and it is the case that remembers rather
    than the sheet: a proof is found under the name it was saved as."""
    calls = stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(client, case_id)
    press(client, case_id, sheet)
    assert len(calls) == 2
    calls.clear()

    moved = read_sheet(client, case_id, sheet["id"])
    moved["meta"] = sheet["meta"]
    row = list(moved["rows"][0])
    row[moved["columns"].index("Coordinates")] = "50.4501 30.5234"
    row[moved["columns"].index("Notes")] = "second reading"
    moved["rows"] = [row]

    said = plan(client, case_id, moved).json()
    assert [entry["action"] for entry in said["rows"]] == ["update"]

    result = press(client, case_id, moved)
    assert calls == []
    assert result["counts"] == {"built": 0, "restated": 1, "failed": 0}
    assert len(case_entities(case_id, "proof")) == 1
    assert len(case_entities(case_id, "media")) == 2

    # The proof states the new point and nothing states the old one any more: a corrected
    # geolocation is a withdrawal, not a second claim.
    places = case_entities(case_id, "place")
    standing = [
        place for place in places if any(link["to"] == place["id"] for link in case_links(case_id))
    ]
    assert len(standing) == 1
    assert round(standing[0]["attrs"]["lat"], 4) == 50.4501

    from azimut.api.cases import get_case

    proof = case_entities(case_id, "proof")[0]
    spec = get_case(case_id).resolve_inside(proof["attrs"]["spec"]).read_text(encoding="utf-8")
    assert "second reading" in spec


def test_a_cancelled_press_keeps_the_rows_it_finished_and_leaves_no_half_row(
    client, monkeypatch
):
    """Cancelling is a promise about the row in flight: its bytes are held outside the
    case until the last moment, so dropping them leaves nothing to clean up."""
    import threading

    held = threading.Event()
    reached = threading.Event()

    def wait(url):
        if url == "https://ex.org/slow":
            reached.set()
            held.wait(10)

    stub_downloads(monkeypatch, before=wait)
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Done first,https://ex.org/a,https://ex.org/b,48.85 2.35,,\n"
        "Interrupted,https://ex.org/slow,https://ex.org/c,48.86 2.36,,\n"
        "Never started,https://ex.org/d,https://ex.org/e,48.87 2.37,,\n",
    )

    started = client.post(
        f"/api/cases/{case_id}/sheets/{sheet['id']}/proofs", json=build_body(sheet)
    )
    job_id = started.json()["job_id"]
    assert reached.wait(10)
    assert client.post(f"/api/jobs/{job_id}/cancel").json() == {"stopped": True}
    held.set()
    result = job_result(client, job_id)

    assert result["stopped"] is True
    assert result["counts"] == {"built": 1, "restated": 0, "failed": 0}
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["Done first"]
    # The interrupted row downloaded two files and filed neither.
    assert len(case_entities(case_id, "media")) == 2


def test_the_rows_the_analyst_put_aside_are_not_built(client, monkeypatch):
    """The plan is read, not obeyed. A row the analyst leaves out stays out."""
    stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Wanted,https://ex.org/a,https://ex.org/b,48.85 2.35,,\n"
        "Not now,https://ex.org/c,https://ex.org/d,48.86 2.36,,\n",
    )
    keys = [row[0] for row in sheet["rows"]]

    result = press(client, case_id, sheet, skip=[keys[1]])
    assert result["counts"]["built"] == 1
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["Wanted"]


def test_a_bookmark_of_that_page_is_not_the_footage(client, monkeypatch):
    """A press before this one may have filed the address as a `bookmark` — a page, not a
    file. Reading it as the footage would leave the row believing it holds a video nobody
    ever downloaded, so the build fetches it and the case ends up holding both."""
    calls = stub_downloads(monkeypatch)
    case_id = make_case(client)
    add(client, case_id, "bookmark", "ex.org/clip", url="https://ex.org/clip",
        source_url="https://ex.org/clip")
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Clip,https://ex.org/clip,,48.85 2.35,,\n",
    )

    assert [row["action"] for row in plan(client, case_id, sheet).json()["rows"]] == ["make"]
    press(client, case_id, sheet)
    assert [call["url"] for call in calls] == ["https://ex.org/clip"]
    assert len(case_entities(case_id, "media")) == 1


def test_a_second_press_over_footage_alone_restates_its_point_without_fetching(
    client, monkeypatch
):
    calls = stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(
        client,
        case_id,
        "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
        "Clip,https://ex.org/clip,,48.85 2.35,,\n",
    )
    press(client, case_id, sheet)
    calls.clear()

    assert [row["action"] for row in plan(client, case_id, sheet).json()["rows"]] == ["join"]
    result = press(client, case_id, sheet)
    assert calls == []
    assert result["counts"] == {"built": 0, "restated": 1, "failed": 0}
    assert len(case_entities(case_id, "media")) == 1
    assert len(case_links(case_id)) == 1


CROSS_BORDER = (
    "Title,Source media,Geolocation proof,Coordinates,Status,Notes\n"
    "Border attack (2),https://ex.org/clip,https://ex.org/pub,\"37.149836, 69.355336\",,AFGHANISTAN\n"
    "Border attack,https://ex.org/clip,https://ex.org/pub,\"37.152061, 69.350817\",,TAJIKISTAN\n"
)


def test_one_published_proof_seen_at_two_points_is_one_proof(client, monkeypatch):
    """The binder's cross-border shape: two lines because it happened at two places, and
    one picture published about it.

    Filing it row by row put two exports of one image in the case under two names and
    fetched both files twice. And a proof **concludes on one point** by design — reopening
    it with other coordinates withdraws the first — so the second point cannot be a second
    conclusion. It is the material that is seen at both, which is what the material is for.
    """
    calls = stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(client, case_id, CROSS_BORDER)

    said = plan(client, case_id, sheet).json()
    assert [row["action"] for row in said["rows"]] == ["make", "join"]
    assert said["rows"][1]["writes"] == "its point, on the proof the row above builds"
    assert "the same published proof" in said["rows"][1]["reason"]

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 1, "restated": 1, "failed": 0}
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == ["Border attack (2)"]
    assert len(case_entities(case_id, "place")) == 2
    # Two downloads, not four: the second row has nothing to fetch that the first did not.
    assert len(calls) == 2

    # The published proof is what establishes *both* positions — that is what writing two
    # lines about one picture says — so it reaches both. Only the composer's own field
    # still states one, and only the composer's own edges are reconciled by a later save.
    assert edges(case_id) == [
        "media depicts place",
        "media depicts place",
        "media depicts place",
        "media depicts place",
        "media derived-from media",
        "proof depicts place",
        "proof depicts place",
        "proof derived-from media",
    ]
    # And the second row's cell still points at the proof it is about, so the line reads as
    # part of it rather than as a stray point.
    second = sheet["rows"][1][0]
    assert set(result["links"][second]) == {"Title", "Source media", "Geolocation proof",
                                            "Coordinates"}


def test_a_second_point_whose_first_row_never_built_says_so_instead_of_passing(
    client, monkeypatch
):
    """A row that puts its point on nothing is not a row that succeeded.

    The join reads the proof and the media the row above filed, and it skipped whatever was
    absent — so when the first row failed on a dead link or a login wall, the second wrote a
    place, attached nothing to it, and reported `restated`. The grid logged it as done and no
    later press took it again: the second position of a cross-border strike disappeared
    without a red line, on the very shape the join exists for.
    """
    stub_downloads(monkeypatch, missing=["https://ex.org/pub"])
    case_id = make_case(client)
    sheet = geoloc(client, case_id, CROSS_BORDER)

    result = press(client, case_id, sheet)
    assert result["counts"] == {"built": 0, "restated": 0, "failed": 2}
    assert result["rows"][1]["reason"] == "the row this one joins did not build"
    assert result["rows"][1]["made"] == {}
    # And no bare pin is left standing for a row that produced nothing else.
    assert case_entities(case_id, "place") == []

    # The ordinary case is untouched: with the first row built, the second restates.
    stub_downloads(monkeypatch)
    again = press(client, case_id, sheet)
    assert again["counts"] == {"built": 1, "restated": 1, "failed": 0}


def test_a_title_corrected_since_moves_the_proof_instead_of_twinning_it(client, monkeypatch):
    """A built proof is identified by **where it was published**, never by its name.

    The name is a cell somebody edits. Keyed on it, a corrected title built a second proof
    beside the first and left the old one standing under the old name — which is the one
    duplicate nobody notices, since both look right in the list.
    """
    calls = stub_downloads(monkeypatch)
    case_id = make_case(client)
    sheet = geoloc(client, case_id)
    press(client, case_id, sheet)
    calls.clear()

    moved = read_sheet(client, case_id, sheet["id"])
    moved["meta"] = sheet["meta"]
    row = list(moved["rows"][0])
    row[moved["columns"].index("Title")] = "Bridge strike, south bank"
    moved["rows"] = [row]

    said = plan(client, case_id, moved).json()
    assert said["rows"][0]["action"] == "update"
    assert "renamed" in said["rows"][0]["reason"]

    result = press(client, case_id, moved)
    assert calls == []
    assert result["counts"] == {"built": 0, "restated": 1, "failed": 0}
    assert [entity["label"] for entity in case_entities(case_id, "proof")] == [
        "Bridge strike, south bank"
    ]
