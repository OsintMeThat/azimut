"""A note's web folder published to the analyst's own GitHub Pages site, in one press.

The web folder (`engine/notes_web.py`) is a page to put online; this puts it there,
in the repository the analyst named in Settings › Website, with the token they made
for it. It is the one exception to "no auto-posting" (SPEC §8): a report page goes to
the analyst's own site on their press in Azimut. Nothing here runs on a schedule, at
startup or on a read.

**The calls** go to `https://api.github.com` and nowhere else, with the token in the
`Authorization` header (never in an address, never logged, never said back), the
version of the API pinned, timeouts, every answer read up to a bound, and a redirect
followed only while it stays on that host over https. They are, from GitHub's REST
reference (docs.github.com, read on 2026-11-18):

- `GET /user`, who the token signs in as;
- `GET /repos/{owner}/{repo}`, whether the repository is there and what it weighs (`size`, KiB);
- `GET /repos/{owner}/{repo}/pages`, whether Pages is on, its address (`html_url`,
  a custom domain included), the branch and folder it serves;
- the Git database to commit the whole folder as **one commit**: `GET git/ref/heads/…`,
  `GET git/commits/…`, `GET git/trees/…`, `POST git/blobs` for each file the folder's
  earlier copy does not already hold, `POST git/trees` for the folder (made whole,
  so a file the new build no longer has is gone from it) and for the root
  (`base_tree`, so every other article stays as it was), `POST git/commits`, then
  `PATCH git/refs/heads/…` as a fast-forward only;
- `GET /repos/{owner}/{repo}/pages/builds/latest`, watched for a bounded time after;
- `GET /repos/{owner}/{repo}/contents/{path}` (raw), for Check;
- on their own presses only, `POST /user/repos` (or `/orgs/{org}/repos`) to make the
  repository, and `POST /repos/{owner}/{repo}/pages` to turn Pages on, after a first
  `PUT contents/README.md` when the repository is still empty (the Git database
  answers 409 on an empty repository, and GitHub's guide names this way to start one).

**The token** is a fine-grained personal access token limited to the one repository:
Contents and Pages, each Read and write (Metadata, read-only, comes with them).
Turning Pages on from here also needs Administration, Read and write, and making the
repository needs a token on all repositories with Administration: both are offered as
presses, and when the token cannot, the tool says what to do on github.com instead.

**What is committed**: the folder under `<short-name>/` at the root the Pages site is
served from (`/`, or `docs/`), without its `HOW-TO-PUBLISH.md` (that is for putting
it online by hand), and `.nojekyll` beside it at that root, so Pages serves the files
as they are. The message is "Publish <note title>"; the author is the token's own
account, as GitHub sets it. A folder of that name that Azimut did not make is refused,
never replaced. Before the press, `spot` finds the folder and the names beside it, `holder` says
what a folder there holds (its card's title, else its page's), and `free_name` a short name
nothing holds, so the dialog can name what a publish would replace.

**The site**: in the same commit, what the site's list is made of (`engine/sitesync.py`
plans it, `engine/site.py` makes it): `articles.json`, `feed.xml`, `sitemap.xml`, the
lists between markers in the pages that carry them and the default home, each only where
Azimut owns it. Reading the site is `GET git/trees/…?recursive=1` for the whole tree and
`GET git/blobs/…` (raw) for each card and each page to fill, bounded in number and size.
The commit keeps the sha of the folder's tree, which the note's record holds so that a
later publish can say the folder was changed on GitHub since; a tree that differs only between
the bar's markers of its pages, which Update the site changes, is no change (`changed_since`).
The folder's page carries the site's own bar when the plan names one (`RootPlan.bar`).
Rebuilding those root files, and the bar of every article page, without a note is
`update_site`. Reading what the site holds, for Settings › Website, is `read_branch`: the
same reads as a publish's plan, plus the head commit's date and first line, and nothing written. Taking a folder off the site is `delete_folder`: one commit that removes
the folder file by file (a tree entry with a null `sha` for each blob the folder's recursive
listing gave, in the mode it gave, posted over `base_tree`: GitHub documents a null `sha` for a
file, and Git drops the folders it empties) and rewrites the root files from the site as it will
be without it; only a folder Azimut published, and never one whose listing GitHub cut short.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import quote, urljoin, urlsplit

import httpx

from .. import __version__
from . import notes_web
from . import site as site_engine

API = "https://api.github.com"
API_HOST = "api.github.com"
#: The REST API version every request names, so an answer's shape does not move under it.
API_VERSION = "2026-03-10"
TIMEOUT = httpx.Timeout(30.0, connect=10.0, write=120.0)
#: The most a JSON answer may weigh, and the page Check reads back.
MAX_ANSWER = 8 * 1024 * 1024
MAX_PAGE = 32 * 1024 * 1024
#: How many redirects are followed, and only on api.github.com over https.
MAX_REDIRECTS = 3
#: A folder this large is refused before anything is written: GitHub warns past 50 MB
#: a file and recommends a Pages site stay under 1 GB.
MAX_FILE_BYTES = 50 * 1024 * 1024
MAX_TOTAL_BYTES = 200 * 1024 * 1024
MAX_FILES = 1000
#: How long one publish may wait, in all, when GitHub asks it to slow down.
MAX_PATIENCE = 120.0
#: GitHub takes some 80 content-making requests a minute: past this many in one
#: publish, they are spaced so that a large folder does not trip the limit.
PACE_FROM = 60
PACE_SECONDS = 0.8
#: The longest commit message, in characters.
MAX_TITLE = 200

DEFAULT_REPO = "articles"
DEFAULT_BRANCH = "main"
NOJEKYLL = notes_web.NOJEKYLL
#: What every Azimut web folder holds at its top, which is how one is known again.
OURS = (notes_web.INDEX, notes_web.SHARE)
#: The most a read of the whole tree may weigh, and one blob read to plan the site: a card, a page.
MAX_TREE = 16 * 1024 * 1024
#: The README an empty repository is started with before Pages can serve it.
STARTER = b"# Articles\n\nReports published from Azimut, one folder each.\n"

#: A GitHub username or organisation: letters, digits and single hyphens, 39 at most.
ACCOUNT = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")
#: A repository name, as GitHub's own form takes it.
REPO = re.compile(r"^[A-Za-z0-9._-]{1,100}$")
#: A branch: a safe part of what Git takes, checked again part by part.
BRANCH = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")
#: An article's short name, the last part of its address: lower case, digits, - and _.
SHORT = re.compile(r"^[a-z0-9](?:[a-z0-9_-]{0,78}[a-z0-9])?$")
MAX_SHORT = 80
SHA1 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
#: A commit's date as GitHub's Git database says it, UTC or with an offset.
COMMIT_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$")

#: What each permission is called on GitHub's token page.
PERMISSIONS = {
    "contents": "Contents",
    "pages": "Pages",
    "administration": "Administration",
    "metadata": "Metadata",
    "repository_creation": "Repository creation",
}

BAD_TOKEN = ("GitHub refused the token: it may be mistyped, expired or revoked. "
             "Make a new one and paste it in Settings › Website.")
NOT_SET = "GitHub Pages is not set up yet: Settings › Website › GitHub Pages."
PUBLISH_MOVED = "The branch changed on GitHub while Azimut was publishing: press Publish again."
DELETE_MOVED = "The branch changed on GitHub while Azimut was deleting: press Delete again."
NOT_OURS = "Azimut deletes only the folders it published."
TOO_MANY_FILES = "The folder holds more files than Azimut can read: delete it on GitHub."
GONE = "That folder is not on the site any more."


class GitHubError(Exception):
    """Something GitHub, the network or a name stopped, said for the analyst in one
    sentence. ``status`` is GitHub's answer, 0 for none."""

    def __init__(self, message: str, status: int = 0, *, permission: str = "") -> None:
        super().__init__(message)
        self.status = status
        self.permission = permission


