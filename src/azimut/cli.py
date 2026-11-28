"""`azimut` command: start the local server and open the browser tab."""

from __future__ import annotations

import argparse
import webbrowser

from . import __version__
from .launcher import choose_port, serve

DEFAULT_PORT = 8477  # uncommon high port, clear of common dev ranges

#: An older Azimut tries a version it downloaded with this before installing it
#: (engine/selfupdate.py `trial`), so every later version must keep answering it the
#: same way: one line, "azimut <version> ok", and exit 0. It loads everything the
#: server serves, native libraries included, and opens no workspace and no network.
SELF_CHECK_FLAG = "--self-check"


def self_check() -> int:
    """Import what the server serves, without serving: a version that cannot load
    on this machine says so here, before it replaces the one that can."""
    import importlib
    import pkgutil

    from . import api, server

    for module in pkgutil.iter_modules(api.__path__):
        importlib.import_module(f"{api.__name__}.{module.name}")
    if not callable(getattr(server, "create_app", None)):
        raise SystemExit("the server has no app factory")  # the one the launcher builds
    print(f"azimut {__version__} ok", flush=True)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(prog="azimut", description="Azimut, a local OSINT workspace")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser tab")
    parser.add_argument("--version", action="version", version=f"azimut {__version__}")
    parser.add_argument(SELF_CHECK_FLAG, action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.self_check:
        raise SystemExit(self_check())

    port, running = choose_port(args.port)
    url = f"http://127.0.0.1:{port}"
    if running:
        print(f"Azimut is already running at {url}.")
        if not args.no_browser:
            webbrowser.open(url)
        return
    if port != args.port:
        print(f"Port {args.port} is in use by another program, so Azimut takes {port}.")
    print(f"Azimut {__version__} · {url} (local only)")
    print("Runs in your browser tab. Close this window to stop Azimut.")
    serve(port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
