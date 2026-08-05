"""The derivation link layer (ONTOLOGY §3): emission at save time, and the
dependency-aware delete that reads off it.

The rules under test, in one sentence: a tool's save states what its output was
made from, and deleting an entity takes down only what is nothing without it —
never an artifact that stands on its own.
"""

import base64
import io

from PIL import Image
import pytest

from azimut.engine import links as link_engine
from azimut.workspace import Case, CaseError

import graph_read


def _png_bytes(color=(200, 30, 30), size=(64, 48)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, "PNG")
    return buf.getvalue()


def _png_b64() -> str:
    return base64.b64encode(_png_bytes((10, 10, 10))).decode()


def _upload(client, cid, name, data=None):
    return client.post(
        f"/api/cases/{cid}/media/upload",
        files={"file": (name, io.BytesIO(data or _png_bytes()), "image/png")},
    ).json()


def _entity(client, cid, **attrs):
    """The entity whose attrs match, e.g. _entity(client, cid, path='media/a.png').

    The case-open response no longer ships the graph (Step 5), so tests read it in
    process — see tests/graph_read.py.
    """
    return graph_read.entity(cid, **attrs)


def _links(client, cid, type_=None):
    return graph_read.links(cid, type_)


def _add_link(cid, from_id, to_id, type_):
    return Case.open(cid).add_link(from_id, to_id, type_, by="user")


def _new_case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


# The filename stem is the title everywhere, preserving its readable spelling.
def _save_proof(client, cid, title, srcs):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)]}
    body = {"title": title, "spec": spec, "png_base64": _png_b64()}
    return client.post(f"/api/cases/{cid}/proofs", json=body).json()


def _save_session(client, cid, title, source_path):
    body = {"title": title, "spec": {"source": {"path": source_path, "kind": "image"}}}
    return client.post(f"/api/cases/{cid}/inspect/sessions", json=body).json()


# ── emission at save time ───────────────────────────────────────────────────


def test_proof_save_links_to_its_panels(client):
    cid = _new_case(client, "Proof links")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]

    _save_proof(client, cid, "Strike proof", [a, b])

    proof = _entity(client, cid, spec="proofs/.meta/Strike proof.json")
    targets = {lk["to"] for lk in _links(client, cid, "derived-from") if lk["from"] == proof["id"]}
    assert targets == {_entity(client, cid, path=a)["id"], _entity(client, cid, path=b)["id"]}


def test_link_provenance_is_confirmed_and_names_its_tool(client):
    # A derivation is a mechanical fact of the analyst's own click, not a tool's
    # guess — so it is confirmed, not suggested (ONTOLOGY §4).
    cid = _new_case(client, "Provenance")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a])

    link = _links(client, cid, "derived-from")[0]
    assert link["provenance"]["status"] == "confirmed"
    assert link["provenance"]["by"] == "proof-composer"
    assert link["provenance"]["at"].endswith("Z")


def test_resaving_a_proof_reconciles_rather_than_stacks(client):
    cid = _new_case(client, "Reconcile")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]

    _save_proof(client, cid, "P", [a, b])
    _save_proof(client, cid, "P", [a, b])  # same panels, saved twice
    assert len(_links(client, cid, "derived-from")) == 2

    _save_proof(client, cid, "P", [a])  # panel b dropped from the proof
    links = _links(client, cid, "derived-from")
    assert len(links) == 1
    assert links[0]["to"] == _entity(client, cid, path=a)["id"]


def test_resaving_keeps_the_untouched_edge_identical(client):
    # Reconciliation must not churn: an edge that is still true keeps its id and
    # its timestamp, so case.json stays a readable diff.
    cid = _new_case(client, "Stable")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a])
    before = _links(client, cid, "derived-from")[0]
    _save_proof(client, cid, "P", [a])
    assert _links(client, cid, "derived-from")[0] == before


def test_post_save_links_to_its_proof_and_media(client):
    cid = _new_case(client, "Post links")
    a = _upload(client, cid, "a.png", _png_bytes((7, 8, 9)))["item"]["path"]
    _save_proof(client, cid, "P", [a])

    client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Thread", "state": {"proofPng": "proofs/P.png", "mediaPath": a}},
    )

    post = _entity(client, cid, draft=".drafts/Thread.json")
    targets = {lk["to"] for lk in _links(client, cid, "derived-from") if lk["from"] == post["id"]}
    assert targets == {
        _entity(client, cid, spec="proofs/.meta/P.json")["id"],
        _entity(client, cid, path=a)["id"],
    }