class NotFound(GitHubError):
    pass


class TooLarge(GitHubError):
    """An answer longer than the reader was told to take."""


class Conflict(GitHubError):
    pass


class BranchMoved(GitHubError):
    """The branch moved on GitHub while a commit was being made, so the move was refused."""


class FolderGone(NotFound):
    """The folder to delete is not on the site (any more)."""


class NotOurs(GitHubError):
    """The folder to delete is not one Azimut deletes: not one it published, or too large to read whole."""


class RateLimited(GitHubError):
    def __init__(self, message: str, status: int, wait: float | None) -> None:
        super().__init__(message, status)
        self.wait = wait


# -- the names ---------------------------------------------------------------------------


def account_name(value: str | None) -> str:
    """A GitHub account as typed, checked; "" for none."""
    text = str(value or "").strip().lstrip("@")
    if not text:
        return ""
    if not ACCOUNT.match(text):
        raise GitHubError("An account name holds letters, digits and single hyphens, 39 at most, "
                          "and does not start or end with a hyphen.")
    return text


def repository_name(value: str | None) -> str:
    """A repository name, checked; "" for none."""
    text = str(value or "").strip()
    if text.lower().endswith(".git"):
        text = text[:-4]
    if not text:
        return ""
    if not REPO.match(text) or text in (".", ".."):
        raise GitHubError("A repository name holds letters, digits, dots, hyphens and underscores, 100 at most.")
    return text


def branch_name(value: str | None) -> str:
    """A branch name, checked against what Git refuses; "" for none."""
    text = str(value or "").strip()
    if not text:
        return ""
    parts = text.split("/")
    if (not BRANCH.match(text) or text.startswith("-") or text == "HEAD" or ".." in text
            or any(not part or part.startswith(".") or part.endswith(".lock") for part in parts)
            or text.endswith(".")):
        raise GitHubError("That does not read as a branch name, such as main.")
    return text


def short_name(value: str | None) -> str:
    """An article's short name, the last part of its address: required."""
    text = str(value or "").strip().strip("/")
    if not text:
        raise GitHubError("Give the article a short name, such as port-strike.")
    if len(text) > MAX_SHORT:
        raise GitHubError(f"A short name is {MAX_SHORT} characters at most.")
    if not SHORT.match(text):
        raise GitHubError("A short name holds lower-case letters, digits, hyphens and underscores, "
                          "and starts and ends with a letter or a digit.")
    return text


def site_base(account: str, repo: str, pages_url: str = "") -> str:
    """Where the articles live: the address Pages gave the site (a custom domain
    included), else `https://<account>.github.io/<repo>/`, or the account's own site
    for a repository named `<account>.github.io`. Always ends with a slash."""
    if pages_url:
        try:
            parts = urlsplit(pages_url)
            address = notes_web.address(parts._replace(scheme="https").geturl())
        except (ValueError, notes_web.NotesWebError):
            address = ""
        if address:
            return address
    host = f"{account.lower()}.github.io"
    if repo.lower() == host:
        return f"https://{host}/"
    return f"https://{host}/{repo}/"


def article_address(base: str, short: str) -> str:
    """The address one article will live at, checked as the web folder checks it."""
    return notes_web.address(f"{base}{short}/")


def blob_sha(data: bytes) -> str:
    """The id Git gives a file's bytes, so a file the repository already holds is not sent again."""
    return hashlib.sha1(b"blob %d\0" % len(data) + data, usedforsecurity=False).hexdigest()


# -- the connection ----------------------------------------------------------------------


def client(transport: httpx.BaseTransport | None = None) -> httpx.Client:
    """The one way out to GitHub: timeouts, no redirect followed by itself, Azimut named.
    ``transport`` stands GitHub in for the tests."""
    return httpx.Client(timeout=TIMEOUT, follow_redirects=False, transport=transport, headers={
        "User-Agent": f"Azimut/{__version__}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
    })


@dataclass
class Answer:
    status: int
    headers: httpx.Headers
    body: bytes

    def json(self) -> Any:
        try:
            return json.loads(self.body or b"null")
        except ValueError:
            return None


