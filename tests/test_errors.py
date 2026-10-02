"""What a failure says on the page: one clause, never the exception's own text."""

from __future__ import annotations

import errno
import subprocess
import time
import zipfile

import httpx
import pytest
from PIL import UnidentifiedImageError

from azimut import errors, jobs
from azimut.engine import inspect as inspect_engine
from azimut.workspace import CaseError


@pytest.mark.parametrize(
    ("exc", "said"),
    [
        (PermissionError(errno.EACCES, "Permission denied", "/home/someone/case"), "the system refused access to that file or folder"),
        (FileNotFoundError(errno.ENOENT, "No such file", "/tmp/x"), "a file it needed is no longer there"),
        (OSError(errno.ENOSPC, "No space left on device"), "the disk is full"),
        (UnidentifiedImageError("cannot identify image file <_io.BytesIO object at 0x7f>"), "this file is not a picture Azimut can read"),
        (zipfile.BadZipFile("File is not a zip file"), "this file is not a readable archive"),
        (subprocess.TimeoutExpired(["ffmpeg"], 60), "it took too long and was stopped"),
        (httpx.ConnectError("[Errno -2] Name or service not known"), "the service could not be reached"),
    ],
)
def test_system_failures_become_a_clause_without_their_text(exc, said):
    assert errors.explain(exc) == said


def test_the_apps_own_sentences_pass_through():
    assert errors.explain(CaseError("a folder name needs a letter or a digit.")) == "a folder name needs a letter or a digit"


@pytest.mark.parametrize("exc", [KeyError("survivor"), TypeError("'NoneType' object is not subscriptable")])
def test_pythons_own_mistakes_never_reach_the_page(exc):
    said = errors.explain(exc)
    assert said == errors.UNEXPECTED
    assert "NoneType" not in said and "survivor" not in said


def test_a_refused_body_reads_like_a_form(client):
    case_id = client.post("/api/cases", json={"name": "Errors"}).json()["id"]
    r = client.post(f"/api/cases/{case_id}/analysis-views", json={"name": "x" * 500})
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert isinstance(detail, str)
    assert "String should" not in detail and "loc" not in detail


def test_the_validation_sentence_names_the_field_and_the_bound():
    said = errors.validation_sentence([
        {"type": "string_too_long", "loc": ("body", "name"), "msg": "String should have at most 80 characters", "ctx": {"max_length": 80}},
        {"type": "less_than_equal", "loc": ("body", "lat"), "msg": "Input should be less than or equal to 90", "ctx": {"le": 90}},
        {"type": "missing", "loc": ("body", "case_id"), "msg": "Field required"},
    ])
    assert said == "Name is too long (80 characters at most); Lat must be at most 90; Case id is required"


def test_a_background_job_reports_a_clause(monkeypatch):
    def work(progress):
        raise PermissionError(errno.EACCES, "Permission denied", "/home/someone/secret")

    job_id = jobs.start("test", work)
    for _ in range(200):
        state = jobs.get(job_id)
        if state and state["status"] != "running":
            break
        time.sleep(0.01)
    assert state["status"] == "error"
    assert state["error"] == "the system refused access to that file or folder"


def test_ffmpeg_says_its_last_word_without_the_path():
    stderr = (
        b"ffmpeg version N-1 Copyright (c) 2000-2026\n  configuration: --enable-gpl\n"
        b"/home/someone/case/media/clip.mp4: Invalid data found when processing input\n"
    )
    exc = inspect_engine.ffmpeg_failed("scan", stderr)
    assert str(exc) == "ffmpeg could not scan this video (Invalid data found when processing input)"
    assert inspect_engine.ffmpeg_failed("enhance", b"").args[0] == "ffmpeg could not enhance this video"
