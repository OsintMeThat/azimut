"""Exercise a release binary as a running local application.

The release workflow uses this after PyInstaller finishes. It verifies the
server, bundled frontend and bundled ffmpeg from the artifact itself.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _request(url: str) -> tuple[int, str, str]:
    with urllib.request.urlopen(url, timeout=2) as response:
        return (
            response.status,
            response.headers.get_content_type(),
            response.read().decode("utf-8", "replace"),
        )


def check_application(base_url: str) -> None:
    status, content_type, body = _request(f"{base_url}/api/health")
    health: dict[str, Any] = json.loads(body)
    if status != 200 or health.get("status") != "ok":
        raise RuntimeError(f"health check failed: {status} {health!r}")

    status, content_type, body = _request(f"{base_url}/")
    if status != 200 or content_type != "text/html" or '<div id="app"></div>' not in body:
        raise RuntimeError("the binary did not serve the built frontend")

    status, content_type, body = _request(f"{base_url}/api/settings/ffmpeg")
    ffmpeg: dict[str, Any] = json.loads(body)
    if status != 200 or not ffmpeg.get("available") or ffmpeg.get("source") != "bundled":
        raise RuntimeError(f"bundled ffmpeg was not detected: {ffmpeg!r}")


def wait_until_ready(base_url: str, process: subprocess.Popen[bytes], timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        code = process.poll()
        if code is not None:
            raise RuntimeError(f"binary exited before it became ready (exit {code})")
        try:
            check_application(base_url)
            return
        except (OSError, urllib.error.URLError):
            time.sleep(0.25)
    raise RuntimeError(f"binary did not become ready within {timeout:g} seconds")


def stop(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def smoke(binary: Path) -> None:
    binary = binary.resolve()
    if not binary.is_file():
        raise FileNotFoundError(binary)

    port = _free_port()
    base_url = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryDirectory(prefix="azimut-binary-smoke-") as workspace:
        env = os.environ.copy()
        env["AZIMUT_HOME"] = workspace
        process = subprocess.Popen(
            [str(binary), "--no-browser", "--port", str(port)],
            env=env,
        )
        try:
            wait_until_ready(base_url, process)
        finally:
            stop(process)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("binary", type=Path)
    args = parser.parse_args()
    smoke(args.binary)


if __name__ == "__main__":
    main()
