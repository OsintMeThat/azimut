"""The artifact registry, and the gates that keep it honest.

Two rules a later tool inherits without doing anything:

- whatever it files, deleting it leaves the case as it was born — no orphan
  beside a deleted proof, no folder nothing points at;
- whatever entity type it introduces has said what it owns on disk, or said it
  owns nothing and why.

Both read `tests/fullcase.py`, so a new tool is covered by adding its artifact
there.
"""

from pathlib import Path

import fullcase
from azimut import layout
from azimut.engine import artifacts
from azimut.workspace import Case

# The thumbnail cache is content-addressed, budgeted and regenerated on demand,
# and the bundle leaves it out for the same reason: it is not case content. The
# tree comparison below skips it rather than pretending it is.
CACHE = "media/.thumbs"


def tree(root: Path) -> set[str]:
    """Every path under a case directory, as case-relative posix strings."""
    out = set()
    for path in root.rglob("*"):
        rel = path.relative_to(root).as_posix()
        if rel == CACHE or rel.startswith(CACHE + "/"):
            continue
        out.add(rel)
    return out


def delete_everything(client, case_id: str) -> None:
    """Delete every entity through the chokepoint, cascades included."""
    for _ in range(50):
        entities = client.get(
            f"/api/cases/{case_id}/catalog/entities", params={"limit": 500}
        ).json()["items"]
        if not entities:
            return
        for entity in entities:
            # A cascade may already have taken it; a 404 is that, not a failure.
            client.delete(f"/api/cases/{case_id}/entities/{entity['id']}")
    raise AssertionError("entities kept coming back")


def test_deleting_everything_returns_the_case_to_its_birth_state(client):
    """The gate. One artifact per tool goes in, everything is deleted, and what
    is left has to be a fresh case — byte-for-byte in shape, if not in content.

    This is what catches the file a later tool forgets to declare: an orphan is
    invisible in the UI and shows up here as one extra path.
    """
    full = fullcase.build_full_case(client)
    born = Case.open(client.post("/api/cases", json={"name": "Newborn"}).json()["id"])

    delete_everything(client, full.case_id)
    # Grids are not entities, so nothing deletes them for us (a gap the trash
    # work records rather than closes).
    client.delete(f"/api/cases/{full.case_id}/search-grids/north-sweep")
    # Deleting is reversible now, so the bytes are still in the trash: this is
    # the second half of the gate, and where they are actually reclaimed.
    client.delete(f"/api/cases/{full.case_id}/trash")

    emptied = Case.open(full.case_id)
    # The tool root, not the case folder: what the analyst keeps beside it is
    # theirs, and a gate on files Azimut never wrote would be meaningless.
    assert tree(emptied.tool_root) == tree(born.tool_root)


def test_deleting_a_proof_takes_its_pasted_images(client):
    """The leak this registry closed: the sidebar delete knew the spec and the
    export, and left ``proofs/<name>.assets/`` behind with the pastes inside."""
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    assets = case.resolve_inside(full.proof_asset).parent
    assert assets.is_dir()

    entity = client.get(
        f"/api/cases/{full.case_id}/entities/lookup",
        params={"attr": "spec", "value": full.proof},
    ).json()["entity"]
    client.delete(f"/api/cases/{full.case_id}/entities/{entity['id']}")

    assert not assets.exists()
    assert not case.resolve_inside(full.proof).exists()


def test_every_type_in_a_full_case_declares_what_it_owns(client):
    """A type in neither table is not a decision, it is an oversight — the next
    tool declares its files in ``KINDS`` or declares it has none in ``NO_FILES``,
    with the reason beside it."""
    full = fullcase.build_full_case(client)

    undeclared = {t for t in full.entity_types if not artifacts.declares(t)}
    assert not undeclared, f"entity types that never say what they own: {sorted(undeclared)}"
    assert all(reason for reason in artifacts.NO_FILES.values())


def test_the_registry_answers_for_one_media_and_its_companions(client):
    """What ``owned`` returns is what moves; what ``caches`` returns is what is
    dropped and regenerated. A media has all three."""
    full = fullcase.build_full_case(client)
    case = Case.open(full.case_id)
    entity = client.get(
        f"/api/cases/{full.case_id}/entities/lookup",
        params={"attr": "path", "value": full.photo},
    ).json()["entity"]

    owned = artifacts.owned(case, entity)
    assert owned[0] == full.photo
    assert layout.sidecar_rel(full.photo) in owned
    assert all(not rel.startswith(CACHE) for rel in owned)
    assert all(rel.startswith(CACHE) for rel in artifacts.caches(case, entity))
