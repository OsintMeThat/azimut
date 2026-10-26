"""gallery-dl runs as a program of its own, never inside the app.

gallery-dl is GPL-2.0-only and Azimut is AGPL-3.0-only, so the two are never one
program: every read goes through gallery-dl's command line in a child process
(engine/gallerydl.py). These tests run the real one, offline, against a local HTTP
server it reads as a direct link, so the contract the app relies on (the JSON
listing, the file and its metadata where they are asked for, the exit status) is
checked against gallery-dl itself rather than against a fake of it.
"""

from __future__ import annotations

import http.server
import re
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from fakeydl import png_bytes

from azimut.engine import gallerydl, scrapers

ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture(autouse=True)
def cache_kept_out_of_the_home(tmp_path, monkeypatch):
    """gallery-dl opens its cache file on every start; a test's runs keep theirs here."""
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    if sys.platform == "win32":
        monkeypatch.setenv("APPDATA", str(tmp_path / "appdata"))


@pytest.fixture()
def site(tmp_path):
    """A local server holding one picture, which gallery-dl reads as a direct link."""
    served = tmp_path / "served"
    served.mkdir()
    (served / "photo.png").write_bytes(png_bytes())

    class Quiet(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(served), **kwargs)

        def log_message(self, *args):  # noqa: ANN002 — keep the test output clean
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Quiet)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_address[1]}"
    finally:
        server.shutdown()
        server.server_close()


def test_a_listing_names_every_file_without_downloading_one(site, tmp_workspace):
    files = gallerydl.listing(f"{site}/photo.png", [])
    assert [url for url, _ in files] == [f"{site}/photo.png"]
    assert files[0][1]["filename"] == "photo" and files[0][1]["extension"] == "png"


def test_a_download_writes_the_picked_file_and_its_metadata(site, tmp_workspace, tmp_path):
    into = tmp_path / "into"
    into.mkdir()
    path, kwdict = gallerydl.download(f"{site}/photo.png", 1, into, [])
    assert path.read_bytes() == png_bytes()
    assert (kwdict["filename"], kwdict["extension"]) == ("photo", "png")


def test_a_cookie_file_is_handed_over_as_gallery_dl_reads_it(site, tmp_workspace, tmp_path):
    """The path is written as JSON, so gallery-dl reads it as a path whatever it holds."""
    cookies = tmp_path / "cookie jar.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n", encoding="utf-8")
    into = tmp_path / "into"
    into.mkdir()
    found = gallerydl.download(
        f"{site}/photo.png", 1, into, gallerydl.option("extractor.cookies", str(cookies))
    )
    assert found is not None


def test_an_address_no_extractor_knows_is_said_as_such(tmp_workspace, tmp_path):
    with pytest.raises(gallerydl.UnsupportedURL):
        gallerydl.listing("https://example.invalid/nothing", [])
    with pytest.raises(gallerydl.UnsupportedURL):
        gallerydl.download("https://example.invalid/nothing", 1, tmp_path, [])


def test_a_refused_file_says_what_the_site_answered(site, tmp_workspace, tmp_path):
    """The words the in-process download raised: "'404 …' for '<url>'"."""
    with pytest.raises(gallerydl.GalleryError, match=r"'404 .*' for '.*missing\.png'"):
        gallerydl.download(f"{site}/missing.png", 1, tmp_path, [])


def test_a_pick_past_the_last_file_is_nothing(site, tmp_workspace, tmp_path):
    assert gallerydl.download(f"{site}/photo.png", 3, tmp_path, []) is None


@pytest.mark.parametrize("index", [None, 1])
def test_the_media_road_files_what_the_real_gallery_dl_downloaded(site, client, index):
    """End to end, nothing faked: a listing then the file, or the picked file at once,
    filed in the case with gallery-dl named as its source and no scratch left behind."""
    from azimut.engine import media as media_engine
    from azimut.workspace import Case

    cid = client.post("/api/cases", json={"name": f"Real {index}"}).json()["id"]
    case = Case.open(cid)
    result = media_engine._download_via_gallery_dl(case, f"{site}/photo.png", index=index)
    item = result["item"]
    assert item["source"]["downloader"] == "gallery-dl"
    assert item["source"]["url"] == f"{site}/photo.png"
    media = case.subdir("media")
    assert (media / item["filename"]).read_bytes() == png_bytes()
    assert list((media / ".dl").glob("*")) == []


