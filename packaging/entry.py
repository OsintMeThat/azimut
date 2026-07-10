"""PyInstaller entry point for the standalone Azimut executable.

Kept as a tiny shim so PyInstaller has a concrete script to analyze; all real
logic lives in ``azimut.cli.main`` (the same code the ``azimut`` command runs).
"""

from azimut.cli import main

if __name__ == "__main__":
    main()
