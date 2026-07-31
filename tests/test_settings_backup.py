"""Settings backup (export/import) and the lazy pairing-token mint.

The backup is one JSON file carrying everything app-wide that isn't a case:
settings.json, templates.json and the signature logo. Two invariants are worth
more than the individual cases below — every setting that can be exported can be
imported back (the drift gate), and ``cookies.txt`` never travels.
"""

import base64

import pytest

from azimut import config
from azimut.api.settings import ImportedSettings

PNG = config.PNG_MAGIC + b"a tiny fake logo"


def bundle_of(client) -> dict:
    return client.get("/api/settings/export").json()


# -- the drift gate ---------------------------------------------------------

# Keys that settings.json holds but a backup deliberately does not restore.
# Empty on purpose: an entry here is a decision, and it needs a reason next to
# it. Anything else showing up in the gate below is an oversight, not a policy.
NOT_RESTORED: dict[str, str] = {}


def test_every_exported_setting_can_be_imported_back():
    """The export dumps settings.json verbatim, so it can never fall behind; the
    import is an allowlist, so it can. This is the gate that says when it did.

    A new key in DEFAULT_SETTINGS fails here until it is either typed into
    ImportedSettings or listed in NOT_RESTORED with a reason. Without it, a
    forgotten key is exported and then silently dropped on the way back — which
    is exactly how `download_cookies` went missing.
    """
    exported = set(config.DEFAULT_SETTINGS)
    importable = {
        field.alias or name for name, field in ImportedSettings.model_fields.items()
    }
    unhandled = exported - importable - set(NOT_RESTORED)
    assert not unhandled, (
        f"settings key(s) {sorted(unhandled)} are exported but not importable: type them "
        "in ImportedSettings, or list them in NOT_RESTORED with the reason"
    )
    # And nothing claims to import a setting the app doesn't have.
    assert not importable - exported


def test_opening_settings_does_not_mint_the_pairing_token(client):
    # loading Settings must not create a credential (it used to mint on read)
    assert client.get("/api/settings").json()["ingest_token"] == ""
    minted = client.post("/api/settings/ingest-token").json()["ingest_token"]
    assert minted
    # once minted, it's reported and stable across reads
    assert client.get("/api/settings").json()["ingest_token"] == minted
    assert client.post("/api/settings/ingest-token").json()["ingest_token"] == minted


def test_export_then_import_restores_keys_and_prefs(client):
    client.put("/api/settings/keys", json={"mapbox": "pk.exported"})
    client.put("/api/settings/prefs", json={"units": "imperial"})

    exported = client.get("/api/settings/export")
    assert exported.headers["content-disposition"].startswith("attachment")
    blob = exported.json()
    assert blob["settings"]["api_keys"]["mapbox"] == "pk.exported"
    assert blob["settings"]["units"] == "imperial"

    # wipe both, then restore from the exported bundle
    client.put("/api/settings/keys", json={"mapbox": ""})
    client.put("/api/settings/prefs", json={"units": "metric"})
    res = client.post("/api/settings/import", json=blob).json()
    assert "api_keys" in res["imported"]

    restored = client.get("/api/settings").json()
    assert restored["api_keys"]["mapbox"] == "pk.exported"
    assert restored["units"] == "imperial"


# -- what the bundle carries ------------------------------------------------


def test_export_carries_templates_and_the_signature(client):
    client.post(
        "/api/templates/proof",
        json={"name": "House style", "data": {"frameColor": "#ff0000"}},
    )
    client.post("/api/settings/signature", files={"file": ("logo.png", PNG, "image/png")})

    blob = bundle_of(client)
    assert [t["name"] for t in blob["templates"]["proof"]] == ["House style"]
    assert base64.b64decode(blob["signature_png"]) == PNG


def test_import_restores_templates_and_the_signature(client):
    client.post("/api/templates/post", json={"name": "Thread", "data": {"body": "hello"}})
    client.post("/api/settings/signature", files={"file": ("logo.png", PNG, "image/png")})
    blob = bundle_of(client)

    # a fresh machine: no presets, no logo
    template_id = client.get("/api/templates").json()["post"][0]["id"]
    client.delete(f"/api/templates/post/{template_id}")
    client.delete("/api/settings/signature")
    assert client.get("/api/settings").json()["signature"] is False

    res = client.post("/api/settings/import", json=blob).json()
    assert res["templates"] == 1
    assert res["signature"] is True
    assert [t["name"] for t in client.get("/api/templates").json()["post"]] == ["Thread"]
    assert config.signature_path().read_bytes() == PNG


