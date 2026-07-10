"""`azimut` command: start the local server and open the browser."""

from __future__ import annotations

import argparse
import threading
import webbrowser

import uvicorn

from . import __version__

DEFAULT_PORT = 8477  # uncommon high port, clear of common dev ranges


def main() -> None:
    parser = argparse.ArgumentParser(prog="azimut", description="Azimut — the OSINT investigator's workbench")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser")
    parser.add_argument("--version", action="version", version=f"azimut {__version__}")
    args = parser.parse_args()

    url = f"http://127.0.0.1:{args.port}"
    if not args.no_browser:
        threading.Timer(0.8, webbrowser.open, args=(url,)).start()

    print(f"Azimut {__version__} — {url}  (local only, nothing leaves this machine)")
    uvicorn.run(
        "azimut.server:create_app",
        factory=True,
        host="127.0.0.1",  # local-first: never bind beyond localhost
        port=args.port,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
