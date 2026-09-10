#!/usr/bin/env python3
"""Load, pair and reload the capture extension in a dev browser, without clicks.

A maintainer tool, not part of the app. It drives Chrome's DevTools protocol and
Firefox's remote debugging protocol, so an edit in ``extension/`` reaches both
browsers with one command:

    python3 scripts/devext.py               # both browsers: load/reload + pair
    python3 scripts/devext.py chrome        # just one of them
    python3 scripts/devext.py --watch       # reload on every save, until Ctrl-C
    python3 scripts/devext.py --fresh       # start from an empty dev profile

Each browser gets its own dev profile, kept between runs, so the pairing token,
the last case and anything set in the popup survive a restart. The token is read
from the running app (or from its settings.json) and written straight into the
extension's storage, which is the manual paste this script exists to remove.

The dev browsers are separate instances: the everyday Chrome and Firefox keep
running untouched, with their own profiles and their own copy of the extension.

Stdlib only: it runs with any python3, no venv and no npm.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parent.parent
EXT = REPO / "extension"
STATE = Path.home() / ".cache" / "azimut-devext"

DEFAULT_APP_URL = os.environ.get("AZIMUT_URL", "http://127.0.0.1:8477")
DEFAULT_CHROME_PORT = 9222
DEFAULT_FIREFOX_PORT = 6080

CHROME_NAMES = (
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
    "brave-browser",
    "microsoft-edge",
)
FIREFOX_NAMES = ("firefox", "firefox-esr", "firefox-developer-edition")
MAC_APPS = {
    "chrome": "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "firefox": "/Applications/Firefox.app/Contents/MacOS/firefox",
}


@dataclass
class Options:
    """What one sync does, so `relaunch.py --ext` can ask for the same thing."""

    browsers: list[str] = field(default_factory=lambda: ["chrome", "firefox"])
    url: str = DEFAULT_APP_URL
    fresh: bool = False
    reload_tabs: bool = True
    chrome_port: int = DEFAULT_CHROME_PORT
    firefox_port: int = DEFAULT_FIREFOX_PORT


def say(browser: str, message: str) -> None:
    print(f"[{browser}] {message}", flush=True)


BACKGROUND_PROOF = (
    "((api) => JSON.stringify(["
    "api.runtime.getManifest().version, "
    "Math.round(Date.now() - performance.timeOrigin)"
    "]))(typeof browser !== 'undefined' ? browser : chrome)"
)


def report_background(browser: str, answer: str | None) -> None:
    """Say what the background context is, and how long ago it started.

    An age of a second or so is the proof the sync landed: reloading the
    extension restarts its background, so anything older is code from before.
    """
    if not answer:
        say(browser, "background asleep, nothing to read back")
        return
    version, age = json.loads(answer)
    if age > 15000:
        say(browser, f"background is {age // 1000}s old: it kept the code it had")
        return
    say(browser, f"background restarted {age / 1000:.1f}s ago, running v{version}")


def find_binary(env_var: str, names: tuple[str, ...], mac_key: str) -> str | None:
    override = os.environ.get(env_var)
    if override:
        return override
    for name in names:
        found = shutil.which(name)
        if found:
            return found
    mac = MAC_APPS[mac_key]
    return mac if Path(mac).exists() else None


def _detached() -> dict[str, Any]:
    """Popen arguments that let the browser survive this script exiting."""
    if os.name == "nt":
        return {"creationflags": getattr(subprocess, "DETACHED_PROCESS", 0)}
    return {"start_new_session": True}


def port_open(port: int) -> bool:
    with socket.socket() as s:
        s.settimeout(0.4)
        return s.connect_ex(("127.0.0.1", port)) == 0


def wait_for_port(port: int, timeout: float = 30.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if port_open(port):
            return True
        time.sleep(0.3)
    return False


# --- pairing token ----------------------------------------------------------


def pairing_token(app_url: str) -> str | None:
    """The app's ingest token: from the running app, else from settings.json."""
    request = urllib.request.Request(
        f"{app_url}/api/settings/ingest-token", data=b"", method="POST"
    )
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return json.load(response).get("ingest_token")
    except (urllib.error.URLError, OSError, ValueError):
        pass
    root = Path(os.environ.get("AZIMUT_HOME", "~/Azimut")).expanduser()
    settings = root / ".azimut" / "settings" / "settings.json"
    try:
        return json.loads(settings.read_text(encoding="utf-8")).get("ingest_token")
    except (OSError, ValueError):
        return None


