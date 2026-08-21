"""The loopback Host / Origin guard (server.install_local_guard).

The server binds localhost, but a page the browser already has open can still
reach 127.0.0.1 directly, or point a name it controls at it (DNS rebinding).
The guard is the wall: the Host must be a loopback name, and a cross-origin web
Origin is turned away everywhere except the token-gated ingest island, which
opens itself to browser-extension origins on purpose.

The shared ``client`` fixture already uses a loopback base_url, so per-request
header overrides are exactly what the guard sees.
"""


def test_loopback_host_is_allowed(client):
    for host in ("127.0.0.1", "127.0.0.1:8477", "localhost", "[::1]:8477"):
        assert client.get("/api/health", headers={"host": host}).status_code == 200
    # a *.localhost name still resolves to loopback and defeats rebinding
    assert client.get("/api/health", headers={"host": "app.localhost"}).status_code == 200


def test_non_loopback_host_is_refused(client):
    # DNS rebinding: a name the attacker controls now points at 127.0.0.1
    r = client.get("/api/health", headers={"host": "evil.example"})
    assert r.status_code == 400
    assert r.text == "invalid host header"


def test_cross_origin_web_page_is_refused(client):
    r = client.get("/api/health", headers={"origin": "https://evil.example"})
    assert r.status_code == 403


def test_same_origin_web_page_is_allowed(client):
    assert client.get("/api/health", headers={"origin": "http://127.0.0.1:8477"}).status_code == 200
    assert client.get("/api/health", headers={"origin": "http://localhost:8477"}).status_code == 200


def test_extension_origin_reaches_only_the_ingest_island(client):
    ext = "chrome-extension://abcdefghijklmnop"
    # the guard lets the extension through on ingest routes — it fails later at
    # the token wall (401), not at the guard (403)
    assert client.get("/api/ingest/ping", headers={"origin": ext}).status_code == 401
    # but anywhere else the extension origin is a cross-origin web page
    assert client.get("/api/health", headers={"origin": ext}).status_code == 403


def test_a_malformed_pairing_token_is_a_refusal_and_not_a_crash(client):
    """The one authenticated surface, asked with bytes it never mints.

    Starlette decodes a header as latin-1, so an octet above 0x7f reaches the comparison as
    a non-ASCII string and `secrets.compare_digest` raises `TypeError` on one. That was a
    500 on the authentication edge — a refusal reported as a server fault, with a traceback
    into the log kept for "Report an issue" — from a value any caller chooses.
    """
    from azimut import config

    config.save_settings({**config.load_settings(), "ingest_token": "abc123"})
    right = client.get("/api/ingest/ping", headers={"X-Azimut-Token": b"abc123"})
    assert right.status_code == 200

    for token in (b"\xe9", b"abc12\xff", b"", "é".encode()):
        answer = client.get("/api/ingest/ping", headers={"X-Azimut-Token": token})
        assert answer.status_code == 401, token
        assert answer.json()["detail"] == "missing or invalid pairing token"
