"""Links the case proposes by itself: who posted a file, and which points share a site.

What each group guards:

- an address names an account only where the platform writes the handle into it, and
  never by guessing from a display name;
- a pass files the account once, reuses one the case already holds under that handle,
  and leaves alone a file somebody already said who posted;
- points within reach are joined by a spanning tree, never a mesh, and joins already
  standing are counted rather than doubled;
- a dropped proposal never comes back, because each entity is read once;
- filing a place, a file or a bookmark queues a pass, and nothing else does;
- what a proof shares with the case is read from geometry and addresses, so it answers
  before the pass has run.
"""

import io

import pytest
from PIL import Image

from azimut.engine import media as media_engine
from azimut.engine import proposals
from azimut.engine import workqueue


@pytest.fixture(autouse=True)
def no_background_worker(monkeypatch):
    """Passes run when a test runs them, so what each one filed is the test's to count."""
    monkeypatch.setattr(workqueue, "start_workers", False)


def make_case(client, name="Proposals"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def case_of(case_id):
    from azimut.api.cases import get_case

    return get_case(case_id)


def add(client, case_id, entity_type, label, **attrs):
    body = {"type": entity_type, "label": label}
    if attrs:
        body["attrs"] = attrs
    response = client.post(f"/api/cases/{case_id}/entities", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def png(shade):
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), (shade, 40, 90)).save(buffer, "PNG")
    return buffer.getvalue()


def download(case, url, shade, name="clip.png"):
    """A file brought in from a post, the way a download files one."""
    return media_engine._register_downloaded_item(
        case, url, name, png(shade), title=f"clip {shade}", source_extra={"downloader": "test"}
    )["entity"]


def links_of_type(case, kind):
    return [link for link in case.list_links() if link["type"] == kind]


# -- reading an address ---------------------------------------------------------


@pytest.mark.parametrize(
    ("url", "label", "platform"),
    [
        ("https://x.com/OSINTWarfare/status/2097292381120876606/", "@OSINTWarfare", "X"),
        ("https://twitter.com/war_noir/status/1", "@war_noir", "X"),
        ("https://mobile.twitter.com/war_noir/status/1?s=20", "@war_noir", "X"),
        ("https://t.me/rybar/61234", "@rybar", "Telegram"),
        ("https://t.me/s/rybar/61234", "@rybar", "Telegram"),
        ("https://www.tiktok.com/@someone/video/7312", "@someone", "TikTok"),
        ("https://www.youtube.com/@somechannel/videos", "@somechannel", "YouTube"),
        ("https://www.instagram.com/someone/p/Cx12/", "@someone", "Instagram"),
        ("https://www.threads.net/@someone/post/Cx12", "@someone", "Threads"),
        ("https://bsky.app/profile/name.bsky.social/post/3kq", "@name.bsky.social", "Bluesky"),
        ("https://mastodon.social/@user/1123", "@user@mastodon.social", "Mastodon"),
    ],
)
def test_an_address_names_the_account_where_the_platform_writes_it(url, label, platform):
    account = proposals.account_from_url(url)
    assert account is not None
    assert account["label"] == label
    assert account["platform"] == platform
    assert account["url"].startswith("https://")


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=abc",  # names a video, not who posted it
        "https://www.instagram.com/p/Cx12/",
        "https://x.com/i/status/1",  # the platform's own word where a handle goes
        "https://t.me/c/1234/56",  # a private channel's number
        "https://bsky.app/profile/did:plc:abc/post/3kq",
        "https://example.org/article",
        "ftp://x.com/user/status/1",
        "not an address",
        "",
        None,
    ],
)
def test_an_address_that_names_no_account_gives_none(url):
    assert proposals.account_from_url(url) is None


# -- who posted it ----------------------------------------------------------------