def test_post_save_links_to_every_selected_media_file(client):
    cid = _new_case(client, "Post media set")
    a = _upload(client, cid, "a.png", _png_bytes((7, 8, 9)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((3, 4, 5)))["item"]["path"]

    client.post(
        f"/api/cases/{cid}/drafts",
        json={
            "title": "Thread",
            "state": {
                "mediaPaths": [a],
                "extraTweets": [{"text": "", "mediaPaths": [b], "mediaType": "images"}],
            },
        },
    )

    post = _entity(client, cid, draft=".drafts/Thread.json")
    targets = {lk["to"] for lk in _links(client, cid, "derived-from") if lk["from"] == post["id"]}
    assert targets == {_entity(client, cid, path=a)["id"], _entity(client, cid, path=b)["id"]}


def test_session_save_depends_on_its_subject(client):
    cid = _new_case(client, "Session links")
    a = _upload(client, cid, "a.png")["item"]["path"]

    _save_session(client, cid, "Look at a", a)

    session = _entity(client, cid, spec=".inspect/Look at a.json")
    depends = _links(client, cid, "depends-on")
    assert len(depends) == 1
    assert depends[0]["from"] == session["id"]
    assert depends[0]["to"] == _entity(client, cid, path=a)["id"]


def _compose_two(client, cid, a, b):
    """Compose two case images side by side (the modern collage save)."""
    return client.post(
        f"/api/cases/{cid}/inspect/compose",
        json={"width": 220, "height": 100,
              "nodes": [
                  {"src": {"path": a}, "quad": [[0, 0], [100, 0], [100, 100], [0, 100]]},
                  {"src": {"path": b}, "quad": [[110, 0], [210, 0], [210, 100], [110, 100]]},
              ]},
    ).json()


def test_a_derived_media_links_to_its_sources(client):
    # Frames, collages and enhanced videos are all filed through one registration
    # point, so the chain is wired once for every tool that makes imagery — the
    # collage stands in for them all here (Pillow only, no ffmpeg needed).
    cid = _new_case(client, "Derived")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]

    res = _compose_two(client, cid, a, b)

    collage = _entity(client, cid, path=res["item"]["path"])
    targets = {lk["to"] for lk in _links(client, cid, "derived-from") if lk["from"] == collage["id"]}
    assert targets == {_entity(client, cid, path=a)["id"], _entity(client, cid, path=b)["id"]}
    assert all(
        lk["provenance"]["by"] == "inspect"
        for lk in _links(client, cid, "derived-from")
        if lk["from"] == collage["id"]
    )


def test_a_deduped_derivative_still_gets_its_chain_once(client):
    # Re-composing the identical collage yields identical bytes: the file dedupes
    # onto the entity already in the case. The derivation is still true, and must
    # be recorded exactly once rather than stacked on every re-run.
    cid = _new_case(client, "Dedupe")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]

    first = _compose_two(client, cid, a, b)
    second = _compose_two(client, cid, a, b)

    assert second["duplicate"] is True
    assert second["entity"]["id"] == first["entity"]["id"]
    collage_id = first["entity"]["id"]
    assert len([lk for lk in _links(client, cid, "derived-from") if lk["from"] == collage_id]) == 2


def test_upload_and_download_emit_no_links(client):
    # An import's origin is a disk file or a URL — provenance carries it, and
    # there is nothing inside the case to point at.
    cid = _new_case(client, "No links")
    _upload(client, cid, "a.png")
    assert _links(client, cid) == []


def test_lineage_rejects_sources_outside_the_artifact_matrix(client):
    cid = _new_case(client, "Lineage matrix")
    case = Case.open(cid)
    media = case.add_entity("media", "Image", {"path": "media/image.png"}, by="user")
    proof = case.add_entity("proof", "Proof", {"spec": "proofs/.meta/proof.json"}, by="user")
    case.add_entity(
        "proof", "Other proof", {"spec": "proofs/.meta/other.json"}, by="user"
    )
    post = case.add_entity("post", "Post", {"draft": ".drafts/post.json"}, by="user")
    session = case.add_entity(
        "inspect-session", "Session", {"spec": ".inspect/session.json"}, by="user"
    )

    link_engine.sync(
        case, proof["id"], link_engine.DERIVED_FROM, ["media/image.png"], by="proof-composer"
    )
    with pytest.raises(CaseError, match="proof cannot be derived-from a proof"):
        link_engine.sync(
            case,
            proof["id"],
            link_engine.DERIVED_FROM,
            ["proofs/.meta/other.json"],
            by="proof-composer",
        )
    with pytest.raises(CaseError, match="inspect-session cannot be depends-on a proof"):
        link_engine.sync(
            case,
            session["id"],
            link_engine.DEPENDS_ON,
            ["proofs/.meta/proof.json"],
            by="inspect",
        )
    with pytest.raises(CaseError, match="post cannot be derived-from a inspect-session"):
        link_engine.sync(
            case,
            post["id"],
            link_engine.DERIVED_FROM,
            [".inspect/session.json"],
            by="post-composer",
        )
    assert {link["to"] for link in case.links_of(proof["id"])} == {media["id"]}


