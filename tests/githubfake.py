"""A stand-in for api.github.com: a small Git object store behind `httpx.MockTransport`.

Blobs, trees, commits and refs as the REST API's Git database answers them, a repository, its
Pages site and its builds. No test reaches GitHub, and none needs an account: the calls are held
to GitHub's REST reference (docs.github.com), not to a live site. Shared by the tests of
publishing a note (`test_githubpages.py`), of the site that publish keeps (`test_site_publish.py`) and of
reading and deleting from it (`test_site_hub.py`). A tree entry with a null `sha` deletes what it names, a
subfolder included, as GitHub's Git database does.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
from typing import Any, Callable

import httpx

from azimut.engine import githubpages

TOKEN = "github_pat_11ABCDEFG0" + "x" * 72


def _sha(kind: str, payload: bytes) -> str:
    return hashlib.sha1(kind.encode() + b" %d\0" % len(payload) + payload).hexdigest()


class FakeGitHub:
    """api.github.com as far as publishing a folder needs it: one account, its
    repositories, each a Git object store with refs, a Pages site and its builds."""

    def __init__(self, login: str = "octo") -> None:
        self.login = login
        self.objects: dict[str, tuple[str, Any]] = {}
        self.repos: dict[str, dict[str, Any]] = {}
        self.requests: list[httpx.Request] = []
        #: (method, path pattern) -> a response, or a callable making one, answered in place
        self.fail: dict[tuple[str, str], Callable[[httpx.Request], httpx.Response] | httpx.Response] = {}
        self.build_status = "building"
        #: whether a recursive listing says it was cut short, as GitHub's does for a huge tree
        self.truncated = False
        #: the committer date every commit made from now on carries, as the Git database says it
        self.commit_date = "2026-11-21T13:55:52Z"

    # the object store ------------------------------------------------------------------

    def blob(self, data: bytes) -> str:
        sha = _sha("blob", data)
        self.objects[sha] = ("blob", data)
        return sha

    def tree(self, entries: dict[str, dict[str, str]]) -> str:
        payload = json.dumps(sorted(entries.items())).encode()
        sha = _sha("tree", payload)
        self.objects[sha] = ("tree", dict(entries))
        return sha

    def commit(self, tree: str, parents: list[str], message: str) -> str:
        payload = json.dumps([tree, parents, message, len(self.objects)]).encode()
        sha = _sha("commit", payload)
        self.objects[sha] = ("commit", {"tree": tree, "parents": parents, "message": message,
                                        "date": self.commit_date})
        return sha

    def write_tree(self, base: str | None, entries: list[dict[str, Any]]) -> str:
        top = dict(self.objects[base][1]) if base else {}
        nested: dict[str, list[dict[str, Any]]] = {}
        for entry in entries:
            first, _, rest = entry["path"].partition("/")
            if rest:
                nested.setdefault(first, []).append({**entry, "path": rest})
                continue
            if "content" in entry:
                sha = self.blob(entry["content"].encode())
            else:
                sha = entry["sha"]
            if sha is None:
                top.pop(first, None)
                continue
            assert sha in self.objects, f"tree names an object GitHub does not have: {sha}"
            top[first] = {"mode": entry["mode"], "type": entry["type"], "sha": sha}
        for first, inner in nested.items():
            below = top[first]["sha"] if first in top and top[first]["type"] == "tree" else None
            top[first] = {"mode": "040000", "type": "tree", "sha": self.write_tree(below, inner)}
        return self.tree(top)

    def walk(self, tree: str, prefix: str = "") -> dict[str, bytes]:
        found: dict[str, bytes] = {}
        for name, entry in self.objects[tree][1].items():
            if entry["type"] == "tree":
                found.update(self.walk(entry["sha"], f"{prefix}{name}/"))
            else:
                found[f"{prefix}{name}"] = self.objects[entry["sha"]][1]
        return found

    def files(self, repo: str = "octo/articles", branch: str = "main") -> dict[str, bytes]:
        head = self.repos[repo]["refs"][branch]
        return self.walk(self.objects[head][1]["tree"])

    def history(self, repo: str = "octo/articles", branch: str = "main") -> list[dict[str, Any]]:
        commits = []
        sha: str | None = self.repos[repo]["refs"][branch]
        while sha:
            commits.append(self.objects[sha][1])
            parents = self.objects[sha][1]["parents"]
            sha = parents[0] if parents else None
        return commits

    # the repositories ------------------------------------------------------------------

    def make_repo(self, full: str = "octo/articles", *, files: dict[str, bytes] | None = None,
                  pages: bool = True, branch: str = "main", empty: bool = False, url: str = "") -> None:
        owner, name = full.split("/")
        #: ``size`` is what the repository answers for its weight in KiB, history included; None leaves it out
        repo: dict[str, Any] = {"owner": owner, "name": name, "private": False, "default_branch": branch,
                                "refs": {}, "pages": None, "size": 2048}
        self.repos[full.lower()] = repo
        if not empty:
            content = files or {"README.md": b"# articles\n"}
            tree = self.write_tree(None, [{"path": path, "mode": "100644", "type": "blob", "sha": self.blob(data)}
                                          for path, data in content.items()])
            repo["refs"][branch] = self.commit(tree, [], "Initial commit")
        if pages:
            self.pages_on(repo, branch, url)

    def pages_on(self, repo: dict[str, Any], branch: str, url: str = "") -> dict[str, Any]:
        repo["pages"] = {"html_url": url or f"https://{repo['owner'].lower()}.github.io/{repo['name']}/",
                         "status": "built", "build_type": "legacy", "cname": None,
                         "source": {"branch": branch, "path": "/"}}
        return repo["pages"]

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    # the API ---------------------------------------------------------------------------

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        assert request.url.host == "api.github.com" and request.url.scheme == "https", request.url
        assert TOKEN not in str(request.url), "the token went into an address"
        for (method, pattern), answer in list(self.fail.items()):
            if request.method == method and re.fullmatch(pattern, request.url.path):
                return answer(request) if callable(answer) else answer
        return self.answer(request)

    def answer(self, request: httpx.Request) -> httpx.Response:
        """What GitHub answers when nothing is made to fail."""
        if request.headers.get("authorization") != f"Bearer {TOKEN}":
            return httpx.Response(401, json={"message": "Bad credentials"})
        assert request.headers.get("x-github-api-version") == githubpages.API_VERSION
        path = request.url.path
        body = json.loads(request.content) if request.content else None
        if path == "/user":
            return httpx.Response(200, json={"login": self.login, "id": 1})
        if path in ("/user/repos",) or re.fullmatch(r"/orgs/[^/]+/repos", path):
            owner = self.login if path == "/user/repos" else path.split("/")[2]
            full = f"{owner}/{body['name']}"
            if full.lower() in self.repos:
                return httpx.Response(422, json={"message": "Repository creation failed."})
            self.make_repo(full, pages=False, empty=not body.get("auto_init"))
            return httpx.Response(201, json={"full_name": full, "default_branch": "main", "private": body["private"]})
        match = re.fullmatch(r"/repos/([^/]+)/([^/]+)(/.*)?", path)
        if not match:
            return httpx.Response(404, json={"message": "Not Found"})
        repo = self.repos.get(f"{match[1]}/{match[2]}".lower())
        if repo is None:
            return httpx.Response(404, json={"message": "Not Found"})
        return self.repo(request, repo, match[3] or "", body)

    def repo(self, request: httpx.Request, repo: dict[str, Any], tail: str, body: Any) -> httpx.Response:
        method = request.method
        empty = not repo["refs"]
        if tail == "":
            said = {"full_name": f"{repo['owner']}/{repo['name']}", "private": repo["private"],
                    "default_branch": repo["default_branch"]}
            if repo["size"] is not None:
                said["size"] = repo["size"]
            return httpx.Response(200, json=said)
        if tail == "/pages":
            if method == "GET":
                return httpx.Response(200, json=repo["pages"]) if repo["pages"] else httpx.Response(404, json={})
            if repo["pages"]:
                return httpx.Response(409, json={"message": "GitHub Pages is already enabled."})
            if body["source"]["branch"] not in repo["refs"]:
                return httpx.Response(422, json={"message": "The branch does not exist."})
            return httpx.Response(201, json=self.pages_on(repo, body["source"]["branch"]))
        if tail == "/pages/builds/latest":
            head = repo["refs"].get(repo["pages"]["source"]["branch"]) if repo["pages"] else None
            if head is None:
                return httpx.Response(404, json={})
            return httpx.Response(200, json={"status": self.build_status, "commit": head,
                                             "error": {"message": "Page build failed." if self.build_status == "errored"
                                                       else None}})
        if tail.startswith("/contents/"):
            where = tail[len("/contents/"):]
            if method == "PUT":
                tree = self.write_tree(None, [{"path": where, "mode": "100644", "type": "blob",
                                               "sha": self.blob(base64.b64decode(body["content"]))}])
                repo["refs"][body.get("branch") or repo["default_branch"]] = self.commit(tree, [], body["message"])
                return httpx.Response(201, json={"commit": {}})
            branch = request.url.params.get("ref") or repo["default_branch"]
            if empty or branch not in repo["refs"]:
                return httpx.Response(404, json={"message": "Not Found"})
            found = self.files(f"{repo['owner']}/{repo['name']}".lower(), branch).get(where)
            if found is None:
                return httpx.Response(404, json={"message": "Not Found"})
            assert request.headers["accept"] == "application/vnd.github.raw+json"
            return httpx.Response(200, content=found)
        if not tail.startswith("/git/"):
            return httpx.Response(404, json={"message": "Not Found"})
        if empty:
            return httpx.Response(409, json={"message": "Git Repository is empty."})
        git = tail[len("/git/"):]
        if git.startswith("ref/heads/") and method == "GET":
            sha = repo["refs"].get(git[len("ref/heads/"):])
            return httpx.Response(200, json={"object": {"sha": sha, "type": "commit"}}) if sha else \
                httpx.Response(404, json={"message": "Not Found"})
        if git == "refs" and method == "POST":
            branch = body["ref"].removeprefix("refs/heads/")
            if branch in repo["refs"]:
                return httpx.Response(422, json={"message": "Reference already exists"})
            repo["refs"][branch] = body["sha"]
            return httpx.Response(201, json={"ref": body["ref"], "object": {"sha": body["sha"]}})
        if git.startswith("refs/heads/") and method == "PATCH":
            branch = git[len("refs/heads/"):]
            current = repo["refs"].get(branch)
            if current is None:
                return httpx.Response(422, json={"message": "Reference does not exist"})
            if not body.get("force") and current not in self.objects[body["sha"]][1]["parents"]:
                return httpx.Response(422, json={"message": "Update is not a fast forward"})
            repo["refs"][branch] = body["sha"]
            return httpx.Response(200, json={"object": {"sha": body["sha"]}})
        if git.startswith("commits/") and method == "GET":
            found = self.objects.get(git[len("commits/"):])
            if not found or found[0] != "commit":
                return httpx.Response(404, json={})
            return httpx.Response(200, json={"sha": git[len("commits/"):], "tree": {"sha": found[1]["tree"]},
                                             "message": found[1]["message"],
                                             "committer": {"name": "octo", "date": found[1]["date"]}})
        if git == "commits" and method == "POST":
            sha = self.commit(body["tree"], body["parents"], body["message"])
            assert "author" not in body and "committer" not in body, "the author is the token's own account"
            return httpx.Response(201, json={"sha": sha})
        if git.startswith("trees/") and method == "GET":
            sha = git[len("trees/"):]
            found = self.objects.get(sha)
            if not found or found[0] != "tree":
                return httpx.Response(404, json={})
            if request.url.params.get("recursive"):
                listed = [{"path": path, "type": "blob", "sha": _sha("blob", data), "mode": "100644", "size": len(data)}
                          for path, data in self.walk(sha).items()]
            else:
                listed = [{"path": name, **entry} for name, entry in found[1].items()]
            return httpx.Response(200, json={"sha": sha, "tree": listed,
                                             "truncated": bool(self.truncated and request.url.params.get("recursive"))})
        if git == "trees" and method == "POST":
            return httpx.Response(201, json={"sha": self.write_tree(body.get("base_tree"), body["tree"])})
        if git.startswith("blobs/") and method == "GET":
            found = self.objects.get(git[len("blobs/"):])
            if not found or found[0] != "blob":
                return httpx.Response(404, json={})
            assert request.headers["accept"] == "application/vnd.github.raw+json"
            return httpx.Response(200, content=found[1])
        if git == "blobs" and method == "POST":
            assert body["encoding"] == "base64"
            return httpx.Response(201, json={"sha": self.blob(base64.b64decode(body["content"]))})
        return httpx.Response(404, json={"message": "Not Found"})

    def posted(self, kind: str) -> list[httpx.Request]:
        return [request for request in self.requests if request.method == "POST" and request.url.path.endswith(kind)]