def test_a_pass_files_the_account_and_joins_it_to_each_file(client):
    case_id = make_case(client)
    case = case_of(case_id)
    first = download(case, "https://x.com/BashaReport/status/1", 1)
    second = download(case, "https://x.com/bashareport/status/2", 2)

    filed = proposals.propose(case)

    assert filed == {"accounts": 1, "posted": 2, "sites": 0}
    accounts = [e for e in case.list_entities() if e["type"] == "account"]
    assert len(accounts) == 1
    account = accounts[0]
    assert account["label"] == "@BashaReport"
    assert account["attrs"]["platform"] == "X"
    assert account["attrs"]["url"] == "https://x.com/BashaReport"
    assert account["provenance"]["status"] == "suggested"
    assert account["provenance"]["by"] == proposals.BY
    posted = links_of_type(case, "posted")
    assert {(link["from"], link["to"]) for link in posted} == {
        (account["id"], first["id"]),
        (account["id"], second["id"]),
    }
    assert all(link["provenance"]["status"] == "suggested" for link in posted)


def test_an_account_the_case_holds_is_reused_whatever_its_sigil(client):
    case_id = make_case(client)
    held = add(client, case_id, "account", "bashareport")
    case = case_of(case_id)
    item = download(case, "https://x.com/BashaReport/status/1", 1)

    filed = proposals.propose(case)

    assert filed["accounts"] == 0
    assert [e["id"] for e in case.list_entities() if e["type"] == "account"] == [held["id"]]
    [link] = links_of_type(case, "posted")
    assert (link["from"], link["to"]) == (held["id"], item["id"])


def test_a_file_somebody_said_who_posted_is_left_alone(client):
    case_id = make_case(client)
    case = case_of(case_id)
    stated = add(client, case_id, "account", "@someone_else")
    item = download(case, "https://x.com/BashaReport/status/1", 1)
    case.add_link(stated["id"], item["id"], "posted", by="user")

    filed = proposals.propose(case)

    assert filed == {"accounts": 0, "posted": 0, "sites": 0}
    assert len(links_of_type(case, "posted")) == 1


def test_a_bookmark_is_read_for_its_account_too(client):
    case_id = make_case(client)
    bookmark = add(client, case_id, "bookmark", "Post", url="https://t.me/rybar/61234")
    case = case_of(case_id)

    proposals.propose(case)

    [link] = links_of_type(case, "posted")
    assert link["to"] == bookmark["id"]


# -- which points are one site -------------------------------------------------------

# About 110 m between neighbours along the meridian, and the last one far away.
NEAR = [(15.7400, 45.0300), (15.7410, 45.0300), (15.7420, 45.0300)]
FAR = (15.9000, 45.5000)


def test_points_within_reach_are_joined_by_a_tree_not_a_mesh(client):
    case_id = make_case(client)
    ids = [add(client, case_id, "place", f"P{n}", lat=lat, lon=lon)["id"]
           for n, (lat, lon) in enumerate(NEAR)]
    far = add(client, case_id, "place", "Far", lat=FAR[0], lon=FAR[1])["id"]
    case = case_of(case_id)

    filed = proposals.propose(case)

    sites = links_of_type(case, "same-site-as")
    # Three points, one site: two edges, never three.
    assert filed["sites"] == 2 and len(sites) == 2
    joined = {link["from"] for link in sites} | {link["to"] for link in sites}
    assert joined == set(ids)
    assert far not in joined
    # Stored canonically, so the same pair can never be filed twice the other way round.
    assert all(link["from"] < link["to"] for link in sites)


def test_a_join_already_standing_is_counted_not_doubled(client):
    case_id = make_case(client)
    first = add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])["id"]
    second = add(client, case_id, "place", "B", lat=NEAR[1][0], lon=NEAR[1][1])["id"]
    case = case_of(case_id)
    case.add_link(first, second, "same-site-as", by="user")

    filed = proposals.propose(case)

    assert filed["sites"] == 0
    assert len(links_of_type(case, "same-site-as")) == 1


def test_a_point_filed_later_joins_the_site_it_lands_on(client):
    case_id = make_case(client)
    add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])
    add(client, case_id, "place", "B", lat=NEAR[1][0], lon=NEAR[1][1])
    case = case_of(case_id)
    proposals.propose(case)
    assert len(links_of_type(case, "same-site-as")) == 1

    later = add(client, case_id, "place", "C", lat=NEAR[2][0], lon=NEAR[2][1])["id"]
    filed = proposals.propose(case)

    assert filed["sites"] == 1
    [new] = [link for link in links_of_type(case, "same-site-as") if later in (link["from"], link["to"])]
    assert new["provenance"]["status"] == "suggested"