def test_lineage_cannot_create_a_cycle(client):
    cid = _new_case(client, "Lineage cycle")
    case = Case.open(cid)
    first = case.add_entity("media", "First", {"path": "media/first.png"}, by="user")
    second = case.add_entity("media", "Second", {"path": "media/second.png"}, by="user")

    link_engine.link_all(
        case, first["id"], link_engine.DERIVED_FROM, ["media/second.png"], by="inspect"
    )
    with pytest.raises(CaseError, match="cannot create a cycle"):
        link_engine.link_all(
            case, second["id"], link_engine.DERIVED_FROM, ["media/first.png"], by="inspect"
        )


def test_a_source_deleted_before_the_save_leaves_a_tombstone(client):
    # The tool was open when the panel's media was deleted elsewhere: the path
    # resolves to nothing, so there is no edge to draw — but the fact that the
    # proof was built on it must not vanish in silence.
    cid = _new_case(client, "Late save")
    a = _upload(client, cid, "a.png")["item"]["path"]
    client.delete(f"/api/cases/{cid}/media?path={a}")

    _save_proof(client, cid, "P", [a])

    proof = _entity(client, cid, spec="proofs/.meta/P.json")
    assert _links(client, cid) == []
    assert proof["attrs"]["lost_sources"] == [
        {"path": a, "at": proof["attrs"]["lost_sources"][0]["at"]}
    ]


def test_missing_sources_are_tombstoned_in_one_case_update():
    class FakeCase:
        def __init__(self):
            self.read_count = 0
            self.updates = []

        def get_entity(self, entity_id):
            self.read_count += 1
            return {"id": entity_id, "attrs": {}}

        def update_entity(self, entity_id, changes):
            self.updates.append((entity_id, changes))

    case = FakeCase()
    link_engine.add_tombstones(
        case,
        "post",
        [{"path": "media/a.png"}, {"path": "media/b.png"}, {"path": "media/a.png"}],
    )

    assert case.read_count == 1
    assert len(case.updates) == 1
    lost = case.updates[0][1]["attrs"][link_engine.LOST]
    assert [item["path"] for item in lost] == ["media/a.png", "media/b.png"]


# ── delete: what goes, what stays ──────────────────────────────────────────


def test_deleting_a_subject_deletes_its_session_but_spares_its_outputs(client):
    cid = _new_case(client, "Cascade")
    a = _upload(client, cid, "a.png", _png_bytes((1, 1, 1)))["item"]["path"]
    _save_session(client, cid, "S", a)
    _save_proof(client, cid, "P", [a])

    subject = _entity(client, cid, path=a)
    res = client.delete(f"/api/cases/{cid}/entities/{subject['id']}").json()

    assert res["status"] == "deleted"
    # the session is nothing without its subject: it goes, file and all
    assert _entity(client, cid, spec=".inspect/S.json") is None
    assert client.get(f"/api/cases/{cid}/inspect/sessions/S").status_code == 404
    # the proof stands on its own: it stays, and its export is untouched
    proof = _entity(client, cid, spec="proofs/.meta/P.json")
    assert proof is not None
    assert client.get(f"/files/{cid}/proofs/P.png").status_code == 200


def test_a_survivor_keeps_a_tombstone_of_what_it_lost(client):
    cid = _new_case(client, "Tombstone")
    a = _upload(client, cid, "strike.png")["item"]["path"]
    _save_proof(client, cid, "P", [a])
    subject = _entity(client, cid, path=a)
    sha = subject["attrs"]["sha256"]

    client.delete(f"/api/cases/{cid}/entities/{subject['id']}")

    lost = _entity(client, cid, spec="proofs/.meta/P.json")["attrs"]["lost_sources"]
    assert len(lost) == 1
    # sha256 + path are what make the loss auditable six months later
    assert lost[0]["sha256"] == sha
    assert lost[0]["path"] == a
    assert lost[0]["label"] == "strike"
    assert lost[0]["at"].endswith("Z")


def test_a_survivor_is_only_scarred_by_what_it_derived_from(client):
    # Deleting the media takes the session down with it. The proof derives from
    # the media, not from the session — it must not inherit a scar for something
    # that merely died in the same breath.
    cid = _new_case(client, "Only mine")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a)
    _save_proof(client, cid, "P", [a])

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")

    lost = _entity(client, cid, spec="proofs/.meta/P.json")["attrs"]["lost_sources"]
    assert [t["path"] for t in lost] == [a]


def test_tombstones_never_stack_on_a_second_delete(client):
    cid = _new_case(client, "Once")
    a = _upload(client, cid, "a.png", _png_bytes((2, 2, 2)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((3, 3, 3)))["item"]["path"]
    _save_proof(client, cid, "P", [a, b])

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")
    _save_proof(client, cid, "P", [a, b])  # re-save still names the dead path
    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=b)['id']}")

    lost = _entity(client, cid, spec="proofs/.meta/P.json")["attrs"]["lost_sources"]
    assert sorted(t["path"] for t in lost) == [a, b]