class GitHub:
    """GitHub's REST API, reached with the analyst's token.

    ``patience`` is how long, in all, this one task may wait when GitHub asks it to slow
    down (0 for a quick question such as Test connection); ``sleep`` is how it waits."""

    def __init__(self, token: str, http: httpx.Client, *, patience: float = 0.0,
                 sleep: Callable[[float], None] | None = None) -> None:
        self._auth = f"Bearer {token}"
        self.http = http
        self.patience = patience
        self.sleep = sleep or time.sleep
        self.waited = 0.0
        self.writes = 0

    def call(self, method: str, path: str, *, body: Any = None, query: Mapping[str, str] | None = None,
             doing: str = "", accept: str = "", cap: int = MAX_ANSWER) -> Answer:
        """One request, retried while GitHub asks for a pause this task can still afford."""
        while True:
            try:
                return self._call(method, path, body=body, query=query, doing=doing, accept=accept, cap=cap)
            except RateLimited as limited:
                wait = limited.wait
                if wait is None or self.waited + wait > self.patience:
                    raise
                self.waited += wait
                self.sleep(wait)

    def _call(self, method: str, path: str, *, body: Any, query: Mapping[str, str] | None, doing: str,
              accept: str, cap: int) -> Answer:
        url = f"{API}{path}"
        if query:
            url += "?" + "&".join(f"{quote(key, safe='')}={quote(value, safe='')}" for key, value in query.items())
        headers = {"Authorization": self._auth}
        if accept:
            headers["Accept"] = accept
        for _ in range(MAX_REDIRECTS + 1):
            answer = self._send(method, url, body, headers, cap)
            if answer.status not in (301, 302, 303, 307, 308):
                return _checked(answer, doing)
            url = self._next(url, answer, method)
            if answer.status == 303:
                method, body = "GET", None
        raise GitHubError("GitHub sent Azimut round in redirects.")

    def _send(self, method: str, url: str, body: Any, headers: dict[str, str], cap: int) -> Answer:
        try:
            request = self.http.build_request(method, url, json=body, headers=headers)
            response = self.http.send(request, stream=True)
            try:
                kept = bytearray()
                for chunk in response.iter_bytes():
                    kept += chunk
                    if len(kept) > cap:
                        raise TooLarge("GitHub answered with more than Azimut reads at once.")
            finally:
                response.close()
        except httpx.TimeoutException as exc:
            raise GitHubError("GitHub did not answer in time. Try again in a moment.") from exc
        except httpx.ConnectError as exc:
            raise GitHubError("Azimut could not reach GitHub. Check this computer's connection.") from exc
        except httpx.HTTPError as exc:
            raise GitHubError("GitHub could not be reached.") from exc
        if method in ("POST", "PUT", "PATCH", "DELETE"):
            self.writes += 1
        return Answer(response.status_code, response.headers, bytes(kept))

    @staticmethod
    def _next(url: str, answer: Answer, method: str) -> str:
        """Where a redirect points, when it stays on api.github.com over https and keeps
        the request whole; anything else stops here."""
        location = answer.headers.get("location") or ""
        target = urljoin(url, location)
        parts = urlsplit(target)
        same = parts.scheme == "https" and parts.hostname == API_HOST and parts.port in (None, 443)
        keeps = method in ("GET", "HEAD") or answer.status in (303, 307, 308)
        if not (location and same and keeps):
            raise GitHubError("GitHub answered from another address, which Azimut does not follow. "
                              "If the repository was renamed, type its new name.", answer.status)
        return target


def _message(answer: Answer) -> str:
    body = answer.json()
    said = str(body.get("message") or "") if isinstance(body, dict) else ""
    return re.sub(r"<[^>]+>", "", " ".join(said.split()))[:160]


def _permission_words(header: str) -> str:
    """`pages=write,administration=write` as the token page says it: the first set only."""
    first = header.split(";")[0]
    names: list[str] = []
    level = "Read-only"
    for item in first.split(","):
        name, _, access = item.strip().partition("=")
        if not name:
            continue
        names.append(PERMISSIONS.get(name, name.replace("_", " ").capitalize()))
        if access in ("write", "admin"):
            level = "Read and write"
    if not names:
        return ""
    joined = names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"
    return f"{joined}, {level}"


def _checked(answer: Answer, doing: str) -> Answer:
    """The answer when it is one, else the sentence that says what went wrong."""
    status = answer.status
    if status < 300:
        return answer
    message = _message(answer)
    doing = doing or "do that"
    if status == 401:
        raise GitHubError(BAD_TOKEN, status)
    if status in (403, 429):
        remaining = answer.headers.get("x-ratelimit-remaining")
        retry = answer.headers.get("retry-after")
        if remaining == "0":
            reset = answer.headers.get("x-ratelimit-reset") or ""
            when = ""
            if reset.isdigit():
                when = f" after {datetime.fromtimestamp(int(reset)).astimezone().strftime('%H:%M')}"
            raise RateLimited(f"GitHub's hourly limit for this token is used up: try again{when}.", status, None)
        if retry is not None or "rate limit" in message.lower() or status == 429:
            wait = float(retry) if retry and retry.isdigit() else 60.0
            raise RateLimited("GitHub asks Azimut to slow down: try again in a minute.", status, wait)
        needed = _permission_words(answer.headers.get("x-accepted-github-permissions") or "")
        if needed:
            raise GitHubError(f"The token may not {doing}: give it {needed} on this repository.", status,
                              permission=needed)
        if "personal access token" in message.lower() or "not accessible" in message.lower():
            raise GitHubError(f"The token may not {doing}: give it Contents and Pages, Read and write, "
                              "on this repository.", status)
        raise GitHubError(f"GitHub refused to {doing}{f': {message}' if message else ''}.", status)
    if status == 404:
        raise NotFound(f"GitHub found nothing to {doing}: check the account, the repository and that the token "
                       "reaches it.", status)
    if status == 409:
        raise Conflict("The repository is empty, or GitHub is still making it: turn on Pages first, "
                       "or wait a moment.", status)
    if status == 422:
        raise GitHubError(f"GitHub would not {doing}{f': {message}' if message else ''}.", status)
    if status >= 500:
        raise GitHubError(f"GitHub is having trouble (HTTP {status}): try again in a moment.", status)
    raise GitHubError(f"GitHub answered HTTP {status} when asked to {doing}.", status)


def _dict(answer: Answer) -> dict[str, Any]:
    body = answer.json()
    if not isinstance(body, dict):
        raise GitHubError("GitHub answered with something Azimut cannot read.", answer.status)
    return body


def _part(value: Any) -> dict[str, Any]:
    """A part of an answer that should be an object, or an empty one."""
    return value if isinstance(value, dict) else {}


def _sha(value: Any) -> str:
    if not (isinstance(value, str) and SHA1.match(value)):
        raise GitHubError("GitHub answered with something Azimut cannot read.")
    return value


def _repo_path(owner: str, repo: str, tail: str = "") -> str:
    return f"/repos/{quote(owner, safe='')}/{quote(repo, safe='')}{tail}"


# -- reading -------------------------------------------------------------------------------


@dataclass
class Repository:
    full_name: str
    private: bool
    default_branch: str
    #: What GitHub says the repository weighs, history included, in bytes (it says KiB); None for none.
    size: int | None = None


@dataclass
class Pages:
    url: str
    branch: str
    path: str
    build_type: str
    status: str

    @property
    def root(self) -> str:
        """The folder of the repository the site is served from: "" or "docs/"."""
        return "docs/" if self.path.strip("/") == "docs" else ""

    def said(self) -> dict[str, Any]:
        return {"url": self.url, "branch": self.branch, "path": self.path, "build_type": self.build_type,
                "status": self.status}