# -- read once ------------------------------------------------------------------------


def test_a_dropped_proposal_does_not_come_back(client):
    case_id = make_case(client)
    add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])
    add(client, case_id, "place", "B", lat=NEAR[1][0], lon=NEAR[1][1])
    case = case_of(case_id)
    download(case, "https://x.com/BashaReport/status/1", 1)
    proposals.propose(case)
    for link in case.list_links():
        if proposals.unreviewed(link):
            case.remove_link(link["id"])

    filed = proposals.propose(case)

    assert filed == {"accounts": 0, "posted": 0, "sites": 0}
    assert not [link for link in case.list_links() if proposals.unreviewed(link)]


def test_the_mark_travels_in_the_manifest_and_names_what_was_read(client):
    case_id = make_case(client)
    place = add(client, case_id, "place", "A", lat=1.0, lon=2.0)
    case = case_of(case_id)
    assert case.link_pass() is None

    proposals.propose(case)

    mark = case.read()["link_pass"]
    assert mark == case.link_pass()
    assert mark["at"] == place["provenance"]["at"]
    assert mark["read"] == [place["id"]]


def test_a_point_filed_in_the_same_second_as_the_mark_is_still_read(client):
    case_id = make_case(client)
    first = add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])
    case = case_of(case_id)
    proposals.propose(case)
    second = add(client, case_id, "place", "B", lat=NEAR[1][0], lon=NEAR[1][1])
    # Pinned to the mark's own second: the case the bare moment could not tell apart.
    case.set_link_pass({"at": second["provenance"]["at"], "read": [first["id"]]})

    filed = proposals.propose(case)

    assert filed["sites"] == 1


# -- when a pass runs --------------------------------------------------------------------


def queued(case):
    return [job for job in case.list_jobs(state="queued") if job["kind"] == proposals.KIND]


def test_filing_a_place_queues_one_pass(client):
    case_id = make_case(client)
    case = case_of(case_id)
    assert queued(case) == []

    add(client, case_id, "place", "A", lat=1.0, lon=2.0)
    add(client, case_id, "place", "B", lat=1.0, lon=2.001)

    assert len(queued(case)) == 1


def test_filing_what_a_pass_does_not_read_queues_nothing(client):
    case_id = make_case(client)
    add(client, case_id, "person", "Somebody")
    add(client, case_id, "account", "@someone")

    assert queued(case_of(case_id)) == []


def test_the_queued_pass_files_what_it_finds(client):
    case_id = make_case(client)
    case = case_of(case_id)
    download(case, "https://x.com/BashaReport/status/1", 1)

    workqueue.drain(case)

    assert len(links_of_type(case, "posted")) == 1


# -- the routes ---------------------------------------------------------------------------


def test_the_list_names_both_ends_and_the_distance(client):
    case_id = make_case(client)
    add(client, case_id, "place", "Hangar", lat=NEAR[0][0], lon=NEAR[0][1])
    add(client, case_id, "place", "Runway", lat=NEAR[1][0], lon=NEAR[1][1])

    ran = client.post(f"/api/cases/{case_id}/proposals")
    assert ran.status_code == 200, ran.text
    body = ran.json()
    assert body["filed"]["sites"] == 1
    assert body["pending"]["sites"] == 1

    listed = client.get(f"/api/cases/{case_id}/proposals").json()
    [item] = listed["items"]
    assert item["type"] == "same-site-as"
    assert {item["from"]["label"], item["to"]["label"]} == {"Hangar", "Runway"}
    assert 100 <= item["metres"] <= 120
    assert listed["radius"] == proposals.SITE_RADIUS_M
    assert listed["through"]


def test_dropping_the_last_proposal_of_an_account_drops_the_account(client):
    case_id = make_case(client)
    case = case_of(case_id)
    download(case, "https://x.com/BashaReport/status/1", 1)
    client.post(f"/api/cases/{case_id}/proposals")
    [link] = links_of_type(case, "posted")

    dropped = client.delete(f"/api/cases/{case_id}/proposals/{link['id']}")

    assert dropped.status_code == 200, dropped.text
    assert dropped.json()["dropped"] == [link["from"]]
    assert not [e for e in case.list_entities() if e["type"] == "account"]
    assert dropped.json()["pending"] == {"accounts": 0, "posted": 0, "sites": 0}


