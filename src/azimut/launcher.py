"""Start the local server and open Azimut in a browser tab.

Azimut is a browser app: the UI lives in a normal Firefox/Chrome tab, not a
separate desktop window. So the launcher does the minimum — run the server and
open the tab once the server is actually accepting connections (rather than
after a fixed guess), which is the one thing the frozen binary needs to feel
like "double-click and it opens". The console stays the control surface: close
it (or Ctrl-C) to stop the server.

No GUI toolkit, no tray — those would pull per-OS native libraries (the kind of
dependency the packaging deliberately avoids), and the app is meant to run in
the browser anyway.
"""

from __future__ import annotations

import atexit
import json
import os
import socket
import threading
import time
import urllib.request
import webbrowser

import uvicorn

#: How many ports past the asked one are tried when another program holds it.
PORT_TRIES = 20


def _build_server(port: int) -> uvicorn.Server:
    config = uvicorn.Config(
        "azimut.server:create_app",
        factory=True,
        host="127.0.0.1",  # local-first: never bind beyond localhost
        port=port,
        log_level="warning",
    )
    return uvicorn.Server(config)


def _open_when_ready(server: uvicorn.Server, url: str) -> None:
    """Open the browser tab once the server reports it's started.

    Polls ``server.started`` on a daemon thread so the open lands after the
    port is listening, not before — no white "can't connect" tab, and no fixed
    sleep that's too short on a cold frozen binary.
    """

    def wait_and_open() -> None:
        for _ in range(200):  # up to ~10 s, then open anyway
            if server.started:
                break
            time.sleep(0.05)
        webbrowser.open(url)

    threading.Thread(target=wait_and_open, daemon=True).start()


def _port_is_free(port: int) -> bool:
    """Whether the server could bind this port. On POSIX the probe sets SO_REUSEADDR
    as uvicorn does, or a connection left in TIME-WAIT would read as a live holder;
    on Windows the same option would let the probe steal a port that is in use."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        if os.name != "nt":
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def _azimut_answers(port: int) -> bool:
    """Whether what listens on this port is Azimut, asked the way its tab would ask.
    No proxy: a system proxy must not be handed a question about this machine."""
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(f"http://127.0.0.1:{port}/api/health", timeout=2) as answer:
            body = json.loads(answer.read(4096))
    except (OSError, ValueError):
        return False
    return isinstance(body, dict) and body.get("status") == "ok" and "version" in body


def _holder_port() -> int | None:
    """The port of an Azimut on this machine that already holds the workspace.

    Two starts need not ask for the same port to meet: the first may have moved to a
    free one while another program held its own, and that program may have let go
    since. Asking the port alone would miss the first and start a second server,
    which would find the workspace taken and offer to take it anyway.
    """
    try:
        from .engine import workspacelock

        payload = workspacelock.holder()
    except Exception:  # an unreadable lock is the server's to explain, not ours
        return None
    port = (payload or {}).get("port")
    if not isinstance(port, int) or (payload or {}).get("host") != socket.gethostname():
        return None
    return port if _azimut_answers(port) else None


def choose_port(port: int) -> tuple[int, bool]:
    """The port to serve on, and whether Azimut already runs there.

    Started twice, Azimut should send the second start to the first one's tab, not
    die on a bind error in a console that closes before anyone reads it. A port held
    by some other program gives way to the next free one.
    """
    held = _holder_port()
    if held is not None:
        return held, True
    if _port_is_free(port):
        return port, False
    if _azimut_answers(port):
        return port, True
    for candidate in range(port + 1, port + 1 + PORT_TRIES):
        if _port_is_free(candidate):
            return candidate, False
    raise SystemExit(
        f"Ports {port} to {port + PORT_TRIES} are all in use. Start Azimut with --port and a free number."
    )


def serve(port: int, *, open_browser: bool = True) -> None:
    """Run the server (blocking) and, unless told not to, open the browser tab."""
    from . import server as server_module
    from .engine import workspacelock

    # The app is built by uvicorn's factory, which takes no arguments, so the
    # port is left here for it: a second instance names the holder by host and
    # port, and "on this machine, port 8477" is what sends someone to the right
    # tab.
    server_module.SERVE_PORT = port
    atexit.register(workspacelock.release)
    server = _build_server(port)
    if open_browser:
        _open_when_ready(server, f"http://127.0.0.1:{port}")
    server.run()
