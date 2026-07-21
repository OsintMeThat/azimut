"""FastAPI application: API routers + built frontend served as static files."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config

STATIC_DIR = Path(__file__).parent / "static"

# The server binds localhost only, but that alone doesn't stop a web page the
# browser has open from reaching it — a page can hit 127.0.0.1 directly (its
# own Origin travels along), or point a name it controls at 127.0.0.1 (DNS
# rebinding, where the Host header becomes that name). Both are refused here:
# the Host must be a loopback name (defeats rebinding), and a cross-origin
# web Origin is turned away on every route except the token-gated ingest
# island, which opens itself to browser-extension origins on purpose.
LOCAL_HOSTNAMES = frozenset({"127.0.0.1", "localhost", "::1", "[::1]"})


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


def _recover_jobs() -> None:
    """On startup, return jobs a crashed process left ``running`` to the queue and
    wake the worker for any case with pending thumbnail work. A `running` row
    nothing owns would otherwise stall forever; recovery resumes it."""
    from .engine import thumbnails
    from .workspace import Case

    for row in Case.list_all():
        try:
            case = Case.open(row["id"])
            case.recover_jobs()
        except Exception:
            continue
        if any(j["state"] == "queued" for j in case.list_jobs(kind=thumbnails.THUMB_KIND)):
            thumbnails.wake(case)


def create_app() -> FastAPI:
    config.ensure_workspace()
    # Before any router can import a scraper: point yt-dlp/gallery-dl at the
    # newer copies in the workspace, if the user has fetched any. No network.
    from .engine import scrapers

    scrapers.activate()

    # Reap stale empty scratch sessions; never let housekeeping block startup.
    from .workspace import Case

    try:
        Case.cleanup_scratch()
    except OSError:
        pass

    # Reclaim background jobs a previous run left mid-flight and resume any
    # pending thumbnail work through the single worker. Best-effort: housekeeping
    # must never block or crash startup.
    try:
        _recover_jobs()
    except Exception:
        pass

    app = FastAPI(title="Azimut", version=__version__, docs_url="/api/docs")

    from .api import cases, drafts, events, files, ingest, inspect, media, proofs, satellite, settings, templates

    app.include_router(cases.router)
    app.include_router(media.router)
    app.include_router(inspect.router)
    app.include_router(satellite.router)
    app.include_router(proofs.router)
    app.include_router(drafts.router)
    app.include_router(files.router)
    app.include_router(settings.router)
    app.include_router(ingest.router)
    app.include_router(events.router)
    app.include_router(templates.router)
    # extension-origin CORS, /api/ingest/* only (see ingest.install_cors)
    ingest.install_cors(app)
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