def test_an_account_still_holding_a_file_stays_when_one_proposal_goes(client):
    case_id = make_case(client)
    case = case_of(case_id)
    download(case, "https://x.com/BashaReport/status/1", 1)
    download(case, "https://x.com/BashaReport/status/2", 2)
    client.post(f"/api/cases/{case_id}/proposals")
    first = links_of_type(case, "posted")[0]

    dropped = client.delete(f"/api/cases/{case_id}/proposals/{first['id']}").json()

    assert dropped["dropped"] == []
    assert len([e for e in case.list_entities() if e["type"] == "account"]) == 1


def test_only_a_proposal_can_be_dropped_here(client):
    case_id = make_case(client)
    first = add(client, case_id, "place", "A", lat=1.0, lon=2.0)["id"]
    second = add(client, case_id, "place", "B", lat=1.0, lon=2.001)["id"]
    stated = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": first, "to_id": second, "type": "same-site-as"},
    )
    assert stated.status_code == 200, stated.text

    refused = client.delete(f"/api/cases/{case_id}/proposals/{stated.json()['id']}")

    assert refused.status_code == 400
    assert client.delete(f"/api/cases/{case_id}/proposals/nope").status_code == 404


def test_confirming_a_proposal_is_the_ordinary_link_patch(client):
    case_id = make_case(client)
    case = case_of(case_id)
    download(case, "https://x.com/BashaReport/status/1", 1)
    client.post(f"/api/cases/{case_id}/proposals")
    [link] = links_of_type(case, "posted")

    confirmed = client.patch(
        f"/api/cases/{case_id}/links/{link['id']}", json={"status": "confirmed"}
    )

    assert confirmed.status_code == 200, confirmed.text
    account = case.get_entity(link["from"])
    # A confirmed relation confirms the endpoint that was still a proposal.
    assert account["provenance"]["status"] == "confirmed"
    assert client.get(f"/api/cases/{case_id}/proposals").json()["items"] == []


def test_the_verb_joins_two_places_and_nothing_else(client):
    case_id = make_case(client)
    first = add(client, case_id, "place", "A", lat=1.0, lon=2.0)["id"]
    far = add(client, case_id, "place", "B", lat=3.0, lon=4.0)["id"]
    person = add(client, case_id, "person", "Somebody")["id"]

    by_hand = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": first, "to_id": far, "type": "same-site-as"},
    )
    refused = client.post(
        f"/api/cases/{case_id}/links",
        json={"from_id": first, "to_id": person, "type": "same-site-as"},
    )

    # A site wider than the radius is the analyst's to state.
    assert by_hand.status_code == 200, by_hand.text
    assert refused.status_code == 400


# -- what a proof shares --------------------------------------------------------------------


def a_proof(client, case_id, label, *, made_from=None, shows=None):
    proof = add(client, case_id, "proof", label)["id"]
    case = case_of(case_id)
    if made_from:
        case.add_link(proof, made_from, "derived-from", by="test")
    if shows:
        case.add_link(proof, shows, "depicts", by="test")
    return proof


def test_kin_names_the_geolocations_on_the_same_site_and_the_points_near(client):
    case_id = make_case(client)
    here = add(client, case_id, "place", "Hangar", lat=NEAR[0][0], lon=NEAR[0][1])["id"]
    there = add(client, case_id, "place", "Runway", lat=NEAR[1][0], lon=NEAR[1][1])["id"]
    loose = add(client, case_id, "place", "Gate", lat=NEAR[2][0], lon=NEAR[2][1])["id"]
    add(client, case_id, "place", "Far", lat=FAR[0], lon=FAR[1])
    mine = a_proof(client, case_id, "Mine", shows=here)
    theirs = a_proof(client, case_id, "Theirs", shows=there)

    answer = client.get(f"/api/cases/{case_id}/entities/{mine}/kin").json()

    assert answer["sites"] == [theirs]
    assert set(answer["places"]) == {there, loose}
    assert answer["radius"] == proposals.SITE_RADIUS_M


