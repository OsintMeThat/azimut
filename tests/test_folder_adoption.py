"""A folder the analyst drops in the workspace becomes a case on one click."""

from pathlib import Path

from azimut import config, layout
from azimut.workspace import Case


def tree(root: Path) -> set[str]:
    """Every path under a directory, as relative posix strings."""
    return {path.relative_to(root).as_posix() for path in root.rglob("*")}


def folders(client) -> dict[str, str]:
    return {f["name"]: f["state"] for f in client.get("/api/workspace/folders").json()}


def make_folder(name: str, *files: str) -> Path:
    """A folder created the way a file manager would create it."""
    path = config.cases_dir() / name
    path.mkdir(parents=True)
    for filename in files:
        path.joinpath(filename).write_bytes(b"analyst material")
    return path


def test_a_folder_in_the_workspace_is_offered_and_becomes_a_case(client):
    make_folder("Oceanside match", "shore.jpg")

    assert folders(client)["Oceanside match"] == "new"

    adopted = client.post("/api/workspace/folders/adopt", json={"name": "Oceanside match"})

    assert adopted.status_code == 200
    assert adopted.json()["id"] == "Oceanside match"
    assert adopted.json()["name"] == "Oceanside match"
    listed = client.get("/api/cases").json()
    assert [(c["id"], c["entity_count"]) for c in listed] == [("Oceanside match", 0)]
    # and it stops being offered, because it is a case now
    assert folders(client) == {}


def test_adoption_leaves_the_analysts_files_where_they_are(client):
    """The whole promise of the case folder: `azimut/` is ours, the rest theirs.

    Adoption fills in our half and does not read, move or import the other one —
    the files are still where they were put, and the case is empty until the
    analyst says otherwise.
    """
    folder = make_folder("Coast survey", "shore.jpg", "notes.docx")

    client.post("/api/workspace/folders/adopt", json={"name": "Coast survey"})

    assert folder.joinpath("shore.jpg").is_file()
    assert folder.joinpath("notes.docx").is_file()
    assert client.get("/api/cases/Coast survey/media").json() == []
    assert list(layout.media(folder).iterdir()) == [layout.media(folder) / layout.META_DIR]
    # the note that says which half is whose lands beside their files
    assert layout.readme(folder).is_file()


def test_adoption_keeps_a_readme_the_analyst_already_wrote(client):
    folder = make_folder("Notes first")
    layout.readme(folder).write_text("mine\n", encoding="utf-8")

    client.post("/api/workspace/folders/adopt", json={"name": "Notes first"})

    assert layout.readme(folder).read_text(encoding="utf-8") == "mine\n"


def test_an_adopted_case_is_born_exactly_like_one_made_in_the_app(client):
    """The gate that keeps adoption from inventing a second kind of case: the
    tool root has to match a fresh case's, or every registry, trash and bundle
    guarantee written against the birth state stops holding for adopted ones."""
    make_folder("Adopted", "shore.jpg")
    client.post("/api/workspace/folders/adopt", json={"name": "Adopted"})
    born = Case.open(client.post("/api/cases", json={"name": "Newborn"}).json()["id"])

    assert tree(Case.open("Adopted").tool_root) == tree(born.tool_root)


def test_a_folder_holding_a_case_that_lost_its_manifest_is_recovered_not_reborn(client):
    """The dangerous half of "or the folder is badly filled": being born over a
    database would write a new empty one on top of somebody's investigation."""
    case_id = client.post("/api/cases", json={"name": "Lost manifest"}).json()["id"]
    client.post(f"/api/cases/{case_id}/notes", json={"title": "Lead", "content": "Body"})
    layout.manifest(config.cases_dir() / case_id).unlink()

    assert folders(client)[case_id] == "broken"
    refused = client.post("/api/workspace/folders/adopt", json={"name": case_id})
    assert refused.status_code == 409
    assert "lost its manifest" in refused.json()["detail"]

    recovered = client.post("/api/workspace/folders/recover", json={"name": case_id})

    assert recovered.status_code == 200
    # the name comes back from the database, not from the folder's slug
    assert recovered.json() == {"id": case_id, "name": "Lost manifest"}
    assert folders(client) == {}
    reopened = client.get(f"/api/cases/{case_id}").json()
    assert reopened["name"] == "Lost manifest"
    assert reopened["azimut"]["schema"] == 9
    notes = client.get(f"/api/cases/{case_id}/catalog/entities?type=note").json()
    assert [n["label"] for n in notes["items"]] == ["Lead"]


def test_recovery_refuses_a_folder_that_never_held_a_case(client):
    make_folder("Just a folder", "shore.jpg")

    refused = client.post("/api/workspace/folders/recover", json={"name": "Just a folder"})

    assert refused.status_code == 409
    assert "no case to recover" in refused.json()["detail"]


def test_a_name_a_case_folder_cannot_carry_asks_for_a_rename(client):
    """Adoption keeps the name the analyst chose, so the name has to be one a
    case folder can hold on every platform — Windows' path budget included."""
    too_long = "a" * (layout.MAX_CASE_SLUG + 1)
    make_folder(too_long)

    assert folders(client)[too_long] == "unusable-name"
    refused = client.post("/api/workspace/folders/adopt", json={"name": too_long})
    assert refused.status_code == 409
    assert "Rename it" in refused.json()["detail"]


def test_a_name_that_would_break_its_own_url_asks_for_a_rename(client):
    """The folder name is the case id, and the id travels in a URL path: `#`
    would cut every later request to this case short."""
    make_folder("Sortie #4")

    assert folders(client)["Sortie #4"] == "unusable-name"
    assert client.post("/api/workspace/folders/adopt", json={"name": "Sortie #4"}).status_code == 409


def test_adoption_refuses_a_name_another_case_already_uses(client):
    client.post("/api/cases", json={"name": "Coast match"})
    make_folder("Coast match")  # the case above lives under its slug, `coast-match`

    refused = client.post("/api/workspace/folders/adopt", json={"name": "Coast match"})

    assert refused.status_code == 409
    assert "already exists" in refused.json()["detail"]


def test_only_visible_directories_are_offered(client):
    """`.azimut/` is the workspace's own machinery and a file is not a case."""
    make_folder("A folder")
    config.cases_dir().joinpath("stray.zip").write_bytes(b"zip")

    assert folders(client) == {"A folder": "new"}


def test_a_folder_is_not_adopted_without_being_asked(client):
    """Nothing turns a folder into a case on startup: someone may have parked it
    there for an afternoon, and a case is a deliberate act."""
    make_folder("Parked here", "shore.jpg")

    Case.migrate_all()

    assert client.get("/api/cases").json() == []
    assert not layout.tool_root(config.cases_dir() / "Parked here").exists()