def whoami(gh: GitHub) -> str:
    login = _dict(gh.call("GET", "/user", doing="read who it signs in as")).get("login")
    return str(login) if isinstance(login, str) and ACCOUNT.match(login) else ""


def repository(gh: GitHub, owner: str, repo: str) -> Repository | None:
    try:
        body = _dict(gh.call("GET", _repo_path(owner, repo), doing="read the repository"))
    except NotFound:
        return None
    branch = body.get("default_branch")
    size = body.get("size")
    return Repository(full_name=str(body.get("full_name") or f"{owner}/{repo}")[:200],
                      private=bool(body.get("private")),
                      default_branch=branch if isinstance(branch, str) and BRANCH.match(branch) else "",
                      size=size * 1024 if isinstance(size, int) and not isinstance(size, bool) and size >= 0 else None)


def pages(gh: GitHub, owner: str, repo: str) -> Pages | None:
    try:
        body = _dict(gh.call("GET", _repo_path(owner, repo, "/pages"), doing="read the Pages site"))
    except NotFound:
        return None
    return _pages(body, owner, repo)


def _pages(body: dict[str, Any], owner: str, repo: str) -> Pages:
    source = _part(body.get("source"))
    url = body.get("html_url")
    return Pages(
        url=site_base(owner, repo, url if isinstance(url, str) else ""),
        branch=str(source.get("branch") or "")[:100],
        path=str(source.get("path") or "/")[:20],
        build_type=str(body.get("build_type") or "legacy")[:20],
        status=str(body.get("status") or "")[:20],
    )


def head(gh: GitHub, owner: str, repo: str, branch: str) -> str | None:
    """The commit a branch points at, None when there is no such branch. An empty
    repository raises `Conflict`."""
    try:
        body = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/ref/heads/{quote(branch)}"),
                             doing="read the branch"))
    except NotFound:
        return None
    target = _part(body.get("object"))
    return _sha(target.get("sha"))


def _entries(gh: GitHub, owner: str, repo: str, tree: str, *, recursive: bool = False) -> list[dict[str, Any]]:
    body = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/trees/{tree}"),
                         query={"recursive": "1"} if recursive else None, doing="read the repository's files"))
    found = body.get("tree")
    return [entry for entry in found if isinstance(entry, dict)] if isinstance(found, list) else []


@dataclass
class Build:
    state: str
    detail: str = ""


def build_state(gh: GitHub, owner: str, repo: str, commit: str) -> Build:
    """Whether Pages has built ``commit``: `built`, `errored` with GitHub's words, or `building`."""
    try:
        body = _dict(gh.call("GET", _repo_path(owner, repo, "/pages/builds/latest"), doing="read the Pages build"))
    except NotFound:
        return Build("building")
    status = str(body.get("status") or "")
    if body.get("commit") != commit:
        return Build("building")
    if status == "built":
        return Build("built")
    if status == "errored":
        error = _part(body.get("error"))
        said = re.sub(r"<[^>]+>", "", " ".join(str(error.get("message") or "").split()))[:200]
        return Build("errored", said or "GitHub could not build the page.")
    return Build("building")


def page_state(gh: GitHub, owner: str, repo: str, branch: str, path: str, sha256: str, bare: str = "") -> str:
    """Whether the page a publish committed is still the one on the branch:
    `unchanged`, `changed` or `missing`. Reads it back, bounded. ``bare`` is the page's id with
    nothing between its bar's markers (`site.without_bar`): a page whose bar alone Update the site
    changed since is unchanged."""
    try:
        answer = gh.call("GET", _repo_path(owner, repo, f"/contents/{quote(path)}"), query={"ref": branch},
                         accept="application/vnd.github.raw+json", doing="read the page", cap=MAX_PAGE)
    except NotFound:
        return "missing"
    if hashlib.sha256(answer.body).hexdigest() == sha256:
        return "unchanged"
    same = bool(bare) and hashlib.sha256(site_engine.without_bar(answer.body)).hexdigest() == bare
    return "unchanged" if same else "changed"


# -- setting up, each on its own press -----------------------------------------------------


def create_repository(gh: GitHub, owner: str, repo: str, login: str) -> Repository:
    """Make the repository, public, with a README so it has a branch to serve."""
    body = {"name": repo, "description": "Reports published from Azimut", "private": False, "auto_init": True,
            "has_issues": False, "has_projects": False, "has_wiki": False}
    path = "/user/repos" if owner.lower() == login.lower() else f"/orgs/{quote(owner, safe='')}/repos"
    made = _dict(gh.call("POST", path, body=body, doing="make a repository"))
    branch = made.get("default_branch")
    return Repository(full_name=str(made.get("full_name") or f"{owner}/{repo}")[:200], private=False,
                      default_branch=branch if isinstance(branch, str) and BRANCH.match(branch) else DEFAULT_BRANCH)


def turn_on_pages(gh: GitHub, owner: str, repo: str, branch: str) -> Pages:
    """Serve ``branch`` from its root. An empty repository is given a README first,
    the one way GitHub lets a first commit be made there, and a missing branch is made
    from the default one."""
    try:
        found = head(gh, owner, repo, branch)
    except Conflict:
        gh.call("PUT", _repo_path(owner, repo, "/contents/README.md"), doing="start the site",
                body={"message": "Start the site", "branch": branch,
                      "content": base64.b64encode(STARTER).decode("ascii")})
        found = head(gh, owner, repo, branch)
    if found is None:
        known = repository(gh, owner, repo)
        start = head(gh, owner, repo, known.default_branch) if known and known.default_branch else None
        if start is None:
            raise GitHubError(f"The repository has no branch {branch} to serve, and none to make it from.")
        gh.call("POST", _repo_path(owner, repo, "/git/refs"), body={"ref": f"refs/heads/{branch}", "sha": start},
                doing="make the branch")
    try:
        made = gh.call("POST", _repo_path(owner, repo, "/pages"),
                       body={"build_type": "legacy", "source": {"branch": branch, "path": "/"}}, doing="turn on Pages")
    except Conflict:
        # Pages was on already
        on = pages(gh, owner, repo)
        if on is None:
            raise
        return on
    return _pages(_dict(made), owner, repo)


# -- reading the site ------------------------------------------------------------------------


@dataclass
class TreeRead:
    """Every file of a tree, by its path from the tree's root to its blob's id."""

    entries: dict[str, str]
    #: False when GitHub cut the listing short or it was more than Azimut reads.
    complete: bool = True
    #: Each file's size in bytes as the listing gives it, by the same paths (none for a file it gives none for).
    sizes: dict[str, int] = field(default_factory=dict)


