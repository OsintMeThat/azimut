"""A case and a note made through the app's own routes, for the notes tests in any shard.

Shared from here rather than imported from another test file, so no Windows shard of the
CI needs a test file another shard runs (`tests/test_ci_shards.py`).
"""

from __future__ import annotations


def make_case(client, name="Report case"):
    return client.post("/api/cases", json={"name": name}).json()["id"]


def make_note(client, cid, title="Rooftop", content="Body.\n", folder=""):
    response = client.post(
        f"/api/cases/{cid}/notes", json={"title": title, "content": content, "folder": folder}
    )
    assert response.status_code == 200, response.text
    return response.json()