# --- a small WebSocket client (Chrome DevTools protocol) --------------------


class WebSocket:
    """Just enough of RFC 6455 to talk CDP: text frames, one connection."""

    def __init__(self, url: str) -> None:
        rest = url.split("://", 1)[1]
        hostport, _, path = rest.partition("/")
        host, _, port = hostport.partition(":")
        self.sock = socket.create_connection((host, int(port or 80)), timeout=30)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            (
                f"GET /{path} HTTP/1.1\r\n"
                f"Host: {hostport}\r\n"
                "Upgrade: websocket\r\n"
                "Connection: Upgrade\r\n"
                f"Sec-WebSocket-Key: {key}\r\n"
                "Sec-WebSocket-Version: 13\r\n\r\n"
            ).encode()
        )
        self.buf = b""
        while b"\r\n\r\n" not in self.buf:
            self.buf += self._read(1)
        head, _, self.buf = self.buf.partition(b"\r\n\r\n")
        if b"101" not in head.split(b"\r\n")[0]:
            raise RuntimeError(f"websocket refused: {head.splitlines()[0]!r}")

    def _read(self, n: int) -> bytes:
        chunk = self.sock.recv(max(n, 4096))
        if not chunk:
            raise RuntimeError("websocket closed")
        return chunk

    def _take(self, n: int) -> bytes:
        while len(self.buf) < n:
            self.buf += self._read(n - len(self.buf))
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, text: str) -> None:
        payload = text.encode()
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 1 << 16:
            header.append(0x80 | 126)
            header += struct.pack(">H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack(">Q", length)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(bytes(header) + mask + masked)

    def recv(self) -> str:
        while True:
            first, second = self._take(2)
            opcode = first & 0x0F
            length = second & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._take(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._take(8))[0]
            payload = self._take(length) if length else b""
            if opcode == 0x9:  # ping: the protocol says answer it
                self.sock.sendall(b"\x8a\x80" + os.urandom(4))
                continue
            if opcode == 0x8:
                raise RuntimeError("websocket closed by browser")
            if opcode in (0x1, 0x2):
                return payload.decode("utf-8", "replace")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


class Chrome:
    def __init__(self, port: int) -> None:
        with urllib.request.urlopen(
            f"http://127.0.0.1:{port}/json/version", timeout=5
        ) as response:
            endpoint = json.load(response)["webSocketDebuggerUrl"]
        self.ws = WebSocket(endpoint)
        self.n = 0

    def call(
        self, method: str, params: dict[str, Any] | None = None, session: str = ""
    ) -> dict[str, Any]:
        self.n += 1
        message: dict[str, Any] = {"id": self.n, "method": method, "params": params or {}}
        if session:
            message["sessionId"] = session
        self.ws.send(json.dumps(message))
        while True:
            answer = json.loads(self.ws.recv())
            if answer.get("id") != self.n:
                continue  # an event, or a stale answer
            if "error" in answer:
                raise RuntimeError(f"{method}: {answer['error'].get('message')}")
            return answer.get("result", {})

    def close(self) -> None:
        self.ws.close()


def chrome_sync(options: Options, token: str | None) -> None:
    binary = find_binary("AZIMUT_CHROME", CHROME_NAMES, "chrome")
    if not binary:
        say("chrome", "not found. Set AZIMUT_CHROME to its path")
        return
    profile = STATE / "chrome"
    if options.fresh:
        if port_open(options.chrome_port):
            chrome_quit(options.chrome_port, profile)
        shutil.rmtree(profile, ignore_errors=True)
    if not port_open(options.chrome_port):
        profile.mkdir(parents=True, exist_ok=True)
        subprocess.Popen(
            [
                binary,
                f"--user-data-dir={profile}",
                f"--remote-debugging-port={options.chrome_port}",
                # Chrome 137 dropped --load-extension; unpacked loading now goes
                # through the DevTools protocol, which this flag opens up.
                "--enable-unsafe-extension-debugging",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-search-engine-choice-screen",
                options.url,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            # Detached: the browser outlives the sync that started it.
            **_detached(),
        )
        if not wait_for_port(options.chrome_port):
            say("chrome", "no debug port. A dev Chrome may still hold the profile")
            return
        say("chrome", f"launched on a dev profile ({profile})")

    cdp = Chrome(options.chrome_port)
    try:
        extension_id = cdp.call("Extensions.loadUnpacked", {"path": str(EXT)})["id"]
        say("chrome", f"extension loaded from disk ({extension_id})")
        if token:
            chrome_in_extension_page(
                cdp,
                extension_id,
                [
                    "chrome.storage.local.set("
                    f"{json.dumps({'backendUrl': options.url, 'token': token})})"
                ],
            )
            say("chrome", "paired")
        report_background("chrome", chrome_background_proof(cdp, extension_id))
        if options.reload_tabs:
            say("chrome", f"reloaded {chrome_reload_tabs(cdp, options.url)} app tab(s)")
    finally:
        cdp.close()


def chrome_quit(port: int, profile: Path) -> None:
    """Ask the dev Chrome to close, and wait until it has really let go.

    Its lock file outlives the debug port by a moment, and a profile replaced
    before that leaves the next launch talking to the dying instance instead of
    starting its own.
    """
    cdp = Chrome(port)
    try:
        cdp.call("Browser.close")
    except (RuntimeError, OSError):
        pass
    finally:
        cdp.close()
    deadline = time.time() + 15
    lock = profile / "SingletonLock"
    while time.time() < deadline and (port_open(port) or lock.exists()):
        time.sleep(0.2)
    time.sleep(0.5)


def chrome_in_extension_page(
    cdp: Chrome, extension_id: str, expressions: list[str]
) -> list[Any]:
    """Run JS with the extension's own APIs, in a page opened for that alone.

    `chrome.storage` and the extension's files exist only inside an extension
    context, so the options page is opened, used and closed again.
    """
    target = cdp.call(
        "Target.createTarget", {"url": f"chrome-extension://{extension_id}/options.html"}
    )["targetId"]
    values: list[Any] = []
    try:
        time.sleep(0.8)
        session = cdp.call(
            "Target.attachToTarget", {"targetId": target, "flatten": True}
        )["sessionId"]
        for expression in expressions:
            answer = cdp.call(
                "Runtime.evaluate",
                {"expression": expression, "awaitPromise": True, "returnByValue": True},
                session,
            )
            if "exceptionDetails" in answer:
                raise RuntimeError(answer["exceptionDetails"].get("text", "evaluation failed"))
            values.append(answer["result"].get("value"))
    finally:
        cdp.call("Target.closeTarget", {"targetId": target})
    return values


def chrome_background_proof(cdp: Chrome, extension_id: str) -> str | None:
    """Ask the extension's service worker what it is running.

    It is the context the reload restarts, and the only one whose age says
    whether the browser took the new code.
    """
    deadline = time.time() + 5
    while time.time() < deadline:
        for target in cdp.call("Target.getTargets")["targetInfos"]:
            if target["type"] != "service_worker" or extension_id not in target["url"]:
                continue
            session = cdp.call(
                "Target.attachToTarget", {"targetId": target["targetId"], "flatten": True}
            )["sessionId"]
            answer = cdp.call(
                "Runtime.evaluate",
                {"expression": BACKGROUND_PROOF, "returnByValue": True},
                session,
            )
            cdp.call("Target.detachFromTarget", {"sessionId": session})
            value = answer["result"].get("value")
            return str(value) if value is not None else None
        time.sleep(0.3)
    return None


def chrome_reload_tabs(cdp: Chrome, app_url: str) -> int:
    """Reload the app's own tabs: content scripts only re-inject on navigation."""
    reloaded = 0
    for target in cdp.call("Target.getTargets")["targetInfos"]:
        if target["type"] != "page" or not target["url"].startswith(app_url):
            continue
        session = cdp.call(
            "Target.attachToTarget", {"targetId": target["targetId"], "flatten": True}
        )["sessionId"]
        cdp.call("Page.reload", {}, session)
        cdp.call("Target.detachFromTarget", {"sessionId": session})
        reloaded += 1
    return reloaded


# --- Firefox remote debugging protocol --------------------------------------


class Firefox:
    """The `<length>:<json>` protocol behind about:debugging."""

    def __init__(self, port: int) -> None:
        self.sock = socket.create_connection(("127.0.0.1", port), timeout=30)
        self.buf = b""
        self.read()  # the server greets before anything is asked of it

    def read(self) -> dict[str, Any]:
        while True:
            colon = self.buf.find(b":")
            if colon != -1:
                length = int(self.buf[:colon])
                if len(self.buf) >= colon + 1 + length:
                    packet = self.buf[colon + 1 : colon + 1 + length]
                    self.buf = self.buf[colon + 1 + length :]
                    return json.loads(packet)
            chunk = self.sock.recv(65536)
            if not chunk:
                raise RuntimeError("debugger connection closed")
            self.buf += chunk

    def call(
        self, message: dict[str, Any], event: str = "", timeout: float = 20.0
    ) -> dict[str, Any]:
        """Send one request; return its reply, or the awaited event instead."""
        data = json.dumps(message).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        deadline = time.time() + timeout
        self.sock.settimeout(timeout)
        while time.time() < deadline:
            answer = self.read()
            if event:
                if answer.get("type") == event:
                    return answer
            elif answer.get("from") == message["to"] and "type" not in answer:
                if "error" in answer:
                    raise RuntimeError(f"{message['type']}: {answer['error']}")
                return answer
        raise RuntimeError(f"no answer to {message['type']}")

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass


FIREFOX_PREFS = """\
// Written by scripts/devext.py: dev profile for the capture extension.
user_pref("devtools.debugger.remote-enabled", true);
user_pref("devtools.debugger.prompt-connection", false);
user_pref("devtools.chrome.enabled", true);
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("extensions.autoDisableScopes", 0);
"""


def firefox_profile_dir() -> Path:
    # The snap can only read parts of $HOME; its own writable area always works.
    snap = Path.home() / "snap" / "firefox" / "common"
    return (snap / "azimut-devext") if snap.exists() else (STATE / "firefox")


def firefox_sync(options: Options, token: str | None) -> None:
    binary = find_binary("AZIMUT_FIREFOX", FIREFOX_NAMES, "firefox")
    if not binary:
        say("firefox", "not found. Set AZIMUT_FIREFOX to its path")
        return
    profile = firefox_profile_dir()
    if options.fresh:
        if port_open(options.firefox_port):
            # Firefox has no remote quit, and the profile is open under it.
            say("firefox", "already running. Close it first to start fresh")
            return
        shutil.rmtree(profile, ignore_errors=True)
    if not port_open(options.firefox_port):
        profile.mkdir(parents=True, exist_ok=True)
        (profile / "user.js").write_text(FIREFOX_PREFS, encoding="utf-8")
        subprocess.Popen(
            [
                binary,
                "--profile",
                str(profile),
                "--no-remote",  # a second instance, beside the everyday Firefox
                "--start-debugger-server",
                str(options.firefox_port),
                options.url,
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            # Detached: the browser outlives the sync that started it.
            **_detached(),
        )
        if not wait_for_port(options.firefox_port, timeout=45):
            say("firefox", "no debug port. A dev Firefox may still hold the profile")
            return
        say("firefox", f"launched on a dev profile ({profile})")

    rdp = Firefox(options.firefox_port)
    try:
        root = rdp.call({"to": "root", "type": "getRoot"})
        rdp.call(
            {
                "to": root["addonsActor"],
                "type": "installTemporaryAddon",
                "addonPath": str(EXT),
                "openDevTools": False,
            }
        )
        say("firefox", "extension installed from disk")
        if not token:
            return
        console = firefox_background_console(rdp)
        if not console:
            say("firefox", "background page not reachable. Pair by hand this once")
            return
        script = (
            "browser.storage.local.set("
            f"{json.dumps({'backendUrl': options.url, 'token': token})})"
        )
        if options.reload_tabs:
            # Filtered here rather than by `tabs.query({url})`: a match pattern
            # cannot carry a port, and the app URL always has one.
            script += (
                ".then(() => browser.tabs.query({}))"
                ".then(tabs => tabs.filter(tab => (tab.url || '').startsWith("
                f"{json.dumps(options.url)})))"
                ".then(tabs => Promise.all(tabs.map(tab => browser.tabs.reload(tab.id)))"
                ".then(() => tabs.length)).catch(() => 0)"
            )
        answer = firefox_evaluate(rdp, console, script)
        if answer is None:
            say("firefox", "could not write the token into the extension")
            return
        say("firefox", "paired")
        report_background("firefox", firefox_evaluate(rdp, console, BACKGROUND_PROOF))
        if options.reload_tabs:
            say("firefox", f"reloaded {answer} app tab(s)")
    finally:
        rdp.close()


def firefox_evaluate(rdp: Firefox, console: str, script: str) -> Any:
    """Run one expression in the add-on's background, or None if it threw."""
    answer = rdp.call(
        {"to": console, "type": "evaluateJSAsync", "text": script, "mapped": {"await": True}},
        event="evaluationResult",
    )
    return None if answer.get("hasException") else answer.get("result")


def firefox_background_console(rdp: Firefox) -> str | None:
    """The console actor of the add-on's background page.

    Watching the add-on announces its frames one by one; the first is devtools'
    own fallback page, the extension's own comes right after.
    """
    addons = rdp.call({"to": "root", "type": "listAddons"})["addons"]
    mine = next(
        (a for a in addons if a.get("id") == "capture-extension@azimut.invalid"), None
    )
    if not mine:
        return None
    watcher = rdp.call({"to": mine["actor"], "type": "getWatcher"})["actor"]
    rdp.call(
        {"to": watcher, "type": "watchTargets", "targetType": "frame"},
        event="target-available-form",
    )
    deadline = time.time() + 10
    rdp.sock.settimeout(10)
    while time.time() < deadline:
        try:
            packet = rdp.read()
        except (OSError, RuntimeError):
            break
        target = packet.get("target") or {}
        if target.get("url", "").startswith("moz-extension://"):
            return target.get("consoleActor")
    return None


# --- watch mode -------------------------------------------------------------


def fingerprint() -> tuple[tuple[str, float], ...]:
    return tuple(
        sorted(
            (str(path), path.stat().st_mtime)
            for path in EXT.rglob("*")
            if path.is_file() and not path.name.startswith(".")
        )
    )


def sync(options: Options) -> None:
    """One pass: load the code from disk into each dev browser, and pair it."""
    token = pairing_token(options.url)
    if not token:
        print("no pairing token yet. Start Azimut once so it mints one", flush=True)
    for browser in options.browsers:
        try:
            (chrome_sync if browser == "chrome" else firefox_sync)(options, token)
        except (RuntimeError, OSError) as error:
            say(browser, f"failed: {error}")


def watch(options: Options, stop: threading.Event | None = None) -> None:
    """Sync again on every save in extension/, until `stop` is set."""
    stop = stop or threading.Event()
    options.fresh = False  # a wipe belongs to the first pass only
    seen = fingerprint()
    while not stop.wait(0.6):
        if fingerprint() == seen:
            continue
        stop.wait(0.3)  # let the editor finish writing
        print(f"change at {time.strftime('%H:%M:%S')}", flush=True)
        sync(options)
        seen = fingerprint()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "browsers",
        nargs="*",
        default=[],
        metavar="{chrome,firefox,all}",
        help="which dev browser to sync (default: both)",
    )
    parser.add_argument("--url", default=DEFAULT_APP_URL, help="where the app runs")
    parser.add_argument("--watch", action="store_true", help="reload on every save")
    parser.add_argument("--fresh", action="store_true", help="wipe the dev profile first")
    parser.add_argument(
        "--no-reload-tabs",
        dest="reload_tabs",
        action="store_false",
        help="leave the open app tabs alone",
    )
    parser.add_argument("--chrome-port", type=int, default=DEFAULT_CHROME_PORT)
    parser.add_argument("--firefox-port", type=int, default=DEFAULT_FIREFOX_PORT)
    args = parser.parse_args()

    unknown = set(args.browsers) - {"chrome", "firefox", "all"}
    if unknown:
        parser.error(f"unknown browser: {', '.join(sorted(unknown))}")

    if not (EXT / "manifest.json").exists():
        print(f"no extension at {EXT}", file=sys.stderr)
        return 1

    options = Options(
        browsers=["chrome", "firefox"]
        if "all" in args.browsers or not args.browsers
        else list(dict.fromkeys(args.browsers)),
        url=args.url,
        fresh=args.fresh,
        reload_tabs=args.reload_tabs,
        chrome_port=args.chrome_port,
        firefox_port=args.firefox_port,
    )
    sync(options)
    if not args.watch:
        return 0

    print("watching extension/, Ctrl-C to stop", flush=True)
    try:
        watch(options)
    except KeyboardInterrupt:
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
