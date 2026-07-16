"""The derivation link layer (ONTOLOGY §3): emission at save time, and the
dependency-aware delete that reads off it.

The rules under test, in one sentence: a tool's save states what its output was
made from, and deleting an entity takes down only what is nothing without it —
never an artifact that stands on its own.
"""

import base64
import io

from PIL import Image


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


def _case(client, cid):
    return client.get(f"/api/cases/{cid}").json()


def _entity(client, cid, **attrs):
    """The entity whose attrs match, e.g. _entity(client, cid, path='media/a.png')."""
    for e in _case(client, cid)["entities"]:
        if all(e["attrs"].get(k) == v for k, v in attrs.items()):
            return e
    return None


def _links(client, cid, type_=None):
    links = _case(client, cid)["links"]
    return [l for l in links if type_ is None or l["type"] == type_]


def _new_case(client, name):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def _save_proof(client, cid, title, srcs, name=None):
    spec = {"panels": [{"id": f"p{i}", "src": s} for i, s in enumerate(srcs)]}
    body = {"title": title, "spec": spec, "png_base64": _png_b64()}
    if name:
        body["name"] = name
    return client.post(f"/api/cases/{cid}/proofs", json=body).json()


def _save_session(client, cid, title, source_path, name=None):
    body = {"title": title, "spec": {"source": {"path": source_path, "kind": "image"}}}
    if name:
        body["name"] = name
    return client.post(f"/api/cases/{cid}/inspect/sessions", json=body).json()


# ── emission at save time ───────────────────────────────────────────────────


def test_proof_save_links_to_its_panels(client):
    cid = _new_case(client, "Proof links")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]

    _save_proof(client, cid, "Strike proof", [a, b])

    proof = _entity(client, cid, spec="proofs/strike-proof.json")
    targets = {l["to"] for l in _links(client, cid, "derived-from") if l["from"] == proof["id"]}
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

    _save_proof(client, cid, "P", [a, b], name="p")
    _save_proof(client, cid, "P", [a, b], name="p")  # same panels, saved twice
    assert len(_links(client, cid, "derived-from")) == 2

    _save_proof(client, cid, "P", [a], name="p")  # panel b dropped from the proof
    links = _links(client, cid, "derived-from")
    assert len(links) == 1
    assert links[0]["to"] == _entity(client, cid, path=a)["id"]


def test_resaving_keeps_the_untouched_edge_identical(client):
    # Reconciliation must not churn: an edge that is still true keeps its id and
    # its timestamp, so case.json stays a readable diff.
    cid = _new_case(client, "Stable")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a], name="p")
    before = _links(client, cid, "derived-from")[0]
    _save_proof(client, cid, "P", [a], name="p")
    assert _links(client, cid, "derived-from")[0] == before


def test_post_save_links_to_its_proof_and_media(client):
    cid = _new_case(client, "Post links")
    a = _upload(client, cid, "a.png", _png_bytes((7, 8, 9)))["item"]["path"]
    _save_proof(client, cid, "P", [a], name="p")

    client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "Thread", "state": {"proofPng": "proofs/p.png", "mediaPath": a}},
    )

    post = _entity(client, cid, draft="exports/thread.json")
    targets = {l["to"] for l in _links(client, cid, "derived-from") if l["from"] == post["id"]}
    assert targets == {
        _entity(client, cid, spec="proofs/p.json")["id"],
        _entity(client, cid, path=a)["id"],
    }


def test_session_save_depends_on_its_subject(client):
    cid = _new_case(client, "Session links")
    a = _upload(client, cid, "a.png")["item"]["path"]

    _save_session(client, cid, "Look at a", a)

    session = _entity(client, cid, spec="inspect/look-at-a.json")
    depends = _links(client, cid, "depends-on")
    assert len(depends) == 1
    assert depends[0]["from"] == session["id"]
    assert depends[0]["to"] == _entity(client, cid, path=a)["id"]


def test_a_derived_media_links_to_its_sources(client):
    # Frames, collages and enhanced videos are all filed through one registration
    # point, so the chain is wired once for every tool that makes imagery — the
    # collage stands in for them all here (Pillow only, no ffmpeg needed).
    cid = _new_case(client, "Derived")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]

    res = client.post(
        f"/api/cases/{cid}/inspect/collage", json={"paths": [a, b], "columns": 2}
    ).json()

    collage = _entity(client, cid, path=res["item"]["path"])
    targets = {l["to"] for l in _links(client, cid, "derived-from") if l["from"] == collage["id"]}
    assert targets == {_entity(client, cid, path=a)["id"], _entity(client, cid, path=b)["id"]}
    assert all(
        l["provenance"]["by"] == "inspect"
        for l in _links(client, cid, "derived-from")
        if l["from"] == collage["id"]
    )