def test_kin_reads_the_account_through_a_frame_before_any_pass(client):
    case_id = make_case(client)
    case = case_of(case_id)
    video = download(case, "https://x.com/BashaReport/status/1", 1)
    download(case, "https://x.com/BashaReport/status/2", 2)
    download(case, "https://x.com/someone/status/3", 3)
    frame = add(client, case_id, "media", "Frame")["id"]
    case.add_link(frame, video["id"], "derived-from", by="test")
    proof = a_proof(client, case_id, "From a frame", made_from=frame)

    answer = client.get(f"/api/cases/{case_id}/entities/{proof}/kin").json()

    # No pass has run, so no account exists yet: the address alone answers.
    assert answer["accounts"] == [{"label": "@BashaReport", "id": None, "files": 1}]
    assert answer["sites"] == []


def test_kin_of_nothing_is_a_404(client):
    case_id = make_case(client)
    assert client.get(f"/api/cases/{case_id}/entities/nope/kin").status_code == 404


def test_an_unreviewed_proposal_holds_no_place_a_proof_lets_go(client):
    case_id = make_case(client)
    case = case_of(case_id)
    kept = add(client, case_id, "place", "Kept", lat=NEAR[0][0], lon=NEAR[0][1])["id"]
    left = add(client, case_id, "place", "Left", lat=NEAR[1][0], lon=NEAR[1][1])["id"]
    proposals.propose(case)
    [link] = links_of_type(case, "same-site-as")
    assert {link["from"], link["to"]} == {kept, left}
    assert proposals.unreviewed(link)

    case.update_link(link["id"], {"status": "confirmed"})

    assert not proposals.unreviewed(case.get_link(link["id"]))


# -- a point named by its coordinates, as the drawing names it ----------------------


def test_a_point_is_described_by_the_town_it_is_near():
    from azimut.engine import cities

    # In the city, its name alone; out in the desert, how far and which way.
    assert cities.describe(10.49, -66.88) == "Caracas"
    far = cities.nearest(16.982714, 45.053931)
    assert far is not None and far["bearing"] == "N" and 80 <= far["km"] <= 110
    assert cities.describe(16.982714, 45.053931).endswith(f"km N of {far['name']}")
    # Mid-ocean has no town within reach, and saying the nearest anyway would mislead.
    assert cities.describe(0.0, -30.0) is None
    assert cities.nearest(91.0, 0.0) is None


def test_the_graph_names_a_coordinate_point_and_leaves_a_named_one(client):
    case_id = make_case(client)
    coords = add(client, case_id, "place", "10.490000, -66.880000", lat=10.49, lon=-66.88)["id"]
    named = add(client, case_id, "place", "Rooftop", lat=10.49, lon=-66.88)["id"]

    nodes = {node["id"]: node for node in client.get(f"/api/cases/{case_id}/graph").json()["nodes"]}

    assert nodes[coords]["caption"] == "Caracas"
    assert nodes[coords]["label"] == "10.490000, -66.880000"
    assert "caption" not in nodes[named]


# -- edited after filing -----------------------------------------------------------------


def test_a_place_geolocated_after_filing_is_read_again(client):
    """Filed first, located later: the usual order. The pass reads past a mark set by
    filing time, so the edit itself has to name the place for the next pass."""
    case_id = make_case(client)
    add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])
    unplaced = add(client, case_id, "place", "Hangar")["id"]
    case = case_of(case_id)
    assert proposals.propose(case)["sites"] == 0

    response = client.patch(
        f"/api/cases/{case_id}/entities/{unplaced}", json={"attrs": {"lat": NEAR[1][0], "lon": NEAR[1][1]}}
    )
    assert response.status_code == 200, response.text
    assert case.list_jobs(kind=proposals.KIND, state="queued")

    assert proposals.propose(case)["sites"] == 1
    assert "again" not in case.link_pass()
    # Read once more, then never again for that edit.
    assert proposals.propose(case)["sites"] == 0


def test_an_edit_that_gives_nothing_to_read_queues_no_pass(client):
    case_id = make_case(client)
    place = add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])["id"]
    case = case_of(case_id)
    proposals.propose(case)
    for job in case.list_jobs():
        case.complete_job(job["id"])

    client.patch(f"/api/cases/{case_id}/entities/{place}", json={"label": "Renamed"})

    assert not case.list_jobs(kind=proposals.KIND, state="queued")
    assert "again" not in case.link_pass()


