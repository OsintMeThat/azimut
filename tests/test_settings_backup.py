"""Settings backup (export/import) and the lazy pairing-token mint."""

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
