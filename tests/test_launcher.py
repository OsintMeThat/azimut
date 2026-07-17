"""The launcher: build a localhost server and open the browser tab once it's up.

Azimut runs in a browser tab (no desktop window), so the launcher's whole job
is to bind loopback and open the tab when the server is actually listening.
"""

import sys
import time

from azimut import cli, launcher


def test_build_server_binds_localhost():
    server = launcher._build_server(9123)
    assert server.config.host == "127.0.0.1"
    assert server.config.port == 9123


def test_serve_runs_the_server_without_opening_a_browser(monkeypatch):
    calls = {"run": 0, "open": 0}

    class FakeServer:
        started = True

        def run(self):
            calls["run"] += 1

    monkeypatch.setattr(launcher, "_build_server", lambda port: FakeServer())
    monkeypatch.setattr(launcher.webbrowser, "open", lambda url: calls.__setitem__("open", 1))

    launcher.serve(8477, open_browser=False)
    assert calls["run"] == 1
    assert calls["open"] == 0


def test_serve_opens_the_browser_tab_when_ready(monkeypatch):
    opened = []

    class FakeServer:
        started = True

        def run(self):
            pass

    monkeypatch.setattr(launcher, "_build_server", lambda port: FakeServer())
    monkeypatch.setattr(launcher.webbrowser, "open", opened.append)

    launcher.serve(8477, open_browser=True)
    for _ in range(200):  # the open lands on a daemon thread — wait for it
        if opened:
            break
        time.sleep(0.01)
    assert opened == ["http://127.0.0.1:8477"]


def test_cli_forwards_arguments_to_serve(monkeypatch):
    captured = {}
    monkeypatch.setattr(
        cli, "serve", lambda port, open_browser: captured.update(port=port, open_browser=open_browser)
    )
    monkeypatch.setattr(sys, "argv", ["azimut", "--port", "9999", "--no-browser"])
    cli.main()
    assert captured == {"port": 9999, "open_browser": False}