def test_deleting_a_proof_spares_the_post_that_announces_it(client):
    # A post carries the coordinates and the source in its own text: it outlives
    # its proof and only loses the attachment.
    cid = _new_case(client, "Post survives")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a])
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "T", "state": {"proofPng": "proofs/P.png", "description": "kept"}},
    )

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, spec='proofs/.meta/P.json')['id']}")

    post = _entity(client, cid, draft=".drafts/T.json")
    assert post is not None
    assert post["attrs"]["lost_sources"][0]["path"] == "proofs/P.png"
    # the thread text itself is untouched
    assert client.get(f"/api/cases/{cid}/drafts/T").json()["state"]["description"] == "kept"


def test_cascade_is_transitive_through_depends_on(client):
    cid = _new_case(client, "Deep")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S1", a)
    # a second session opened over the first one's spec — contrived, but it is
    # what a future tool nesting sessions would produce, and it must follow.
    s1 = _entity(client, cid, spec=".inspect/S1.json")
    s2 = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "inspect-session", "label": "S2", "attrs": {"spec": ".inspect/s2.json"}},
    ).json()
    _add_link(cid, s2["id"], s1["id"], "depends-on")

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")

    assert _entity(client, cid, spec=".inspect/S1.json") is None
    assert _entity(client, cid, spec=".inspect/s2.json") is None


def test_a_session_over_a_frame_survives_the_frames_video_going(client):
    # The frame is derived from the video, so it survives; the session over the
    # frame therefore has its subject and survives too. Only the session opened
    # on the video itself goes.
    cid = _new_case(client, "Frame session")
    video = _upload(client, cid, "v.png", _png_bytes((9, 9, 9)))["item"]["path"]
    frame = _upload(client, cid, "f.png", _png_bytes((8, 8, 8)))["item"]["path"]
    _add_link(
        cid,
        _entity(client, cid, path=frame)["id"],
        _entity(client, cid, path=video)["id"],
        "derived-from",
    )
    _save_session(client, cid, "On the video", video)
    _save_session(client, cid, "On the frame", frame)

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=video)['id']}")

    assert _entity(client, cid, spec=".inspect/On the video.json") is None
    assert _entity(client, cid, spec=".inspect/On the frame.json") is not None
    assert _entity(client, cid, path=frame) is not None


def test_deleting_an_entity_drops_the_links_touching_it(client):
    cid = _new_case(client, "Edges")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a])
    assert len(_links(client, cid)) == 1

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")
    assert _links(client, cid) == []


# ── the same rules from every door ─────────────────────────────────────────


def test_the_media_library_delete_honours_the_graph(client):
    # The confirm dialog lives in the sidebar, but the rules cannot: deleting the
    # same media from its own tool must do exactly the same thing.
    cid = _new_case(client, "Via library")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a)
    _save_proof(client, cid, "P", [a])

    client.delete(f"/api/cases/{cid}/media?path={a}")

    assert _entity(client, cid, spec=".inspect/S.json") is None
    assert _entity(client, cid, spec="proofs/.meta/P.json")["attrs"]["lost_sources"][0]["path"] == a


def test_the_inspect_delete_honours_the_graph(client):
    cid = _new_case(client, "Via inspect")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a)

    client.delete(f"/api/cases/{cid}/inspect/sessions/S")

    # a session deleted on its own takes nothing with it: its subject stands
    assert _entity(client, cid, spec=".inspect/S.json") is None
    assert _entity(client, cid, path=a) is not None
    assert _links(client, cid) == []


def test_the_satellite_delete_honours_the_graph(client):
    cid = _new_case(client, "Via satellite")
    a = _upload(client, cid, "cap.png")["item"]["path"]
    _save_session(client, cid, "S", a)

    client.delete(f"/api/cases/{cid}/satellite?path={a}")

    assert _entity(client, cid, spec=".inspect/S.json") is None


def test_a_tool_delete_still_drops_an_unfiled_artifact(client):
    # An artifact with no entity has no graph to honour, but its file must go.
    cid = _new_case(client, "Orphan")
    case = client.get(f"/api/cases/{cid}").json()
    client.post(f"/api/cases/{cid}/proofs", json={"title": "P", "spec": {"panels": []}, "name": "p"})
    proof = _entity(client, cid, spec="proofs/.meta/P.json")
    client.delete(f"/api/cases/{cid}/entities/{proof['id']}")  # entity + files gone

    # re-create the file alone, with no entity behind it
    client.post(f"/api/cases/{cid}/proofs", json={"title": "P", "spec": {"panels": []}, "name": "p"})
    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, spec='proofs/.meta/P.json')['id']}")
    assert client.get(f"/api/cases/{cid}/proofs/P").status_code == 404
    assert case["id"] == cid


# ── the dependents preview that feeds the dialog ───────────────────────────


def test_dependents_endpoint_reports_the_plan(client):
    cid = _new_case(client, "Preview")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a)
    _save_proof(client, cid, "P", [a])

    subject = _entity(client, cid, path=a)
    plan = client.get(f"/api/cases/{cid}/entities/{subject['id']}/dependents").json()

    assert [e["label"] for e in plan["cascade"]] == ["S"]
    assert [e["label"] for e in plan["tombstone"]] == ["P"]
    # and it changed nothing
    assert _entity(client, cid, path=a) is not None