def read_tree(gh: GitHub, owner: str, repo: str, tree: str) -> TreeRead:
    """Every file under ``tree`` (a site's root) with its size, in one request; an empty read for no tree."""
    if not tree:
        return TreeRead({})
    try:
        body = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/trees/{tree}"), query={"recursive": "1"},
                             doing="read the site's files", cap=MAX_TREE))
    except TooLarge:
        return TreeRead({}, complete=False)
    found = body.get("tree")
    listed = found if isinstance(found, list) else []
    blobs = [item for item in listed
             if isinstance(item, dict) and item.get("type") == "blob" and isinstance(item.get("sha"), str)]
    entries = {str(item.get("path")): str(item.get("sha")) for item in blobs}
    sizes = {str(item.get("path")): item["size"] for item in blobs
             if isinstance(item.get("size"), int) and not isinstance(item.get("size"), bool) and item["size"] >= 0}
    return TreeRead(entries, complete=not body.get("truncated"), sizes=sizes)


def read_blob(gh: GitHub, owner: str, repo: str, sha: str, cap: int) -> bytes | None:
    """A file's bytes by its blob's id, raw; None when it is more than ``cap`` or is gone."""
    if not SHA1.match(sha):
        return None
    try:
        return gh.call("GET", _repo_path(owner, repo, f"/git/blobs/{sha}"), accept="application/vnd.github.raw+json",
                       doing="read a file of the site", cap=cap).body
    except (TooLarge, NotFound):
        return None


# -- publishing ----------------------------------------------------------------------------


@dataclass
class RootPlan:
    """What a publish does at the site's root beside the folder (`engine/sitesync.py`): the files
    to write, by path from that root, each only where it differs; what to tell the analyst; and
    the categories the site named, None when it was not read."""

    files: dict[str, bytes] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    categories: list[str] | None = None
    #: What the folder's article page carries between its bar's markers in place of the bar it was
    #: built with: the site's own (`site.own_bar`); None keeps Azimut's.
    bar: str | None = None


#: Plans the site's root from the id of its tree ("" when it has none yet), the name of the
#: folder being published and its card, which replaces the one the tree holds for it (an update
#: of the site alone has neither: "" and None).
Planner = Callable[[str, str, "site_engine.Card | None"], RootPlan]


@dataclass
class Published:
    commit: str
    folder: str
    uploaded: int
    reused: int
    removed: int | None
    created_branch: bool = False
    files: list[str] = field(default_factory=list)
    #: The id of the folder's tree as committed, which a later publish compares the folder on
    #: GitHub with.
    tree: str = ""
    #: Whether the folder on GitHub differed from the ``expected_tree`` it was replaced from.
    edited: bool = False
    #: The files written at the site's root, the words to say about them, and the categories read.
    root: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    categories: list[str] | None = None
    #: The SHA-256 of the folder's page as committed, and of it with nothing between its bar's
    #: markers (`site.without_bar`), "" for a folder with no page.
    page: str = ""
    bare: str = ""


def _bounded(files: Mapping[str, bytes]) -> None:
    if len(files) > MAX_FILES:
        raise GitHubError(f"The folder holds {len(files)} files; Azimut publishes {MAX_FILES} at most.")
    total = 0
    for path, data in files.items():
        _plain(path)
        if len(data) > MAX_FILE_BYTES:
            raise GitHubError(f"{path} weighs more than {MAX_FILE_BYTES // (1024 * 1024)} MB, which GitHub "
                              "warns against: leave the clip as a link.")
        total += len(data)
    if total > MAX_TOTAL_BYTES:
        raise GitHubError(f"The folder weighs more than {MAX_TOTAL_BYTES // (1024 * 1024)} MB, too much for one "
                          "page on GitHub Pages.")


def _plain(path: str) -> None:
    parts = path.split("/")
    if (not path or path.startswith("/") or "\\" in path or ":" in path
            or any(part in ("", ".", "..") for part in parts)):
        raise GitHubError(f"a file of the folder has a name it cannot have: {path!r}")


@dataclass
class _Branch:
    """A branch's head and the trees above the site's root, as a publish finds them."""

    parent: str
    created: bool
    base_tree: str
    #: The tree of the site's root folder ("" when it is not there yet), and its own files.
    level: str
    top: list[dict[str, Any]]
    #: The head commit's committer date and first message line, as GitHub says them ("" for none).
    date: str = ""
    message: str = ""


def _open(gh: GitHub, owner: str, repo: str, branch: str, above: list[str]) -> _Branch:
    parent = head(gh, owner, repo, branch)
    created = parent is None
    if parent is None:
        known = repository(gh, owner, repo)
        parent = head(gh, owner, repo, known.default_branch) if known and known.default_branch else None
        if parent is None:
            raise GitHubError(f"The repository has no branch {branch}: turn on Pages for it first.")
    commit = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/commits/{parent}"), doing="read the branch"))
    tree = _part(commit.get("tree"))
    base_tree = _sha(tree.get("sha"))
    level = base_tree
    for part in above:
        entry = next((item for item in _entries(gh, owner, repo, level) if item.get("path") == part), None)
        if entry is None or entry.get("type") != "tree":
            level = ""
            break
        level = _sha(entry.get("sha"))
    date = _part(commit.get("committer")).get("date")
    words = str(commit.get("message") or "").strip().split("\n", 1)[0]
    return _Branch(parent, created, base_tree, level, _entries(gh, owner, repo, level) if level else [],
                   date=date if isinstance(date, str) and COMMIT_DATE.match(date) else "",
                   message=" ".join(words.split())[:MAX_TITLE])


def _upload(gh: GitHub, owner: str, repo: str, data: bytes, *, pace: bool) -> str:
    if pace and gh.writes:
        gh.sleep(PACE_SECONDS)
    made = _dict(gh.call("POST", _repo_path(owner, repo, "/git/blobs"), doing="upload the folder's files",
                         body={"content": base64.b64encode(data).decode("ascii"), "encoding": "base64"}))
    return _sha(made.get("sha"))