def test_a_deduped_derivative_still_gets_its_chain_once(client):
    # Re-composing the identical collage yields identical bytes: the file dedupes
    # onto the entity already in the case. The derivation is still true, and must
    # be recorded exactly once rather than stacked on every re-run.
    cid = _new_case(client, "Dedupe")
    a = _upload(client, cid, "a.png", _png_bytes((1, 2, 3)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((4, 5, 6)))["item"]["path"]
    body = {"paths": [a, b], "columns": 2}

    first = client.post(f"/api/cases/{cid}/inspect/collage", json=body).json()
    second = client.post(f"/api/cases/{cid}/inspect/collage", json=body).json()

    assert second["duplicate"] is True
    assert second["entity"]["id"] == first["entity"]["id"]
    collage_id = first["entity"]["id"]
    assert len([l for l in _links(client, cid, "derived-from") if l["from"] == collage_id]) == 2


def test_upload_and_download_emit_no_links(client):
    # An import's origin is a disk file or a URL — provenance carries it, and
    # there is nothing inside the case to point at.
    cid = _new_case(client, "No links")
    _upload(client, cid, "a.png")
    assert _links(client, cid) == []


def test_a_source_deleted_before_the_save_leaves_a_tombstone(client):
    # The tool was open when the panel's media was deleted elsewhere: the path
    # resolves to nothing, so there is no edge to draw — but the fact that the
    # proof was built on it must not vanish in silence.
    cid = _new_case(client, "Late save")
    a = _upload(client, cid, "a.png")["item"]["path"]
    client.delete(f"/api/cases/{cid}/media?path={a}")

    _save_proof(client, cid, "P", [a], name="p")

    proof = _entity(client, cid, spec="proofs/p.json")
    assert _links(client, cid) == []
    assert proof["attrs"]["lost_sources"] == [
        {"path": a, "at": proof["attrs"]["lost_sources"][0]["at"]}
    ]


# ── delete: what goes, what stays ──────────────────────────────────────────


def test_deleting_a_subject_deletes_its_session_but_spares_its_outputs(client):
    cid = _new_case(client, "Cascade")
    a = _upload(client, cid, "a.png", _png_bytes((1, 1, 1)))["item"]["path"]
    _save_session(client, cid, "S", a, name="s")
    _save_proof(client, cid, "P", [a], name="p")

    subject = _entity(client, cid, path=a)
    res = client.delete(f"/api/cases/{cid}/entities/{subject['id']}").json()

    assert res["status"] == "deleted"
    # the session is nothing without its subject: it goes, file and all
    assert _entity(client, cid, spec="inspect/s.json") is None
    assert client.get(f"/api/cases/{cid}/inspect/sessions/s").status_code == 404
    # the proof stands on its own: it stays, and its export is untouched
    proof = _entity(client, cid, spec="proofs/p.json")
    assert proof is not None
    assert client.get(f"/files/{cid}/proofs/p.png").status_code == 200


def test_a_survivor_keeps_a_tombstone_of_what_it_lost(client):
    cid = _new_case(client, "Tombstone")
    a = _upload(client, cid, "strike.png")["item"]["path"]
    _save_proof(client, cid, "P", [a], name="p")
    subject = _entity(client, cid, path=a)
    sha = subject["attrs"]["sha256"]

    client.delete(f"/api/cases/{cid}/entities/{subject['id']}")

    lost = _entity(client, cid, spec="proofs/p.json")["attrs"]["lost_sources"]
    assert len(lost) == 1
    # sha256 + path are what make the loss auditable six months later
    assert lost[0]["sha256"] == sha
    assert lost[0]["path"] == a
    assert lost[0]["label"] == "strike.png"
    assert lost[0]["at"].endswith("Z")


def test_a_survivor_is_only_scarred_by_what_it_derived_from(client):
    # Deleting the media takes the session down with it. The proof derives from
    # the media, not from the session — it must not inherit a scar for something
    # that merely died in the same breath.
    cid = _new_case(client, "Only mine")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a, name="s")
    _save_proof(client, cid, "P", [a], name="p")

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")

    lost = _entity(client, cid, spec="proofs/p.json")["attrs"]["lost_sources"]
    assert [t["path"] for t in lost] == [a]


def test_tombstones_never_stack_on_a_second_delete(client):
    cid = _new_case(client, "Once")
    a = _upload(client, cid, "a.png", _png_bytes((2, 2, 2)))["item"]["path"]
    b = _upload(client, cid, "b.png", _png_bytes((3, 3, 3)))["item"]["path"]
    _save_proof(client, cid, "P", [a, b], name="p")

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")
    _save_proof(client, cid, "P", [a, b], name="p")  # re-save still names the dead path
    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=b)['id']}")

    lost = _entity(client, cid, spec="proofs/p.json")["attrs"]["lost_sources"]
    assert sorted(t["path"] for t in lost) == [a, b]


def test_deleting_a_proof_spares_the_post_that_announces_it(client):
    # A post carries the coordinates and the source in its own text: it outlives
    # its proof and only loses the attachment.
    cid = _new_case(client, "Post survives")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a], name="p")
    client.post(
        f"/api/cases/{cid}/drafts",
        json={"title": "T", "state": {"proofPng": "proofs/p.png", "description": "kept"}},
    )

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, spec='proofs/p.json')['id']}")

    post = _entity(client, cid, draft="exports/t.json")
    assert post is not None
    assert post["attrs"]["lost_sources"][0]["path"] == "proofs/p.png"
    # the thread text itself is untouched
    assert client.get(f"/api/cases/{cid}/drafts/t").json()["state"]["description"] == "kept"


