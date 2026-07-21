"""Settings backup (export/import) and the lazy pairing-token mint."""

import pytest

from azimut import config


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
    assert blob["api_keys"]["mapbox"] == "pk.exported"
    assert blob["units"] == "imperial"

    # wipe both, then restore from the exported blob
    client.put("/api/settings/keys", json={"mapbox": ""})
    client.put("/api/settings/prefs", json={"units": "metric"})
    res = client.post("/api/settings/import", json={"settings": blob}).json()
    assert "api_keys" in res["imported"]

    restored = client.get("/api/settings").json()
    assert restored["api_keys"]["mapbox"] == "pk.exported"
    assert restored["units"] == "imperial"


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