def test_export_leaves_the_login_session_behind(client):
    """cookies.txt is a live session: it stays on the machine that made it.

    Only the *choice* of login source travels (the test below); the session
    itself would expire in transit, trip the site's device checks, and multiply
    where a credential lives.
    """
    session = b"# Netscape HTTP Cookie File\n.x.com\tTRUE\t/\tTRUE\t0\tauth_token\tsecret\n"
    client.post(
        "/api/settings/cookies-file",
        files={"file": ("cookies.txt", session, "text/plain")},
    )
    assert config.cookies_file_path().is_file()

    raw = client.get("/api/settings/export").text
    assert "auth_token" not in raw
    assert "Netscape" not in raw


def test_export_leaves_the_workspace_location_behind(client, tmp_path):
    """Where the workspace is, is an address on *this* machine.

    A backup exists to carry keys and presets to another computer, where that
    path may be a drive letter that doesn't exist or someone else's home. So the
    pointer stays put, and it is deliberately not a settings key — which is why
    the drift gate above cannot be the thing that catches this.
    """
    pointed = tmp_path / "somewhere" / "Azimut"
    pointed.mkdir(parents=True)
    config.write_pointer(pointed)

    blob = bundle_of(client)

    assert "somewhere" not in str(blob)


def test_the_browser_login_choice_travels_but_a_missing_file_does_not(client):
    client.put(
        "/api/settings/prefs",
        json={"download_cookies": {"source": "browser", "browser": "firefox"}},
    )
    blob = bundle_of(client)
    assert blob["settings"]["download_cookies"] == {"source": "browser", "browser": "firefox"}

    client.put("/api/settings/prefs", json={"download_cookies": {"source": "none"}})
    client.post("/api/settings/import", json=blob)
    assert client.get("/api/settings").json()["download_cookies"] == {
        "source": "browser",
        "browser": "firefox",
    }


def test_a_file_login_source_lands_on_none_because_the_file_never_travels(client):
    client.post("/api/settings/import", json={"settings": {"download_cookies": {"source": "file"}}})
    assert client.get("/api/settings").json()["download_cookies"] == {"source": "none"}


def test_an_unknown_browser_lands_on_none(client):
    client.post(
        "/api/settings/import",
        json={"settings": {"download_cookies": {"source": "browser", "browser": "netscape"}}},
    )
    assert client.get("/api/settings").json()["download_cookies"]["source"] == "none"


# -- restoring is forgiving where it can be, strict where it must be --------


def test_an_older_backup_without_the_new_sections_still_imports(client):
    """A file written before templates and the logo travelled: settings only."""
    res = client.post("/api/settings/import", json={"settings": {"units": "imperial"}}).json()
    assert res == {"imported": ["units"], "templates": 0, "signature": False}
    assert client.get("/api/settings").json()["units"] == "imperial"


def test_a_bundle_with_only_templates_imports(client):
    res = client.post(
        "/api/settings/import",
        json={"templates": {"schema": 1, "proof": [{"id": "a1", "name": "Style", "data": {}}]}},
    ).json()
    assert res["imported"] == []
    assert res["templates"] == 1
    assert [t["name"] for t in client.get("/api/templates").json()["proof"]] == ["Style"]


def test_malformed_templates_are_dropped_not_saved(client):
    res = client.post(
        "/api/settings/import",
        json={"templates": {"schema": 1, "proof": [{"id": "bad id", "name": "", "data": "x"}]}},
    ).json()
    assert res["templates"] == 0
    assert client.get("/api/templates").json()["proof"] == []


