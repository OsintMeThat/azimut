"""REST API for Settings › Website: the WordPress site a note is sent to as a
draft, the GitHub Pages site a note's web folder is published to, and the numbers
Cloudflare Web Analytics keeps of its readers.

The site's address and the username are ordinary settings (`wordpress_site`,
`wordpress_user`), carried by a settings backup; so are the GitHub account, the
repository and the branch (`github_account`, `github_repo`, `github_branch`) and the
address Pages last said the site has (`github_site`), and the Cloudflare account ID and
site tag (`site_stats_account`, `site_stats_tag`, saved as Settings › Website's preferences).
The application password, the GitHub token and the Cloudflare API token are kept apart, in
``publishing.json`` (`engine/publishsecrets.py`), and never sent back: the browser learns
only whether one is set and its last four characters.

Nothing here reaches the network but its presses: **Test connection** for either
service, and for GitHub **Create the repository**, **Turn on Pages**, **Update the site**
(`/github/site`, which rebuilds the site's list, feed, sitemap and home without a note),
**Read the categories** (`/github/categories`), **Read the site** (`/github/site/read`, the
articles, maps and pages it holds, with its home, categories and last commit; reads only),
**Delete** an article's folder (`/github/site/delete`, one commit, only a folder Azimut published),
the watch of a page being built (`/github/build`, asked by the export dialog after a publish), and
**Read the numbers** (`/cloudflare/numbers`, `engine/sitestats.py`: one query to api.cloudflare.com, after
the list of the account's sites when the site tag must be found from the site token).
Reading these settings, saving them and forgetting them stay on this machine. Sending
a note is the Notebook's (`/notes/{note}/wordpress` and `/notes/{note}/github`,
`api/notes.py`).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import config
from ..engine import githubpages as github
from ..engine import notes_web
from ..engine import notes_wordpress as wordpress
from ..engine import publishsecrets, site, sitestats, sitesync

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
    """What Settings › Website shows of each service: never a secret, never fetched."""
    return {WORDPRESS: _state(), GITHUB: _github_state(), CLOUDFLARE: _cloudflare_state()}


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


# -- GitHub Pages ------------------------------------------------------------------------

GITHUB = "github"


class GitHubIn(BaseModel):
    """What Settings saves; a field left out (None) stays as it is. An empty token keeps
    the one kept: Forget is how it goes."""

    account: str | None = Field(default=None, max_length=60)
    repo: str | None = Field(default=None, max_length=120)
    branch: str | None = Field(default=None, max_length=120)
    token: str | None = Field(default=None, max_length=publishsecrets.MAX_SECRET + 20)


@dataclass(frozen=True)
class GitHubTarget:
    """The repository a page is published to, as Settings keeps it, and the token,
    which no repr of it shows."""

    account: str
    repo: str
    branch: str
    site: str
    token: str = field(repr=False)

    @property
    def ready(self) -> bool:
        return bool(self.account and self.repo and self.branch and self.token)

    @property
    def base(self) -> str:
        """Where the articles live, as far as this machine knows without asking GitHub."""
        return github.site_base(self.account, self.repo, self.site)


#: A token as GitHub makes them: letters, digits and underscores.
TOKEN = re.compile(r"^[A-Za-z0-9_]{20,255}$")


def github_settings() -> GitHubTarget:
    """The account, repository, branch and token as saved, each read again as Settings
    checks it, so a hand-edited settings file cannot steer a call."""
    settings = config.load_settings()
    try:
        account = github.account_name(str(settings.get("github_account") or ""))
        repo = github.repository_name(str(settings.get("github_repo") or "")) or github.DEFAULT_REPO
        branch = github.branch_name(str(settings.get("github_branch") or "")) or github.DEFAULT_BRANCH
    except github.GitHubError:
        account, repo, branch = "", github.DEFAULT_REPO, github.DEFAULT_BRANCH
    site = str(settings.get("github_site") or "")
    try:
        site = notes_web.address(site)
    except notes_web.NotesWebError:
        site = ""
    token = publishsecrets.read(GITHUB)
    return GitHubTarget(account=account, repo=repo, branch=branch, site=site,
                        token=token if TOKEN.match(token) else "")


def _logo() -> bytes | None:
    """The logo the site's pages carry: the site's own, else the Publishing logo; None with
    neither, or with one that is no PNG."""
    found = config.site_logo()
    return found[0] if found else None


def site_for(target: GitHubTarget, address: str) -> site.Site:
    """The site as Settings › Website describes it, served at ``address``."""
    return site.from_settings(config.load_settings(), address=address, account=target.account, logo=_logo())


def _github_state() -> dict[str, Any]:
    target = github_settings()
    found = site_for(target, target.base)
    return {
        "account": target.account,
        "repo": target.repo,
        "branch": target.branch,
        "site": target.site,
        "base": target.base if target.account else "",
        "token": publishsecrets.status(GITHUB),
        # what the site is called here, whatever Settings left empty read from: its title, whether
        # it has a logo, and the categories the last read of the site found, for the publish dialog
        "website": {"title": found.title if target.account else "", "logo": found.logo is not None,
                    "logo_from": (config.site_logo() or (b"", ""))[1],
                    "counting": found.stats if found.counter or found.beacon else ""},
        "categories": site.categories_read(config.load_settings().get("github_categories")),
    }


def keep_categories(categories: list[str] | None) -> None:
    """Keep the categories a read of the site found, for the dialog to suggest without asking GitHub."""
    if categories is None:
        return
    kept = site.categories_read(categories)
    if kept != site.categories_read(config.load_settings().get("github_categories")):
        config.update_settings(lambda settings: settings.update(github_categories=kept))


def keep_site(target: GitHubTarget, url: str) -> None:
    """Keep the address Pages gave the site, for the dialog to say without asking."""
    if url and url != target.site:
        config.update_settings(lambda settings: settings.update(github_site=url))


@router.put("/github")
def save_github(body: GitHubIn) -> dict[str, Any]:
    try:
        account = github.account_name(body.account) if body.account is not None else None
        repo = (github.repository_name(body.repo) or github.DEFAULT_REPO) if body.repo is not None else None
        branch = (github.branch_name(body.branch) or github.DEFAULT_BRANCH) if body.branch is not None else None
        if body.token:
            token = body.token.strip()
            if not TOKEN.match(token):
                raise github.GitHubError("That does not read as a GitHub token: copy it whole, as github.com showed it.")
            publishsecrets.write(GITHUB, token)
    except (github.GitHubError, publishsecrets.SecretError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    def apply(settings: dict[str, Any]) -> None:
        moved = False
        for key, value in (("github_account", account), ("github_repo", repo), ("github_branch", branch)):
            if value is not None and value != settings.get(key):
                settings[key] = value
                moved = moved or key != "github_branch"
        if moved:
            # another repository is another site: its address is read again on the next press
            settings["github_site"] = ""
            settings["github_categories"] = []

    if account is not None or repo is not None or branch is not None:
        config.update_settings(apply)
    return _github_state()


@router.delete("/github")
def forget_github() -> dict[str, Any]:
    """Forget the token and the account on this machine; the repository and the branch
    go back to what they were before anything was set."""
    publishsecrets.forget(GITHUB)
    config.update_settings(lambda settings: settings.update(
        github_account="", github_repo=github.DEFAULT_REPO, github_branch=github.DEFAULT_BRANCH, github_site="",
        github_categories=[]))
    return _github_state()


def _connection(target: GitHubTarget, gh: github.GitHub) -> dict[str, Any]:
    """Who the token is, whether the repository is there and whether Pages serves it."""
    login = github.whoami(gh)
    said: dict[str, Any] = {"ok": False, "login": login, "repository": f"{target.account}/{target.repo}",
                            "exists": False, "empty": False, "private": False, "pages": None,
                            "base": target.base, "needs": "", "detail": "", "warnings": [], "workflow": False}
    repo = github.repository(gh, target.account, target.repo)
    if repo is None:
        said.update(needs="repository", detail=f"There is no repository {target.account}/{target.repo} "
                                                "that this token can reach.")
        return said
    said.update(exists=True, private=repo.private)
    try:
        github.head(gh, target.account, target.repo, target.branch)
    except github.Conflict:
        said["empty"] = True
    pages = github.pages(gh, target.account, target.repo)
    if pages is None:
        said.update(needs="pages", detail=f"Pages is off for {target.account}/{target.repo}.")
        return said
    keep_site(target, pages.url)
    said.update(ok=True, pages=pages.said(), base=pages.url, warnings=pages_warnings(target, pages, repo.private),
                workflow=pages.build_type == "workflow")
    return said


def pages_warnings(target: GitHubTarget, pages: github.Pages, private: bool) -> list[str]:
    warnings = []
    if pages.branch and pages.branch != target.branch:
        warnings.append(f"Pages serves the {pages.branch} branch, not {target.branch}: "
                        f"set Branch to {pages.branch}.")
    if pages.build_type == "workflow":
        warnings.append(site.WORKFLOW_NOTICE)
    if private:
        warnings.append("The repository is private, but its Pages site is public.")
    return warnings


def _needs_target() -> GitHubTarget:
    target = github_settings()
    if not target.ready:
        raise HTTPException(status_code=409, detail=github.NOT_SET)
    return target


@router.post("/github/test")
def test_github() -> dict[str, Any]:
    """Sign in with the kept token and say who it is, whether the repository is there and
    whether Pages serves it. One press, a handful of reads, nothing written."""
    target = github_settings()
    if not target.ready:
        return {"ok": False, "detail": "Fill in the account and the token first.", "needs": ""}
    try:
        with github.client() as http:
            return _connection(target, github.GitHub(target.token, http))
    except github.GitHubError as exc:
        return {"ok": False, "detail": str(exc), "needs": ""}


@router.post("/github/repository")
def create_github_repository() -> dict[str, Any]:
    """Make the repository on GitHub, public, with a README: the press that says so.
    A token that may not make repositories is told how to do it on github.com."""
    target = _needs_target()
    try:
        with github.client() as http:
            gh = github.GitHub(target.token, http)
            login = github.whoami(gh)
            made = github.create_repository(gh, target.account, target.repo, login)
    except github.GitHubError as exc:
        manual = exc.status in (401, 403, 404)
        detail = ("This token may not make repositories: make it on github.com, then let the token reach it."
                  if manual and exc.status != 401 else str(exc))
        return {"ok": False, "detail": detail, "manual": manual}
    return {"ok": True, "repository": made.full_name, "branch": made.default_branch}


@router.post("/github/pages")
def turn_on_github_pages() -> dict[str, Any]:
    """Turn Pages on for the branch set, from its root: the press that says so. A token
    without the permission GitHub asks for this is told how to do it on github.com."""
    target = _needs_target()
    try:
        with github.client() as http:
            on = github.turn_on_pages(github.GitHub(target.token, http), target.account, target.repo, target.branch)
    except github.GitHubError as exc:
        manual = exc.status in (403, 404)
        detail = (f"This token may not turn Pages on: give it {exc.permission or 'Administration, Read and write'}, "
                  "or turn it on in the repository's Settings › Pages." if manual else str(exc))
        return {"ok": False, "detail": detail, "manual": manual}
    keep_site(target, on.url)
    return {"ok": True, "pages": on.said(), "base": on.url}


class BuildIn(BaseModel):
    commit: str = Field(pattern=r"^[0-9a-f]{40}$")


@router.post("/github/build")
def github_build(body: BuildIn) -> dict[str, Any]:
    """Whether Pages has built a commit Azimut published: `built`, `building` or
    `errored`. Asked by the export dialog for a bounded time after its press."""
    target = _needs_target()
    try:
        with github.client() as http:
            state = github.build_state(github.GitHub(target.token, http), target.account, target.repo, body.commit)
    except github.GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"state": state.state, "detail": state.detail}


def _site_found(target: GitHubTarget, gh: github.GitHub) -> tuple[github.Repository, github.Pages] | dict[str, Any]:
    """The repository and its Pages site, or the answer that says what is missing."""
    repo = github.repository(gh, target.account, target.repo)
    repository = f"{target.account}/{target.repo}"
    if repo is None:
        return {"ok": False, "needs": "repository",
                "detail": f"There is no repository {repository} that this token can reach."}
    pages = github.pages(gh, target.account, target.repo)
    if pages is None:
        return {"ok": False, "needs": "pages", "detail": f"Pages is off for {repository}."}
    if pages.branch and pages.branch != target.branch:
        raise HTTPException(status_code=409, detail=pages_warnings(target, pages, False)[0])
    keep_site(target, pages.url)
    return repo, pages


def _site_press(target: GitHubTarget, gh: github.GitHub) -> github.Pages | dict[str, Any]:
    """The Pages site of the repository, or the answer that says what is missing."""
    found = _site_found(target, gh)
    return found if isinstance(found, dict) else found[1]


@router.post("/github/site")
def update_github_site() -> dict[str, Any]:
    """Update the site: rebuild its list, feed, sitemap, marked pages and home from the cards the
    repository holds, and give each article page the bar the site asks for (`azimut-bar.html`, else
    Azimut's), in one commit, with no note published. Only files Azimut made are written; with
    nothing to change, nothing is committed (``updated`` is false)."""
    target = _needs_target()
    try:
        with github.client() as http:
            gh = github.GitHub(target.token, http, patience=github.MAX_PATIENCE)
            found = _site_press(target, gh)
            if isinstance(found, dict):
                return found
            plan = sitesync.updater(gh, target.account, target.repo, site_for(target, found.url))
            done = github.update_site(gh, target.account, target.repo, target.branch, found.root,
                                      "Update the site", plan)
    except github.GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    assert done is not None
    keep_categories(done.categories)
    return {"ok": True, "updated": bool(done.root), "commit": done.commit if done.root else "",
            "written": done.root, "warnings": done.warnings,
            "categories": site.categories_read(config.load_settings().get("github_categories"))}


@router.post("/github/categories")
def read_github_categories() -> dict[str, Any]:
    """Read the site for the categories it holds, in its cards and in the `section="…"` of its
    marked pages, and keep them for the publish dialog to suggest. Reads only."""
    target = _needs_target()
    try:
        with github.client() as http:
            gh = github.GitHub(target.token, http)
            found = _site_press(target, gh)
            if isinstance(found, dict):
                return found
            plan = sitesync.planner(gh, target.account, target.repo, site_for(target, found.url))
            read = github.read_site(gh, target.account, target.repo, target.branch, found.root, plan)
    except github.GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    keep_categories(read.categories)
    return {"ok": True, "categories": site.categories_read(read.categories), "warnings": read.warnings}


@router.post("/github/site/read")
def read_github_site() -> dict[str, Any]:
    """Read what the site holds, for Settings › Website › Articles: its cards (every article, map and
    page, unlisted ones too, each with its weight and whether `/github/site/delete` takes it), its
    categories with the pages that list them, whose home it has, whose bar its articles carry (``bar``,
    `yours` for its own `azimut-bar.html`, else `azimut`), its legal and privacy pages, the last commit,
    and what the site and the repository weigh. Keeps the categories it found. Reads only."""
    target = _needs_target()
    try:
        with github.client() as http:
            gh = github.GitHub(target.token, http, patience=github.MAX_PATIENCE)
            found = _site_found(target, gh)
            if isinstance(found, dict):
                return found
            repo, pages = found
            home = site_for(target, pages.url)
            read = github.read_branch(gh, target.account, target.repo, target.branch, pages.root)
            surveyed = sitesync.survey(gh, target.account, target.repo, home, read.tree)
    except github.GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    keep_categories(surveyed.found)
    return {"ok": True, "address": home.address, "home": surveyed.home, "bar": surveyed.bar, "items": surveyed.items,
            "categories": surveyed.categories, "marked": surveyed.marked, "legal": surveyed.legal,
            "privacy": surveyed.privacy,
            "last": {"date": read.date, "message": read.message} if read.date else None,
            "size": {"site": surveyed.bytes, "repository": repo.size}, "warnings": surveyed.warnings}


class DeleteIn(BaseModel):
    folder: str = Field(max_length=300)


@router.post("/github/site/delete")
def delete_github_folder(body: DeleteIn) -> dict[str, Any]:
    """Take an article's folder off the site, in one commit that also rewrites the list, the feed, the
    sitemap, the marked pages and Azimut's home from the site as it will be without it. Only a folder
    Azimut published goes, file by file (422 for any other and for one too large to read, 404 for one
    that is gone); the branch moving on GitHub meanwhile is a 409 with nothing changed. The note in
    the case is left as it is."""
    target = _needs_target()
    try:
        with github.client() as http:
            gh = github.GitHub(target.token, http, patience=github.MAX_PATIENCE)
            found = _site_press(target, gh)
            if isinstance(found, dict):
                return found
            plan = sitesync.remover(gh, target.account, target.repo, site_for(target, found.url))
            done = github.delete_folder(gh, target.account, target.repo, target.branch, found.root, body.folder,
                                        f"Delete {body.folder}", plan)
    except github.NotOurs as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except github.FolderGone as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except github.BranchMoved as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except github.GitHubError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    keep_categories(done.categories)
    return {"ok": True, "commit": done.commit, "folder": done.folder, "removed": done.removed, "written": done.root,
            "warnings": done.warnings}


# -- Cloudflare Web Analytics: the site's numbers -------------------------------------------------

CLOUDFLARE = "cloudflare"


class CloudflareIn(BaseModel):
    """The API token that reads the site's numbers. An empty one keeps the one kept: Forget is how
    it goes."""

    token: str | None = Field(default=None, max_length=publishsecrets.MAX_SECRET + 20)


def _cloudflare_state() -> dict[str, Any]:
    return {"token": publishsecrets.status(CLOUDFLARE)}


@router.put("/cloudflare")
def save_cloudflare(body: CloudflareIn) -> dict[str, Any]:
    try:
        if body.token:
            publishsecrets.write(CLOUDFLARE, sitestats.api_token(body.token))
    except (sitestats.StatsError, publishsecrets.SecretError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return _cloudflare_state()


@router.delete("/cloudflare")
def forget_cloudflare() -> dict[str, Any]:
    """Forget the API token on this machine; the account ID and the site tag stay, being no secret."""
    publishsecrets.forget(CLOUDFLARE)
    return _cloudflare_state()


def _remember_tag(tag: str, site_token: str) -> None:
    """Keep a site tag found from the site token, with that token, so the next press asks no list."""
    config.update_settings(lambda settings: settings.update(site_stats_tag=tag, site_stats_tag_from=site_token))


@router.post("/cloudflare/numbers")
def read_cloudflare_numbers() -> dict[str, Any]:
    """Read the site's numbers from Cloudflare Web Analytics: the page views and visits of each page
    over 7 and 30 days, the totals, the referrers and the countries, on the Read the numbers press only.

    The site tag the query filters by is the one typed by hand, else the one last found for the site
    token Readers holds, else found now from that token by listing the account's sites, and kept. A
    found tag under which Cloudflare counts nothing is looked up again once. 409 until the account ID,
    the API token and the site token (or a tag) are set; ``{ok: false, needs: "tag", detail}`` when the
    tag cannot be found (no site has that token, or the token may not list the sites), for the analyst
    to type it; 502 with what went wrong in one sentence."""
    settings = config.load_settings()
    account = site.cloudflare_id(settings.get("site_stats_account"))
    token = publishsecrets.read(CLOUDFLARE)
    prefs = site.prefs_of(settings)
    site_token = prefs["site_stats_token"]
    tag = prefs["site_stats_tag"]
    by_hand = bool(tag) and not prefs["site_stats_tag_found"]
    known = by_hand or (bool(tag) and settings.get("site_stats_tag_from") == site_token)
    if not (account and sitestats.API_TOKEN.match(token) and (known or site_token)):
        raise HTTPException(status_code=409, detail=sitestats.NOT_SET)
    target = github_settings()
    address = target.base if target.account else ""
    options = {"prefix": sitestats.site_prefix(address), "host": urlsplit(address).hostname or ""}
    try:
        with sitestats.client() as http:
            if not known:
                tag = sitestats.find_site_tag(http, token, account, site_token)
                _remember_tag(tag, site_token)
            numbers = sitestats.read_numbers(http, token, account, tag, **options)
            if known and not by_hand and sitestats.counted_nothing(numbers):
                try:
                    again = sitestats.find_site_tag(http, token, account, site_token)
                except sitestats.StatsError:
                    # the list cannot say: the tag kept and its empty numbers stand
                    again = tag
                if again != tag:
                    tag = again
                    _remember_tag(tag, site_token)
                    numbers = sitestats.read_numbers(http, token, account, tag, **options)
    except sitestats.StatsError as exc:
        if exc.needs:
            return {"ok": False, "needs": exc.needs, "detail": str(exc)}
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {"ok": True, "address": address, "tag": tag, "tag_found": not by_hand, **numbers}