def _land(gh: GitHub, owner: str, repo: str, branch: str, opened: _Branch, above: list[str],
          entries: list[dict[str, Any]], message: str, *, moved: str = PUBLISH_MOVED) -> str:
    """Write the site root's tree from ``entries`` over what it holds, then the commit and the
    branch's move as a fast-forward only. The commit's id; ``moved`` is what is said when the
    branch moved on GitHub meanwhile."""
    body: dict[str, Any] = {"tree": entries}
    if opened.level:
        body["base_tree"] = opened.level
    site_tree = _sha(_dict(gh.call("POST", _repo_path(owner, repo, "/git/trees"), doing="write the folder",
                                   body=body)).get("sha"))
    if above:
        # the site's root is a folder of the repository (`docs/`): it takes its place there
        wrapped = _dict(gh.call("POST", _repo_path(owner, repo, "/git/trees"), doing="write the folder", body={
            "base_tree": opened.base_tree,
            "tree": [{"path": "/".join(above), "mode": "040000", "type": "tree", "sha": site_tree}]}))
        site_tree = _sha(wrapped.get("sha"))
    title = " ".join(message.split())[:MAX_TITLE] or "Publish"
    made_commit = _dict(gh.call("POST", _repo_path(owner, repo, "/git/commits"), doing="commit the folder",
                                body={"message": title, "tree": site_tree, "parents": [opened.parent]}))
    sha = _sha(made_commit.get("sha"))
    try:
        if opened.created:
            gh.call("POST", _repo_path(owner, repo, "/git/refs"), body={"ref": f"refs/heads/{branch}", "sha": sha},
                    doing="make the branch")
        else:
            gh.call("PATCH", _repo_path(owner, repo, f"/git/refs/heads/{quote(branch)}"),
                    body={"sha": sha, "force": False}, doing="move the branch")
    except GitHubError as exc:
        if exc.status == 422:
            raise BranchMoved(moved, 422) from exc
        raise
    return sha


def _root_entries(gh: GitHub, owner: str, repo: str, plan: RootPlan, taken: str, *, pace: bool) -> list[dict[str, Any]]:
    """The tree entries of the files a plan writes at the site's root: each uploaded, none
    inside ``taken``, the folder being published."""
    entries = []
    for path in sorted(plan.files):
        _plain(path)
        if taken and (path == taken or path.startswith(f"{taken}/")):
            raise GitHubError(f"the site's own files may not go into the folder {taken}")
        sha = _upload(gh, owner, repo, plan.files[path], pace=pace)
        entries.append({"path": path, "mode": "100644", "type": "blob", "sha": sha})
    return entries


def publish(gh: GitHub, owner: str, repo: str, branch: str, files: Mapping[str, bytes], folder: str,
            message: str, *, card: "site_engine.Card | None" = None, plan: Planner | None = None,
            expected_tree: str = "") -> Published:
    """Commit ``files`` as ``folder`` (`<short>` or `docs/<short>`) on ``branch``, in one
    commit, with `.nojekyll` at the folder's root: the folder made whole, so a file the
    new build no longer has is gone; everything else in the repository as it was.

    With a ``card``, the folder carries it as `article.json`, dated as the card already in the
    folder is when there is one (the first publication's day stands). With a ``plan`` the same
    commit writes what it names at the site's root (`RootPlan`), and the folder's page takes the
    site's own bar when the plan names one. ``expected_tree`` is the id of the folder's tree as the
    last publish left it: the result says whether it is another now, beyond the bar of its pages.
    """
    _bounded(files)
    _plain(folder)
    *above, name = folder.split("/")
    opened = _open(gh, owner, repo, branch, above)
    top = opened.top
    found = next((item for item in top if item.get("path") == name), None)
    old: dict[str, str] = {}
    complete = True
    if found is not None:
        if found.get("type") != "tree":
            raise GitHubError(f"The repository holds a file named {name} there: give the article another short name.")
        listing = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/trees/{_sha(found.get('sha'))}"),
                                query={"recursive": "1"}, doing="read the article's files"))
        complete = not listing.get("truncated")
        found_entries = listing.get("tree")
        entries: list[Any] = found_entries if isinstance(found_entries, list) else []
        old = {str(item.get("path")): str(item.get("sha")) for item in entries
               if isinstance(item, dict) and item.get("type") == "blob" and isinstance(item.get("sha"), str)}
        if not all(part in old for part in OURS):
            raise GitHubError(f"The repository already has a folder named {name} that Azimut did not make: "
                              "give the article another short name.")
    edited = bool(expected_tree and found is not None and found.get("sha") != expected_tree
                  and not (complete and _bars_only(gh, owner, repo, expected_tree, old)))
    files = dict(files)
    if card is not None:
        earlier = None
        if site_engine.CARD in old:
            earlier = read_blob(gh, owner, repo, old[site_engine.CARD], site_engine.MAX_CARD_BYTES)
        first = site_engine.card_date(earlier) if earlier else ""
        card = card.dated(first) if first else card
        files[site_engine.CARD] = card.as_json()
    root = plan(opened.level, name, card) if plan is not None else RootPlan()
    page = files.get(notes_web.INDEX)
    if root.bar is not None and page is not None:
        # the site's own bar, in place of Azimut's the page was built with; a map page has none to swap
        page = site_engine.with_bar(page, root.bar) or page
        files[notes_web.INDEX] = page
        _bounded(files)
    have = set(old.values())
    wanted = {path: blob_sha(data) for path, data in files.items()}
    new = sorted(path for path, sha in wanted.items() if sha not in have)
    pace = len(new) + len(root.files) > PACE_FROM
    shas: dict[str, str] = {}
    for path in sorted(files):
        shas[path] = _upload(gh, owner, repo, files[path], pace=pace) if path in new else wanted[path]
    folder_tree = _tree(gh, owner, repo, shas)
    entries_out: list[dict[str, Any]] = [{"path": name, "mode": "040000", "type": "tree", "sha": folder_tree}]
    entries_out += _root_entries(gh, owner, repo, root, name, pace=pace)
    if not any(item.get("path") == NOJEKYLL and item.get("type") == "blob" for item in top):
        entries_out.append({"path": NOJEKYLL, "mode": "100644", "type": "blob", "content": ""})
    sha = _land(gh, owner, repo, branch, opened, above, entries_out, message)
    return Published(commit=sha, folder=folder, uploaded=len(new), reused=len(files) - len(new),
                     removed=len(set(old) - set(files)) if complete else None, created_branch=opened.created,
                     files=sorted(files), tree=folder_tree, edited=edited, root=sorted(root.files),
                     warnings=list(root.warnings), categories=root.categories,
                     page=hashlib.sha256(page).hexdigest() if page is not None else "",
                     bare=hashlib.sha256(site_engine.without_bar(page)).hexdigest() if page is not None else "")