@pytest.mark.parametrize(
    ("status", "log", "name", "message"),
    [
        # What gallery-dl raised by name, as Job.run logs it.
        (16, "[twitter][error] AuthorizationError: Login required\n",
         "AuthorizationError", "Login required"),
        (16, "[instagram][error] AuthRequired: Account credentials required\n",
         "AuthRequired", "Account credentials required"),
        # AbortExtraction is logged with its message alone.
        (4, "[twitter][error] Unavailable\n", "", "Unavailable"),
        # A login refused that said nothing about itself is still read by its status.
        (16, "", "AuthorizationError", "gallery-dl stopped without saying why"),
        # A file the site refused: the downloader's words, not "Failed to download".
        (4, "[downloader.http][warning] '403 Forbidden' for 'https://cdn.test/a.jpg'\n"
            "[download][error] Failed to download a.jpg\n",
         "", "'403 Forbidden' for 'https://cdn.test/a.jpg'"),
    ],
)
def test_a_failed_run_is_read_back_as_the_error_it_was(status, log, name, message):
    failure = gallerydl._failure(gallerydl.Finished(status, "", log))
    assert isinstance(failure, gallerydl.GalleryError)
    assert (failure.name, str(failure)) == (name, message)


def test_the_binary_runs_itself_as_gallery_dl(monkeypatch):
    """The release binary has no other Python: it starts itself again with the flag."""
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert gallerydl.command() == [sys.executable, gallerydl.FROZEN_FLAG]
    monkeypatch.setattr(sys, "frozen", False)
    # -P: a folder named gallery_dl where Azimut was started cannot stand in for it.
    assert gallerydl.command() == [sys.executable, "-P", "-m", "gallery_dl"]


def test_the_binary_entry_point_hands_the_flag_to_gallery_dl(tmp_workspace):
    """packaging/entry.py, run the way the binary is: the flag makes it gallery-dl."""
    proc = subprocess.run(
        [sys.executable, str(ROOT / "packaging" / "entry.py"), gallerydl.FROZEN_FLAG, "--version"],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr
    assert re.fullmatch(r"\d+\.\d+\.\d+\S*", proc.stdout.strip())


def _runtime_copy(version: str, said: str) -> None:
    """A gallery-dl fetched from Settings, standing in for the bundled one."""
    home = scrapers.dist_dir("gallery-dl")
    package = home / "gallery_dl"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text(
        f"def main():\n    print({said!r})\n    return 0\n", encoding="utf-8"
    )
    (package / "__main__.py").write_text(
        "import sys\nfrom gallery_dl import main\nsys.exit(main())\n", encoding="utf-8"
    )
    (home / f"gallery_dl-{version}.dist-info").mkdir()


def test_an_update_from_settings_is_the_one_that_runs(tmp_workspace):
    """A newer copy wins in the child as it won in-process, and without a restart."""
    _runtime_copy("999.0.0", "the updated copy")
    assert gallerydl.run(["--version"]).stdout.strip() == "the updated copy"
    assert scrapers.needs_restart("gallery-dl") is False


def test_an_older_copy_left_by_another_build_does_not_shadow_the_bundled_one(tmp_workspace):
    _runtime_copy("0.0.1", "the stale copy")
    assert gallerydl.run(["--version"]).stdout.strip() != "the stale copy"


def test_the_binary_child_reads_the_update_too(tmp_workspace, monkeypatch, capsys):
    """run_frozen, what the binary's child runs: the runtime finder, then gallery-dl."""
    activated = []
    monkeypatch.setattr(scrapers, "activate", lambda: activated.append(True) or {})
    monkeypatch.setattr(sys, "argv", ["azimut"])
    with pytest.raises(SystemExit) as ended:  # argparse's --version, as in the child
        gallerydl.run_frozen(["--version"])
    assert ended.value.code == 0
    assert activated == [True]
    assert re.fullmatch(r"\d+\.\d+\.\d+\S*", capsys.readouterr().out.strip())


def test_the_app_never_imports_gallery_dl():
    """The one licence boundary in the code: no module of the app imports gallery-dl.

    `run_frozen` is the exception by design: it runs in the binary's child, which is
    gallery-dl and nothing else, never in the app.
    """
    offenders = []
    for path in sorted((ROOT / "src" / "azimut").rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        for line in text.splitlines():
            if re.match(r"\s*(import gallery_dl|from gallery_dl\b)", line):
                offenders.append(f"{path.relative_to(ROOT).as_posix()}: {line.strip()}")
    assert offenders == ["src/azimut/engine/gallerydl.py: import gallery_dl"]
    source = (ROOT / "src" / "azimut" / "engine" / "gallerydl.py").read_text(encoding="utf-8")
    assert source.index("import gallery_dl\n") > source.index("def run_frozen")
