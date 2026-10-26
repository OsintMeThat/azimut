"""PyInstaller entry point for the standalone Azimut executable.

Kept as a tiny shim so PyInstaller has a concrete script to analyze; all real
logic lives in ``azimut.cli.main`` (the same code the ``azimut`` command runs).
"""

import multiprocessing
import sys

from azimut.cli import main
from azimut.engine import gallerydl

if __name__ == "__main__":
    # gallery-dl runs as a program of its own, and this executable is the only Python
    # the binary has: started again with this flag, it is gallery-dl and nothing else
    if sys.argv[1:2] == [gallerydl.FROZEN_FLAG]:
        sys.exit(gallerydl.run_frozen(sys.argv[2:]))
    # a search's processes start the executable again: this hands them their work instead of a second app
    multiprocessing.freeze_support()
    main()
