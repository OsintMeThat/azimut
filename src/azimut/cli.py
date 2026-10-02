"""`azimut` command: start the local server and open the browser tab."""

from __future__ import annotations

import argparse
import webbrowser

from . import __version__
from .launcher import choose_port, serve

DEFAULT_PORT = 8477  # uncommon high port, clear of common dev ranges


def main() -> None:
    parser = argparse.ArgumentParser(prog="azimut", description="Azimut, a local OSINT workspace")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser tab")
    parser.add_argument("--version", action="version", version=f"azimut {__version__}")
    args = parser.parse_args()

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
