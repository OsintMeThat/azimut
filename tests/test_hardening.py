"""Local hardening: the decompression-bomb clamp, owner-only secrets, request bounds."""

import os
import re
import stat
import sys
import warnings

import pytest
from PIL import Image

from azimut import config


def test_decompression_bomb_guard_is_set():
    import importlib

    import azimut

    # Pytest resets warning filters after package import. Reloading reproduces
    # normal process startup and proves the package installs its policy.
    importlib.reload(azimut)

    assert Image.MAX_IMAGE_PIXELS == 100_000_000
    assert any(
        action == "error" and category is Image.DecompressionBombWarning
        for action, _message, category, _module, _line in warnings.filters
    )


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX file modes")
def test_settings_and_workspace_are_owner_only(tmp_workspace):
    config.ensure_workspace()
    assert stat.S_IMODE(os.stat(config.workspace_root()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.internal_dir()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.settings_dir()).st_mode) == 0o700
    assert stat.S_IMODE(os.stat(config.settings_path()).st_mode) == 0o600


#: Body fields that mean "the browser assembled this and it has no natural size". A table
#: (`columns`/`rows`/`text`/`meta`), a document (`content`) or a picture
#: (`png_base64`/`assets`): each can arrive at tens of megabytes from an ordinary gesture,
#: and each is parsed into memory whole. `content` is here because `text` alone let a note
#: written through `POST /notes` past a gate that caught the same note through `PUT`.
CARRIES = frozenset({"columns", "rows", "text", "meta", "content", "png_base64", "assets"})


def _bounded_by_its_own_field(model, named):
    """Whether every carrying field declares its own `max_length`.

    The second acceptable answer, and the right one for a field with a natural size: a
    coordinate is never a document, so `POST /geo/parse` is bounded where it is read rather
    than by a middleware built for bodies too big to parse.
    """
    fields = getattr(model, "model_fields", {}) or {}
    return all(
        any(getattr(rule, "max_length", None) is not None for rule in fields[name].metadata)
        for name in named
    )


def test_no_route_carrying_a_browser_built_payload_is_parsed_before_it_is_bounded():
    """The gate that stops the next recurrence, rather than the next entry in a list.

    `server.BulkBodyLimit.ROUTES` is spelled out by hand, and routes kept being added
    without one: four roads out of a sheet's promotion first — `parse`, `move/undo`,
    `proofs`, `meta` — and then the composer's own save, which posts a rendered PNG plus
    every image pasted into the proof and had no limit at all, on the very middleware that
    exists for pictures the browser draws.

    So the list is not trusted: every router the application mounts is walked here, and any
    body model holding a table or a picture must answer a limit. Asked of the app rather
    than of two named routers, because "which routers carry tables" was itself the
    assumption that let the proof route through.
    """
    from azimut.server import BulkBodyLimit, create_app

    def every_route(holder):
        """Walk the mounted tree. FastAPI keeps an included router as a wrapper around the
        router it was given rather than flattening its routes into the app, so a single pass
        over `app.routes` sees nineteen wrappers and no body at all."""
        for entry in getattr(holder, "routes", ()):
            yield entry
            yield from every_route(entry)
            wrapped = getattr(entry, "original_router", None)
            if wrapped is not None:
                yield from every_route(wrapped)

    checked = 0
    for route in every_route(create_app()):
        body = getattr(route, "body_field", None)
        model = getattr(getattr(body, "field_info", None), "annotation", None)
        carried = CARRIES & set(getattr(model, "model_fields", {}) or {})
        if not carried:
            continue
        for method in sorted(getattr(route, "methods", set()) & {"POST", "PUT"}):
            path = re.sub(r"\{[^}]+\}", "x", route.path)
            bounded = BulkBodyLimit._limit(
                {"type": "http", "method": method, "path": path}
            ) is not None or _bounded_by_its_own_field(model, carried)
            assert bounded, f"{method} {route.path} carries {sorted(carried)} and answers no limit"
            checked += 1
    # The count is the test's own gate: a FastAPI that stopped exposing `body_field` would
    # otherwise make this pass by checking nothing.
    assert checked >= 16, checked


def test_the_proof_export_is_refused_by_the_size_it_decodes_to(client, monkeypatch):
    """The whole request is bounded by the middleware; the picture inside it by the route.

    Two bounds because they answer two things. The middleware refuses a body too big to
    parse, before parsing. This one refuses a legal-sized body whose export alone is
    absurd — and it has to land before the rename, which deletes the old PNG and moves the
    pasted images: a payload refused after that point would leave the proof under its old
    name with both of them gone.
    """
    import base64

    from azimut.api import proofs as proofs_api

    monkeypatch.setattr(proofs_api, "MAX_EXPORT_BYTES", 64)
    case_id = client.post("/api/cases", json={"name": "Bounds"}).json()["id"]
    answer = client.post(
        f"/api/cases/{case_id}/proofs",
        json={
            "title": "Too wide",
            "spec": {"azimut_proof": 1, "panels": [], "shapes": []},
            "png_base64": base64.b64encode(b"x" * 200).decode("ascii"),
        },
    )
    assert answer.status_code == 413
    assert "under" in answer.json()["detail"]
    assert client.get(f"/api/cases/{case_id}/proofs").json() == []