def test_dependents_endpoint_is_empty_for_a_lone_entity(client):
    cid = _new_case(client, "Lonely")
    a = _upload(client, cid, "a.png")["item"]["path"]
    plan = client.get(
        f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}/dependents"
    ).json()
    assert plan == {"cascade": [], "tombstone": []}


def test_dependents_endpoint_404s_on_an_unknown_entity(client):
    cid = _new_case(client, "Ghost")
    assert client.get(f"/api/cases/{cid}/entities/e_nope/dependents").status_code == 404


# ── the derivation chain the Details panel reads ───────────────────────────


def test_chain_endpoint_reads_sources_and_dependents(client):
    cid = _new_case(client, "Chain")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a])

    media = _entity(client, cid, path=a)
    proof = _entity(client, cid, spec="proofs/.meta/P.json")

    proof_chain = client.get(f"/api/cases/{cid}/entities/{proof['id']}/chain").json()
    assert proof_chain["entity"]["id"] == proof["id"]
    assert len(proof_chain["sources"]) == 1
    src = proof_chain["sources"][0]
    assert src["entity"]["id"] == media["id"] and src["type"] == "derived-from"
    assert proof_chain["dependents"] == [] and proof_chain["empty"] is False

    # the mirror: the media sees the proof among its dependents
    media_chain = client.get(f"/api/cases/{cid}/entities/{media['id']}/chain").json()
    assert [d["entity"]["id"] for d in media_chain["dependents"]] == [proof["id"]]
    assert media_chain["sources"] == []


def test_chain_endpoint_includes_lost_sources_and_404s(client):
    cid = _new_case(client, "Chain lost")
    a = _upload(client, cid, "a.png")["item"]["path"]
    client.delete(f"/api/cases/{cid}/media?path={a}")
    _save_proof(client, cid, "P", [a])  # source gone → tombstone, no edge

    proof = _entity(client, cid, spec="proofs/.meta/P.json")
    chain = client.get(f"/api/cases/{cid}/entities/{proof['id']}/chain").json()
    assert [t["path"] for t in chain["lost"]] == [a]
    assert chain["empty"] is False

    assert client.get(f"/api/cases/{cid}/entities/e_nope/chain").status_code == 404


def test_chain_endpoint_is_empty_for_a_lone_entity(client):
    cid = _new_case(client, "Chain lone")
    a = _upload(client, cid, "a.png")["item"]["path"]
    chain = client.get(
        f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}/chain"
    ).json()
    assert chain["sources"] == [] and chain["dependents"] == [] and chain["lost"] == []
    assert chain["empty"] is True


def test_chain_endpoint_exposes_and_triages_a_suggested_location_relation(client):
    cid = _new_case(client, "Suggested relation")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    place = case.add_entity("place", "Point", by="enrich", status="suggested")
    link = case.add_link(
        media["id"],
        place["id"],
        "located-at",
        by="enrich",
        status="suggested",
    )

    relation = client.get(f"/api/cases/{cid}/entities/{media['id']}/chain").json()[
        "relations"
    ][0]
    assert relation["entity"]["id"] == place["id"]
    assert relation["link"]["id"] == link["id"]
    assert relation["direction"] == "out"

    confirmed = client.patch(
        f"/api/cases/{cid}/links/{link['id']}",
        json={"status": "confirmed"},
    ).json()
    assert confirmed["provenance"]["status"] == "confirmed"

    assert client.delete(f"/api/cases/{cid}/links/{link['id']}").json() == {
        "status": "deleted"
    }
    assert case.links_of(media["id"]) == []


def test_confirming_a_suggested_place_confirms_its_location_links(client):
    cid = _new_case(client, "Confirm location")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    place = case.add_entity("place", "Point", by="enrich", status="suggested")
    link = case.add_link(
        media["id"],
        place["id"],
        "located-at",
        by="enrich",
        status="suggested",
    )

    response = client.patch(
        f"/api/cases/{cid}/entities/{place['id']}",
        json={"status": "confirmed"},
    )

    assert response.json()["provenance"]["status"] == "confirmed"
    confirmed_link = next(
        item for item in case.links_of(place["id"]) if item["id"] == link["id"]
    )
    assert confirmed_link["provenance"]["status"] == "confirmed"


def test_lookup_endpoint_resolves_an_entity_by_attr(client):
    cid = _new_case(client, "Lookup")
    a = _upload(client, cid, "a.png")["item"]["path"]
    ent = _entity(client, cid, path=a)

    hit = client.get(f"/api/cases/{cid}/entities/lookup?attr=path&value={a}").json()
    assert hit["entity"]["id"] == ent["id"]
    miss = client.get(f"/api/cases/{cid}/entities/lookup?attr=path&value=media/none.jpg").json()
    assert miss["entity"] is None