@pytest.mark.parametrize(
    "encoded",
    [
        "not base64 at all",
        base64.b64encode(b"GIF89a not a png").decode(),
        base64.b64encode(b"").decode(),
    ],
)
def test_a_bad_signature_is_dropped_without_failing_the_restore(client, encoded):
    res = client.post(
        "/api/settings/import",
        json={"settings": {"units": "imperial"}, "signature_png": encoded},
    )
    assert res.status_code == 200
    assert res.json()["signature"] is False
    # the valuable part still landed
    assert client.get("/api/settings").json()["units"] == "imperial"
    assert config.signature_path().is_file() is False


def test_a_signature_over_the_size_cap_is_dropped_like_a_malformed_one(client):
    oversized = base64.b64encode(PNG + b"\0" * config.SIGNATURE_MAX_BYTES).decode()
    res = client.post("/api/settings/import", json={"signature_png": oversized})
    assert res.status_code == 200
    assert res.json()["signature"] is False
    assert config.signature_path().is_file() is False


def test_a_grotesque_signature_field_is_refused_before_it_is_decoded(client):
    """The string bound comes first: a field far past any real logo is rejected
    without spending memory to base64-decode it."""
    res = client.post("/api/settings/import", json={"signature_png": "A" * 10_000_000})
    assert res.status_code == 422
    assert config.signature_path().is_file() is False


def test_import_ignores_unknown_keys(client):
    res = client.post(
        "/api/settings/import", json={"settings": {"evil": "boom", "units": "imperial"}}
    ).json()
    assert res["imported"] == ["units"]
    stored = config.load_settings()
    assert "evil" not in stored
    assert stored["units"] == "imperial"


def test_import_canonicalizes_known_fields_and_ignores_future_provider_keys(client):
    response = client.post(
        "/api/settings/import",
        json={
            "settings": {
                "api_keys": {"mapbox": "  pk.restored  ", "empty": "   "},
                "providers_enabled": {"mapbox": False, "future": True},
                "eco_max_zooms": {"mapbox": 12, "future": 4},
                "post_mention": "  @account  ",
            }
        },
    )
    assert response.status_code == 200
    stored = config.load_settings()
    assert stored["api_keys"] == {"mapbox": "pk.restored"}
    assert stored["providers_enabled"] == {"mapbox": False}
    assert stored["eco_max_zooms"] == {"mapbox": 12}
    assert stored["post_mention"] == "@account"


@pytest.mark.parametrize(
    "field,value",
    [
        ("api_keys", ["bad"]),
        ("free_tiers", ["bad"]),
        ("free_tiers", {"mapbox": 0}),
        ("usage", {"mapbox": {"2026-13": 1}}),
        ("usage", {"mapbox": {"2026-07": -1}}),
        ("home_view", {"lat": 91.0, "lon": 0.0, "zoom": 12}),
        ("eco_max_zoom", 99),
        ("coord_format", "utm"),
        ("post_target", "threads"),
        ("update_check_on_start", 1),
        ("tile_providers", [{"id": "bad id", "url": "https://tiles/{z}/{x}/{y}"}]),
    ],
)
def test_import_rejects_malformed_known_fields_without_partial_write(client, field, value):
    before = config.settings_path().read_bytes()
    response = client.post(
        "/api/settings/import",
        json={"settings": {"units": "imperial", field: value}},
    )
    assert response.status_code == 422
    assert config.settings_path().read_bytes() == before
    assert config.load_settings()["units"] == "metric"


def test_a_signature_no_gate_ever_saw_is_left_out_of_the_backup(client):
    """The upload route bounds what Settings accepts, but a file dropped into the
    workspace by hand has been through nothing. A backup is not the place to
    discover it: reading it whole to encode it is the work the gate exists to
    refuse."""
    from azimut import config

    path = config.signature_path()
    path.parent.mkdir(parents=True, exist_ok=True)

    # too big, even though it really is a PNG
    path.write_bytes(PNG + b"\x00" * (config.SIGNATURE_MAX_BYTES + 1))
    assert client.get("/api/settings/export").json()["signature_png"] == ""

    # small enough, but not a PNG at all
    path.write_bytes(b"GIF89a not really an image")
    assert client.get("/api/settings/export").json()["signature_png"] == ""

    # the real thing still travels
    path.write_bytes(PNG)
    assert base64.b64decode(client.get("/api/settings/export").json()["signature_png"]) == PNG
