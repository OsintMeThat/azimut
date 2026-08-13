"""REST API for case lifecycle, entities and links.

One router per domain, assembled here. The order below is the order routes are
matched in, and it is load-bearing: a case's id is its folder name, so
`/api/cases/entity-types` and `/api/cases/{case_id}` are the same shape and the
literal one has to be registered first. `registry` therefore goes before
`lifecycle`, and nothing declaring a bare `/{case_id}` may move above it.

The note bodies and their PDF export live next door in `api/notes.py`.
"""

from __future__ import annotations

from fastapi import APIRouter

from .bundles import router as _bundles
from .catalog import router as _catalog
from .common import (
    delete_by_path,
    delete_entities_deep,
    delete_entity_deep,
    get_case,
)
from .doctor import router as _doctor
from .entities import router as _entities
from .entity_images import router as _entity_images
from .folders import router as _folders
from .graph import router as _graph
from .lifecycle import router as _lifecycle
from .lifecycle import workspace_router
from .links import router as _links
from .registry import router as _registry
from .timeline import router as _timeline
from .timeline import timeline
from .trash import router as _trash

router = APIRouter()
# Literal paths first — see the module docstring.
for _sub in (
    _registry,
    _bundles,
    _doctor,
    _lifecycle,
    _catalog,
    _graph,
    _entities,
    _entity_images,
    _links,
    _timeline,
    _trash,
    _folders,
):
    router.include_router(_sub)

__all__ = [
    "delete_by_path",
    "delete_entities_deep",
    "delete_entity_deep",
    "get_case",
    "router",
    "timeline",
    "workspace_router",
]
