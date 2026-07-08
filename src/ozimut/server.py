"""FastAPI application: API routers + built frontend served as static files."""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, config

STATIC_DIR = Path(__file__).parent / "static"


def create_app() -> FastAPI:
    config.ensure_workspace()

    app = FastAPI(title="Ozimut", version=__version__, docs_url="/api/docs")

    from .api import cases, files, media, proofs, satellite

    app.include_router(cases.router)
    app.include_router(media.router)
    app.include_router(satellite.router)
    app.include_router(proofs.router)
    app.include_router(files.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    # Built frontend (frontend/ builds into src/ozimut/static/).
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
                    "ozimut": __version__,
                    "hint": "frontend not built — run `npm run build` in frontend/ "
                    "or use the Vite dev server (npm run dev)",
                }
            )

    return app
