"""REST API for Settings › Publishing › WordPress: the site a note is sent to as a draft.

The site's address and the username are ordinary settings (`wordpress_site`,
`wordpress_user`), carried by a settings backup. The application password is kept
apart, in ``publishing.json`` (`engine/publishsecrets.py`), and never sent back:
the browser learns only whether one is set and its last four characters.

Nothing here reaches the network but **Test connection**, on its press: reading
these settings, saving them and forgetting them stay on this machine. Sending a note
is the Notebook's (`POST /api/cases/{id}/notes/{note}/wordpress`, `api/notes.py`).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..engine import notes_wordpress as wordpress
from ..engine import publishsecrets

router = APIRouter(prefix="/api/publishing", tags=["publishing"])

WORDPRESS = "wordpress"


class WordPressIn(BaseModel):
    """What Settings saves; a field left out (None) stays as it is. An empty password
    keeps the one kept: Forget is how it goes."""

    site: str | None = Field(default=None, max_length=wordpress.MAX_ADDRESS + 20)
    user: str | None = Field(default=None, max_length=wordpress.MAX_USER + 20)
    password: str | None = Field(default=None, max_length=publishsecrets.MAX_SECRET + 20)


def wordpress_settings() -> tuple[str, str, str]:
    """The site, the username and the password as saved: the address read again, so a
    hand-edited settings file is checked as Settings checks it."""
    settings = config.load_settings()
    try:
        site = wordpress.site_address(str(settings.get("wordpress_site") or ""))
        user = wordpress.user_name(str(settings.get("wordpress_user") or ""))
    except wordpress.WordPressError:
        return "", "", ""
    return site, user, publishsecrets.read(WORDPRESS)


def _state() -> dict[str, Any]:
    settings = config.load_settings()
    return {
        "site": str(settings.get("wordpress_site") or ""),
        "user": str(settings.get("wordpress_user") or ""),
        "password": publishsecrets.status(WORDPRESS),
    }


@router.get("")
def read_publishing() -> dict[str, Any]:
    """What Settings › Publishing shows of each service: never a secret, never fetched."""
    return {WORDPRESS: _state()}


@router.put("/wordpress")
def save_wordpress(body: WordPressIn) -> dict[str, Any]:
    try:
        site = wordpress.site_address(body.site) if body.site is not None else None
        user = wordpress.user_name(body.user) if body.user is not None else None
        if body.password:
            publishsecrets.write(WORDPRESS, body.password)
    except (wordpress.WordPressError, publishsecrets.SecretError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def apply(settings: dict[str, Any]) -> None:
        if site is not None:
            settings["wordpress_site"] = site
        if user is not None:
            settings["wordpress_user"] = user

    if site is not None or user is not None:
        config.update_settings(apply)
    return _state()


@router.delete("/wordpress")
def forget_wordpress() -> dict[str, Any]:
    """Forget the site: its address, the username and the password, from this machine."""
    publishsecrets.forget(WORDPRESS)
    config.update_settings(lambda settings: settings.update(wordpress_site="", wordpress_user=""))
    return _state()


@router.post("/wordpress/test")
def test_wordpress() -> dict[str, Any]:
    """Sign in to the site with the saved password and say as whom, or what went wrong.

    The one request this tab makes, and only on its press."""
    site, user, password = wordpress_settings()
    if not site or not user or not password:
        return {"ok": False, "detail": "Fill in the address, the username and the application password first."}
    try:
        with wordpress.client() as http:
            connection = wordpress.connect(wordpress.Site(site, user, password, http))
    except wordpress.WordPressError as exc:
        return {"ok": False, "detail": str(exc)}
    said = ""
    if not connection.can_post:
        said = "This account may not write posts: it needs the Author role or above."
    elif not connection.can_upload:
        said = "This account may not upload pictures: it needs the Author role or above."
    return {
        "ok": not said,
        "name": connection.name,
        "site_name": connection.site_name,
        "detail": said,
    }