def test_derivation_endpoint_returns_the_closure_and_404s(client):
    cid = _new_case(client, "Derivation")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]
    _save_proof(client, cid, "P", [a, b])
    proof = _entity(client, cid, spec="proofs/.meta/P.json")

    sub = client.get(f"/api/cases/{cid}/entities/{proof['id']}/derivation").json()
    ids = {e["id"] for e in sub["entities"]}
    assert ids == {proof["id"], _entity(client, cid, path=a)["id"], _entity(client, cid, path=b)["id"]}
    assert len(sub["links"]) == 2 and all(lk["type"] == "derived-from" for lk in sub["links"])

    assert client.get(f"/api/cases/{cid}/entities/e_nope/derivation").status_code == 404


# ── relations: the non-chain vocabulary, stated by hand ─────────────────────


def test_relation_vocabulary_says_how_each_type_reads_and_who_may_state_it(client):
    entries = {row["type"]: row for row in client.get("/api/cases/relation-types").json()}

    assert entries["located-at"]["label"] == "was recorded at"
    assert entries["located-at"]["inverse_label"] == "was recorded here"
    assert entries["located-at"]["from_types"] == ["media"]
    assert entries["located-at"]["to_types"] == ["place"]
    assert entries["located-at"]["from_media_kinds"] == ["audio", "image", "video"]
    assert entries["located-at"]["manual"] is True
    assert entries["in-network"]["from_types"] == ["ip", "network"]
    assert entries["in-network"]["to_types"] == ["network"]
    assert entries["mentions"]["action"] == "mention"
    assert {entries[type_]["action"] for type_ in ("about", "at", "cites")} == {"claim"}
    # enrichment's own claim: named so the UI can say it, never offered by hand
    assert entries["same-image-as"]["manual"] is False
    assert entries["same-image-as"]["from_media_kinds"] == ["image"]


def test_the_analyst_can_state_a_relation_and_it_lands_confirmed(client):
    cid = _new_case(client, "Stated relation")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    place = case.add_entity("place", "Checkpoint", {"lat": 48.0, "lon": 37.8}, by="user")

    link = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": media["id"], "to_id": place["id"], "type": "located-at"},
    ).json()

    assert link["from"] == media["id"] and link["to"] == place["id"]
    # a click is not a guess: there is nothing left for the analyst to review
    assert link["provenance"] == {
        "by": "user",
        "at": link["provenance"]["at"],
        "status": "confirmed",
    }
    # stating it twice is the same one edge, not two
    again = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": media["id"], "to_id": place["id"], "type": "located-at"},
    ).json()
    assert again["id"] == link["id"]
    assert len(case.links_of(place["id"])) == 1


def test_a_stated_relation_is_refused_when_the_ontology_has_no_reading(client):
    cid = _new_case(client, "Refused relations")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    other = case.add_entity("media", "Other", {"path": "media/other.jpg"}, by="user")
    place = case.add_entity("place", "Checkpoint", {"lat": 48.0, "lon": 37.8}, by="user")

    def post(from_id, to_id, type_):
        return client.post(
            f"/api/cases/{cid}/links",
            json={"from_id": from_id, "to_id": to_id, "type": type_},
        )

    # a derivation records what a save did; it is never asserted after the fact
    assert post(media["id"], place["id"], "derived-from").status_code == 400
    # the wrong way round: a place is not recorded at a photo
    assert post(place["id"], media["id"], "located-at").status_code == 400
    # a perceptual-hash match is enrichment's claim, not a person's
    assert post(media["id"], other["id"], "same-image-as").status_code == 400
    # free-typed labels stay valid in stored data, but nothing outside the
    # registry can be minted through the API
    assert post(media["id"], place["id"], "depicts-vaguely").status_code == 400
    assert post(media["id"], media["id"], "located-at").status_code == 400
    assert post(media["id"], "e_ghost", "located-at").status_code == 400

    assert case.links_of(media["id"]) == []


def test_media_relations_respect_the_file_kind(client):
    cid = _new_case(client, "Media kinds")
    case = Case.open(cid)
    image = case.add_entity("media", "Still", {"path": "media/still.jpg"}, by="user")
    audio = case.add_entity("media", "Call", {"path": "media/call.wav"}, by="user")
    document = case.add_entity("media", "Report", {"path": "media/report.pdf"}, by="user")
    capture = case.add_entity("capture", "Map", {"path": "captures/map.png"}, by="user")
    person = case.add_entity("person", "Witness", {}, by="user")
    place = case.add_entity("place", "Station", {"lat": 1.0, "lon": 2.0}, by="user")

    def post(from_id, to_id, type_):
        return client.post(
            f"/api/cases/{cid}/links",
            json={"from_id": from_id, "to_id": to_id, "type": type_},
        )

    assert post(image["id"], place["id"], "located-at").status_code == 200
    assert post(audio["id"], place["id"], "located-at").status_code == 200
    assert post(document["id"], place["id"], "located-at").status_code == 400
    assert post(capture["id"], place["id"], "located-at").status_code == 400
    assert post(image["id"], place["id"], "depicts").status_code == 200
    assert post(audio["id"], place["id"], "depicts").status_code == 400
    assert post(person["id"], image["id"], "appears-in").status_code == 200
    assert post(person["id"], audio["id"], "appears-in").status_code == 400


