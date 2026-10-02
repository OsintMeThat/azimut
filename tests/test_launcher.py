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
    monkeypatch.setattr(cli, "choose_port", lambda port: (port, False))
    monkeypatch.setattr(
        cli, "serve", lambda port, open_browser: captured.update(port=port, open_browser=open_browser)
    )
    monkeypatch.setattr(sys, "argv", ["azimut", "--port", "9999", "--no-browser"])
    cli.main()
    assert captured == {"port": 9999, "open_browser": False}


def test_cli_sends_a_second_start_to_the_running_tab(monkeypatch, capsys):
    """Started twice, Azimut opens the first one's tab instead of dying on a bind
    error in a console that closes before anyone reads it."""
    opened = []
    monkeypatch.setattr(cli, "choose_port", lambda port: (port, True))
    monkeypatch.setattr(cli, "serve", lambda *a, **k: (_ for _ in ()).throw(AssertionError("served twice")))
    monkeypatch.setattr(cli.webbrowser, "open", opened.append)
    monkeypatch.setattr(sys, "argv", ["azimut", "--port", "9999"])
    cli.main()
    assert opened == ["http://127.0.0.1:9999"]
    assert "already running" in capsys.readouterr().out


def test_cli_moves_to_the_next_port_when_another_program_holds_it(monkeypatch, capsys):
    captured = {}
    monkeypatch.setattr(cli, "choose_port", lambda port: (port + 1, False))
    monkeypatch.setattr(cli, "serve", lambda port, open_browser: captured.update(port=port))
    monkeypatch.setattr(sys, "argv", ["azimut", "--port", "9999", "--no-browser"])
    cli.main()
    assert captured == {"port": 10000}
    assert "in use by another program" in capsys.readouterr().out


def test_choose_port_tells_azimut_from_another_program():
    import socket
    import threading
    from http.server import BaseHTTPRequestHandler, HTTPServer

    class Health(BaseHTTPRequestHandler):
        body = b'{"status": "ok", "version": "0.0.0"}'

        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(self.body)

        def log_message(self, *args):
            pass

    azimut = HTTPServer(("127.0.0.1", 0), Health)
    threading.Thread(target=azimut.serve_forever, daemon=True).start()
    try:
        assert launcher.choose_port(azimut.server_port) == (azimut.server_port, True)
    finally:
        azimut.shutdown()
        azimut.server_close()

    other = socket.socket()
    other.bind(("127.0.0.1", 0))
    other.listen(1)
    try:
        port = other.getsockname()[1]
        chosen, running = launcher.choose_port(port)
        assert running is False and chosen != port
    finally:
        other.close()


def test_a_second_start_finds_the_azimut_holding_the_workspace_on_another_port(monkeypatch):
    """The first start moved to a free port while another program held 8477, which
    has let go since. Asking 8477 alone would start a second server, and that one
    would find the workspace taken."""
    import socket

    from azimut.engine import workspacelock

    monkeypatch.setattr(workspacelock, "holder", lambda root=None: {"host": socket.gethostname(), "port": 8478})
    monkeypatch.setattr(launcher, "_azimut_answers", lambda port: port == 8478)
    assert launcher.choose_port(8477) == (8478, True)

    # Another machine holding a shared folder is the server's to explain, not ours.
    monkeypatch.setattr(workspacelock, "holder", lambda root=None: {"host": "elsewhere", "port": 8478})
    monkeypatch.setattr(launcher, "_port_is_free", lambda port: True)
    assert launcher.choose_port(8477) == (8477, False)
