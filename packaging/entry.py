"""PyInstaller entry point for the standalone Azimut executable.

Kept as a tiny shim so PyInstaller has a concrete script to analyze; all real
logic lives in ``azimut.cli.main`` (the same code the ``azimut`` command runs).
"""

import multiprocessing
import sys

from azimut.cli import main
from azimut.engine import gallerydl

#: Started with this, the binary runs a pool the way a search does and prints what it
#: answered (scripts/smoke_binary.py), so the release proves its children get their work.
PROCESSES_FLAG = "--smoke-processes"


def processes_answer() -> int:
    """Two spawned workers each compute a factorial; their sum, 840, is printed."""
    import math
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(max_workers=2, mp_context=multiprocessing.get_context("spawn")) as pool:
        print(sum(pool.map(math.factorial, [5, 6])))
    return 0


if __name__ == "__main__":
    # gallery-dl runs as a program of its own, and this executable is the only Python
    # the binary has: started again with this flag, it is gallery-dl and nothing else
    if sys.argv[1:2] == [gallerydl.FROZEN_FLAG]:
        sys.exit(gallerydl.run_frozen(sys.argv[2:]))
    # a search's processes start the executable again: this hands them their work instead of a second app
    multiprocessing.freeze_support()
    if sys.argv[1:2] == [PROCESSES_FLAG]:
        sys.exit(processes_answer())
    main()
