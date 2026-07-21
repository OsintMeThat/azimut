#!/usr/bin/env python3
"""Rebuild and relaunch the local Azimut checkout on any supported OS.

The tool supervises the process it starts and exposes a token-protected local
control socket. A later invocation can therefore stop that exact process
without scanning process names or killing unrelated Vite/Azimut instances.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
STATE_PATH = ROOT / ".azimut-relaunch.json"


def _read_state(path: Path) -> dict[str, Any] | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    port = data.get("port")
    token = data.get("token")
    if not isinstance(port, int) or not 1 <= port <= 65535:
        return None
    if not isinstance(token, str) or len(token) != 64:
        return None
    return {"port": port, "token": token}


def _remove_owned_state(path: Path, token: str) -> None:
    state = _read_state(path)
    if state and state["token"] == token:
        path.unlink(missing_ok=True)


class _ControlServer:
    """Accept a stop request from the next relaunch invocation."""

    def __init__(self, state_path: Path) -> None:
        self.state_path = state_path
        self.token = secrets.token_hex(32)
        self.stop_requested = threading.Event()
        self._socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self._socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self._socket.bind(("127.0.0.1", 0))
        self._socket.listen(1)
        self._socket.settimeout(0.25)
        self.port = int(self._socket.getsockname()[1])
        self._thread = threading.Thread(target=self._serve, daemon=True)

    def start(self) -> None:
        temp = self.state_path.with_name(f"{self.state_path.name}.{self.token}.tmp")
        temp.write_text(
            json.dumps({"port": self.port, "token": self.token}),
            encoding="utf-8",
        )
        try:
            temp.chmod(0o600)
        except OSError:
            pass
        os.replace(temp, self.state_path)
        self._thread.start()

    def _serve(self) -> None:
        while not self.stop_requested.is_set():
            try:
                connection, _ = self._socket.accept()
            except TimeoutError:
                continue
            except OSError:
                return
            with connection:
                connection.settimeout(1)
                try:
                    supplied = connection.recv(128).decode("ascii").strip()
                except (OSError, UnicodeError):
                    continue
                if secrets.compare_digest(supplied, self.token):
                    connection.sendall(b"OK\n")
                    self.stop_requested.set()

    def close(self) -> None:
        self.stop_requested.set()
        self._socket.close()
        if self._thread.is_alive() and self._thread is not threading.current_thread():
            self._thread.join(timeout=1)
        _remove_owned_state(self.state_path, self.token)


def _stop_previous(path: Path, timeout: float = 10) -> bool:
    state = _read_state(path)
    if state is None:
        path.unlink(missing_ok=True)
        return False
    try:
        with socket.create_connection(("127.0.0.1", state["port"]), timeout=1) as connection:
            connection.sendall(f"{state['token']}\n".encode("ascii"))
            if connection.recv(16).strip() != b"OK":
                raise RuntimeError("the previous launcher rejected the stop request")
    except OSError:
        _remove_owned_state(path, state["token"])
        return False

    deadline = time.monotonic() + timeout
    while path.exists() and time.monotonic() < deadline:
        time.sleep(0.05)
    if path.exists():
        raise RuntimeError("the previous launcher did not stop within 10 seconds")
    return True


def _venv_python(root: Path, platform: str = os.name) -> Path:
    relative = Path("Scripts/python.exe") if platform == "nt" else Path("bin/python")
    python = root / ".venv" / relative
    if not python.is_file():
        raise RuntimeError(f"virtual environment not found at {python}; create .venv first")
    return python


def _npm_build_command(platform: str = os.name) -> list[str]:
    npm = shutil.which("npm")
    if not npm:
        raise RuntimeError("npm was not found on PATH; install Node.js 20 or newer")
    if platform == "nt" and Path(npm).suffix.lower() in {".cmd", ".bat"}:
        command = os.environ.get("COMSPEC", "cmd.exe")
        return [command, "/d", "/s", "/c", npm, "run", "build"]
    return [npm, "run", "build"]


def _spawn(command: list[str], cwd: Path) -> subprocess.Popen[bytes]:
    if os.name == "nt":
        return subprocess.Popen(
            command,
            cwd=cwd,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
    return subprocess.Popen(command, cwd=cwd, start_new_session=True)


def _terminate(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            process.kill()
        else:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        process.wait(timeout=5)


def _run_process(
    command: list[str], cwd: Path, stop_requested: threading.Event
) -> int | None:
    process = _spawn(command, cwd)
    try:
        while process.poll() is None:
            if stop_requested.wait(0.2):
                _terminate(process)
                return None
        return process.returncode
    except BaseException:
        _terminate(process)
        raise


def run(*, port: int, no_browser: bool) -> int:
    if _stop_previous(STATE_PATH):
        print("Stopped the previous managed Azimut instance.")

    control = _ControlServer(STATE_PATH)
    control.start()
    try:
        print("Rebuilding the frontend...")
        result = _run_process(_npm_build_command(), ROOT / "frontend", control.stop_requested)
        if result is None:
            return 0
        if result != 0:
            return result

        command = [str(_venv_python(ROOT)), "-m", "azimut.cli", "--port", str(port)]
        if no_browser:
            command.append("--no-browser")
        print(f"Starting Azimut on http://127.0.0.1:{port}")
        result = _run_process(command, ROOT, control.stop_requested)
        return 0 if result is None else result
    finally:
        control.close()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Rebuild the frontend and relaunch the local Azimut checkout"
    )
    parser.add_argument("--port", type=int, default=8477)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("--port must be between 1 and 65535")
    try:
        return run(port=args.port, no_browser=args.no_browser)
    except RuntimeError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