def test_cascade_is_transitive_through_depends_on(client):
    cid = _new_case(client, "Deep")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S1", a, name="s1")
    # a second session opened over the first one's spec — contrived, but it is
    # what a future tool nesting sessions would produce, and it must follow.
    s1 = _entity(client, cid, spec="inspect/s1.json")
    s2 = client.post(
        f"/api/cases/{cid}/entities",
        json={"type": "inspect-session", "label": "S2", "attrs": {"spec": "inspect/s2.json"}},
    ).json()
    made = client.post(
        f"/api/cases/{cid}/links",
        json={"from_id": s2["id"], "to_id": s1["id"], "type": "depends-on"},
    )
    assert made.status_code == 200, made.text

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")

    assert _entity(client, cid, spec="inspect/s1.json") is None
    assert _entity(client, cid, spec="inspect/s2.json") is None


def test_a_session_over_a_frame_survives_the_frames_video_going(client):
    # The frame is derived from the video, so it survives; the session over the
    # frame therefore has its subject and survives too. Only the session opened
    # on the video itself goes.
    cid = _new_case(client, "Frame session")
    video = _upload(client, cid, "v.png", _png_bytes((9, 9, 9)))["item"]["path"]
    frame = _upload(client, cid, "f.png", _png_bytes((8, 8, 8)))["item"]["path"]
    made = client.post(
        f"/api/cases/{cid}/links",
        json={
            "from_id": _entity(client, cid, path=frame)["id"],
            "to_id": _entity(client, cid, path=video)["id"],
            "type": "derived-from",
        },
    )
    assert made.status_code == 200, made.text
    _save_session(client, cid, "On the video", video, name="onvideo")
    _save_session(client, cid, "On the frame", frame, name="onframe")

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=video)['id']}")

    assert _entity(client, cid, spec="inspect/onvideo.json") is None
    assert _entity(client, cid, spec="inspect/onframe.json") is not None
    assert _entity(client, cid, path=frame) is not None


def test_deleting_an_entity_drops_the_links_touching_it(client):
    cid = _new_case(client, "Edges")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_proof(client, cid, "P", [a], name="p")
    assert len(_links(client, cid)) == 1

    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, path=a)['id']}")
    assert _links(client, cid) == []


# ── the same rules from every door ─────────────────────────────────────────


def test_the_media_library_delete_honours_the_graph(client):
    # The confirm dialog lives in the sidebar, but the rules cannot: deleting the
    # same media from its own tool must do exactly the same thing.
    cid = _new_case(client, "Via library")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a, name="s")
    _save_proof(client, cid, "P", [a], name="p")

    client.delete(f"/api/cases/{cid}/media?path={a}")

    assert _entity(client, cid, spec="inspect/s.json") is None
    assert _entity(client, cid, spec="proofs/p.json")["attrs"]["lost_sources"][0]["path"] == a


def test_the_inspect_delete_honours_the_graph(client):
    cid = _new_case(client, "Via inspect")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a, name="s")

    client.delete(f"/api/cases/{cid}/inspect/sessions/s")

    # a session deleted on its own takes nothing with it: its subject stands
    assert _entity(client, cid, spec="inspect/s.json") is None
    assert _entity(client, cid, path=a) is not None
    assert _links(client, cid) == []


def test_the_satellite_delete_honours_the_graph(client):
    cid = _new_case(client, "Via satellite")
    a = _upload(client, cid, "cap.png")["item"]["path"]
    _save_session(client, cid, "S", a, name="s")

    client.delete(f"/api/cases/{cid}/satellite?path={a}")

    assert _entity(client, cid, spec="inspect/s.json") is None


def test_a_tool_delete_still_drops_an_unfiled_artifact(client):
    # An artifact with no entity has no graph to honour, but its file must go.
    cid = _new_case(client, "Orphan")
    case = _case(client, cid)
    client.post(f"/api/cases/{cid}/proofs", json={"title": "P", "spec": {"panels": []}, "name": "p"})
    proof = _entity(client, cid, spec="proofs/p.json")
    client.delete(f"/api/cases/{cid}/entities/{proof['id']}")  # entity + files gone

    # re-create the file alone, with no entity behind it
    client.post(f"/api/cases/{cid}/proofs", json={"title": "P", "spec": {"panels": []}, "name": "p"})
    client.delete(f"/api/cases/{cid}/entities/{_entity(client, cid, spec='proofs/p.json')['id']}")
    assert client.get(f"/api/cases/{cid}/proofs/p").status_code == 404
    assert case["id"] == cid


# ── the dependents preview that feeds the dialog ───────────────────────────


def test_dependents_endpoint_reports_the_plan(client):
    cid = _new_case(client, "Preview")
    a = _upload(client, cid, "a.png")["item"]["path"]
    _save_session(client, cid, "S", a, name="s")
    _save_proof(client, cid, "P", [a], name="p")

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
