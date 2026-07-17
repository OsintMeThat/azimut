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

import threading
import time
import webbrowser

import uvicorn


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


def serve(port: int, *, open_browser: bool = True) -> None:
    """Run the server (blocking) and, unless told not to, open the browser tab."""
    server = _build_server(port)
    if open_browser:
        _open_when_ready(server, f"http://127.0.0.1:{port}")
    server.run()
