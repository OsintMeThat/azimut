"""A post from X or Bluesky in a note: `/post`, and the card the editor draws.

`POST /api/cases/{id}/social-posts/fetch` reads the posts pasted links name and keeps
them in the case (`engine/socialposts.py`), as one job the editor polls, one answer per
link: its kept post, or why it could not be read. **The one road here that reaches the
network, and only on the analyst's press.** A post the case keeps already, or one of the
analyst's own published posts, answers without it.

`GET /api/cases/{id}/social-posts/offers` lists what `/post` offers beside a paste, and
`POST /api/cases/{id}/social-posts/from-case` keeps one of them: a file the case
downloaded from a post, or a published post's draft. `POST
/api/cases/{id}/social-posts/describe` answers a `::: post` block as every document draws
it. These three only read the case, never the network.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import jobs
from ..engine import socialposts
from .cases import get_case

router = APIRouter(prefix="/api", tags=["notes"])

#: The longest block the describe route reads.
MAX_BLOCK_BYTES = 64 * 1024


class FetchIn(BaseModel):
    """The links pasted, one per post, a thread in order."""

    links: list[str] = Field(min_length=1, max_length=socialposts.MAX_THREAD)


class FromCaseIn(BaseModel):
    media: str | None = Field(default=None, max_length=512)
    draft: str | None = Field(default=None, max_length=200)


class DescribeIn(BaseModel):
    text: str = Field(max_length=MAX_BLOCK_BYTES)


def _answer(case: Any, link: str) -> dict[str, Any]:
    """One link read, as the block reads the answer: its post, or what went wrong. A wall
    is tried again with the session Settings holds, as a download is (`media.fetch_url`)."""
    try:
        entity = socialposts.fetch(case, link)
    except socialposts.NeedsLogin as exc:
        return {"link": link, "error": str(exc), "needs_auth": True, "refused": exc.refused}
    except socialposts.PostError as exc:
        return {"link": link, "error": str(exc)}
    return {"link": link, "id": entity["id"], "label": entity.get("label") or ""}


@router.post("/cases/{case_id}/social-posts/fetch")
def fetch_posts(case_id: str, body: FetchIn) -> dict[str, str]:
    case = get_case(case_id)
    links = [one.strip() for one in body.links if one.strip()]
    if not links or any(len(one) > 2000 for one in links):
        raise HTTPException(status_code=422, detail="links must be post addresses")

    def work(set_progress: Any) -> dict[str, Any]:
        answers = []
        for number, link in enumerate(links, 1):
            set_progress({"done": number - 1, "total": len(links)})
            answers.append(_answer(case, link))
        return {"results": answers}

    return {"job_id": jobs.start("social-post", work)}


@router.get("/cases/{case_id}/social-posts/offers")
def post_offers(case_id: str) -> dict[str, list[dict[str, Any]]]:
    return socialposts.offers(get_case(case_id))


@router.post("/cases/{case_id}/social-posts/from-case")
def post_from_case(case_id: str, body: FromCaseIn) -> dict[str, Any]:
    case = get_case(case_id)
    if bool(body.media) == bool(body.draft):
        raise HTTPException(status_code=422, detail="name a media or a draft")
    try:
        entity = socialposts.from_media(case, body.media) if body.media else socialposts.from_draft(case, str(body.draft))
    except socialposts.PostError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"id": entity["id"], "label": entity.get("label") or ""}


@router.post("/cases/{case_id}/social-posts/describe")
def describe_block(case_id: str, body: DescribeIn) -> dict[str, Any]:
    return socialposts.describe(get_case(case_id), body.text)
