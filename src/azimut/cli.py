"""`azimut` command: start the local server and open the browser tab."""

from __future__ import annotations

import argparse

from . import __version__
from .launcher import serve

DEFAULT_PORT = 8477  # uncommon high port, clear of common dev ranges


def main() -> None:
    parser = argparse.ArgumentParser(prog="azimut", description="Azimut, a local OSINT workspace")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser tab")
    parser.add_argument("--version", action="version", version=f"azimut {__version__}")
    args = parser.parse_args()

    print(f"Azimut {__version__} · http://127.0.0.1:{args.port} (local only)")
    print("Runs in your browser tab. Close this window to stop Azimut.")
    serve(args.port, open_browser=not args.no_browser)


if __name__ == "__main__":
    main()
