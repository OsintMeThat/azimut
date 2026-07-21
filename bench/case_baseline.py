#!/usr/bin/env python3
"""JSON-store baseline for the storage/performance migration (Step 0).

Builds the synthetic large case (tests/bigcase.py) and times the operations the
migration is meant to make cheap, on the current monolithic ``case.json``. The
numbers are the "before" this work is measured against; capture them on the
reference machine described in docs/STORAGE_AND_PERFORMANCE.md before changing
anything.

Standard library only, and it lives outside ``src/azimut`` so it is never
packaged into the wheel or the frozen binaries. Run it, don't ship it:

    python bench/case_baseline.py                    # default 10k/20k/5k
    python bench/case_baseline.py --no-media-files   # graph only, faster
    python bench/case_baseline.py --entities 2000 --links 4000 --media 1000
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import statistics
import sys
import tempfile
import time
from pathlib import Path

_TESTS = Path(__file__).resolve().parent.parent / "tests"
sys.path.insert(0, str(_TESTS))


def _time(fn, iterations: int) -> float:
    """Median wall-clock milliseconds over ``iterations`` calls of ``fn``."""
    samples = []
    for _ in range(iterations):
        start = time.perf_counter()
        fn()
        samples.append((time.perf_counter() - start) * 1000)
    return statistics.median(samples)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--entities", type=int, default=10_000)
    ap.add_argument("--links", type=int, default=20_000)
    ap.add_argument("--media", type=int, default=5_000)
    ap.add_argument("--notes", type=int, default=200)
    ap.add_argument("--artifacts", type=int, default=300)
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--iterations", type=int, default=25)
    ap.add_argument("--no-media-files", action="store_true",
                    help="skip writing placeholder media/sidecars (graph-only timing)")
    ap.add_argument("--home", type=Path, default=None,
                    help="workspace root to build in (default: a temp dir, removed after)")
    ap.add_argument("--keep", action="store_true", help="keep the temp workspace")
    args = ap.parse_args()

    home = args.home or Path(tempfile.mkdtemp(prefix="azimut-bench-"))
    os.environ["AZIMUT_HOME"] = str(home)

    # imported after AZIMUT_HOME is set; config reads the env at call time
    from azimut.engine import links as link_engine
    from bigcase import build_big_case

    print(f"workspace: {home}")
    print(f"building {args.entities} entities / {args.links} links / {args.media} media …")
    t0 = time.perf_counter()
    case, summary = build_big_case(
        entities=args.entities, links=args.links, media=args.media,
        notes=args.notes, artifacts=args.artifacts, seed=args.seed,
        write_media_files=not args.no_media_files,
    )
    build_ms = (time.perf_counter() - t0) * 1000

    data = case.read()
    ids = [e["id"] for e in data["entities"]]
    json_bytes = case.json_path.stat().st_size
    payload_bytes = len(json.dumps({"id": case.id, **data}))
    a, b = ids[0], ids[1]
    subject = next(lk["to"] for lk in data["links"] if lk["type"] == "depends-on")
    mid = ids[len(ids) // 2]

    it = args.iterations

    def op_add_entity():
        case.add_entity("domain", "bench-probe", {"note": "x"}, by="user")

    def op_add_link():
        case.add_link(a, b, "mentions", by="user")

    def op_update_entity():
        case.update_entity(mid, {"attrs": {"touched": time.time()}})

    def op_filter_scan():
        d = case.read()
        _ = [e for e in d["entities"] if e.get("type") == "media"]
        _ = [e for e in d["entities"] if "42" in e.get("label", "")]

    def op_plan_delete():
        link_engine.plan_delete(case, subject)

    def op_remove_entity():
        e = case.add_entity("domain", "bench-remove", by="user")
        start = time.perf_counter()
        case.remove_entity(e["id"])
        op_remove_entity.last = (time.perf_counter() - start) * 1000

    def timed_remove():
        op_remove_entity()
        return op_remove_entity.last

    results = [
        ("read (open case)", it, _time(case.read, it)),
        ("filter/search scan", it, _time(op_filter_scan, it)),
        ("plan_delete (dialog)", it, _time(op_plan_delete, it)),
        ("add_entity (1 write)", it, _time(op_add_entity, it)),
        ("add_link (1 write)", it, _time(op_add_link, it)),
        ("update_entity (1 write)", it, _time(op_update_entity, it)),
        ("remove_entity (1 write)", it,
         statistics.median([timed_remove() for _ in range(it)])),
    ]

    print()
    print(f"  entities={summary.entities}  links={summary.links}  "
          f"media={summary.media} ({summary.media_files_missing} missing files)  "
          f"notes={summary.notes}  artifacts={summary.artifacts}  "
          f"folders={summary.folders}  tombstoned={summary.tombstoned}")
    print(f"  case.json on disk : {json_bytes / 1e6:8.2f} MB")
    print(f"  case-open payload : {payload_bytes / 1e6:8.2f} MB  (shipped to the browser)")
    print(f"  fixture build     : {build_ms / 1000:8.2f} s")
    print()
    print(f"  {'operation':<26}{'iters':>7}{'median ms':>14}")
    print(f"  {'-' * 26}{'-' * 7}{'-' * 14}")
    for name, iters, ms in results:
        print(f"  {name:<26}{iters:>7}{ms:>14.3f}")
    print()
    print("  Every *_write op above is a full read-modify-write of case.json: its")
    print("  cost scales with the whole case, which is the ceiling this work lifts.")

    if not args.keep and args.home is None:
        shutil.rmtree(home, ignore_errors=True)
    elif args.keep:
        print(f"\n  kept workspace at {home}")


if __name__ == "__main__":
    main()
