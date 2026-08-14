"""FastAPI application: API routers + built frontend served as static files."""

from __future__ import annotations

import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__, config
from .engine import workspacelock, workspacemove

logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

#: The port this run serves on, set by `launcher.serve` before the app is built.
#: Only used to name ourselves in the workspace lock, so another instance can
#: say *which* Azimut has the folder rather than only that one does.
SERVE_PORT: int | None = None

# The server binds localhost only, but that alone doesn't stop a web page the
# browser has open from reaching it — a page can hit 127.0.0.1 directly (its
# own Origin travels along), or point a name it controls at 127.0.0.1 (DNS
# rebinding, where the Host header becomes that name). Both are refused here:
# the Host must be a loopback name (defeats rebinding), and a cross-origin
# web Origin is turned away on every route except the token-gated ingest
# island, which opens itself to browser-extension origins on purpose.
LOCAL_HOSTNAMES = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})


class BulkBodyLimit:
    """Bound the JSON routes that carry a payload the browser assembled, before parsing.

    Three of them: a note's PDF export posts its Mermaid diagrams, an analysis plate
    posts the page itself, and a sheet posts a whole table. Each is bounded by its own
    route's number, so the limit stays beside the code that knows what it is for.
    """

    #: `(method, tail, module, attribute)`, where the tail is the path segments after
    #: `/api/cases/{case_id}/` and `*` stands for one segment of any value.
    ROUTES: tuple[tuple[str, tuple[str, ...], str, str], ...] = (
        ("POST", ("notes", "pdf"), "notes", "MAX_PDF_BODY_BYTES"),
        ("POST", ("plates",), "plates", "MAX_PLATE_BODY_BYTES"),
        ("POST", ("sheets", "import"), "sheets", "MAX_SHEET_BODY_BYTES"),
        ("PUT", ("sheets", "*"), "sheets", "MAX_SHEET_BODY_BYTES"),
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    @staticmethod
    def _matches(tail: tuple[str, ...], route: tuple[str, ...]) -> bool:
        return len(tail) == len(route) and all(
            want in ("*", have) for want, have in zip(route, tail)
        )

    @classmethod
    def _limit(cls, scope: Scope) -> int | None:
        method = str(scope.get("method", ""))
        parts = str(scope.get("path", "")).strip("/").split("/")
        if len(parts) < 4 or parts[0] != "api" or parts[1] != "cases":
            return None
        tail = tuple(parts[3:])
        for want_method, route, module_name, attribute in cls.ROUTES:
            if method != want_method or not cls._matches(tail, route):
                continue
            # Imported lazily so each route owns its limit and a test can lower it
            # without rebuilding the application.
            from importlib import import_module

            module = import_module(f".api.{module_name}", package=__package__)
            return int(getattr(module, attribute))
        return None

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        limit = self._limit(scope) if scope["type"] == "http" else None
        if limit is None:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        raw_length = headers.get(b"content-length", b"")
        try:
            content_length = int(raw_length) if raw_length else None
        except ValueError:
            content_length = None
        if content_length is not None and content_length > limit:
            await JSONResponse(
                {"detail": "request body too large"}, status_code=413
            )(scope, receive, send)
            return

        body = bytearray()
        while True:
            message = await receive()
            if message["type"] != "http.request":
                break
            chunk = message.get("body", b"")
            if len(body) + len(chunk) > limit:
                await JSONResponse(
                    {"detail": "request body too large"}, status_code=413
                )(scope, receive, send)
                return
            body.extend(chunk)
            if not message.get("more_body", False):
                break

        sent = False

        async def replay() -> Message:
            nonlocal sent
            if sent:
                return {"type": "http.disconnect"}
            sent = True
            return {"type": "http.request", "body": bytes(body), "more_body": False}

        await self.app(scope, replay, send)


def _hostname(value: str) -> str:
    """The bare host of a Host or Origin header — no scheme, path or port."""
    host = value.strip().lower()
    if "://" in host:
        host = host.split("://", 1)[1]
    host = host.split("/", 1)[0]
    if host.startswith("["):  # bracketed IPv6, e.g. [::1]:8477 -> [::1]
        return host.split("]", 1)[0] + "]"
    return host.split(":", 1)[0]


def _is_local(hostname: str) -> bool:
    return hostname in LOCAL_HOSTNAMES or hostname.endswith(".localhost")


def install_local_guard(app: FastAPI) -> None:
    """Reject requests that don't originate from this machine's own loopback.

    Added last so it runs first (outermost middleware): a bad Host or a
    cross-origin web Origin is refused before any router — or the ingest CORS
    layer — sees it. Extension origins are still allowed, but only on the
    ingest routes they're scoped to.
    """
    from .api.ingest import EXTENSION_ORIGIN_SCHEMES

    @app.middleware("http")
    async def local_guard(request: Request, call_next):
        if not _is_local(_hostname(request.headers.get("host", ""))):
            return PlainTextResponse("invalid host header", status_code=400)
        origin = request.headers.get("origin")
        if origin and not _is_local(_hostname(origin)):
            ingest_extension = request.url.path.startswith(
                "/api/ingest/"
            ) and origin.startswith(EXTENSION_ORIGIN_SCHEMES)
            if not ingest_extension:
                return PlainTextResponse("cross-origin request refused", status_code=403)
        return await call_next(request)


#: Reachable while the workspace is not: everything the stop screen and the
#: recovery dialog need, and nothing that would touch a case.
ALWAYS_AVAILABLE = ("/api/health", "/api/settings/workspace")

_opening = threading.Lock()


def open_workspace_if_free() -> dict[str, Any] | None:
    """Hold the workspace and open it, or say who has it instead.

    Asked on the way into every case request, and cheap once it has succeeded —
    holding the lock is a fact in memory. Retrying matters because the answer
    changes without this process restarting: someone closes the other Azimut,
    presses reload, and the tab has to come back to life. Until then nothing is
    served, because a workspace this process never opened is one whose
    migrations never ran.
    """
    if workspacelock.held():
        return None
    with _opening:
        if workspacelock.held():
            return None
        try:
            workspacelock.acquire(SERVE_PORT)
        except workspacelock.WorkspaceBusy as busy:
            return busy.holder or {}
        from .workspace import open_workspace

        open_workspace()
    return None


def install_availability_guard(app: FastAPI) -> None:
    """Refuse case work while there is no workspace to do it in.

    Three states share one answer. A configured folder that is gone must never
    be silently recreated — that is the fastest way to make someone believe they
    lost everything. A workspace being copied to a new volume must not be
    written to half way through. And a workspace another Azimut holds is not
    ours to touch. All three leave the recovery routes reachable, so the browser
    can show what happened and offer the way out.
    """

    @app.middleware("http")
    async def guard(request, call_next):  # type: ignore[no-untyped-def]
        path = request.url.path
        if path.startswith("/api/") and not path.startswith(ALWAYS_AVAILABLE):
            if config.workspace_missing():
                return JSONResponse(
                    {"detail": "the workspace folder is not available", "workspace": "missing"},
                    status_code=503,
                )
            if workspacemove.in_progress():
                return JSONResponse(
                    {"detail": "the workspace is being moved", "workspace": "moving"},
                    status_code=503,
                )
            if (busy := open_workspace_if_free()) is not None:
                return JSONResponse(
                    {"detail": workspacelock.describe(busy), "workspace": "locked"},
                    status_code=503,
                )
        return await call_next(request)


def create_app() -> FastAPI:
    # Start keeping the tail of the warning log, so "Report an issue" has
    # something to say about a run that already went wrong (engine/diagnostics).
    from .engine import diagnostics

    diagnostics.install()

    # A configured folder that is gone stops here: no skeleton is created, no
    # case is migrated, and the browser gets the stop screen instead of an empty
    # workspace that looks like lost work.
    #
    # The lock comes before the housekeeping for the same reason it exists: two
    # processes running the case migrations at once is renames racing over the
    # same directories. A workspace another Azimut holds is left exactly as it
    # is, and the tab that opens explains who has it.
    if not config.workspace_missing() and (busy := open_workspace_if_free()):
        logger.warning("workspace not opened: %s", workspacelock.describe(busy))

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        # Give the workspace back on the way out. The OS would drop the lock
        # when the process dies anyway; releasing it here clears the payload, so
        # the next run has nothing to judge the staleness of, and closes the
        # handle, which is what lets Windows delete the folder afterwards.
        workspacelock.release()

    app = FastAPI(
        title="Azimut", version=__version__, docs_url="/api/docs", lifespan=lifespan
    )

    from .api import (
        analysis_views, cases, drafts, events, files, folders, ingest, inspect, media,
        notes, plates, proofs, satellite, settings, sheets, templates,
    )

    app.include_router(cases.router)
    app.include_router(cases.workspace_router)
    app.include_router(analysis_views.router)
    app.include_router(notes.router)
    app.include_router(plates.router)
    app.include_router(sheets.router)
    app.include_router(media.router)
    app.include_router(inspect.router)
    app.include_router(satellite.router)
    app.include_router(proofs.router)
    app.include_router(drafts.router)
    app.include_router(files.router)
    app.include_router(folders.router)
    app.include_router(settings.router)
    app.include_router(ingest.router)
    app.include_router(events.router)
    app.include_router(templates.router)
    # extension-origin CORS, /api/ingest/* only (see ingest.install_cors)
    ingest.install_cors(app)
    # Inside the local guard: a request that isn't allowed to reach the app at
    # all should not learn whether the workspace is there.
    install_availability_guard(app)
    # Bound picture-carrying JSON before FastAPI/Pydantic materialises it.
    app.add_middleware(BulkBodyLimit)
    # last, so it wraps everything: refuse non-loopback Host / cross-origin web
    install_local_guard(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    # Built frontend (frontend/ builds into src/azimut/static/).
    if (STATIC_DIR / "index.html").exists():
        app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str):  # SPA fallback: serve index.html for app routes
            candidate = (STATIC_DIR / path).resolve()
            if path and candidate.is_file() and candidate.is_relative_to(STATIC_DIR.resolve()):
                return FileResponse(candidate)
            return FileResponse(STATIC_DIR / "index.html")

    else:  # dev without a built frontend: make it obvious, not broken

        @app.get("/", include_in_schema=False)
        def no_frontend() -> JSONResponse:
            return JSONResponse(
                {
                    "azimut": __version__,
                    "hint": "frontend not built; run `npm run build` in frontend/ "
                    "or use the Vite dev server (npm run dev)",
                }
            )

    return app