def test_networks_link_ips_and_parent_networks_without_cycles(client):
    cid = _new_case(client, "Networks")
    case = Case.open(cid)
    ip = case.add_entity("ip", "203.0.113.42", {}, by="user")
    subnet = case.add_entity("network", "203.0.113.0/24", {}, by="user")
    parent = case.add_entity("network", "203.0.112.0/23", {}, by="user")

    assert client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": ip["id"], "to_id": subnet["id"], "type": "in-network"},
    ).status_code == 200
    assert client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": subnet["id"], "to_id": parent["id"], "type": "in-network"},
    ).status_code == 200
    assert client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": parent["id"], "to_id": subnet["id"], "type": "in-network"},
    ).status_code == 400


def test_organization_containment_cannot_create_a_cycle(client):
    cid = _new_case(client, "Organization cycle")
    case = Case.open(cid)
    unit = case.add_entity("organization", "Unit", {}, by="user")
    command = case.add_entity("organization", "Command", {}, by="user")

    assert client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": unit["id"], "to_id": command["id"], "type": "part-of"},
    ).status_code == 200
    assert client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": command["id"], "to_id": unit["id"], "type": "part-of"},
    ).status_code == 400


def test_an_older_out_of_matrix_connection_is_removable_but_not_rewordable(client):
    cid = _new_case(client, "Older connection")
    case = Case.open(cid)
    person = case.add_entity("person", "Member", {}, by="user")
    organization = case.add_entity("organization", "Group", {}, by="user")
    legacy = case.add_link(person["id"], organization["id"], "part-of", by="user")

    refused = client.patch(
        f"/api/cases/{cid}/links/{legacy['id']}", json={"type": "member-of"}
    )
    assert refused.status_code == 400
    assert client.delete(f"/api/cases/{cid}/links/{legacy['id']}").status_code == 200
    assert case.links_of(person["id"]) == []


def test_a_relation_can_be_restated_corrected_and_taken_back(client):
    """Relations are editable for as long as the case is open: a wrong reading is
    corrected on the same edge — same id, same provenance — and any relation can be
    removed, whether a tool proposed it or the analyst stated it."""
    cid = _new_case(client, "Editable relations")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    place = case.add_entity("place", "Checkpoint", {"lat": 48.0, "lon": 37.8}, by="user")
    link = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": media["id"], "to_id": place["id"], "type": "located-at"},
    ).json()

    restated = client.patch(
        f"/api/cases/{cid}/links/{link['id']}", json={"type": "depicts"}
    ).json()
    assert restated["id"] == link["id"]  # one edge corrected, not replaced
    assert restated["type"] == "depicts"
    assert restated["provenance"]["at"] == link["provenance"]["at"]

    assert client.delete(f"/api/cases/{cid}/links/{link['id']}").json() == {
        "status": "deleted"
    }
    assert case.links_of(media["id"]) == []


def test_restating_a_relation_is_refused_outside_the_vocabulary(client):
    cid = _new_case(client, "Refused restatements")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    other = case.add_entity("media", "Other", {"path": "media/other.jpg"}, by="user")
    place = case.add_entity("place", "Checkpoint", {"lat": 48.0, "lon": 37.8}, by="user")
    located = case.add_link(media["id"], place["id"], "located-at", by="user")
    depicts = case.add_link(media["id"], place["id"], "depicts", by="user")
    hashed = case.add_link(media["id"], other["id"], "same-image-as", by="enrich")
    derived = case.add_link(media["id"], other["id"], "derived-from", by="user")

    def patch(link_id, body):
        return client.patch(f"/api/cases/{cid}/links/{link_id}", json=body)

    # the pair already holds that reading: two identical edges would say it twice
    assert patch(located["id"], {"type": "depicts"}).status_code == 400
    # a perceptual-hash match is enrichment's claim, not the analyst's to reword
    assert patch(hashed["id"], {"type": "located-at"}).status_code == 400
    # a derivation records what a save did
    assert patch(derived["id"], {"type": "located-at"}).status_code == 400
    # ...and nothing outside the registry can be minted through a restatement
    assert patch(depicts["id"], {"type": "vaguely-near"}).status_code == 400
    assert patch("l_ghost", {"type": "depicts"}).status_code == 404
    assert patch(depicts["id"], {}).status_code == 400  # nothing to update

    assert {item["type"] for item in case.links_of(media["id"])} == {
        "located-at", "depicts", "same-image-as", "derived-from"
    }