def test_a_bookmark_given_its_address_later_is_read_for_its_account(client):
    case_id = make_case(client)
    bookmark = add(client, case_id, "bookmark", "Post")["id"]
    case = case_of(case_id)
    proposals.propose(case)

    client.patch(f"/api/cases/{case_id}/entities/{bookmark}", json={"attrs": {"url": "https://t.me/rybar/61234"}})
    proposals.propose(case)

    [link] = links_of_type(case, "posted")
    assert link["to"] == bookmark


def _settled(case):
    for job in case.list_jobs(kind=proposals.KIND, state="queued"):
        case.complete_job(job["id"])


def test_a_point_sent_back_unchanged_does_not_bring_back_a_dropped_proposal(client):
    """A second Promote of a places sheet resends every point it holds. Reading those
    places again would propose once more what the analyst dropped; a real move is new."""
    case_id = make_case(client)
    add(client, case_id, "place", "A", lat=NEAR[0][0], lon=NEAR[0][1])
    second = add(client, case_id, "place", "B", lat=NEAR[1][0], lon=NEAR[1][1])["id"]
    case = case_of(case_id)
    assert proposals.propose(case)["sites"] == 1
    [link] = links_of_type(case, "same-site-as")
    assert client.delete(f"/api/cases/{case_id}/proposals/{link['id']}").status_code == 200
    _settled(case)

    resent = {"attrs": {"lat": NEAR[1][0], "lon": NEAR[1][1], "notes": "checked"}}
    assert client.patch(f"/api/cases/{case_id}/entities/{second}", json=resent).status_code == 200
    assert not case.list_jobs(kind=proposals.KIND, state="queued")
    assert "again" not in case.link_pass()
    assert proposals.propose(case)["sites"] == 0

    moved = {"attrs": {"lat": NEAR[2][0], "lon": NEAR[2][1]}}
    assert client.patch(f"/api/cases/{case_id}/entities/{second}", json=moved).status_code == 200
    assert case.list_jobs(kind=proposals.KIND, state="queued")
    assert proposals.propose(case)["sites"] == 1


def test_a_file_renamed_with_its_source_unchanged_keeps_a_dropped_proposal_dropped(client):
    """Details saves a file's stated source with its title, changed or not."""
    url = "https://x.com/BashaReport/status/1"
    case_id = make_case(client)
    item = client.post(
        f"/api/cases/{case_id}/media/upload",
        files={"file": ("shot.png", io.BytesIO(png(3)), "image/png")},
        data={"source_url": url},
    ).json()["item"]
    case = case_of(case_id)
    assert proposals.propose(case)["posted"] == 1
    [posted] = links_of_type(case, "posted")
    assert client.delete(f"/api/cases/{case_id}/proposals/{posted['id']}").status_code == 200
    _settled(case)

    saved = {"path": item["path"], "title": "Renamed", "notes": "", "source_url": url}
    assert client.patch(f"/api/cases/{case_id}/media", json=saved).status_code == 200

    assert not case.list_jobs(kind=proposals.KIND, state="queued")
    assert proposals.propose(case) == {"accounts": 0, "posted": 0, "sites": 0}
    assert not links_of_type(case, "posted")


def test_the_waiting_proposals_are_read_without_walking_the_graph(client, monkeypatch):
    """The panel reads this on every case revision while Graph is mounted, so it is
    counted and listed in SQL, never by materialising every link."""
    from azimut.sqlite_backend import SqliteCase

    case_id = make_case(client)
    for n, (lat, lon) in enumerate(NEAR):
        add(client, case_id, "place", f"P{n}", lat=lat, lon=lon)
    case = case_of(case_id)
    download(case, "https://x.com/BashaReport/status/1", 1)
    proposals.propose(case)

    def whole_graph(*args, **kwargs):
        raise AssertionError("the proposals read walked every link")

    monkeypatch.setattr(SqliteCase, "list_links", whole_graph)
    body = client.get(f"/api/cases/{case_id}/proposals").json()
    assert body["pending"] == {"accounts": 1, "posted": 1, "sites": 2}
    assert body["listed"] == 3
