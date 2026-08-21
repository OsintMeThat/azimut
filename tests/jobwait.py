"""Wait for a background job the way the browser does.

Every road that ends in a job — a download, a sheet press, a proof import, a frame
suggestion — is polled here, and each caller used to count its own turns: a hundred turns
of a tenth of a second in one module, two hundred of a twentieth in the next. A turn is
not a unit of time. A poll that costs a millisecond on a developer's machine costs whole
seconds on the Windows runner, so the same count of turns was a different budget on every
box, and on that one it ran out while a three-row press was still filing its second row.

Wall clock instead, in one place, so "long enough" is said once.
"""

from __future__ import annotations

import time
from typing import Any

#: Long enough for the slowest box we run on. Windows spends around twenty seconds on a
#: three-row proofs press, against under one here, and a job that is genuinely stuck
#: fails the shard either way — so the cost of being generous is paid only when something
#: is already broken.
WAIT = 60.0


def wait_for_job(client, job_id: str, *, timeout: float = WAIT) -> dict[str, Any]:
    """The job's record once it stops running, whatever it ended as."""
    deadline = time.monotonic() + timeout
    while True:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] != "running":
            return job
        assert time.monotonic() < deadline, f"the job never finished: {job}"
        time.sleep(0.05)


def job_result(client, job_id: str, *, timeout: float = WAIT) -> Any:
    """The result of a job that has to succeed, reporting the record if it did not."""
    job = wait_for_job(client, job_id, timeout=timeout)
    assert job["status"] == "done", job
    return job["result"]