def test_confirming_a_relation_confirms_the_point_it_proposes(client):
    """The two halves of an enrichment suggestion are one claim, so the Suggestions
    list and the relation rows never disagree about the same click: accepting "this
    file was recorded at this point" accepts the point too."""
    cid = _new_case(client, "Symmetric confirm")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    place = case.add_entity(
        "place", "48.858370, 2.294481", {"lat": 48.85837, "lon": 2.294481},
        by="enrich", status="suggested",
    )
    link = case.add_link(
        media["id"], place["id"], "located-at", by="enrich", status="suggested"
    )

    confirmed = client.patch(
        f"/api/cases/{cid}/links/{link['id']}", json={"status": "confirmed"}
    ).json()

    assert confirmed["provenance"]["status"] == "confirmed"
    assert case.get_entity(place["id"])["provenance"]["status"] == "confirmed"
    # the media was already the analyst's own import: nothing to change there
    assert case.get_entity(media["id"])["provenance"]["status"] == "confirmed"


def test_dismissing_a_relation_leaves_the_point_it_proposed_alone(client):
    """Dropping the edge is not a verdict on the point. A place can be real while
    one file's claim about it is wrong, and deleting entities behind a dismiss
    would make a one-click triage destructive."""
    cid = _new_case(client, "Dismiss keeps the point")
    case = Case.open(cid)
    media = case.add_entity("media", "Photo", {"path": "media/photo.jpg"}, by="user")
    place = case.add_entity("place", "Point", {"lat": 1.0, "lon": 2.0}, by="enrich", status="suggested")
    link = case.add_link(media["id"], place["id"], "located-at", by="enrich", status="suggested")

    client.delete(f"/api/cases/{cid}/links/{link['id']}")

    assert case.get_entity(place["id"])["provenance"]["status"] == "suggested"
    assert case.links_of(place["id"]) == []


def test_a_derivation_cannot_be_taken_back_as_if_it_were_a_relation(client):
    """A derivation is recorded by the save that produced it, and deleting one here
    would lose it without the tombstone `losses` reads. The POST and the type
    correction both refuse chain types; the delete has to agree with them."""
    cid = _new_case(client, "Chain is not a relation")
    case = Case.open(cid)
    crop = case.add_entity("media", "Crop", {"path": "media/crop.png"}, by="user")
    source = case.add_entity("media", "Source", {"path": "media/source.png"}, by="user")
    chain = case.add_link(crop["id"], source["id"], "derived-from", by="inspect")

    refused = client.delete(f"/api/cases/{cid}/links/{chain['id']}")

    assert refused.status_code == 400
    assert "derivation" in refused.json()["detail"]
    assert case.get_link(chain["id"]) is not None

    # a link that never existed is still a 404, not a 400
    assert client.delete(f"/api/cases/{cid}/links/l_nope").status_code == 404


def test_confirming_an_entity_accepts_the_point_its_suggestion_named(client):
    """The two halves of an enrichment suggestion are one claim. Confirming the
    photo cannot leave the place it was proposed at sitting in Suggestions, or the
    map chips a point "suggested" while the relation row beside it reads as a
    finding — the same invariant confirming the edge itself carries."""
    cid = _new_case(client, "Confirm both halves")
    case = Case.open(cid)
    photo = case.add_entity(
        "media", "Photo", {"path": "media/photo.jpg"}, by="enrich", status="suggested"
    )
    place = case.add_entity(
        "place", "Point", {"lat": 1.0, "lon": 2.0}, by="enrich", status="suggested"
    )
    link = case.add_link(photo["id"], place["id"], "located-at", by="enrich", status="suggested")

    client.patch(f"/api/cases/{cid}/entities/{photo['id']}", json={"status": "confirmed"})

    assert case.get_entity(photo["id"])["provenance"]["status"] == "confirmed"
    assert case.get_link(link["id"])["provenance"]["status"] == "confirmed"
    assert case.get_entity(place["id"])["provenance"]["status"] == "confirmed"


def test_confirming_an_entity_stops_at_one_hop(client):
    """Accepting a photo's own point is a reading of that photo, not a licence to
    accept whatever else that point was separately proposed to be."""
    cid = _new_case(client, "One hop")
    case = Case.open(cid)
    photo = case.add_entity(
        "media", "Photo", {"path": "media/photo.jpg"}, by="enrich", status="suggested"
    )
    place = case.add_entity(
        "place", "Point", {"lat": 1.0, "lon": 2.0}, by="enrich", status="suggested"
    )
    other = case.add_entity(
        "media", "Other", {"path": "media/other.jpg"}, by="enrich", status="suggested"
    )
    case.add_link(photo["id"], place["id"], "located-at", by="enrich", status="suggested")
    far = case.add_link(other["id"], place["id"], "located-at", by="enrich", status="suggested")

    client.patch(f"/api/cases/{cid}/entities/{photo['id']}", json={"status": "confirmed"})

    # the place came along, one hop out; the second photo's own claim did not
    assert case.get_entity(place["id"])["provenance"]["status"] == "confirmed"
    assert case.get_link(far["id"])["provenance"]["status"] == "suggested"
    assert case.get_entity(other["id"])["provenance"]["status"] == "suggested"