def read_site(gh: GitHub, owner: str, repo: str, branch: str, root: str, plan: Planner) -> RootPlan:
    """What an update of the site would write, with nothing committed: ``plan`` run on the site's
    root as ``branch`` holds it now."""
    above = [part for part in root.strip("/").split("/") if part]
    opened = _open(gh, owner, repo, branch, above)
    if opened.created:
        raise GitHubError(f"The repository has no branch {branch}: turn on Pages for it first.")
    return plan(opened.level, "", None)


#: The most pages of a folder looked into to tell a change of bar from an edit.
MAX_BAR_PAGES = 4


def _listing(gh: GitHub, owner: str, repo: str, tree: str) -> dict[str, str] | None:
    """Every file under a folder's tree by its path, None when there is no such tree or GitHub cut it short."""
    if not SHA1.match(tree):
        return None
    try:
        body = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/trees/{tree}"), query={"recursive": "1"},
                             doing="read the article's files"))
    except NotFound:
        return None
    found = body.get("tree")
    if body.get("truncated") or not isinstance(found, list):
        return None
    return {str(item.get("path")): str(item.get("sha")) for item in found
            if isinstance(item, dict) and item.get("type") == "blob" and isinstance(item.get("sha"), str)}


def _bars_only(gh: GitHub, owner: str, repo: str, before: str, now: Mapping[str, str]) -> bool:
    """Whether a folder's files ``now`` differ from its tree ``before`` only between the bar's markers
    of its pages: what Update the site changes, which is not an edit. Reads the tree it was and each
    page that differs, both sides, only when the trees differ."""
    then = _listing(gh, owner, repo, before)
    if then is None or set(then) != set(now):
        return False
    changed = sorted(path for path, sha in now.items() if then[path] != sha)
    if len(changed) > MAX_BAR_PAGES or not all(path.endswith(".html") for path in changed):
        return False
    for path in changed:
        old = read_blob(gh, owner, repo, then[path], MAX_PAGE)
        new = read_blob(gh, owner, repo, now[path], MAX_PAGE)
        if old is None or new is None or site_engine.without_bar(old) != site_engine.without_bar(new):
            return False
    return True


def changed_since(gh: GitHub, owner: str, repo: str, before: str, now: str) -> bool:
    """Whether a folder was changed on GitHub since a publish left it as the tree ``before``, ``now``
    being its tree on the branch ("" for none): another tree, unless only the bar of its pages moved."""
    if not before or not now or now == before:
        return False
    listed = _listing(gh, owner, repo, now)
    return listed is None or not _bars_only(gh, owner, repo, before, listed)


@dataclass(frozen=True)
class Spot:
    """Where a publish would put a folder: the id of the tree a folder of that name has on the branch
    now ("" for none), and every name at the site's root beside it, files included."""

    tree: str = ""
    names: frozenset[str] = frozenset()


def spot(gh: GitHub, owner: str, repo: str, branch: str, folder: str) -> Spot:
    """``folder`` on ``branch`` as it is now: its tree, which a publish compares with the one it last
    left there, and the names at the site's root, which a free short name is found among. An empty
    spot when there is no such branch."""
    *above, name = folder.split("/")
    try:
        opened = _open(gh, owner, repo, branch, above)
    except GitHubError:
        return Spot()
    if opened.created:
        return Spot()
    found = next((item for item in opened.top if item.get("path") == name and item.get("type") == "tree"), None)
    return Spot(_sha(found.get("sha")) if found is not None else "",
                frozenset(str(item["path"]) for item in opened.top if isinstance(item.get("path"), str)))


#: The most of a folder's page read for its `<title>`, when the folder holds no card.
MAX_TITLE_PAGE = 2 * 1024 * 1024


@dataclass(frozen=True)
class Holder:
    """What a folder already on the site is, as the check before a publish names it."""

    #: Its card's title, else its page's `<title>`, else the folder's name.
    title: str
    #: Whether Azimut made it (its marker files, `OURS`): a publish replaces only such a folder.
    ours: bool


def holder(gh: GitHub, owner: str, repo: str, tree: str, name: str) -> Holder:
    """What the folder ``name``, whose tree is ``tree``, holds: its title and whether Azimut made it.
    Reads its own listing, then its card or its page, each bounded; a part that cannot be read names
    it by its folder."""
    if not SHA1.match(tree):
        return Holder(name, False)
    try:
        listing = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/trees/{tree}"), doing="read the article's files"))
    except NotFound:
        return Holder(name, False)
    entries = listing.get("tree")
    files = {str(item.get("path")): str(item.get("sha")) for item in (entries if isinstance(entries, list) else [])
             if isinstance(item, dict) and item.get("type") == "blob" and isinstance(item.get("sha"), str)}
    title = ""
    if site_engine.CARD in files:
        card = read_blob(gh, owner, repo, files[site_engine.CARD], site_engine.MAX_CARD_BYTES)
        title = site_engine.card_title(card) if card is not None else ""
    if not title and notes_web.INDEX in files:
        page = read_blob(gh, owner, repo, files[notes_web.INDEX], MAX_TITLE_PAGE)
        title = site_engine.page_title(page) if page is not None else ""
    return Holder(title or name, all(part in files for part in OURS))


def free_name(short: str, taken: Iterable[str]) -> str:
    """A short name beside ``short`` that nothing at the site's root holds: `port-strike-2`, then `-3`,
    and on from the number a name already ends on. "" when none is free within a hundred."""
    names = {name.casefold() for name in taken}
    ending = re.fullmatch(r"(.+?)-(\d{1,3})", short)
    stem, start = (ending.group(1), int(ending.group(2)) + 1) if ending else (short, 2)
    for number in range(start, start + 100):
        suffix = f"-{number}"
        made = f"{stem[:MAX_SHORT - len(suffix)].rstrip('-_')}{suffix}"
        if SHORT.match(made) and made.casefold() not in names:
            return made
    return ""


def update_site(gh: GitHub, owner: str, repo: str, branch: str, root: str, message: str,
                plan: Planner) -> Published | None:
    """Rebuild the site's root files without publishing a note: one commit holding what ``plan``
    names, or None, with nothing committed, when the site is up to date. ``root`` is the folder
    Pages serves from, "" or `docs/`."""
    above = [part for part in root.strip("/").split("/") if part]
    opened = _open(gh, owner, repo, branch, above)
    if opened.created:
        raise GitHubError(f"The repository has no branch {branch}: turn on Pages for it first.")
    made = plan(opened.level, "", None)
    if not made.files:
        return Published(commit=opened.parent, folder="", uploaded=0, reused=0, removed=None,
                         warnings=list(made.warnings), categories=made.categories)
    pace = len(made.files) > PACE_FROM
    entries = _root_entries(gh, owner, repo, made, "", pace=pace)
    if not any(item.get("path") == NOJEKYLL and item.get("type") == "blob" for item in opened.top):
        entries.append({"path": NOJEKYLL, "mode": "100644", "type": "blob", "content": ""})
    sha = _land(gh, owner, repo, branch, opened, above, entries, message)
    return Published(commit=sha, folder="", uploaded=len(made.files), reused=0, removed=None,
                     root=sorted(made.files), warnings=list(made.warnings), categories=made.categories)


@dataclass
class BranchRead:
    """What a read of the site's branch holds: the files of its root and the head commit's
    committer date and first message line ("" for none)."""

    tree: TreeRead
    date: str = ""
    message: str = ""


def read_branch(gh: GitHub, owner: str, repo: str, branch: str, root: str) -> BranchRead:
    """The site's root as ``branch`` holds it now, with its head commit, and nothing committed.
    ``root`` is the folder Pages serves from, "" or `docs/`."""
    above = [part for part in root.strip("/").split("/") if part]
    opened = _open(gh, owner, repo, branch, above)
    if opened.created:
        raise GitHubError(f"The repository has no branch {branch}: turn on Pages for it first.")
    return BranchRead(read_tree(gh, owner, repo, opened.level), opened.date, opened.message)


def deletable_name(folder: str) -> bool:
    """Whether a folder's name is one Azimut could have published: a short name at the site's root,
    which is none of the folders no card lives in (`site.SKIP`)."""
    return "/" not in folder and folder not in site_engine.SKIP and bool(SHORT.match(folder))


def deletable(folder: str, held: Iterable[str], card: bool) -> bool:
    """Whether `delete_folder` takes ``folder``: the one guard of the delete and of what the read
    says can be deleted. ``held`` are the paths of the folder's files relative to it, ``card`` whether
    its `article.json` is a card of `azimut-article/1`."""
    files = set(held)
    return deletable_name(folder) and card and site_engine.CARD in files and all(part in files for part in OURS)


@dataclass
class Deleted:
    commit: str
    folder: str
    #: How many files the folder held.
    removed: int
    #: The files written at the site's root, the words to say about them, and the categories read.
    root: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    categories: list[str] | None = None


def delete_folder(gh: GitHub, owner: str, repo: str, branch: str, root: str, folder: str, message: str,
                  plan: Planner) -> Deleted:
    """Take ``folder`` (a short name at the site's root) off ``branch`` in one commit, with the
    root files ``plan`` names for the site as it will be without it.

    Only a folder Azimut published goes: one level down, holding a card of `azimut-article/1`
    and Azimut's own files (`OURS`), else `NotOurs`, as is a folder whose listing GitHub cut short
    (more files than Azimut ever publishes); a folder that is not there is `FolderGone`. The
    branch moving on GitHub meanwhile is `BranchMoved`, with nothing changed."""
    if not deletable_name(folder):
        raise NotOurs(NOT_OURS, 422)
    above = [part for part in root.strip("/").split("/") if part]
    opened = _open(gh, owner, repo, branch, above)
    if opened.created:
        raise GitHubError(f"The repository has no branch {branch}: turn on Pages for it first.")
    found = next((item for item in opened.top if item.get("path") == folder and item.get("type") == "tree"), None)
    if found is None:
        raise FolderGone(GONE, 404)
    listing = _dict(gh.call("GET", _repo_path(owner, repo, f"/git/trees/{_sha(found.get('sha'))}"),
                            query={"recursive": "1"}, doing="read the article's files"))
    if listing.get("truncated"):
        raise NotOurs(TOO_MANY_FILES, 422)
    listed = listing.get("tree")
    blobs = [item for item in (listed if isinstance(listed, list) else [])
             if isinstance(item, dict) and item.get("type") == "blob" and isinstance(item.get("sha"), str)]
    held = {str(item.get("path")): str(item.get("sha")) for item in blobs}
    card = read_blob(gh, owner, repo, held[site_engine.CARD], site_engine.MAX_CARD_BYTES) \
        if site_engine.CARD in held else None
    if not deletable(folder, held, card is not None and site_engine.is_card(card)):
        raise NotOurs(NOT_OURS, 422)
    made = plan(opened.level, folder, None)
    # the folder goes file by file, each in the mode the listing gave it; Git drops the folders it empties
    entries: list[dict[str, Any]] = [
        {"path": f"{folder}/{item.get('path')}", "mode": str(item.get("mode") or "100644"), "type": "blob", "sha": None}
        for item in sorted(blobs, key=lambda one: str(one.get("path")))]
    entries += _root_entries(gh, owner, repo, made, folder, pace=len(made.files) > PACE_FROM)
    sha = _land(gh, owner, repo, branch, opened, above, entries, message, moved=DELETE_MOVED)
    return Deleted(commit=sha, folder=folder, removed=len(held),
                   root=sorted(made.files), warnings=list(made.warnings), categories=made.categories)


def _tree(gh: GitHub, owner: str, repo: str, shas: Mapping[str, str]) -> str:
    """The folder's own tree, made from nothing so it holds these files and no other,
    its subfolders first."""
    here: list[dict[str, Any]] = []
    below: dict[str, dict[str, str]] = {}
    for path, sha in shas.items():
        first, _, rest = path.partition("/")
        if rest:
            below.setdefault(first, {})[rest] = sha
        else:
            here.append({"path": first, "mode": "100644", "type": "blob", "sha": sha})
    for name, inner in sorted(below.items()):
        here.append({"path": name, "mode": "040000", "type": "tree", "sha": _tree(gh, owner, repo, inner)})
    made = _dict(gh.call("POST", _repo_path(owner, repo, "/git/trees"), doing="write the folder",
                         body={"tree": sorted(here, key=lambda entry: entry["path"])}))
    return _sha(made.get("sha"))


__all__ = [
    "API", "API_VERSION", "BAD_TOKEN", "BranchMoved", "BranchRead", "Build", "Conflict", "DEFAULT_BRANCH",
    "DEFAULT_REPO", "Deleted", "FolderGone", "GitHub", "GitHubError", "Holder", "NOT_SET", "NotFound", "NotOurs", "Pages",
    "Published", "RateLimited", "Repository", "Spot", "account_name", "article_address", "blob_sha", "branch_name",
    "build_state", "changed_since", "client", "create_repository", "deletable", "deletable_name", "delete_folder", "free_name",
    "head", "holder", "page_state", "pages", "publish", "read_blob", "read_branch", "read_site", "read_tree", "repository",
    "repository_name", "short_name", "site_base", "spot", "turn_on_pages", "update_site", "whoami",
]
